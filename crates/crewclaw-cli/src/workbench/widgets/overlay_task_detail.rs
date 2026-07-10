//! v0.15 P1-3：TASK DETAIL 全屏浮层（对齐 handoff 设计稿 `TASK DETAIL OVERLAY`）。
//!
//! 数据真值（用户标准：有真用真，无真明示）：全部读 AppState,零造数据——
//!   - FULL EVENT LOG = 完整 timeline（ts/status图标/event_type/label/detail_kv）。
//!   - OUTCOME = status（映射状态字）/events（timeline 长度）/cost（引擎 est_cost）/
//!     kpi impact（accepted_count 真计数）。
//!   - ARTIFACTS = 真实产物（bytes→KB + status）；EVIDENCE = 真实证据（source + source_type）。
//! 无真源的 budget/progress 不摆（设计稿有,但我们无真值 → 省略,不造）。

use ratatui::{
    Frame,
    layout::{Alignment, Constraint, Direction, Layout, Rect},
    style::{Modifier, Style},
    text::{Line, Span, Text},
    widgets::{Block, Clear, Paragraph},
};

use unicode_width::UnicodeWidthStr;

use crate::workbench::config;
use crate::workbench::state::AppState;
use crate::workbench::ui::{event_type_color, fmt_hhmm, symbol_color, truncate_display_width};

use super::workbench_panels::titled_block;

/// 当前任务号 + 是否运行中（复用 QUEUE 的真序号规则：已完结任务头计数 + 运行中 +1）。
fn current_task_number(state: &AppState) -> (usize, bool) {
    let heads = state
        .timeline
        .iter()
        .filter(|e| e.task_meta.is_some())
        .count();
    match state.task.as_ref() {
        Some(t) if t.status == "running" => (heads + 1, true),
        _ => (heads.max(1), false),
    }
}

/// 状态字（设计稿映射：⚙ RUNNING / ⏸ WAITING APPROVAL / ★ DELIVERED / · IDLE）。
fn status_word(state: &AppState, running: bool) -> (&'static str, ratatui::style::Color) {
    if state.approval.is_some() {
        ("⏸ WAITING APPROVAL", config::orange())
    } else if running {
        ("⚙ RUNNING", config::aqua())
    } else if state.timeline.iter().any(|e| e.task_meta.is_some()) {
        ("★ DELIVERED", config::green())
    } else {
        ("· IDLE", config::dim())
    }
}

/// 最近一次任务的估算成本（引擎 est_cost 真值；无则 None）。
fn latest_cost(state: &AppState) -> Option<f64> {
    state
        .timeline
        .iter()
        .rev()
        .find_map(|e| e.task_meta.as_ref().and_then(|m| m.est_cost))
}

fn cost_str(state: &AppState) -> String {
    latest_cost(state)
        .map(|c| format!("${c:.2}"))
        .unwrap_or_else(|| "—".to_string())
}

pub(crate) fn render_task_detail(frame: &mut Frame<'_>, state: &AppState) {
    let area = frame.area();
    frame.render_widget(Clear, area);
    // 不透明底：先铺一整块 bg,避免露出底层三栏。
    frame.render_widget(
        Block::default().style(Style::default().bg(config::bg())),
        area,
    );

    // 内边距 1 列/行。
    let pad = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(1), // header
            Constraint::Length(1), // 分隔
            Constraint::Min(3),    // body
            Constraint::Length(1), // 底提示
        ])
        .horizontal_margin(1)
        .vertical_margin(0)
        .split(area);

    render_header(frame, state, pad[0]);
    // 分隔线
    frame.render_widget(
        Paragraph::new(Line::from(Span::styled(
            "─".repeat(pad[1].width as usize),
            Style::default().fg(config::border()),
        ))),
        pad[1],
    );
    render_body(frame, state, pad[2]);
    frame.render_widget(
        Paragraph::new(Line::from(Span::styled(
            "Esc / q / o 返回工作台 · j/k 在工作台切换事件",
            Style::default().fg(config::dim()),
        ))),
        pad[3],
    );
}

