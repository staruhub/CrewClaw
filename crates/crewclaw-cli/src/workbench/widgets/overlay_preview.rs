//! v0.15 P1-5 / v0.16 W4.1：产物预览浮层（对齐 handoff 设计稿 PREVIEW OVERLAY）。
//!
//! 数据真值：内容 = `read_artifact_preview` **真读磁盘文件**（截断 ≤400 行/8000 字符）；
//! 读不到时回退产物 summary/path（真元数据），并明示无法读取——不造正文。
//! v0.16：补齐设计稿的 j/k 滚动交互 + 头部 meta 行 + 底部 workspace 提示 + n/N 文件序号。

use ratatui::{
    Frame,
    layout::{Constraint, Direction, Layout, Rect},
    style::{Modifier, Style},
    text::{Line, Span, Text},
    widgets::{Block, Borders, Clear, Paragraph, Wrap},
};

use crate::workbench::config;
use crate::workbench::preview::read_artifact_preview;
use crate::workbench::state::AppState;
use crate::workbench::ui::{centered_rect, fmt_hhmm};

const MAX_LINES: usize = 400;
const MAX_CHARS: usize = 8_000;

pub(crate) fn render_preview(frame: &mut Frame<'_>, state: &AppState, scroll: u16) {
    // v0.16 修复：先铺整帧幕布，避免居中弹层四周留白露出底层 WORKBENCH 内容(见 render_modal_backdrop)。
    crate::workbench::ui::render_modal_backdrop(frame);
    let area = centered_rect(76, 74, frame.area());
    frame.render_widget(Clear, area);

    let artifact = state.selected_artifact();
    let name = artifact
        .and_then(|a| a.name.clone())
        .unwrap_or_else(|| "产物".to_string());

    // v0.16 W4.1：aqua 边框(原 green,设计稿 PREVIEW 用 --aqua)。
    let block = Block::default()
        .title(Span::styled(
            format!(" PREVIEW · {name} "),
            Style::default()
                .fg(config::aqua())
                .add_modifier(Modifier::BOLD),
        ))
        .borders(Borders::ALL)
        .border_style(Style::default().fg(config::aqua()))
        .style(Style::default().bg(config::bg()));
    let inner = block.inner(area);
    frame.render_widget(block, area);

    let rows = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(1), // 头部 meta 行
            Constraint::Length(1), // 分隔
            Constraint::Min(3),    // 正文(可滚动)
            Constraint::Length(1), // 底部 workspace 提示 + n/N
        ])
        .split(inner);

    render_header_meta(frame, artifact, rows[0]);
    frame.render_widget(
        Paragraph::new(Line::from(Span::styled(
            "─".repeat(rows[1].width as usize),
            Style::default().fg(config::border()),
        ))),
        rows[1],
    );
    render_body(frame, artifact, scroll, rows[2]);
    render_footer(frame, state, rows[3]);
}

fn render_header_meta(frame: &mut Frame<'_>, artifact: Option<&crate::workbench::state::Artifact>, area: Rect) {
    let mut left = String::new();
    if let Some(a) = artifact {
        if let Some(k) = a.kind.as_deref() {
            left.push_str(k);
        }
        if let Some(b) = a.bytes {
            if !left.is_empty() {
                left.push_str(" · ");
            }
            left.push_str(&human_kb(b));
        }
        if !a.status.is_empty() {
            if !left.is_empty() {
                left.push_str(" · ");
            }
            left.push_str(&a.status);
        }
        if a.created_ts > 0 {
            if !left.is_empty() {
                left.push_str(" · ");
            }
            left.push_str(&format!("生成于 {}", fmt_hhmm(a.created_ts)));
        }
    }
    let right = "j/k 滚动 · [ ] 切换文件 · Esc 关闭";
    let width = area.width as usize;
    let pad = width.saturating_sub(left.len() + right.len()).max(1);
    frame.render_widget(
        Paragraph::new(Line::from(vec![
            Span::styled(left, Style::default().fg(config::dim())),
            Span::raw(" ".repeat(pad)),
            Span::styled(right, Style::default().fg(config::dim())),
        ])),
        area,
    );
}

fn render_body(
    frame: &mut Frame<'_>,
    artifact: Option<&crate::workbench::state::Artifact>,
    scroll: u16,
    area: Rect,
) {
    let mut lines: Vec<Line> = Vec::new();
    match artifact.and_then(|a| a.path.clone()) {
        Some(path) => match read_artifact_preview(&path, MAX_LINES, MAX_CHARS) {
            Ok(content) => {
                for line in content.lines() {
                    if line.starts_with("… (truncated,") {
                        lines.push(Line::from(Span::styled(
                            line.to_string(),
                            Style::default().fg(config::dim()),
                        )));
                    } else {
                        lines.push(Line::from(line.to_string()));
                    }
                }
                if lines.is_empty() {
                    lines.push(Line::from(Span::styled(
                        "（文件为空）",
                        Style::default().fg(config::dim()),
                    )));
                }
            }
            Err(err) => {
                lines.push(Line::from(Span::styled(
                    format!("无法读取 {path}：{err}"),
                    Style::default().fg(config::red()),
                )));
                if let Some(sum) = artifact.and_then(|a| a.summary.clone()) {
                    lines.push(Line::from(""));
                    lines.push(Line::from(Span::styled(sum, Style::default().fg(config::dim()))));
                }
            }
        },
        None => {
            lines.push(Line::from(Span::styled(
                "此产物没有磁盘路径,无法预览正文。",
                Style::default().fg(config::dim()),
            )));
            if let Some(sum) = artifact.and_then(|a| a.summary.clone()) {
                lines.push(Line::from(""));
                lines.push(Line::from(sum));
            }
        }
    }
    frame.render_widget(
        Paragraph::new(Text::from(lines))
            .wrap(Wrap { trim: false })
            .scroll((scroll, 0)),
        area,
    );
}

fn render_footer(frame: &mut Frame<'_>, state: &AppState, area: Rect) {
    let left = "workspace/ · 只读预览 · 批准后正式交付";
    let idx = state.selected_artifact_index().map(|i| i + 1).unwrap_or(0);
    let total = state.artifacts.len();
    let right = format!("{idx}/{total}");
    let width = area.width as usize;
    let pad = width.saturating_sub(left.len() + right.len()).max(1);
    frame.render_widget(
        Paragraph::new(Line::from(vec![
            Span::styled(left, Style::default().fg(config::dim())),
            Span::raw(" ".repeat(pad)),
            Span::styled(right, Style::default().fg(config::dim())),
        ])),
        area,
    );
}

fn human_kb(bytes: u64) -> String {
    if bytes < 1024 {
        format!("{bytes} B")
    } else {
        format!("{:.1} KB", bytes as f64 / 1024.0)
    }
}
