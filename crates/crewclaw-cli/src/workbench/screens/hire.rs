//! v0.12 HIRE 屏：雇佣流程 · Doctor 体检。数据来自 ui_state.hire_reports（启动时
//! doctor::build_report 计算的**真实**体检结论），与 market 平行按 hire_cursor 对应。
//! v0.16 W5.2：双栏改设计稿布局——左 HIRING FLOW 五步列(仅 Doctor 步真值,其余步引擎无真源,
//! 如实标"流程示意")+ 右 DOCTOR 命令行样式检查报告。

use ratatui::{
    Frame,
    layout::{Constraint, Direction, Layout, Rect},
    style::{Modifier, Style},
    text::{Line, Span, Text},
    widgets::{Paragraph, Wrap},
};

use super::super::config;
use super::super::state::{AppState, HireHealth, UiState};
use super::super::widgets::workbench_panels::titled_block;
use super::{pad_left, section};

pub fn render(frame: &mut Frame<'_>, _state: &AppState, ui_state: &UiState, area: Rect) {
    if ui_state.market.is_empty() {
        let block = titled_block("HIRING FLOW", config::aqua());
        let inner = pad_left(block.inner(area));
        frame.render_widget(block, area);
        frame.render_widget(
            Paragraph::new(Text::from(vec![
                section("入职流程"),
                Line::from(""),
                Line::from(Span::styled(
                    "  先到 MARKET（2）选择一位员工",
                    Style::default().fg(config::dim()),
                )),
            ])),
            inner,
        );
        return;
    }

    let idx = ui_state.hire_cursor.min(ui_state.market.len() - 1);
    let emp = &ui_state.market[idx];
    let report = ui_state.hire_reports.get(idx);

    let cols = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([Constraint::Length(30), Constraint::Min(30)])
        .split(area);

    render_flow(
        frame,
        emp.display_name.as_str(),
        emp.category.as_str(),
        report,
        cols[0],
    );
    render_doctor(frame, emp.name.as_str(), report, cols[1]);
}

/// v0.16 W5.2：五步入职流——仅 04 Doctor 有真源(HireHealth 驱动),其余无引擎真值,
/// 标 dim `流程示意` 而非假装已执行(有真用真,无真明示)。
fn render_flow(
    frame: &mut Frame<'_>,
    display_name: &str,
    category: &str,
    report: Option<&HireHealth>,
    area: Rect,
) {
    let block = titled_block("HIRING FLOW", config::aqua());
    let inner = pad_left(block.inner(area));
    frame.render_widget(block, area);

    let (doctor_icon, doctor_color, doctor_tag) = match report.map(|r| r.status.as_str()) {
        Some("healthy") => ("✓", config::green(), "done"),
        Some("warning") => ("▶", config::orange(), "有提醒"),
        Some("broken") => ("✗", config::red(), "需修复"),
        _ => ("○", config::dim(), "无数据"),
    };
    let steps: [(&str, &str, &str, ratatui::style::Color, &str); 5] = [
        ("01", "Contract", "○", config::dim(), "流程示意"),
        ("02", "Permission", "○", config::dim(), "流程示意"),
        ("03", "Runtime", "○", config::dim(), "流程示意"),
        ("04", "Doctor", doctor_icon, doctor_color, doctor_tag),
        ("05", "Trial Task", "○", config::dim(), "流程示意"),
    ];
    let mut lines: Vec<Line> = Vec::new();
    for (no, name, icon, color, tag) in steps {
        lines.push(Line::from(vec![
            Span::styled(format!("{icon} "), Style::default().fg(color)),
            Span::styled(format!("{no} "), Style::default().fg(config::dim())),
            Span::styled(name.to_string(), Style::default().fg(config::fg())),
            Span::styled(format!("  {tag}"), Style::default().fg(config::dim())),
        ]));
    }
    lines.push(Line::from(""));
    lines.push(Line::from(Span::styled(
        "candidate",
        Style::default().fg(config::dim()),
    )));
    lines.push(Line::from(Span::styled(
        display_name.to_string(),
        Style::default()
            .fg(config::yellow())
            .add_modifier(Modifier::BOLD),
    )));
    if !category.is_empty() {
        lines.push(Line::from(Span::styled(
            category.to_string(),
            Style::default().fg(config::dim()),
        )));
    }
    frame.render_widget(
        Paragraph::new(Text::from(lines)).wrap(Wrap { trim: true }),
        inner,
    );
}

/// v0.16 W5.2：DOCTOR 检查报告——命令行样式首行 + 检查行(HireHealth 真值)+ 底部徽章。
fn render_doctor(frame: &mut Frame<'_>, slug: &str, report: Option<&HireHealth>, area: Rect) {
    let block = titled_block("DOCTOR · 入职体检", config::yellow());
    let inner = pad_left(block.inner(area));
    frame.render_widget(block, area);
    let dim = Style::default().fg(config::dim());
    let fg = Style::default().fg(config::fg());

    let mut lines: Vec<Line> = vec![
        Line::from(Span::styled(
            format!("$ crewclaw doctor --employee {slug}"),
            dim,
        )),
        Line::from(""),
    ];
    match report {
        None => lines.push(Line::from(Span::styled("（无体检数据）", dim))),
        Some(r) => {
            if r.issues.is_empty() {
                lines.push(Line::from(vec![
                    Span::styled("✓ ", Style::default().fg(config::green())),
                    Span::styled("no issues     ", dim),
                    Span::styled("全部检查通过", fg),
                ]));
            } else {
                for issue in &r.issues {
                    lines.push(Line::from(vec![
                        Span::styled("¡ ", Style::default().fg(config::orange())),
                        Span::styled(format!("{:<12} ", "issue"), dim),
                        Span::styled(issue.clone(), fg),
                    ]));
                }
            }
            for s in &r.suggestions {
                lines.push(Line::from(vec![
                    Span::styled("→ ", Style::default().fg(config::yellow())),
                    Span::styled(format!("{:<12} ", "suggestion"), dim),
                    Span::styled(s.clone(), dim),
                ]));
            }
        }
    }
    lines.push(Line::from(""));

    let (badge, badge_color, hint) = match report.map(|r| r.status.as_str()) {
        Some("healthy") => (
            "[✓ READY]".to_string(),
            config::green(),
            "可以雇佣，进入试岗".to_string(),
        ),
        Some(status) => {
            let n = report.map(|r| r.issues.len()).unwrap_or(0);
            (
                format!("[¡ {n} ISSUES]"),
                config::orange(),
                format!("{status} · 建议先处理问题项"),
            )
        }
        None => (
            "[— 无数据]".to_string(),
            config::dim(),
            "先到 MARKET 选择员工".to_string(),
        ),
    };
    lines.push(Line::from(vec![
        Span::styled(
            badge,
            Style::default()
                .fg(config::bg())
                .bg(badge_color)
                .add_modifier(Modifier::BOLD),
        ),
        Span::styled(format!("  {hint}"), dim),
    ]));

    frame.render_widget(
        Paragraph::new(Text::from(lines)).wrap(Wrap { trim: true }),
        inner,
    );
}
