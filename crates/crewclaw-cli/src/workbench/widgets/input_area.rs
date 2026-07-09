use ratatui::{
    Frame,
    layout::{Position, Rect},
    style::{Modifier, Style},
    text::{Line, Span, Text},
    widgets::{Block, Borders, Paragraph, Wrap},
};
use unicode_width::UnicodeWidthStr;

// v0.8 M7：输入框 chrome 色板同样走 config::Theme（dark/light 可配）。
use crate::workbench::config::{accent as ACCENT, border as BORDER, dim as DIM, green as GREEN};

/// v0.13：设计规范的输入提示符前缀（仅首行；宽 2 列）。
const PROMPT: &str = "› ";

pub(crate) fn height_for_input(input: &str, terminal_height: u16) -> u16 {
    let max_height = terminal_height
        .saturating_div(3)
        .max(6)
        .min(terminal_height.saturating_sub(3).max(3));
    let desired = input_line_count(input).saturating_add(2) as u16;
    desired.clamp(3, max_height)
}

pub(crate) fn render(
    frame: &mut Frame<'_>,
    area: Rect,
    input: &str,
    cursor: usize,
    focused: bool,
    placeholder: &str,
    spans: &[(usize, usize)],
    identity: &str,
) {
    // v0.13：聚焦边框 green（设计规范：INPUT 聚焦时边框变 --green）。
    // v0.16 W1.2：离焦=bd(设计稿 inputBd,非 dim);›/标题与边框同源色。
    let border_style = if focused {
        Style::default().fg(GREEN()).add_modifier(Modifier::BOLD)
    } else {
        Style::default().fg(BORDER())
    };
    let title = if focused { " INPUT " } else { " input " };
    let body_height = area.height.saturating_sub(2) as usize;
    let lines = visible_input_lines(input, cursor, focused, placeholder, body_height, spans);

    let mut block = Block::default()
        .borders(Borders::ALL)
        .title(title)
        .border_style(border_style);
    // v0.9 M4：员工名·model 收进输入框标题右侧（dim），替代已移除的顶部 header。
    if !identity.is_empty() {
        block = block.title(
            Line::from(Span::styled(
                format!(" {identity} "),
                Style::default().fg(DIM()),
            ))
            .right_aligned(),
        );
    }

    frame.render_widget(
        Paragraph::new(Text::from(lines))
            .block(block)
            .wrap(Wrap { trim: false }),
        area,
    );

    if let Some(position) = cursor_position(area, input, cursor, focused, body_height) {
        frame.set_cursor_position(position);
    }
}

fn visible_input_lines(
    input: &str,
    cursor: usize,
    focused: bool,
    placeholder: &str,
    body_height: usize,
    spans: &[(usize, usize)],
) -> Vec<Line<'static>> {
    if body_height == 0 {
        return Vec::new();
    }
    // v0.13：首行前置 › 提示符（随首行滚出视口时不再显示）。
    // v0.16 W1.2：› 与边框同源色(设计稿 `color:{{inputBd}}`——聚焦 green/离焦 bd)。
    let prompt_color = if focused { GREEN() } else { BORDER() };
    let prompt_span = || Span::styled(PROMPT.to_string(), Style::default().fg(prompt_color));
    if input.is_empty() {
        // v0.16：空输入恒显占位(设计稿 HTML placeholder 语义——聚焦与否都提示能做什么)。
        return vec![Line::from(vec![
            prompt_span(),
            Span::styled(placeholder.to_string(), Style::default().fg(DIM())),
        ])];
    }

    // 每行连同其在 input 中的 byte 起点，用于把落在该行内的占位块区间上色。
    let mut line_offsets = Vec::new();
    let mut offset = 0usize;
    for line in input.split('\n') {
        line_offsets.push((offset, line));
        offset += line.len() + 1; // +1 = '\n'
    }
    let cursor_row = cursor_row(input, cursor);
    let start = visible_start(cursor_row, line_offsets.len(), body_height);
    line_offsets
        .iter()
        .enumerate()
        .skip(start)
        .take(body_height)
        .map(|(row, (line_start, line))| {
            let mut styled = styled_line(line, *line_start, spans);
            if row == 0 {
                styled.spans.insert(0, prompt_span());
            }
            styled
        })
        .collect()
}