fn render_header(frame: &mut Frame<'_>, state: &AppState, area: Rect) {
    let (num, running) = current_task_number(state);
    let (word, wcolor) = status_word(state, running);
    let title = state
        .task
        .as_ref()
        .map(|t| t.title.clone())
        .filter(|t| !t.is_empty())
        .unwrap_or_else(|| "（暂无任务）".to_string());

    let left = vec![
        Span::styled(
            truncate_display_width(&title, (area.width as usize).saturating_sub(40).max(8)),
            Style::default()
                .fg(config::yellow())
                .add_modifier(Modifier::BOLD),
        ),
        Span::styled(format!("  task #{num}"), Style::default().fg(config::dim())),
        Span::styled(
            format!("  {word}"),
            Style::default().fg(wcolor).add_modifier(Modifier::BOLD),
        ),
    ];
    let left_line = Line::from(left);
    let used = left_line.width();
    let meta = format!(
        "cost {} · {} events · Esc 返回",
        cost_str(state),
        state.timeline.len()
    );
    let meta_w = meta.width();
    let gap = (area.width as usize).saturating_sub(used + meta_w);
    let mut spans = left_line.spans;
    spans.push(Span::raw(" ".repeat(gap)));
    spans.push(Span::styled(meta, Style::default().fg(config::dim())));
    frame.render_widget(Paragraph::new(Line::from(spans)), area);
}

fn render_body(frame: &mut Frame<'_>, state: &AppState, area: Rect) {
    let cols = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([Constraint::Percentage(58), Constraint::Percentage(42)])
        .spacing(1)
        .split(area);

    render_event_log(frame, state, cols[0]);
    render_right(frame, state, cols[1]);
}

fn render_event_log(frame: &mut Frame<'_>, state: &AppState, area: Rect) {
    let block = titled_block("FULL EVENT LOG", config::yellow());
    let inner = block.inner(area);
    frame.render_widget(block, area);
    let width = inner.width as usize;

    let mut lines: Vec<Line> = Vec::new();
    for entry in &state.timeline {
        let time = fmt_hhmm(entry.ts);
        let type_col = truncate_display_width(entry.event_type, 18);
        let type_pad = 18usize.saturating_sub(type_col.width());
        let head_w = time.width() + 1 + 1 + 1 + 18 + 1;
        let label = truncate_display_width(&entry.label, width.saturating_sub(head_w).max(4));
        let mut spans = vec![
            Span::styled(time, Style::default().fg(config::dim())),
            Span::styled(
                format!(" {}", entry.status),
                Style::default().fg(symbol_color(&entry.status)),
            ),
            Span::styled(
                format!(" {type_col}{} ", " ".repeat(type_pad)),
                Style::default().fg(event_type_color(entry.event_type)),
            ),
            Span::raw(label.clone()),
        ];
        // extra（detail 概要）右对齐。
        if !entry.detail.is_empty() {
            let used = head_w + label.width();
            let rest = width.saturating_sub(used + 2);
            if rest >= 4 {
                let meta = truncate_display_width(&entry.detail, rest);
                let padn = width.saturating_sub(used + meta.width());
                spans.push(Span::raw(" ".repeat(padn)));
                spans.push(Span::styled(meta, Style::default().fg(config::dim())));
            }
        }
        lines.push(Line::from(spans));
        // detail_kv 次行（缩进）。
        if !entry.detail_kv.is_empty() {
            let kv = entry
                .detail_kv
                .iter()
                .map(|(k, v)| format!("{k}: {v}"))
                .collect::<Vec<_>>()
                .join(" · ");
            lines.push(Line::from(Span::styled(
                format!(
                    "  {}",
                    truncate_display_width(&kv, width.saturating_sub(2).max(4))
                ),
                Style::default().fg(config::dim()),
            )));
        }
    }
    if lines.is_empty() {
        lines.push(Line::from(Span::styled(
            "（暂无事件——发一条消息给员工后,这里显示完整事件日志）",
            Style::default().fg(config::dim()),
        )));
    }
    // 溢出时贴底显示尾部（最新事件）。
    let vis = inner.height as usize;
    let scroll = lines.len().saturating_sub(vis) as u16;
    frame.render_widget(Paragraph::new(Text::from(lines)).scroll((scroll, 0)), inner);
}

fn render_right(frame: &mut Frame<'_>, state: &AppState, area: Rect) {
    let rows = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(7),                                         // OUTCOME
            Constraint::Length((state.artifacts.len() as u16).min(6) + 2), // ARTIFACTS
            Constraint::Min(3),                                            // EVIDENCE
        ])
        .split(area);

    render_outcome(frame, state, rows[0]);
    render_artifacts(frame, state, rows[1]);
    render_evidence(frame, state, rows[2]);
}

