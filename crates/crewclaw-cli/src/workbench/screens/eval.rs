//! EVAL 屏呈现受保护的 KPI/TaskRun 状态与评测记录。认证只来自 Node `session.ready` 中经
//! `readEvalResult` 完整校验的结果；Rust 磁盘投影只能显示为待验证，mock 始终非认证。

use ratatui::{
    Frame,
    layout::{Constraint, Direction, Layout, Rect},
    style::{Modifier, Style},
    text::{Line, Span, Text},
    widgets::{Block, Borders, Paragraph},
};

use super::super::config;
use super::super::state::{
    AppState, DreamSnapshot, EvalReport, KpiCumulative, MonthlyMetric, UiState,
};
use super::{bar, pad_left, screen_block, section};

/// v0.17 P2 C1：员工首次验收距今的天数（epoch ms 差，向下取整）。无历史 → None（不伪造"0 天"）。
fn tenure_days(first_hired_ts: Option<u64>) -> Option<u64> {
    let ts = first_hired_ts?;
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .ok()?
        .as_millis() as u64;
    Some(now_ms.saturating_sub(ts) / 86_400_000)
}

pub fn render(frame: &mut Frame<'_>, state: &AppState, ui_state: &UiState, area: Rect) {
    let block = screen_block("EVAL", "绩效 · KPI · 评测 · 任务状态");
    let inner = block.inner(area);
    frame.render_widget(block, area);

    let event_cum = state
        .employee
        .as_ref()
        .map(|e| e.kpi_cumulative)
        .unwrap_or_default();
    let event_eval = state.employee.as_ref().and_then(|e| e.eval.as_ref());
    let eval_from_session = event_eval.is_some();
    let (cum, eval, monthly, dream, errors) = if ui_state.persisted_state_active {
        (
            &ui_state.persisted_insights.kpi,
            event_eval.or(ui_state.persisted_insights.eval.as_ref()),
            ui_state.persisted_insights.monthly.as_slice(),
            Some(&ui_state.persisted_insights.dream),
            ui_state.persisted_insights.errors.as_slice(),
        )
    } else {
        (&event_cum, event_eval, &[][..], None, &[][..])
    };
    // 左主区 | 右认证/TaskRun 状态侧栏。窄于 90 列时退化为单栏。
    if inner.width >= 90 {
        let cols = Layout::default()
            .direction(Direction::Horizontal)
            .constraints([Constraint::Min(40), Constraint::Length(35)])
            .split(inner);
        render_main(
            frame,
            cum,
            eval,
            eval_from_session,
            monthly,
            errors,
            pad_left(cols[0]),
        );
        render_status(frame, eval, eval_from_session, cum, dream, errors, cols[1]);
    } else {
        render_main(
            frame,
            cum,
            eval,
            eval_from_session,
            monthly,
            errors,
            pad_left(inner),
        );
    }
}