/// v0.8 M6：把单行按占位块区间切成 Span，块内文本反色（ACCENT bg）以示原子块。`line_start` 是该行
/// 在整个 input 中的 byte 起点，`spans` 为绝对 byte 区间。
fn styled_line(line: &str, line_start: usize, spans: &[(usize, usize)]) -> Line<'static> {
    let line_end = line_start + line.len();
    // 收集与本行相交的块，转成行内相对 byte 区间并按起点排序。
    let mut local: Vec<(usize, usize)> = spans
        .iter()
        .filter(|(s, e)| *s < line_end && *e > line_start)
        .map(|(s, e)| (s.saturating_sub(line_start), (*e).min(line_end) - line_start))
        .collect();
    if local.is_empty() {
        return Line::from(Span::raw(line.to_string()));
    }
    local.sort_by_key(|(s, _)| *s);
    let mut out = Vec::new();
    let mut pos = 0usize;
    for (s, e) in local {
        if s > pos {
            out.push(Span::raw(line[pos..s].to_string()));
        }
        out.push(Span::styled(
            line[s..e].to_string(),
            Style::default().fg(ACCENT()).add_modifier(Modifier::REVERSED),
        ));
        pos = e;
    }
    if pos < line.len() {
        out.push(Span::raw(line[pos..].to_string()));
    }
    Line::from(out)
}

fn cursor_position(
    area: Rect,
    input: &str,
    cursor: usize,
    focused: bool,
    body_height: usize,
) -> Option<Position> {
    if !focused || area.width <= 2 || area.height <= 2 || body_height == 0 {
        return None;
    }
    let cursor = closest_char_boundary(input, cursor.min(input.len()));
    let (cursor_row, prefix) = cursor_line_prefix(input, cursor);
    let line_count = input_line_count(input);
    let start = visible_start(cursor_row, line_count, body_height);
    let visible_row = cursor_row.saturating_sub(start);
    if visible_row >= body_height {
        return None;
    }
    let max_x = area.width.saturating_sub(2) as usize;
    // v0.13：首行有 › 前缀（宽 2），光标 x 相应右移。
    let prompt_w = if cursor_row == 0 {
        UnicodeWidthStr::width(PROMPT)
    } else {
        0
    };
    Some(Position {
        x: area.x + 1 + (prompt_w + UnicodeWidthStr::width(prefix)).min(max_x) as u16,
        y: area.y + 1 + visible_row as u16,
    })
}

fn visible_start(cursor_row: usize, line_count: usize, body_height: usize) -> usize {
    if line_count <= body_height {
        return 0;
    }
    cursor_row.saturating_add(1).saturating_sub(body_height)
}

fn cursor_row(input: &str, cursor: usize) -> usize {
    input[..closest_char_boundary(input, cursor.min(input.len()))]
        .bytes()
        .filter(|byte| *byte == b'\n')
        .count()
}

fn cursor_line_prefix(input: &str, cursor: usize) -> (usize, &str) {
    let before_cursor = &input[..cursor];
    let row = before_cursor.bytes().filter(|byte| *byte == b'\n').count();
    let line_start = before_cursor
        .rfind('\n')
        .map(|index| index + 1)
        .unwrap_or(0);
    (row, &input[line_start..cursor])
}

fn input_line_count(input: &str) -> usize {
    input.split('\n').count().max(1)
}

fn closest_char_boundary(text: &str, index: usize) -> usize {
    if text.is_char_boundary(index) {
        return index;
    }
    text.char_indices()
        .map(|(boundary, _)| boundary)
        .take_while(|boundary| *boundary < index)
        .last()
        .unwrap_or(0)
}
