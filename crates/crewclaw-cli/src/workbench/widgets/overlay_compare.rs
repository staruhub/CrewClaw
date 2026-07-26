//! MARKET `x` 勾选 2-3 名员工 → `c` 打开真实 KPI 对比浮层。
//!
//! 数据真值(用户标准:有真用真,无真明示 MOCK)：全部字段来自 registry 真值的
//! `MarketEntry` 与其启动时读盘的 `kpi_cumulative`；无历史的指标显示 `—`。

use ratatui::{
    Frame,
    layout::{Constraint, Direction, Layout},
    style::{Modifier, Style},
    text::{Line, Span, Text},
    widgets::{Block, Borders, Clear, Paragraph},
};

use crate::workbench::config;
use crate::workbench::state::{MarketEntry, UiState};
use crate::workbench::ui::{centered_rect, truncate_display_width};

pub(crate) fn render_compare(frame: &mut Frame<'_>, ui_state: &UiState) {
    if !ui_state.compare_open() {
        return;
    }
    let entries: Vec<&MarketEntry> = ui_state
        .compare_selection
        .iter()
        .filter_map(|&i| ui_state.market.get(i))
        .collect();
    if !(2..=3).contains(&entries.len()) {
        return;
    }

    // v0.16 修复：先铺整帧幕布，避免居中弹层四周留白露出底层 WORKBENCH 内容(见 render_modal_backdrop)。
    crate::workbench::ui::render_modal_backdrop(frame);
    let area = centered_rect(92, 88, frame.area());
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

    let denominator = entries.len() as u32;
    let cols = Layout::default()
        .direction(Direction::Horizontal)
        .constraints(vec![Constraint::Ratio(1, denominator); entries.len()])
        .spacing(2)
        .split(inner);

    let best = CompareBest::from_entries(&entries);
    for (col, e) in cols.iter().zip(entries.iter()) {
        frame.render_widget(Paragraph::new(Text::from(compare_column(e, &best))), *col);
    }
}

#[derive(Default)]
struct CompareBest {
    tasks: Option<u64>,
    acceptance: Option<f64>,
    average_cost: Option<f64>,
}

impl CompareBest {
    fn from_entries(entries: &[&MarketEntry]) -> Self {
        let tasks = entries
            .iter()
            .filter(|entry| entry.kpi_cumulative.tasks > 0)
            .map(|entry| entry.kpi_cumulative.tasks)
            .max();
        let acceptance = entries
            .iter()
            .filter(|entry| entry.kpi_cumulative.tasks > 0)
            .map(|entry| entry.kpi_cumulative.accepted as f64 / entry.kpi_cumulative.tasks as f64)
            .max_by(f64::total_cmp);
        let average_cost = entries
            .iter()
            .filter(|entry| entry.kpi_cumulative.tasks > 0)
            .map(|entry| entry.kpi_cumulative.total_cost / entry.kpi_cumulative.tasks as f64)
            .filter(|value| value.is_finite())
            .min_by(f64::total_cmp);
        Self {
            tasks,
            acceptance,
            average_cost,
        }
    }
}

fn metric_row(label: &'static str, value: String, best: bool) -> Line<'static> {
    Line::from(vec![
        Span::styled(format!("{label:<10}"), Style::default().fg(config::dim())),
        Span::styled(
            value,
            Style::default()
                .fg(if best { config::green() } else { config::fg() })
                .add_modifier(if best {
                    Modifier::BOLD
                } else {
                    Modifier::empty()
                }),
        ),
        Span::styled(
            if best { "  BEST" } else { "" },
            Style::default().fg(config::green()),
        ),
    ])
}

fn compare_column(e: &MarketEntry, best: &CompareBest) -> Vec<Line<'static>> {
    let dim = Style::default().fg(config::dim());
    let fg = Style::default().fg(config::fg());
    let row = move |label: &'static str, value: String| -> Line<'static> {
        Line::from(vec![
            Span::styled(format!("{label:<10}"), dim),
            Span::styled(value, fg),
        ])
    };
    let cumulative = &e.kpi_cumulative;
    let has_history = cumulative.tasks > 0;
    let acceptance = has_history.then(|| cumulative.accepted as f64 / cumulative.tasks as f64);
    let average_cost = has_history
        .then(|| cumulative.total_cost / cumulative.tasks as f64)
        .filter(|value| value.is_finite());
    vec![
        Line::from(Span::styled(
            e.display_name.clone(),
            Style::default()
                .fg(config::yellow())
                .add_modifier(Modifier::BOLD),
        )),
        Line::from(""),
        Line::from(Span::styled(
            "REAL KPI",
            Style::default()
                .fg(config::aqua())
                .add_modifier(Modifier::BOLD),
        )),
        metric_row(
            "tasks",
            if has_history {
                cumulative.tasks.to_string()
            } else {
                "—".to_string()
            },
            has_history && best.tasks == Some(cumulative.tasks),
        ),
        metric_row(
            "accepted",
            acceptance
                .map(|rate| format!("{} ({:.0}%)", cumulative.accepted, rate * 100.0))
                .unwrap_or_else(|| "—".to_string()),
            acceptance.is_some() && acceptance == best.acceptance,
        ),
        metric_row(
            "avg cost",
            average_cost
                .map(|cost| format!("${cost:.3}"))
                .unwrap_or_else(|| "—".to_string()),
            average_cost.is_some() && average_cost == best.average_cost,
        ),
        metric_row(
            "compat",
            e.compatibility_level
                .map(|level| format!("L{level}/L4"))
                .unwrap_or_else(|| "—".to_string()),
            false,
        ),
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
                truncate_display_width(&e.first_task, 18)
            },
        ),
    ]
}