fn render_main(
    frame: &mut Frame<'_>,
    cum: &KpiCumulative,
    eval: Option<&EvalReport>,
    eval_from_session: bool,
    monthly: &[MonthlyMetric],
    errors: &[String],
    area: Rect,
) {
    let dim = Style::default().fg(config::dim());

    // 顶部固定 4 行给真值标注 + KPI 瓦片(bg1 底+bd 框,2 行×3 列);其余(月度条形/上岗考试/
    // verdict)仍是一个滚动 Paragraph,用 Layout 纵向分两段。
    let rows = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(1),
            Constraint::Length(1),
            Constraint::Length(6),
            Constraint::Min(3),
        ])
        .split(area);
    let kpi_unverified = errors.iter().any(|error| error.starts_with("kpi:"));
    let runs_unverified = errors.iter().any(|error| error.starts_with("runs:"));
    let kpi_label = if kpi_unverified {
        " 累计 KPI · 状态不可验证"
    } else if cum.tasks > 0 {
        " 累计 KPI · 真实（跨会话）"
    } else {
        " 累计 KPI · 暂无任务记录"
    };
    frame.render_widget(
        Paragraph::new(Line::from(Span::styled(
            kpi_label,
            Style::default()
                .fg(if kpi_unverified {
                    config::red()
                } else if cum.tasks > 0 {
                    config::green()
                } else {
                    config::dim()
                })
                .add_modifier(Modifier::BOLD),
        ))),
        rows[0],
    );
    let eval_unverified = errors.iter().any(|error| error.starts_with("eval:"));
    let eval_summary = match eval {
        Some(report) if eval_from_session && report.certified && !report.mock => (
            format!(" 上岗考试 · 已认证 {} · {}", report.score, report.verdict),
            config::green(),
        ),
        Some(report) if report.mock => (
            format!(" 上岗考试 · 非认证机械分 {}", report.score),
            config::orange(),
        ),
        Some(_) => (
            " 上岗考试 · 存储记录待验证 · 不可认证".to_string(),
            config::yellow(),
        ),
        None if eval_unverified => (" 上岗考试 · 状态不可验证".to_string(), config::red()),
        None => (" 上岗考试 · 未评测".to_string(), config::dim()),
    };
    frame.render_widget(
        Paragraph::new(Line::from(Span::styled(
            eval_summary.0,
            Style::default()
                .fg(eval_summary.1)
                .add_modifier(Modifier::BOLD),
        ))),
        rows[1],
    );
    if kpi_unverified {
        frame.render_widget(
            Paragraph::new(Line::from(Span::styled(
                " 持久化 KPI 文件损坏或不安全；未展示其中指标",
                Style::default().fg(config::red()),
            ))),
            rows[2],
        );
    } else {
        render_kpi_tiles(frame, cum, rows[2]);
    }

    let mut lines: Vec<Line> = Vec::new();
    if !errors.is_empty() {
        lines.push(Line::from(Span::styled(
            format!("状态读取警告：{} 项被安全拒绝", errors.len()),
            Style::default().fg(config::yellow()),
        )));
        lines.push(Line::from(""));
    }

    lines.push(section("每月 TaskRun"));
    if runs_unverified {
        lines.push(Line::from(Span::styled(
            "  TaskRun 状态不可验证；未把无法核验的文件计入指标",
            Style::default().fg(config::red()),
        )));
    } else if monthly.is_empty() {
        lines.push(Line::from(Span::styled("  暂无真实月度任务记录", dim)));
    } else {
        let max = monthly.iter().map(|metric| metric.tasks).max().unwrap_or(1);
        for metric in monthly {
            lines.push(Line::from(vec![
                Span::styled(format!("  {:<7}", metric.month), dim),
                Span::styled(
                    bar(metric.tasks as u32, max as u32, 24),
                    Style::default().fg(config::blue()),
                ),
                Span::styled(
                    format!(" {}  验收 {}", metric.tasks, metric.accepted),
                    Style::default().fg(config::fg()),
                ),
            ]));
        }
    }
    lines.push(Line::from(""));

    render_exams(&mut lines, eval, eval_from_session, dim, eval_unverified);

    frame.render_widget(Paragraph::new(Text::from(lines)), rows[3]);
}

