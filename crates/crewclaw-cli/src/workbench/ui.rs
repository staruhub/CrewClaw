use ratatui::{
    Frame,
    layout::{Constraint, Direction, Layout},
    style::{Color, Modifier, Style},
    text::{Line, Span, Text},
    widgets::{Block, Borders, Paragraph, Wrap},
};

use super::state::{
    AppState, SYM_FAIL, SYM_OK, SYM_RUNNING, SYM_WAIT, SYM_WARN, TimelineEntry,
};

const ACCENT: Color = Color::Cyan;
const OK: Color = Color::Green;
const BAD: Color = Color::Red;
const WARN: Color = Color::Yellow;
const DIM: Color = Color::Gray;

pub fn render(frame: &mut Frame<'_>, state: &AppState, input: &str) {
    let root = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(3),
            Constraint::Min(8),
            Constraint::Length(4),
        ])
        .split(frame.area());

    render_status(frame, state, root[0]);
    render_panels(frame, state, root[1]);
    render_bottom(frame, state, input, root[2]);
}

fn render_status(frame: &mut Frame<'_>, state: &AppState, area: ratatui::layout::Rect) {
    let employee = state.employee.as_ref();
    let name = employee.map(|e| e.name.as_str()).unwrap_or("CrewClaw Trial");
    let role = employee.map(|e| e.role.as_str()).unwrap_or("Trial Workbench");
    let model = employee.map(|e| e.model.as_str()).unwrap_or("unknown");
    let task_state = state
        .task
        .as_ref()
        .map(|task| task.status.as_str())
        .unwrap_or(state.status.as_str());
    let cost = format!(
        "Cost: prompt {} / completion {}",
        state.usage.prompt_tok, state.usage.completion_tok
    );
    let tools = if state.tools.is_empty() {
        "Tools: none".to_string()
    } else {
        format!(
            "Tools: {}",
            state
                .tools
                .iter()
                .map(|(_, tool)| {
                    let label = tool.tool.as_deref().unwrap_or("tool");
                    let mark = match tool.status.as_str() {
                        "ok" => SYM_OK,
                        "failed" => SYM_FAIL,
                        "running" => SYM_RUNNING,
                        _ => "?",
                    };
                    let detail = tool.summary.as_deref().unwrap_or(tool.status.as_str());
                    format!("{label} {mark} {detail}")
                })
                .collect::<Vec<_>>()
                .join(" · ")
        )
    };
    let memory = format!(
        "Memory: session {} · persistent {} · workspace {}",
        memory_mark(&state.memory.session),
        memory_mark(&state.memory.persistent),
        memory_mark(&state.memory.workspace)
    );

    let lines = vec![
        Line::from(vec![
            Span::styled(
                format!("{name} · {role}"),
                Style::default().fg(ACCENT).add_modifier(Modifier::BOLD),
            ),
            Span::raw(format!("   Mode: {} · State: {task_state} · Model: {model}", state.mode)),
        ]),
        Line::from(vec![Span::raw(format!("{cost}   {tools}"))]),
        Line::from(vec![Span::raw(memory)]),
    ];
    frame.render_widget(Paragraph::new(Text::from(lines)), area);
}

fn render_panels(frame: &mut Frame<'_>, state: &AppState, area: ratatui::layout::Rect) {
    let chunks = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([
            Constraint::Percentage(24),
            Constraint::Percentage(50),
            Constraint::Percentage(26),
        ])
        .split(area);

    render_tasks(frame, state, chunks[0]);
    render_timeline(frame, state, chunks[1]);
    render_context(frame, state, chunks[2]);
}

