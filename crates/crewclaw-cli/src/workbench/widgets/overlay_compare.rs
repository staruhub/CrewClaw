//! v0.17 P1-B2：MARKET `x` 勾选 ≤2 员工 → `c` 打开对比浮层（对齐设计稿 COMPARE overlay）。
//!
//! 数据真值(用户标准:有真用真,无真明示 MOCK)：全部字段来自 registry 真值的
//! `MarketEntry`(status/category/tags/hermes_req/env_reqs/first_task)。设计稿里的
//! ★评分/tasks/accept 等指标引擎没有真源——不造,不出现在这个浮层里。

use ratatui::{
    Frame,
    layout::{Constraint, Direction, Layout},
    style::{Modifier, Style},
    text::{Line, Span, Text},
    widgets::{Block, Borders, Clear, Paragraph},
};

use crate::workbench::config;
use crate::workbench::state::{MarketEntry, UiState};
use crate::workbench::ui::centered_rect;

pub(crate) fn render_compare(frame: &mut Frame<'_>, ui_state: &UiState) {
    if !ui_state.compare_open {
        return;
    }
    let entries: Vec<&MarketEntry> = ui_state
        .compare_selection
        .iter()
        .filter_map(|&i| ui_state.market.get(i))
        .collect();
    if entries.len() != 2 {
        return;
    }

    // v0.16 修复：先铺整帧幕布，避免居中弹层四周留白露出底层 WORKBENCH 内容(见 render_modal_backdrop)。
    crate::workbench::ui::render_modal_backdrop(frame);
    let area = centered_rect(76, 60, frame.area());
    frame.render_widget(Clear, area);

    let block = Block::default()
        .title(Span::styled(
            " ⇄ COMPARE · 员工对比 ",
            Style::default()
                .fg(config::aqua())
                .add_modifier(Modifier::BOLD),
        ))
        .title_bottom(Line::from(Span::styled(
            " Esc/q 关闭 ",
            Style::default().fg(config::dim()),
        )))
        .borders(Borders::ALL)
        .border_style(Style::default().fg(config::aqua()))
        .style(Style::default().bg(config::bg()));
    let inner = block.inner(area);
    frame.render_widget(block, area);

    let cols = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([Constraint::Ratio(1, 2); 2])
        .spacing(2)
        .split(inner);

    for (col, e) in cols.iter().zip(entries.iter()) {
        frame.render_widget(Paragraph::new(Text::from(compare_column(e))), *col);
    }
}

fn compare_column(e: &MarketEntry) -> Vec<Line<'static>> {
    let dim = Style::default().fg(config::dim());
    let fg = Style::default().fg(config::fg());
    let row = move |label: &'static str, value: String| -> Line<'static> {
        Line::from(vec![
            Span::styled(format!("{label:<10}"), dim),
            Span::styled(value, fg),
        ])
    };
    vec![
        Line::from(Span::styled(
            e.display_name.clone(),
            Style::default()
                .fg(config::yellow())
                .add_modifier(Modifier::BOLD),
        )),
        Line::from(""),
        row("status", e.status.clone()),
        row(
            "category",
            if e.category.is_empty() {
                "—".into()
            } else {
                e.category.clone()
            },
        ),
        row(
            "tags",
            if e.tags.is_empty() {
                "—".into()
            } else {
                e.tags.join(" / ")
            },
        ),
        row(
            "hermes",
            if e.hermes_req.is_empty() {
                "—".into()
            } else {
                e.hermes_req.clone()
            },
        ),
        row(
            "env",
            if e.env_reqs.is_empty() {
                "无额外声明".into()
            } else {
                e.env_reqs.join(" · ")
            },
        ),
        row(
            "first task",
            if e.first_task.is_empty() {
                "—".into()
            } else {
                e.first_task.clone()
            },
        ),
    ]
}
