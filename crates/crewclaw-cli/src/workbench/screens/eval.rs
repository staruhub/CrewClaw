//! v0.13 M6 EVAL 屏：规范 §8 布局——左：6 格 KPI 网格 + 月度条形 + 上岗考试；右：35ch REPUTATION
//! 侧栏（verdict 绿 PASS）。
//! v0.17 P2 C1：6 格 KPI 网格改真值——来自 `employee.kpi_cumulative`(引擎 kpi.mjs 跨会话真累计,
//! 与 EMPLOYEE 面板"累计"区同一数据源)。月度条形/上岗考试/REPUTATION 侧栏引擎侧仍无数据源，
//! 各自就地标 MOCK(不再用一个顶层徽标笼统盖住真假混合的整屏——那样会把真瓦片也说成演示)。

use ratatui::{
    Frame,
    layout::{Constraint, Direction, Layout, Rect},
    style::{Modifier, Style},
    text::{Line, Span, Text},
    widgets::{Block, Borders, Paragraph},
};

use super::super::config;
use super::super::state::{AppState, EvalReport, KpiCumulative, UiState};
use super::{bar, mock_badge, pad_left, screen_block, section};

/// 月度条形/上岗考试/REPUTATION 侧栏——引擎无数据源，静态演示看板。deterministic——不随机、
/// 不读时钟，测试可断言。
struct EvalBoard {
    months: [(&'static str, u32); 6],
    exams: [(&'static str, u32); 3],
    reputation: u32,
    hires: u32,
    reviews: [(&'static str, &'static str); 3],
}

impl EvalBoard {
    fn mock() -> Self {
        EvalBoard {
            months: [
                ("2月", 8),
                ("3月", 12),
                ("4月", 15),
                ("5月", 19),
                ("6月", 23),
                ("7月", 27),
            ],
            exams: [("模型选型", 88), ("Agent 工作流", 82), ("ROI 评估", 90)],
            reputation: 86,
            hires: 34,
            reviews: [
                ("阿超", "交付快，口径清楚"),
                ("P 总", "ROI 测算靠谱"),
                ("小满", "驳回后修订到位"),
            ],
        }
    }
}

/// v0.17 P2 C1：员工首次验收距今的天数（epoch ms 差，向下取整）。无历史 → None（不伪造"0 天"）。
fn tenure_days(first_hired_ts: Option<u64>) -> Option<u64> {
    let ts = first_hired_ts?;
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .ok()?
        .as_millis() as u64;
    Some(now_ms.saturating_sub(ts) / 86_400_000)
}

pub fn render(frame: &mut Frame<'_>, state: &AppState, _ui_state: &UiState, area: Rect) {
    let block = screen_block("EVAL", "绩效 · KPI · 考试 · 信誉");
    let inner = block.inner(area);
    frame.render_widget(block, area);

    let b = EvalBoard::mock();
    let cum = state
        .employee
        .as_ref()
        .map(|e| e.kpi_cumulative)
        .unwrap_or_default();
    // v0.18 B2：上岗考试真评测（None=从未评测,回落 MOCK 占位）。
    let eval = state.employee.as_ref().and_then(|e| e.eval.as_ref());
    // 规范 §8：左主区 | 右 REPUTATION 侧栏（280px ≈ 35ch）。窄于 90 列时退化为单栏（不挤压）。
    if inner.width >= 90 {
        let cols = Layout::default()
            .direction(Direction::Horizontal)
            .constraints([Constraint::Min(40), Constraint::Length(35)])
            .split(inner);
        render_main(frame, &b, &cum, eval, pad_left(cols[0]));
        render_reputation(frame, &b, cols[1]);
    } else {
        render_main(frame, &b, &cum, eval, pad_left(inner));
    }
}

fn render_main(frame: &mut Frame<'_>, b: &EvalBoard, cum: &KpiCumulative, eval: Option<&EvalReport>, area: Rect) {
    let dim = Style::default().fg(config::dim());
    let fg = Style::default().fg(config::fg());

    // 顶部固定 4 行给真值标注 + KPI 瓦片(bg1 底+bd 框,2 行×3 列);其余(月度条形/上岗考试/
    // verdict)仍是一个滚动 Paragraph,用 Layout 纵向分两段。
    let rows = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Length(1), Constraint::Length(1), Constraint::Length(6), Constraint::Min(3)])
        .split(area);
    // v0.17 P2 C1：这 6 格瓦片现在是真数据——标"真实"而非 MOCK(月度条形/考试仍在下方标 MOCK)。
    frame.render_widget(
        Paragraph::new(Line::from(Span::styled(
            " 累计 KPI · 真实（跨会话）",
            Style::default().fg(config::green()).add_modifier(Modifier::BOLD),
        ))),
        rows[0],
    );
    render_kpi_tiles(frame, cum, rows[2]);

    let mut lines: Vec<Line> = Vec::new();
    lines.push(mock_badge());
    lines.push(Line::from(""));

    // 月度完成任务条形图。
    lines.push(section("每月完成任务"));
    let max = b.months.iter().map(|(_, v)| *v).max().unwrap_or(1);
    for (m, v) in b.months {
        lines.push(Line::from(vec![
            Span::styled(format!("  {m:<4}"), dim),
            Span::styled(bar(v, max, 24), Style::default().fg(config::blue())),
            Span::styled(format!(" {v}"), fg),
        ]));
    }
    lines.push(Line::from(""));

    // v0.18 B2：上岗考试——三态。有真评测(eval-runner 落盘)→ 真分；mock 跑 → 橙色明示非认证；
    // 从未评测 → 保留 EvalBoard::mock() 占位（明示 MOCK，等有人跑一次 eval:expert）。
    render_exams(&mut lines, b, eval, dim, fg);

    frame.render_widget(Paragraph::new(Text::from(lines)), rows[3]);
}

/// v0.18 B2：上岗考试 section 的三态渲染（真实 / MOCK 跑 / 从未评测占位）。
fn render_exams(lines: &mut Vec<Line<'static>>, b: &EvalBoard, eval: Option<&EvalReport>, dim: Style, fg: Style) {
    let score_bar = |score: u32| {
        let color = if score >= 85 { config::green() } else if score >= 60 { config::yellow() } else { config::red() };
        (bar(score, 100, 18), color)
    };
    match eval {
        // 真实认证分。
        Some(rep) if !rep.mock => {
            lines.push(Line::from(vec![
                Span::styled("上岗考试 · ", Style::default().fg(config::dim()).add_modifier(Modifier::BOLD)),
                Span::styled(
                    format!("真实（{} · {}）", rep.model, crate::workbench::ui::fmt_date(rep.evaluated_at)),
                    Style::default().fg(config::green()),
                ),
            ]));
            for exam in &rep.exams {
                let (glyph, color) = score_bar(exam.score);
                let name = crate::workbench::ui::truncate_display_width(&exam.id, 14);
                lines.push(Line::from(vec![
                    Span::styled(format!("  {name:<14}"), dim),
                    Span::styled(glyph, Style::default().fg(color)),
                    Span::styled(format!(" {}", exam.score), Style::default().fg(color)),
                ]));
            }
            push_verdict(lines, &rep.verdict, dim);
        }
        // MOCK 跑（CREW_MOCK 机械 harness，非认证分）。
        Some(rep) => {
            lines.push(Line::from(vec![
                Span::styled("上岗考试 · ", Style::default().fg(config::dim()).add_modifier(Modifier::BOLD)),
                Span::styled("MOCK 跑（CREW_MOCK · 非认证分）", Style::default().fg(config::orange())),
            ]));
            for exam in &rep.exams {
                let name = crate::workbench::ui::truncate_display_width(&exam.id, 14);
                let (glyph, _c) = score_bar(exam.score);
                lines.push(Line::from(vec![
                    Span::styled(format!("  {name:<14}"), dim),
                    Span::styled(glyph, Style::default().fg(config::dim())),
                    Span::styled(format!(" {}", exam.score), dim),
                ]));
            }
            push_verdict(lines, &rep.verdict, dim);
        }
        // 从未评测——保留占位（明示 MOCK；提示怎么跑真评测）。
        None => {
            lines.push(Line::from(vec![
                Span::styled("上岗考试 · ", Style::default().fg(config::dim()).add_modifier(Modifier::BOLD)),
                Span::styled("示例数据（未评测,跑 eval:expert 出真分）", Style::default().fg(config::orange())),
            ]));
            for (name, score) in b.exams {
                let color = if score >= 85 { config::green() } else { config::yellow() };
                lines.push(Line::from(vec![
                    Span::styled(format!("  {name:<14}"), dim),
                    Span::styled(bar(score, 100, 18), Style::default().fg(color)),
                    Span::styled(format!(" {score}"), Style::default().fg(color)),
                ]));
            }
            let _ = fg;
            push_verdict(lines, "PASS", dim);
        }
    }
}

fn push_verdict(lines: &mut Vec<Line<'static>>, verdict: &str, dim: Style) {
    let pass = verdict.eq_ignore_ascii_case("pass");
    lines.push(Line::from(vec![
        Span::styled("  verdict ", dim),
        Span::styled(
            format!(" {} ", verdict.to_uppercase()),
            Style::default()
                .fg(config::bg())
                .bg(if pass { config::green() } else { config::red() })
                .add_modifier(Modifier::BOLD),
        ),
    ]));
}

/// v0.17 P2 C1：KPI 6 瓦片——真累计数据(bg1 底+bd 框,2 行×3 列;值大字彩色+可选第三行注记)。
/// 无历史(从未跑过任务)的字段一律 "—"，不伪造 0%/$0.00 这类看似真实的假数字。
fn render_kpi_tiles(frame: &mut Frame<'_>, cum: &KpiCumulative, area: Rect) {
    let accept_rate = if cum.tasks > 0 {
        format!("{:.0}%", cum.accepted as f64 / cum.tasks as f64 * 100.0)
    } else {
        "—".to_string()
    };
    let total_cost = if cum.total_cost > 0.0 {
        format!("${:.2}", cum.total_cost)
    } else {
        "—".to_string()
    };
    let avg_cost = if cum.tasks > 0 && cum.total_cost > 0.0 {
        format!("${:.2}", cum.total_cost / cum.tasks as f64)
    } else {
        "—".to_string()
    };
    let tenure = tenure_days(cum.first_hired_ts)
        .map(|d| format!("{d} 天"))
        .unwrap_or_else(|| "—".to_string());
    let hired_note = cum
        .first_hired_ts
        .map(|ts| format!("自 {}", crate::workbench::ui::fmt_date(ts)))
        .unwrap_or_default();

    let tiles: [(&str, String, String); 6] = [
        ("累计任务", cum.tasks.to_string(), String::new()),
        ("累计验收", cum.accepted.to_string(), String::new()),
        ("验收率", accept_rate, String::new()),
        ("累计成本", total_cost, String::new()),
        ("平均成本", avg_cost, String::new()),
        ("在岗天数", tenure, hired_note),
    ];
    let tile_rows = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Length(3); 2])
        .split(area);
    for (row_area, chunk) in tile_rows.iter().zip(tiles.chunks(3)) {
        let cols = Layout::default()
            .direction(Direction::Horizontal)
            .constraints([Constraint::Ratio(1, 3); 3])
            .spacing(1)
            .split(*row_area);
        for (col, (label, value, trend)) in cols.iter().zip(chunk.iter()) {
            frame.render_widget(
                Block::default()
                    .borders(Borders::ALL)
                    .border_style(Style::default().fg(config::border()))
                    .style(Style::default().bg(config::bg1())),
                *col,
            );
            let value_area = Rect { x: col.x + 1, y: col.y + 1, width: col.width.saturating_sub(2), height: 1.min(col.height) };
            frame.render_widget(
                Paragraph::new(Line::from(Span::styled(
                    format!("{value}  {label}"),
                    Style::default().fg(config::green()).add_modifier(Modifier::BOLD),
                ))),
                value_area,
            );
            if col.height > 2 && !trend.is_empty() {
                let trend_area = Rect { x: col.x + 1, y: col.y + 2, width: col.width.saturating_sub(2), height: 1 };
                frame.render_widget(
                    Paragraph::new(Line::from(Span::styled(trend.clone(), Style::default().fg(config::dim())))),
                    trend_area,
                );
            }
        }
    }
}