fn render_tasks(frame: &mut Frame<'_>, state: &AppState, area: ratatui::layout::Rect) {
    let mut lines = Vec::new();
    if let Some(task) = &state.task {
        lines.push(Line::from(vec![
            Span::styled("> ", Style::default().fg(ACCENT)),
            Span::raw(task.title.clone()),
        ]));
        lines.push(Line::from(Span::styled(
            format!("  {}", task.status),
            Style::default().fg(status_color(&task.status)),
        )));
    } else {
        lines.push(Line::from(Span::styled("No active task", Style::default().fg(DIM))));
    }

    lines.push(Line::from(""));
    lines.push(Line::from(Span::styled(
        "Plan",
        Style::default().fg(ACCENT).add_modifier(Modifier::BOLD),
    )));
    if let Some(plan) = &state.plan {
        for (index, step) in plan.steps.iter().enumerate() {
            lines.push(Line::from(format!("{}. {step}", index + 1)));
        }
    } else {
        lines.push(Line::from(Span::styled("(waiting)", Style::default().fg(DIM))));
    }

    lines.push(Line::from(""));
    lines.push(Line::from(Span::styled(
        "Artifacts",
        Style::default().fg(ACCENT).add_modifier(Modifier::BOLD),
    )));
    for artifact in &state.artifacts {
        lines.push(Line::from(format!(
            "{} {}",
            status_symbol(&artifact.status),
            artifact.name.as_deref().unwrap_or("(unnamed)")
        )));
    }

    frame.render_widget(
        Paragraph::new(Text::from(lines))
            .block(Block::default().title("Tasks").borders(Borders::ALL))
            .wrap(Wrap { trim: true }),
        area,
    );
}

fn render_timeline(frame: &mut Frame<'_>, state: &AppState, area: ratatui::layout::Rect) {
    let mut lines = state
        .timeline
        .iter()
        .rev()
        .take(80)
        .collect::<Vec<_>>();
    lines.reverse();
    let lines = lines
        .into_iter()
        .map(timeline_line)
        .chain(answer_preview(state))
        .collect::<Vec<_>>();

    frame.render_widget(
        Paragraph::new(Text::from(lines))
            .block(Block::default().title("Timeline").borders(Borders::ALL))
            .wrap(Wrap { trim: true }),
        area,
    );
}

fn render_context(frame: &mut Frame<'_>, state: &AppState, area: ratatui::layout::Rect) {
    let mut lines = Vec::new();
    lines.push(Line::from(Span::styled(
        "Tools",
        Style::default().fg(ACCENT).add_modifier(Modifier::BOLD),
    )));
    if state.tools.is_empty() {
        lines.push(Line::from(Span::styled("(none)", Style::default().fg(DIM))));
    }
    for tool in state.tools.values() {
        lines.push(Line::from(vec![
            Span::styled(status_symbol(&tool.status), Style::default().fg(status_color(&tool.status))),
            Span::raw(format!(" {}", tool.tool.as_deref().unwrap_or("tool"))),
            Span::styled(
                format!(" {}", tool.summary.as_deref().unwrap_or(tool.status.as_str())),
                Style::default().fg(DIM),
            ),
        ]));
    }

    lines.push(Line::from(""));
    lines.push(Line::from(Span::styled(
        "Evidence",
        Style::default().fg(ACCENT).add_modifier(Modifier::BOLD),
    )));
    for item in &state.evidence {
        lines.push(Line::from(format!(
            "{} {}",
            item.source.as_deref().unwrap_or("source"),
            item.fact.as_deref().unwrap_or("")
        )));
    }

    lines.push(Line::from(""));
    lines.push(Line::from(Span::styled(
        "Checks",
        Style::default().fg(ACCENT).add_modifier(Modifier::BOLD),
    )));
    for artifact in &state.artifacts {
        for check in &artifact.checks {
            lines.push(Line::from(format!("{} {check}", SYM_WAIT)));
        }
    }

    lines.push(Line::from(""));
    lines.push(Line::from(Span::styled(
        "Approval",
        Style::default().fg(ACCENT).add_modifier(Modifier::BOLD),
    )));
    if let Some(approval) = &state.approval {
        lines.push(Line::from(format!(
            "{} {}",
            approval.tool.as_deref().unwrap_or("tool"),
            approval.reason.as_deref().unwrap_or("")
        )));
    } else {
        lines.push(Line::from(Span::styled("(none)", Style::default().fg(DIM))));
    }

    frame.render_widget(
        Paragraph::new(Text::from(lines))
            .block(Block::default().title("Context / Artifacts / Checks").borders(Borders::ALL))
            .wrap(Wrap { trim: true }),
        area,
    );
}