/// 上岗考试 section 的四态渲染（session 认证 / mock 非认证 / 磁盘待验证 / 未评测）。
fn render_exams(
    lines: &mut Vec<Line<'static>>,
    eval: Option<&EvalReport>,
    eval_from_session: bool,
    dim: Style,
    unverified: bool,
) {
    let score_bar = |score: u32| {
        let color = if score >= 85 {
            config::green()
        } else if score >= 60 {
            config::yellow()
        } else {
            config::red()
        };
        (bar(score, 100, 18), color)
    };
    match eval {
        // 真实认证分。
        Some(rep) if eval_from_session && rep.certified && !rep.mock => {
            lines.push(Line::from(vec![
                Span::styled(
                    "上岗考试 · ",
                    Style::default()
                        .fg(config::dim())
                        .add_modifier(Modifier::BOLD),
                ),
                Span::styled(
                    format!(
                        "真实（{} · {}）",
                        rep.model,
                        crate::workbench::ui::fmt_date(rep.evaluated_at)
                    ),
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
            push_verdict(lines, &rep.verdict, "认证 verdict ", dim, true);
        }
        // MOCK 跑（CREW_MOCK 机械 harness，非认证分）。
        Some(rep) if rep.mock => {
            lines.push(Line::from(vec![
                Span::styled(
                    "上岗考试 · ",
                    Style::default()
                        .fg(config::dim())
                        .add_modifier(Modifier::BOLD),
                ),
                Span::styled(
                    "MOCK 跑（CREW_MOCK · 非认证分）",
                    Style::default().fg(config::orange()),
                ),
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
            push_verdict(lines, &rep.verdict, "机械 verdict（非认证） ", dim, false);
        }
        // Rust 只能做安全读取与结构投影，无法重算 Node 当前 subject contract；不认证。
        Some(_) => {
            lines.push(Line::from(vec![
                Span::styled(
                    "上岗考试 · ",
                    Style::default()
                        .fg(config::dim())
                        .add_modifier(Modifier::BOLD),
                ),
                Span::styled(
                    "存储记录待验证（不可认证）",
                    Style::default().fg(config::yellow()),
                ),
            ]));
            lines.push(Line::from(Span::styled(
                "  等待 Node session.ready 绑定当前 subject/spec/runtime 后确认",
                dim,
            )));
            lines.push(Line::from(Span::styled(
                "  未展示磁盘分数、模型或 verdict",
                dim,
            )));
        }
        // 从未评测——不展示任何示例分数或假 verdict。
        None if unverified => {
            lines.push(Line::from(vec![
                Span::styled(
                    "上岗考试 · ",
                    Style::default()
                        .fg(config::dim())
                        .add_modifier(Modifier::BOLD),
                ),
                Span::styled("状态不可验证", Style::default().fg(config::red())),
            ]));
            lines.push(Line::from(Span::styled(
                "  持久化评测文件损坏或不安全；未展示其中分数",
                dim,
            )));
        }
        None => {
            lines.push(Line::from(vec![
                Span::styled(
                    "上岗考试 · ",
                    Style::default()
                        .fg(config::dim())
                        .add_modifier(Modifier::BOLD),
                ),
                Span::styled("未评测", Style::default().fg(config::dim())),
            ]));
            lines.push(Line::from(Span::styled(
                "  运行 pnpm eval:expert <employee> 后刷新；不会生成占位分数",
                dim,
            )));
        }
    }
}

fn push_verdict(
    lines: &mut Vec<Line<'static>>,
    verdict: &str,
    label: &'static str,
    dim: Style,
    certified: bool,
) {
    let pass = verdict.eq_ignore_ascii_case("pass");
    lines.push(Line::from(vec![
        Span::styled(format!("  {label}"), dim),
        Span::styled(
            format!(" {} ", verdict.to_uppercase()),
            Style::default()
                .fg(if certified {
                    config::bg()
                } else {
                    config::orange()
                })
                .bg(if certified {
                    if pass { config::green() } else { config::red() }
                } else {
                    config::bg1()
                })
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
            let value_area = Rect {
                x: col.x + 1,
                y: col.y + 1,
                width: col.width.saturating_sub(2),
                height: 1.min(col.height),
            };
            frame.render_widget(
                Paragraph::new(Line::from(Span::styled(
                    format!("{value}  {label}"),
                    Style::default()
                        .fg(config::green())
                        .add_modifier(Modifier::BOLD),
                ))),
                value_area,
            );
            if col.height > 2 && !trend.is_empty() {
                let trend_area = Rect {
                    x: col.x + 1,
                    y: col.y + 2,
                    width: col.width.saturating_sub(2),
                    height: 1,
                };
                frame.render_widget(
                    Paragraph::new(Line::from(Span::styled(
                        trend.clone(),
                        Style::default().fg(config::dim()),
                    ))),
                    trend_area,
                );
            }
        }
    }
}

/// 右侧只显示可核验的认证与 TaskRun 状态，不制造雇主评分、雇佣数或评价。
fn render_status(
    frame: &mut Frame<'_>,
    eval: Option<&EvalReport>,
    eval_from_session: bool,
    kpi: &KpiCumulative,
    dream: Option<&DreamSnapshot>,
    errors: &[String],
    area: Rect,
) {
    let block = Block::default()
        .title(" 认证与任务状态 ")
        .borders(Borders::LEFT)
        .border_style(Style::default().fg(config::border()));
    let inner = block.inner(area);
    frame.render_widget(block, area);

    let dim = Style::default().fg(config::dim());
    let mut lines: Vec<Line> = Vec::new();
    match eval {
        Some(report) if eval_from_session && report.certified && !report.mock => {
            lines.push(Line::from(Span::styled(
                " 已认证 · mock:false",
                Style::default()
                    .fg(config::green())
                    .add_modifier(Modifier::BOLD),
            )));
            lines.push(Line::from(vec![
                Span::styled(" 分数 ", dim),
                Span::styled(
                    report.score.to_string(),
                    Style::default()
                        .fg(config::green())
                        .add_modifier(Modifier::BOLD),
                ),
                Span::styled(format!("  {}", report.verdict), dim),
            ]));
            lines.push(Line::from(Span::styled(
                format!(" 模型 {}", report.model),
                dim,
            )));
        }
        Some(report) if report.mock => {
            lines.push(Line::from(Span::styled(
                " 非认证机械评测 · mock:true",
                Style::default()
                    .fg(config::orange())
                    .add_modifier(Modifier::BOLD),
            )));
            lines.push(Line::from(Span::styled(
                format!(" 机械分 {}  {}", report.score, report.verdict),
                Style::default().fg(config::orange()),
            )));
        }
        Some(_) => {
            lines.push(Line::from(Span::styled(
                " 存储记录待验证 · 不可认证",
                Style::default()
                    .fg(config::yellow())
                    .add_modifier(Modifier::BOLD),
            )));
            lines.push(Line::from(Span::styled(
                " 等待 Node 校验当前 subject contract",
                dim,
            )));
        }
        None if errors.iter().any(|error| error.starts_with("eval:")) => {
            lines.push(Line::from(Span::styled(
                " 评测状态不可验证",
                Style::default()
                    .fg(config::red())
                    .add_modifier(Modifier::BOLD),
            )));
        }
        None => lines.push(Line::from(Span::styled(" 未评测", dim))),
    }
    lines.push(Line::from(""));
    lines.push(Line::from(Span::styled(
        " 持久化绩效",
        Style::default()
            .fg(config::dim())
            .add_modifier(Modifier::BOLD),
    )));
    if errors.iter().any(|error| error.starts_with("kpi:")) {
        lines.push(Line::from(Span::styled(
            " KPI 状态不可验证",
            Style::default().fg(config::red()),
        )));
    } else {
        lines.push(Line::from(vec![
            Span::styled(" 任务 ", dim),
            Span::styled(kpi.tasks.to_string(), Style::default().fg(config::fg())),
            Span::styled("  验收 ", dim),
            Span::styled(
                kpi.accepted.to_string(),
                Style::default().fg(config::green()),
            ),
        ]));
    }
    if let Some(dream) = dream {
        lines.push(Line::from(vec![
            Span::styled(" 需修订 ", dim),
            Span::styled(
                dream.revision_count.to_string(),
                Style::default().fg(config::yellow()),
            ),
            Span::styled("  失败/拒绝 ", dim),
            Span::styled(
                dream.failed_count.to_string(),
                Style::default().fg(config::red()),
            ),
        ]));
    }
    if !errors.is_empty() {
        lines.push(Line::from(""));
        lines.push(Line::from(Span::styled(
            format!(" {} 项状态不可验证", errors.len()),
            Style::default().fg(config::yellow()),
        )));
    }

    frame.render_widget(Paragraph::new(Text::from(lines)), inner);
}