/// 右侧 REPUTATION 侧栏（规范 §8：280px 列）——评分/雇佣数/雇主评价。引擎侧无信誉数据源，
/// 保留为明示 MOCK 的演示数据（不同于左侧已经真值化的 KPI 瓦片）。
fn render_reputation(frame: &mut Frame<'_>, b: &EvalBoard, area: Rect) {
    let block = Block::default()
        .title(" REPUTATION ")
        .borders(Borders::LEFT)
        .border_style(Style::default().fg(config::border()));
    let inner = block.inner(area);
    frame.render_widget(block, area);

    let dim = Style::default().fg(config::dim());
    let mut lines: Vec<Line> = Vec::new();
    lines.push(Line::from(Span::styled(
        " MOCK · 引擎暂无信誉数据源",
        Style::default().fg(config::orange()),
    )));
    lines.push(Line::from(""));
    lines.push(Line::from(vec![
        Span::styled(" 雇主评分 ", dim),
        Span::styled(
            format!("{}/100", b.reputation),
            Style::default()
                .fg(config::orange())
                .add_modifier(Modifier::BOLD),
        ),
    ]));
    lines.push(Line::from(vec![
        Span::styled(" ", dim),
        Span::styled(
            bar(b.reputation, 100, 20),
            Style::default().fg(config::orange()),
        ),
    ]));
    lines.push(Line::from(Span::styled(
        format!(" 累计被雇佣 {} 次", b.hires),
        dim,
    )));
    lines.push(Line::from(""));
    lines.push(Line::from(Span::styled(
        " 雇主评价",
        Style::default()
            .fg(config::dim())
            .add_modifier(Modifier::BOLD),
    )));
    for (who, comment) in b.reviews {
        lines.push(Line::from(vec![
            Span::styled(format!(" ◆ {who} "), Style::default().fg(config::aqua())),
            Span::styled(comment, Style::default().fg(config::fg())),
        ]));
    }

    frame.render_widget(Paragraph::new(Text::from(lines)), inner);
}