fn render_bottom(
    frame: &mut Frame<'_>,
    state: &AppState,
    input: &str,
    area: ratatui::layout::Rect,
) {
    let machine = state_machine_line(state);
    let actions = if state.pending_actions.is_empty() {
        "Actions: accept / revise / export / inspect / q".to_string()
    } else {
        format!(
            "Actions: {}",
            state
                .pending_actions
                .iter()
                .filter_map(|action| {
                    let key = action.get("key")?.as_str()?;
                    let label = action.get("label").and_then(|v| v.as_str()).unwrap_or("");
                    Some(format!("{key} {label}"))
                })
                .collect::<Vec<_>>()
                .join(" / ")
        )
    };
    let lines = vec![
        machine,
        Line::from(actions),
        Line::from(vec![
            Span::styled("> ", Style::default().fg(ACCENT)),
            Span::raw(input.to_string()),
        ]),
    ];
    frame.render_widget(
        Paragraph::new(Text::from(lines))
            .block(Block::default().borders(Borders::ALL))
            .wrap(Wrap { trim: true }),
        area,
    );
}

fn timeline_line(entry: &TimelineEntry) -> Line<'static> {
    let mut spans = vec![
        Span::styled(entry.status.clone(), Style::default().fg(symbol_color(&entry.status))),
        Span::raw(format!(" {}", entry.label)),
    ];
    if !entry.detail.is_empty() {
        spans.push(Span::styled(format!("  {}", entry.detail), Style::default().fg(DIM)));
    }
    Line::from(spans)
}

fn answer_preview(state: &AppState) -> Vec<Line<'static>> {
    if state.answer.is_empty() {
        return Vec::new();
    }
    vec![
        Line::from(""),
        Line::from(Span::styled(
            "Answer",
            Style::default().fg(ACCENT).add_modifier(Modifier::BOLD),
        )),
        Line::from(state.answer.chars().take(600).collect::<String>()),
    ]
}

fn state_machine_line(state: &AppState) -> Line<'static> {
    let phases = [
        ("Plan", state.plan.is_some()),
        ("Running", state.status == "running"),
        ("Approval", state.status == "awaiting_approval"),
        ("Done", state.status == "done"),
    ];
    let mut spans = vec![Span::styled(
        "STATE: ",
        Style::default().fg(ACCENT).add_modifier(Modifier::BOLD),
    )];
    for (index, (label, active)) in phases.iter().enumerate() {
        if index > 0 {
            spans.push(Span::raw(" > "));
        }
        spans.push(Span::styled(
            *label,
            Style::default().fg(if *active { OK } else { DIM }),
        ));
    }
    Line::from(spans)
}

fn memory_mark(status: &str) -> &'static str {
    match status {
        "available" | "enabled" => SYM_OK,
        "disabled" | "unavailable" => SYM_FAIL,
        _ => "?",
    }
}

fn status_symbol(status: &str) -> &'static str {
    match status {
        "ok" | "done" | "ready" | "accepted" => SYM_OK,
        "failed" | "rejected" => SYM_FAIL,
        "running" => SYM_RUNNING,
        "draft" | "awaiting_approval" => SYM_WAIT,
        _ => SYM_WARN,
    }
}

fn status_color(status: &str) -> Color {
    match status {
        "ok" | "done" | "ready" | "accepted" => OK,
        "failed" | "rejected" => BAD,
        "running" => ACCENT,
        "draft" | "awaiting_approval" => WARN,
        _ => DIM,
    }
}

fn symbol_color(symbol: &str) -> Color {
    match symbol {
        SYM_OK => OK,
        SYM_FAIL => BAD,
        SYM_RUNNING => ACCENT,
        SYM_WARN | SYM_WAIT => WARN,
        _ => DIM,
    }
}