fn outcome_row(k: &str, v: String, color: ratatui::style::Color, width: usize) -> Line<'static> {
    let kw = k.width();
    let vw = v.width();
    let gap = width.saturating_sub(kw + vw);
    Line::from(vec![
        Span::styled(k.to_string(), Style::default().fg(config::dim())),
        Span::raw(" ".repeat(gap)),
        Span::styled(v, Style::default().fg(color)),
    ])
}

fn render_outcome(frame: &mut Frame<'_>, state: &AppState, area: Rect) {
    let block = titled_block("OUTCOME", config::green());
    let inner = block.inner(area);
    frame.render_widget(block, area);
    let w = inner.width as usize;
    let (_, running) = current_task_number(state);
    let (word, wcolor) = status_word(state, running);
    let (kpi, kpi_c) = if state.accepted_count > 0 {
        (
            format!("accepted +{}", state.accepted_count),
            config::green(),
        )
    } else {
        ("pending".to_string(), config::dim())
    };
    let lines = vec![
        outcome_row(
            "status",
            word.trim_start_matches(['⚙', '⏸', '★', '·', ' '])
                .to_string(),
            wcolor,
            w,
        ),
        outcome_row("events", state.timeline.len().to_string(), config::fg(), w),
        outcome_row("cost", cost_str(state), config::yellow(), w),
        outcome_row("kpi impact", kpi, kpi_c, w),
    ];
    frame.render_widget(Paragraph::new(Text::from(lines)), inner);
}

fn render_artifacts(frame: &mut Frame<'_>, state: &AppState, area: Rect) {
    let block = titled_block("ARTIFACTS", config::green());
    let inner = block.inner(area);
    frame.render_widget(block, area);
    let w = inner.width as usize;
    let mut lines: Vec<Line> = Vec::new();
    if state.artifacts.is_empty() {
        lines.push(Line::from(Span::styled(
            "（本任务暂无产物）",
            Style::default().fg(config::dim()),
        )));
    }
    for a in state.artifacts.iter().take(6) {
        let name = a.name.clone().unwrap_or_else(|| "未命名".to_string());
        let color = if a.status == "accepted" {
            config::green()
        } else {
            config::fg()
        };
        let mut meta = String::new();
        if let Some(b) = a.bytes {
            meta.push_str(&human_kb(b));
        }
        if !a.status.is_empty() {
            if !meta.is_empty() {
                meta.push_str(" · ");
            }
            meta.push_str(&a.status);
        }
        let head = format!("▤ {name}");
        let head_t = truncate_display_width(&head, w.saturating_sub(meta.width() + 1).max(4));
        let gap = w.saturating_sub(head_t.width() + meta.width());
        lines.push(Line::from(vec![
            Span::styled(head_t, Style::default().fg(color)),
            Span::raw(" ".repeat(gap)),
            Span::styled(meta, Style::default().fg(config::dim())),
        ]));
    }
    frame.render_widget(Paragraph::new(Text::from(lines)), inner);
}

fn render_evidence(frame: &mut Frame<'_>, state: &AppState, area: Rect) {
    let block = titled_block("EVIDENCE", config::purple());
    let inner = block.inner(area);
    frame.render_widget(block, area);
    let w = inner.width as usize;
    let mut lines: Vec<Line> = Vec::new();
    if state.evidence.is_empty() {
        lines.push(Line::from(Span::styled(
            "（暂无引用来源）",
            Style::default().fg(config::dim()),
        )));
    }
    for e in &state.evidence {
        let src = e
            .source
            .clone()
            .or_else(|| e.fact.clone())
            .unwrap_or_else(|| "来源".to_string());
        lines.push(Line::from(Span::styled(
            format!(
                "◈ {}",
                truncate_display_width(&src, w.saturating_sub(2).max(4))
            ),
            Style::default().fg(config::fg()),
        )));
        let tag = e
            .source_type
            .clone()
            .map(|t| format!("source_type {t}"))
            .or_else(|| e.confidence.map(|c| format!("confidence {c:.2}")))
            .unwrap_or_else(|| "未分类".to_string());
        lines.push(Line::from(Span::styled(
            format!("  {tag}"),
            Style::default().fg(config::dim()),
        )));
    }
    frame.render_widget(
        Paragraph::new(Text::from(lines)).alignment(Alignment::Left),
        inner,
    );
}

fn human_kb(bytes: u64) -> String {
    if bytes < 1024 {
        format!("{bytes} B")
    } else {
        format!("{:.1} KB", bytes as f64 / 1024.0)
    }
}
