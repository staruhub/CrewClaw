//! HIRE supervision screen backed by the real registry/manifest/runtime/team lifecycle.
//!
//! Eight checks are computed in `flow_state`; warnings remain visibly distinct from passes and
//! only an all-nonblocking report unlocks Trial. Enter performs the owner-locked team mutation and
//! opens the three-step onboarding overlay. The screen never labels an unexecuted step as done.

use ratatui::{
    Frame,
    layout::{Constraint, Direction, Layout, Rect},
    style::{Color, Modifier, Style},
    text::{Line, Span, Text},
    widgets::{Paragraph, Wrap},
};

use super::super::config;
use super::super::flow_state::{self, CheckStatus, HireFlowSnapshot, HireStage};
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
    let fallback = ui_state.hire_reports.get(idx);
    let flow = flow_state::snapshot(&emp.name);

    let cols = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([Constraint::Length(30), Constraint::Min(30)])
        .split(area);

    render_flow(
        frame,
        &emp.name,
        &emp.display_name,
        &emp.category,
        flow.as_ref(),
        fallback,
        cols[0],
    );
    render_doctor(frame, &emp.name, flow.as_ref(), fallback, cols[1]);
}

fn status_style(status: CheckStatus) -> Color {
    match status {
        CheckStatus::Passed => config::green(),
        CheckStatus::Warning => config::orange(),
        CheckStatus::Failed => config::red(),
    }
}

fn named_check(flow: Option<&HireFlowSnapshot>, name: &str) -> Option<CheckStatus> {
    flow?
        .checks
        .iter()
        .find(|check| check.name == name)
        .map(|check| check.status)
}

fn combined_status(statuses: impl IntoIterator<Item = Option<CheckStatus>>) -> CheckStatus {
    let values = statuses.into_iter().flatten().collect::<Vec<_>>();
    if values
        .iter()
        .any(|status| matches!(status, CheckStatus::Failed))
    {
        CheckStatus::Failed
    } else if values.is_empty()
        || values
            .iter()
            .any(|status| matches!(status, CheckStatus::Warning))
    {
        CheckStatus::Warning
    } else {
        CheckStatus::Passed
    }
}

