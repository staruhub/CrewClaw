use ratatui::{
    Frame,
    layout::{Constraint, Direction, Layout, Rect},
    style::{Modifier, Style},
    text::{Line, Span, Text},
    widgets::{Block, Borders, Paragraph, Wrap},
};
use unicode_width::UnicodeWidthStr;

use super::super::{
    config,
    preview::read_artifact_preview,
    state::{AppState, UiState},
    ui::{status_symbol, symbol_color, truncate_display_width},
};

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct ArtifactPreviewRow {
    pub title: String,
    pub detail: String,
}

pub(crate) fn artifact_preview_row(state: &AppState) -> Option<ArtifactPreviewRow> {
    let preview = state.preview.as_ref()?;
    Some(ArtifactPreviewRow {
        title: preview.title.clone(),
        detail: preview.detail.clone(),
    })
}

/// WORKBENCH 中屏（2col）的常驻产物阅读器。列表选中即预览；完整浮层仍由 Enter 打开。
pub(crate) fn render_inline(
    frame: &mut Frame<'_>,
    state: &AppState,
    ui_state: &UiState,
    area: Rect,
) {
    let list_height =
        (state.artifacts.len().min(5) as u16 + 3).clamp(5, area.height.saturating_sub(5).max(5));
    let rows = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Length(list_height), Constraint::Min(4)])
        .split(area);
    render_artifact_list(frame, state, rows[0]);
    render_preview_body(frame, state, ui_state, rows[1]);
}

/// 宽屏（≥140 三栏）右栏四段（设计稿构成）：ARTIFACTS → TOOLS → EVIDENCE → PREVIEW。
/// TOOLS/EVIDENCE 数据源见 workbench_panels（session.ready 能力真值 / evidence 事件）；
/// 中屏 2col 仍走 `render_inline` 的 ARTIFACTS+PREVIEW，窄屏降级路径不变。
pub(crate) fn render_inline_wide(
    frame: &mut Frame<'_>,
    state: &AppState,
    ui_state: &UiState,
    area: Rect,
) {
    // 各盒高度按真数据行数收敛：TOOLS = 目录条数(≤8)+框；EVIDENCE = 每条 2 行(≤3 条)+框；
    // 占位分支各 1 行。PREVIEW 吃剩余。
    let tools_h = (state.tool_catalog.len().clamp(1, 8) as u16) + 2;
    let evidence_rows = match state.evidence.len().min(3) {
        0 => 1,
        n => (n * 2) as u16,
    };
    let evidence_h = evidence_rows + 2;
    let list_height = (state.artifacts.len().min(4) as u16 + 3).clamp(
        5,
        area.height.saturating_sub(tools_h + evidence_h + 4).max(5),
    );
    let rows = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(list_height),
            Constraint::Length(tools_h),
            Constraint::Length(evidence_h),
            Constraint::Min(4),
        ])
        .split(area);
    render_artifact_list(frame, state, rows[0]);
    super::workbench_panels::render_tools_box(frame, state, rows[1]);
    super::workbench_panels::render_evidence_box(frame, state, rows[2]);
    render_preview_body(frame, state, ui_state, rows[3]);
}

fn render_artifact_list(frame: &mut Frame<'_>, state: &AppState, area: Rect) {
    let block = Block::default()
        .title(Span::styled(
            " ARTIFACTS ",
            Style::default()
                .fg(config::yellow())
                .add_modifier(Modifier::BOLD),
        ))
        .borders(Borders::ALL)
        .border_style(Style::default().fg(config::border()));
    let inner = block.inner(area);
    frame.render_widget(block, area);
    let sections = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Min(1), Constraint::Length(1)])
        .split(inner);
    let width = sections[0].width as usize;
    let selected_id = state.selected_artifact_id();
    let mut lines = Vec::new();
    if state.artifacts.is_empty() {
        lines.push(Line::from(Span::styled(
            truncate_display_width("尚无产物", width),
            Style::default().fg(config::dim()),
        )));
        lines.push(Line::from(Span::styled(
            truncate_display_width("任务完成后会出现在这里", width),
            Style::default().fg(config::dim()),
        )));
    } else {
        for (index, artifact) in state.artifacts.iter().rev().take(5).enumerate() {
            let selected = artifact.id.as_ref() == selected_id.as_ref();
            let name = artifact
                .name
                .as_deref()
                .or(artifact.id.as_deref())
                .unwrap_or("未命名");
            let marker = if selected { ">" } else { " " };
            let status = status_symbol(&artifact.status);
            let newest = index == 0 && selected;
            let tail = if newest { " NEW" } else { "" };
            let head_width = marker.width() + status.width() + tail.width() + 2;
            lines.push(Line::from(vec![
                Span::styled(
                    format!("{marker}{status} "),
                    Style::default().fg(symbol_color(status)),
                ),
                Span::styled(
                    truncate_display_width(name, width.saturating_sub(head_width).max(4)),
                    if selected {
                        Style::default()
                            .fg(config::yellow())
                            .add_modifier(Modifier::BOLD)
                    } else {
                        Style::default().fg(config::fg())
                    },
                ),
                Span::styled(tail.to_string(), Style::default().fg(config::aqua())),
            ]));
        }
    }
    frame.render_widget(Paragraph::new(Text::from(lines)), sections[0]);
    frame.render_widget(
        Paragraph::new(Line::from(Span::styled(
            truncate_display_width("p 聚焦 · [ ] 切换 · Ctrl+O 全部", inner.width as usize),
            Style::default().fg(config::aqua()),
        ))),
        sections[1],
    );
}

fn render_preview_body(frame: &mut Frame<'_>, state: &AppState, ui_state: &UiState, area: Rect) {
    let selected = state.selected_artifact();
    let name = selected
        .and_then(|artifact| artifact.name.as_deref().or(artifact.id.as_deref()))
        .unwrap_or("无选择");
    let border = if ui_state.preview_focused {
        config::green()
    } else {
        config::border()
    };
    let block = Block::default()
        .title(Span::styled(
            format!(" PREVIEW · {} ", truncate_display_width(name, 32)),
            Style::default()
                .fg(if ui_state.preview_focused {
                    config::green()
                } else {
                    config::yellow()
                })
                .add_modifier(Modifier::BOLD),
        ))
        .borders(Borders::ALL)
        .border_style(Style::default().fg(border));
    let inner = block.inner(area);
    frame.render_widget(block, area);

    let content = match selected {
        None => "选择产物后将在这里预览。\nCtrl+O 打开完整产物列表。".to_string(),
        Some(artifact) => artifact
            .path
            .as_deref()
            .and_then(|path| read_artifact_preview(path, 400, 64 * 1024).ok())
            .filter(|text| !text.trim().is_empty())
            .or_else(|| artifact.summary.clone())
            .or_else(|| state.preview.as_ref().map(|preview| preview.detail.clone()))
            .unwrap_or_else(|| "产物暂无可读文本预览。".to_string()),
    };
    frame.render_widget(
        Paragraph::new(content)
            .style(Style::default().fg(config::fg()))
            .wrap(Wrap { trim: false })
            .scroll((ui_state.preview_scroll, 0)),
        inner,
    );
}
