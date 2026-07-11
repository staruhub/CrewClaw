//! v0.15 P1-2：通知中心浮层（对齐 handoff 设计稿 NOTIFICATIONS）。
//!
//! 数据真值：条目全部由 reducer 从**真事件**派生（审批请求/交付/验收/打回）。
//! 预算告警/Dream/年审无真源 → 不造(不出现)。未读态由 `Notice.read` 承载。

use ratatui::{
    Frame,
    layout::Rect,
    style::{Modifier, Style},
    text::{Line, Span, Text},
    widgets::{Block, Borders, Clear, Paragraph},
};

use unicode_width::UnicodeWidthStr;

use crate::workbench::config;
use crate::workbench::state::{AppState, NoticeKind, UiState};
use crate::workbench::ui::{fmt_hhmm, truncate_display_width};

fn kind_color(kind: NoticeKind) -> ratatui::style::Color {
    match kind {
        NoticeKind::Approval => config::orange(),
        NoticeKind::Delivered => config::green(),
        NoticeKind::Accepted => config::green(),
        NoticeKind::Rejected => config::red(),
        NoticeKind::Budget => config::yellow(),
    }
}

/// v0.16 W4.2：跳转行动文案(设计稿 notifsData 的 `act` 字段,按类别真值映射)。
fn action_text(kind: NoticeKind) -> &'static str {
    match kind {
        NoticeKind::Approval => "→ 去批准",
        NoticeKind::Delivered => "→ 看详情",
        NoticeKind::Accepted => "→ 看 KPI",
        NoticeKind::Rejected => "→ 去处理",
        NoticeKind::Budget => "→ 调预算",
    }
}

/// v0.16 W4.2：右上角锚定(设计稿 `top:2px right:14px width:420px`,而非居中)。
fn top_right_rect(frame_area: Rect) -> Rect {
    let width = (46u16).min(frame_area.width.saturating_sub(4)).max(20);
    let height = ((frame_area.height * 6) / 10).min(frame_area.height.saturating_sub(2));
    let x = frame_area.width.saturating_sub(width + 1);
    let y = 1u16.min(frame_area.height.saturating_sub(1));
    Rect {
        x,
        y,
        width,
        height,
    }
}

pub(crate) fn render_notifications(frame: &mut Frame<'_>, state: &AppState, ui_state: &UiState) {
    let area = top_right_rect(frame.area());
    frame.render_widget(Clear, area);

    let unread = state.unread_notices();
    let title = Line::from(vec![
        Span::styled(
            " ◔ NOTIFICATIONS · 通知中心 ",
            Style::default()
                .fg(config::blue())
                .add_modifier(Modifier::BOLD),
        ),
        Span::styled(
            format!("{unread} 未读 "),
            Style::default().fg(if unread > 0 {
                config::red()
            } else {
                config::dim()
            }),
        ),
    ]);
    let block = Block::default()
        .title(title)
        .title_bottom(Line::from(Span::styled(
            " j/k 选 · Enter 跳转并已读 · R 全部已读 · Esc 关闭 ",
            Style::default().fg(config::dim()),
        )))
        .borders(Borders::ALL)
        // v0.16 W4.2：blue 边框(原 aqua,设计稿 NOTIFICATIONS 用 --blue)。
        .border_style(Style::default().fg(config::blue()))
        .style(Style::default().bg(config::bg()));
    let inner = block.inner(area);
    frame.render_widget(block, area);

    if state.notices.is_empty() {
        frame.render_widget(
            Paragraph::new(Text::from(vec![
                Line::from(""),
                Line::from(Span::styled(
                    "  暂无通知——审批请求/交付/验收/打回会实时出现在这里。",
                    Style::default().fg(config::dim()),
                )),
            ])),
            inner,
        );
        return;
    }

    // 最新在上。
    let ordered: Vec<(usize, &crate::workbench::state::Notice)> =
        state.notices.iter().enumerate().rev().collect();
    let width = inner.width as usize;
    let mut lines: Vec<Line> = Vec::new();
    for (row, (_, n)) in ordered.iter().enumerate() {
        let selected = row == ui_state.notif_cursor.min(ordered.len().saturating_sub(1));
        let color = kind_color(n.kind);
        let marker = if selected { "▌" } else { " " };
        let dot = if n.read { " " } else { "●" };
        let time = fmt_hhmm(n.ts);
        let head = format!("{marker}{} {} ", n.kind.icon(), n.title);
        let tail = format!("{dot} {time}");
        let pad = width.saturating_sub(head.width() + tail.width());
        let row_style = if selected {
            Style::default().bg(config::bg2())
        } else {
            Style::default()
        };
        lines.push(Line::from(vec![
            Span::styled(
                head,
                row_style.fg(color).add_modifier(if selected {
                    Modifier::BOLD
                } else {
                    Modifier::empty()
                }),
            ),
            Span::styled(" ".repeat(pad), row_style),
            Span::styled(
                tail,
                row_style.fg(if n.read { config::dim() } else { config::red() }),
            ),
        ]));
        // 正文次行 + 行尾跳转行动文案(设计稿 `{{ nf.body }} {{ nf.act }}`)。
        let action = action_text(n.kind);
        let body_w = width.saturating_sub(3 + action.width() + 1).max(4);
        lines.push(Line::from(vec![
            Span::styled(
                format!("   {}", truncate_display_width(&n.body, body_w)),
                row_style.fg(config::dim()),
            ),
            Span::styled(format!(" {action}"), row_style.fg(color)),
        ]));
        // v0.16 W4.2：行间 dashed 分隔(设计稿 `border-bottom:1px dashed var(--bg2)`)。
        lines.push(Line::from(Span::styled(
            "╌".repeat(width),
            Style::default().fg(config::bg2()),
        )));
    }
    // 让选中行尽量可见：简单贴底滚动。
    let vis = inner.height as usize;
    let scroll = (lines.len().saturating_sub(vis)) as u16;
    let scroll = scroll.min((ui_state.notif_cursor as u16) * 2);
    frame.render_widget(Paragraph::new(Text::from(lines)).scroll((scroll, 0)), inner);
}

/// 用于键位层：把当前选中的通知标为已读，返回其跳转屏（若有）。
/// ordered = 最新在前，故 cursor 0 是最新。
/// v0.17 P0-3：返回被标记的通知的 `kind`，供调用方按类别跳屏（此前一律跳 WORKBENCH——
/// Accepted 通知的行动文案明明写着"→ 看 KPI"，Enter 却从不带你去 EVAL 屏，是半做）。
pub(crate) fn mark_selected_read(state: &mut AppState, cursor: usize) -> Option<NoticeKind> {
    let len = state.notices.len();
    if len == 0 {
        return None;
    }
    // ordered rev：cursor 0 → 最后一条（最新）。
    let idx = len.saturating_sub(1).saturating_sub(cursor.min(len - 1));
    let notice = state.notices.get_mut(idx)?;
    notice.read = true;
    Some(notice.kind)
}