fn render_flow(
    frame: &mut Frame<'_>,
    slug: &str,
    display_name: &str,
    category: &str,
    flow: Option<&HireFlowSnapshot>,
    fallback: Option<&HireHealth>,
    area: Rect,
) {
    let block = titled_block("HIRING FLOW", config::aqua());
    let inner = pad_left(block.inner(area));
    frame.render_widget(block, area);

    let contract = named_check(flow, "Contract").unwrap_or(CheckStatus::Warning);
    let permission = named_check(flow, "Permission").unwrap_or(CheckStatus::Warning);
    let runtime = combined_status([
        named_check(flow, "Runtime"),
        named_check(flow, "Hermes"),
        named_check(flow, "Environment"),
    ]);
    let doctor = flow
        .map(|snapshot| combined_status(snapshot.checks.iter().map(|check| Some(check.status))))
        .unwrap_or_else(|| match fallback.map(|report| report.status.as_str()) {
            Some("healthy") => CheckStatus::Passed,
            Some("broken") => CheckStatus::Failed,
            _ => CheckStatus::Warning,
        });
    let trial = if flow.is_some_and(HireFlowSnapshot::trial_ready) {
        CheckStatus::Passed
    } else {
        CheckStatus::Warning
    };
    let stage_tag = |status: CheckStatus, ready_tag: &'static str| match status {
        CheckStatus::Passed => ready_tag,
        CheckStatus::Warning => "待确认",
        CheckStatus::Failed => "阻塞",
    };
    let steps = [
        ("01", "Contract", contract, stage_tag(contract, "verified")),
        (
            "02",
            "Permission",
            permission,
            stage_tag(permission, "frozen"),
        ),
        ("03", "Runtime", runtime, stage_tag(runtime, "ready")),
        ("04", "Doctor", doctor, stage_tag(doctor, "8/8")),
        (
            "05",
            "Trial Task",
            trial,
            match flow.map(|snapshot| &snapshot.stage) {
                Some(HireStage::Onboarding(_)) => "onboarding",
                Some(HireStage::Active) => "active",
                Some(HireStage::TrialReady) => "ready",
                Some(HireStage::Blocked) => "blocked",
                _ => "pending",
            },
        ),
    ];

    let mut lines = Vec::new();
    for (no, name, status, tag) in steps {
        let color = status_style(status);
        lines.push(Line::from(vec![
            Span::styled(format!("{} ", status.symbol()), Style::default().fg(color)),
            Span::styled(format!("{no} "), Style::default().fg(config::dim())),
            Span::styled(name.to_string(), Style::default().fg(config::fg())),
            Span::styled(format!("  {tag}"), Style::default().fg(color)),
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
    lines.push(Line::from(Span::styled(
        slug.to_string(),
        Style::default().fg(config::dim()),
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

fn render_doctor(
    frame: &mut Frame<'_>,
    slug: &str,
    flow: Option<&HireFlowSnapshot>,
    fallback: Option<&HireHealth>,
    area: Rect,
) {
    let block = titled_block("DOCTOR · 入职体检", config::yellow());
    let inner = pad_left(block.inner(area));
    frame.render_widget(block, area);
    let dim = Style::default().fg(config::dim());
    let fg = Style::default().fg(config::fg());
    let mut lines = vec![
        Line::from(Span::styled(
            format!("$ crewclaw doctor --employee {slug} --runtime local"),
            dim,
        )),
        Line::from(""),
    ];

    if let Some(flow) = flow {
        for check in &flow.checks {
            let color = status_style(check.status);
            lines.push(Line::from(vec![
                Span::styled(
                    format!("{} ", check.status.symbol()),
                    Style::default().fg(color),
                ),
                Span::styled(format!("{:<12} ", check.name), fg),
                Span::styled(check.detail.clone(), Style::default().fg(color)),
            ]));
        }
        lines.push(Line::from(""));
        if !flow.pending_permissions.is_empty() {
            lines.push(Line::from(vec![
                Span::styled("△ ", Style::default().fg(config::orange())),
                Span::styled("Pending      ", fg),
                Span::styled(
                    format!("未自动授予：{}", flow.pending_permissions.join(", ")),
                    dim,
                ),
            ]));
        }
        if let Some(error) = &flow.last_error {
            lines.push(Line::from(vec![
                Span::styled("✗ ", Style::default().fg(config::red())),
                Span::styled("Last action  ", fg),
                Span::styled(error.clone(), Style::default().fg(config::red())),
            ]));
        }

        let (badge, badge_color, hint) = match flow.stage {
            HireStage::Blocked => ("[✗ BLOCKED]", config::red(), "修复阻塞项后按 [d] 重新体检"),
            HireStage::TrialReady => (
                "[✓ TRIAL READY]",
                config::green(),
                "[Enter] 持久化雇佣并开始 3 步入职",
            ),
            HireStage::Onboarding(_) => (
                "[→ ONBOARDING]",
                config::yellow(),
                "完成入职后首个 Trial Task 会进入 INPUT",
            ),
            HireStage::Active => (
                "[✓ ACTIVE]",
                config::green(),
                "员工已存在于 .crewclaw/team.json · [f] 解雇 · [o] 重看入职",
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
    } else {
        lines.push(Line::from(Span::styled(
            "△ 尚未附着工作区，以下为旧 Doctor 摘要",
            Style::default().fg(config::orange()),
        )));
        if let Some(report) = fallback {
            let (badge, badge_color, body) = match report.status.as_str() {
                "healthy" => (
                    "[✓ READY]",
                    config::green(),
                    if report.issues.is_empty() {
                        vec!["全部检查通过 · no issues".to_string()]
                    } else {
                        report.issues.clone()
                    },
                ),
                "broken" => ("[✗ ISSUES]", config::red(), report.issues.clone()),
                _ => ("[△ WARN]", config::orange(), report.issues.clone()),
            };
            lines.push(Line::from(vec![
                Span::styled(
                    badge,
                    Style::default()
                        .fg(config::bg())
                        .bg(badge_color)
                        .add_modifier(Modifier::BOLD),
                ),
                Span::styled(format!("  status={}", report.status), dim),
            ]));
            for issue in body {
                lines.push(Line::from(vec![
                    Span::styled("△ ", Style::default().fg(config::orange())),
                    Span::styled(issue, fg),
                ]));
            }
            for suggestion in &report.suggestions {
                lines.push(Line::from(vec![
                    Span::styled("→ ", Style::default().fg(config::aqua())),
                    Span::styled(suggestion.clone(), dim),
                ]));
            }
        }
    }

    frame.render_widget(
        Paragraph::new(Text::from(lines)).wrap(Wrap { trim: true }),
        inner,
    );
}
