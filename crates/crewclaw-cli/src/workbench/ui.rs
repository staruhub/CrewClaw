use ratatui::{
    Frame,
    layout::{Alignment, Constraint, Direction, Layout, Rect},
    style::{Color, Modifier, Style},
    text::{Line, Span, Text},
    widgets::{Block, Borders, Clear, Paragraph, Tabs, Wrap},
};
use unicode_width::UnicodeWidthStr;

use super::state::{
    AppState, FocusPanel, NarrowTab, Overlay, SYM_FAIL, SYM_OK, SYM_RUNNING, SYM_WAIT, SYM_WARN,
    TimelineEntry, UiState,
};

const ACCENT: Color = Color::Cyan;
const OK: Color = Color::Green;
const BAD: Color = Color::Red;
const WARN: Color = Color::Yellow;
const DIM: Color = Color::Gray;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum LayoutKind {
    Wide,
    Mid,
    Narrow,
}

pub fn render(frame: &mut Frame<'_>, state: &AppState, ui_state: &UiState, input: &str) {
    let root = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(3),
            Constraint::Min(8),
            Constraint::Length(4),
        ])
        .split(frame.area());

    render_status(frame, state, root[0]);
    render_panels(frame, state, ui_state, root[1]);
    render_bottom(frame, state, ui_state, input, root[2]);
    render_overlay(frame, ui_state);
    render_approval_modal(frame, state);
}

pub(crate) fn layout_kind(width: u16) -> LayoutKind {
    if width >= 100 {
        LayoutKind::Wide
    } else if width >= 70 {
        LayoutKind::Mid
    } else {
        LayoutKind::Narrow
    }
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
                    let mark = status_symbol(&tool.status);
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
            Span::raw(format!(
                "   Mode: {} · State: {} · Model: {model}",
                state.mode,
                status_label(task_state)
            )),
        ]),
        Line::from(vec![Span::raw(format!("{cost}   {tools}"))]),
        Line::from(vec![Span::raw(memory)]),
    ];
    frame.render_widget(Paragraph::new(Text::from(lines)), area);
}

fn render_panels(
    frame: &mut Frame<'_>,
    state: &AppState,
    ui_state: &UiState,
    area: ratatui::layout::Rect,
) {
    match layout_kind(area.width) {
        LayoutKind::Wide => render_wide(frame, state, ui_state, area),
        LayoutKind::Mid => render_mid(frame, state, ui_state, area),
        LayoutKind::Narrow => render_narrow(frame, state, ui_state, area),
    }
}

fn render_wide(
    frame: &mut Frame<'_>,
    state: &AppState,
    ui_state: &UiState,
    area: ratatui::layout::Rect,
) {
    let columns = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([
            Constraint::Percentage(25),
            Constraint::Percentage(49),
            Constraint::Percentage(26),
        ])
        .split(area);
    let right = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Percentage(34),
            Constraint::Percentage(33),
            Constraint::Percentage(33),
        ])
        .split(columns[2]);

    render_tasks(frame, state, ui_state, columns[0]);
    render_timeline(frame, state, ui_state, columns[1]);
    render_artifacts(frame, state, ui_state, right[0]);
    render_tools(frame, state, ui_state, right[1]);
    render_inspect(frame, state, ui_state, right[2]);
}

fn render_mid(
    frame: &mut Frame<'_>,
    state: &AppState,
    ui_state: &UiState,
    area: ratatui::layout::Rect,
) {
    let columns = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([Constraint::Percentage(36), Constraint::Percentage(64)])
        .split(area);
    let left = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Percentage(58), Constraint::Percentage(42)])
        .split(columns[0]);
    let right = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Percentage(58),
            Constraint::Percentage(21),
            Constraint::Percentage(21),
        ])
        .split(columns[1]);

    render_tasks(frame, state, ui_state, left[0]);
    render_artifacts(frame, state, ui_state, left[1]);
    render_timeline(frame, state, ui_state, right[0]);
    render_tools(frame, state, ui_state, right[1]);
    render_inspect(frame, state, ui_state, right[2]);
}

fn render_narrow(
    frame: &mut Frame<'_>,
    state: &AppState,
    ui_state: &UiState,
    area: ratatui::layout::Rect,
) {
    let rows = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Length(3), Constraint::Min(4)])
        .split(area);
    let selected = match ui_state.active_tab {
        NarrowTab::Timeline => 0,
        NarrowTab::Artifacts => 1,
        NarrowTab::Tools => 2,
        NarrowTab::Inspect => 3,
    };
    frame.render_widget(
        Tabs::new(["Timeline", "Artifacts", "Tools", "Inspect"])
            .select(selected)
            .block(Block::default().borders(Borders::ALL))
            .style(Style::default().fg(DIM))
            .highlight_style(Style::default().fg(ACCENT).add_modifier(Modifier::BOLD)),
        rows[0],
    );
    match ui_state.active_tab {
        NarrowTab::Timeline => render_timeline(frame, state, ui_state, rows[1]),
        NarrowTab::Artifacts => render_artifacts(frame, state, ui_state, rows[1]),
        NarrowTab::Tools => render_tools(frame, state, ui_state, rows[1]),
        NarrowTab::Inspect => render_inspect(frame, state, ui_state, rows[1]),
    }
}

fn render_tasks(
    frame: &mut Frame<'_>,
    state: &AppState,
    ui_state: &UiState,
    area: ratatui::layout::Rect,
) {
    let mut lines = Vec::new();
    if let Some(task) = &state.task {
        lines.push(Line::from(vec![
            Span::styled("> ", Style::default().fg(ACCENT)),
            Span::raw(task.title.clone()),
        ]));
        lines.push(Line::from(Span::styled(
            format!("  {}", status_label(&task.status)),
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
            .block(panel_block("Tasks / Employee", ui_state.focus == FocusPanel::Tasks))
            .wrap(Wrap { trim: true })
            .scroll((ui_state.scroll_for(FocusPanel::Tasks), 0)),
        area,
    );
}

fn render_timeline(
    frame: &mut Frame<'_>,
    state: &AppState,
    ui_state: &UiState,
    area: ratatui::layout::Rect,
) {
    let mut lines = Vec::new();
    if let Some(badge) = quick_utility_badge_line(state, area.width.saturating_sub(2) as usize) {
        lines.push(badge);
    }

    let mut timeline = state
        .timeline
        .iter()
        .rev()
        .take(80)
        .collect::<Vec<_>>();
    timeline.reverse();
    lines.extend(
        timeline
            .into_iter()
            .map(timeline_line)
            .chain(answer_preview(state)),
    );

    if let Some(pending_line) =
        pending_actions_line(&state.pending_actions, area.width.saturating_sub(2) as usize)
    {
        let block = panel_block("Timeline", ui_state.focus == FocusPanel::Timeline);
        let inner = inner_panel_rect(area);
        frame.render_widget(block, area);
        if inner.height == 0 {
            return;
        }

        let timeline_area = Rect {
            height: inner.height.saturating_sub(1),
            ..inner
        };
        let actions_area = Rect {
            y: inner.y + inner.height.saturating_sub(1),
            height: 1,
            ..inner
        };
        if timeline_area.height > 0 {
            frame.render_widget(
                Paragraph::new(Text::from(lines))
                    .wrap(Wrap { trim: true })
                    .scroll((ui_state.scroll_for(FocusPanel::Timeline), 0)),
                timeline_area,
            );
        }
        frame.render_widget(
            Paragraph::new(Text::from(pending_action_hint_line(&pending_line))),
            actions_area,
        );
        return;
    }

    frame.render_widget(
        Paragraph::new(Text::from(lines))
            .block(panel_block("Timeline", ui_state.focus == FocusPanel::Timeline))
            .wrap(Wrap { trim: true })
            .scroll((ui_state.scroll_for(FocusPanel::Timeline), 0)),
        area,
    );
}

fn render_artifacts(
    frame: &mut Frame<'_>,
    state: &AppState,
    ui_state: &UiState,
    area: ratatui::layout::Rect,
) {
    let mut lines = Vec::new();
    if state.artifacts.is_empty() {
        lines.push(Line::from(Span::styled("(none)", Style::default().fg(DIM))));
    }
    for artifact in &state.artifacts {
        lines.push(Line::from(vec![
            Span::styled(
                status_symbol(&artifact.status),
                Style::default().fg(status_color(&artifact.status)),
            ),
            Span::raw(format!(
                " {}",
                artifact.name.as_deref().unwrap_or("(unnamed)")
            )),
        ]));
        if let Some(path) = &artifact.path {
            lines.push(Line::from(Span::styled(format!("  {path}"), Style::default().fg(DIM))));
        }
        for check in &artifact.checks {
            lines.push(Line::from(format!("  {SYM_WAIT} {check}")));
        }
    }

    frame.render_widget(
        Paragraph::new(Text::from(lines))
            .block(panel_block("Artifacts / Checks", ui_state.focus == FocusPanel::Artifacts))
            .wrap(Wrap { trim: true })
            .scroll((ui_state.scroll_for(FocusPanel::Artifacts), 0)),
        area,
    );
}

fn render_tools(
    frame: &mut Frame<'_>,
    state: &AppState,
    ui_state: &UiState,
    area: ratatui::layout::Rect,
) {
    let mut lines = Vec::new();
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

    frame.render_widget(
        Paragraph::new(Text::from(lines))
            .block(panel_block("Tools", ui_state.focus == FocusPanel::Tools))
            .wrap(Wrap { trim: true })
            .scroll((ui_state.scroll_for(FocusPanel::Tools), 0)),
        area,
    );
}

fn render_inspect(
    frame: &mut Frame<'_>,
    state: &AppState,
    ui_state: &UiState,
    area: ratatui::layout::Rect,
) {
    let mut lines = Vec::new();
    lines.push(Line::from(Span::styled(
        "Task",
        Style::default().fg(ACCENT).add_modifier(Modifier::BOLD),
    )));
    if let Some(task) = &state.task {
        lines.push(Line::from(format!(
            "{} {}",
            status_symbol(&task.status),
            task.title
        )));
    } else {
        lines.push(Line::from(Span::styled("(none)", Style::default().fg(DIM))));
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
        "Approval",
        Style::default().fg(ACCENT).add_modifier(Modifier::BOLD),
    )));
    if let Some(approval) = &state.approval {
        lines.push(Line::from(format!(
            "{} {} {}",
            SYM_WAIT,
            approval.tool.as_deref().unwrap_or("tool"),
            approval.reason.as_deref().unwrap_or("")
        )));
    } else {
        lines.push(Line::from(Span::styled("(none)", Style::default().fg(DIM))));
    }

    frame.render_widget(
        Paragraph::new(Text::from(lines))
            .block(panel_block("Inspect", ui_state.focus == FocusPanel::Inspect))
            .wrap(Wrap { trim: true })
            .scroll((ui_state.scroll_for(FocusPanel::Inspect), 0)),
        area,
    );
}

fn render_bottom(
    frame: &mut Frame<'_>,
    state: &AppState,
    ui_state: &UiState,
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
    let input_label = if ui_state.input_focused {
        "Slash command"
    } else {
        "Input"
    };
    let lines = vec![
        machine,
        Line::from(actions),
        Line::from(vec![
            Span::styled(format!("{input_label}> "), Style::default().fg(ACCENT)),
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

fn render_overlay(frame: &mut Frame<'_>, ui_state: &UiState) {
    let Some(overlay) = ui_state.overlay else {
        return;
    };
    let area = centered_rect(70, 60, frame.area());
    let lines = match overlay {
        Overlay::CommandPalette => vec![
            Line::from(Span::styled(
                "Command Palette",
                Style::default().fg(ACCENT).add_modifier(Modifier::BOLD),
            )),
            Line::from(""),
            Line::from("accept"),
            Line::from("revise"),
            Line::from("export"),
            Line::from("inspect"),
        ],
        Overlay::Help => vec![
            Line::from(Span::styled(
                "Keybindings",
                Style::default().fg(ACCENT).add_modifier(Modifier::BOLD),
            )),
            Line::from(""),
            Line::from("Tab / Shift+Tab  Cycle focus or narrow tabs"),
            Line::from("1-4              Narrow tabs: Timeline / Artifacts / Tools / Inspect"),
            Line::from("Up / Down        Scroll focused panel"),
            Line::from("Enter            Activate selected item or submit input"),
            Line::from("Esc              Back or close overlay"),
            Line::from("Ctrl+P           Command palette"),
            Line::from("/                Slash-command input"),
            Line::from("?                Help"),
            Line::from("q / Ctrl+C       Quit"),
        ],
    };

    frame.render_widget(Clear, area);
    frame.render_widget(
        Paragraph::new(Text::from(lines))
            .alignment(Alignment::Left)
            .block(Block::default().title("Workbench").borders(Borders::ALL))
            .wrap(Wrap { trim: true }),
        area,
    );
}

fn render_approval_modal(frame: &mut Frame<'_>, state: &AppState) {
    let Some(approval) = &state.approval else {
        return;
    };
    let area = approval_modal_rect(frame.area());
    let inner_width = area.width.saturating_sub(2) as usize;
    let inner_height = area.height.saturating_sub(2) as usize;
    let mut lines = Vec::new();

    lines.push(Line::from(truncate_display_width(
        approval.reason.as_deref().unwrap_or("需要确认授权"),
        inner_width,
    )));
    if let Some(tool) = approval.tool.as_deref() {
        lines.push(Line::from(truncate_display_width(
            &format!("工具: {tool}"),
            inner_width,
        )));
    }
    while lines.len().saturating_add(1) < inner_height {
        lines.push(Line::from(""));
    }
    lines.push(Line::from(truncate_display_width(
        "[a] 允许执行    [d] 拒绝",
        inner_width,
    )));

    frame.render_widget(Clear, area);
    frame.render_widget(
        Paragraph::new(Text::from(lines))
            .block(
                Block::default()
                    .title("⚠ 需要授权")
                    .borders(Borders::ALL)
                    .border_style(Style::default().fg(Color::Yellow)),
            )
            .wrap(Wrap { trim: true }),
        area,
    );
}

fn approval_modal_rect(area: Rect) -> Rect {
    let percent_width = area.width.saturating_mul(60) / 100;
    let min_width = area.width.min(30);
    let width = percent_width.max(min_width).min(area.width);
    let height = area.height.min(10);
    Rect {
        x: area.x + area.width.saturating_sub(width) / 2,
        y: area.y + area.height.saturating_sub(height) / 2,
        width,
        height,
    }
}

fn centered_rect(
    percent_x: u16,
    percent_y: u16,
    area: Rect,
) -> Rect {
    let vertical = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Percentage((100 - percent_y) / 2),
            Constraint::Percentage(percent_y),
            Constraint::Percentage((100 - percent_y) / 2),
        ])
        .split(area);
    Layout::default()
        .direction(Direction::Horizontal)
        .constraints([
            Constraint::Percentage((100 - percent_x) / 2),
            Constraint::Percentage(percent_x),
            Constraint::Percentage((100 - percent_x) / 2),
        ])
        .split(vertical[1])[1]
}

fn panel_block(title: &'static str, focused: bool) -> Block<'static> {
    let style = if focused {
        Style::default().fg(ACCENT).add_modifier(Modifier::BOLD)
    } else {
        Style::default().fg(DIM)
    };
    Block::default()
        .title(title)
        .borders(Borders::ALL)
        .border_style(style)
}

fn inner_panel_rect(area: Rect) -> Rect {
    Rect {
        x: area.x.saturating_add(1),
        y: area.y.saturating_add(1),
        width: area.width.saturating_sub(2),
        height: area.height.saturating_sub(2),
    }
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

fn quick_utility_badge_line(state: &AppState, max_width: usize) -> Option<Line<'static>> {
    let utility = state.quick_utility.as_ref()?;
    let mut label = "⚡ 快捷工具 · 不计入员工绩效".to_string();
    if let Some(intent) = utility
        .intent
        .as_deref()
        .map(str::trim)
        .filter(|intent| !intent.is_empty())
    {
        label.push('：');
        label.push_str(intent);
    }

    Some(Line::from(Span::styled(
        truncate_display_width(&label, max_width),
        Style::default().fg(WARN),
    )))
}

fn pending_actions_line(actions: &[serde_json::Value], max_width: usize) -> Option<String> {
    let items = actions
        .iter()
        .filter_map(|action| {
            let key = action.get("key").and_then(|v| v.as_str())?;
            let label = action.get("label").and_then(|v| v.as_str())?;
            Some(format!("[{key}] {label}"))
        })
        .collect::<Vec<_>>();

    if items.is_empty() {
        return None;
    }

    Some(truncate_display_width(
        &format!("可执行：{}", items.join("  ")),
        max_width,
    )
    .trim_end()
    .to_string())
}

fn pending_action_hint_line(text: &str) -> Line<'static> {
    let prefix = "可执行：";
    if let Some(rest) = text.strip_prefix(prefix) {
        return Line::from(vec![
            Span::styled(prefix.to_string(), Style::default().fg(ACCENT)),
            Span::styled(rest.to_string(), Style::default().fg(DIM)),
        ]);
    }
    Line::from(Span::styled(text.to_string(), Style::default().fg(DIM)))
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
        Line::from(truncate_display_width(&state.answer, 600)),
    ]
}

fn truncate_display_width(text: &str, max_width: usize) -> String {
    let mut width = 0usize;
    let mut out = String::new();
    for ch in text.chars() {
        let mut buf = [0; 4];
        let segment = ch.encode_utf8(&mut buf);
        let next_width = UnicodeWidthStr::width(segment);
        if width + next_width > max_width {
            break;
        }
        width += next_width;
        out.push(ch);
    }
    out
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
        let symbol = if *active { SYM_OK } else { SYM_WAIT };
        spans.push(Span::styled(
            format!("{symbol} {label}"),
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
        "blocked" => SYM_WARN,
        "idle" | "draft" | "awaiting_approval" | "proposed" => SYM_WAIT,
        _ => SYM_WARN,
    }
}

fn status_label(status: &str) -> String {
    format!("{} {status}", status_symbol(status))
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

#[cfg(test)]
mod tests {
    use super::*;
    use ratatui::{Terminal, backend::TestBackend};

    use super::super::state::{Approval, QuickUtility};

    #[test]
    fn truncates_cjk_by_display_width_not_char_count() {
        assert_eq!(truncate_display_width("你好ab", 5), "你好a");
        assert_eq!(truncate_display_width("a你b好", 4), "a你b");
    }

    #[test]
    fn layout_kind_uses_spec_breakpoints() {
        assert_eq!(layout_kind(120), LayoutKind::Wide);
        assert_eq!(layout_kind(100), LayoutKind::Wide);
        assert_eq!(layout_kind(99), LayoutKind::Mid);
        assert_eq!(layout_kind(70), LayoutKind::Mid);
        assert_eq!(layout_kind(69), LayoutKind::Narrow);
    }

    #[test]
    fn status_symbol_carries_semantics_without_color() {
        assert_eq!(status_symbol("done"), SYM_OK);
        assert_eq!(status_symbol("failed"), SYM_FAIL);
        assert_eq!(status_symbol("running"), SYM_RUNNING);
        assert_eq!(status_symbol("blocked"), SYM_WARN);
        assert_eq!(status_symbol("idle"), SYM_WAIT);
    }

    #[test]
    fn render_shows_approval_modal_over_normal_layout() {
        let mut state = AppState::default();
        state.approval = Some(Approval {
            id: Some("approval1".to_string()),
            tool: Some("shell.exec".to_string()),
            reason: Some("需要执行受控命令".to_string()),
            scope: None,
        });
        let mut terminal = Terminal::new(TestBackend::new(80, 24)).expect("test terminal");

        terminal
            .draw(|frame| render(frame, &state, &UiState::default(), ""))
            .expect("draw frame");

        let contents = terminal
            .backend()
            .buffer()
            .content()
            .iter()
            .map(|cell| cell.symbol())
            .collect::<String>();
        let compact = contents.replace(' ', "");
        assert!(compact.contains("需要授权"));
        assert!(compact.contains("需要执行受控命令"));
        assert!(compact.contains("工具:shell.exec"));
        assert!(compact.contains("[a]允许执行[d]拒绝"));
    }

    #[test]
    fn render_shows_quick_utility_badge_in_timeline() {
        let mut state = AppState::default();
        state.quick_utility = Some(QuickUtility {
            intent: Some("北京天气".to_string()),
            result: None,
            source: Some("weather".to_string()),
            status: Some("done".to_string()),
        });
        let mut ui_state = UiState::default();
        ui_state.focus = FocusPanel::Timeline;
        let mut terminal = Terminal::new(TestBackend::new(100, 24)).expect("test terminal");

        terminal
            .draw(|frame| render(frame, &state, &ui_state, ""))
            .expect("draw frame");

        let contents = terminal
            .backend()
            .buffer()
            .content()
            .iter()
            .map(|cell| cell.symbol())
            .collect::<String>();
        let compact = contents.replace(' ', "");
        assert!(compact.contains("⚡快捷工具·不计入员工绩效：北京天气"));
    }

    #[test]
    fn pending_actions_line_formats_valid_actions_and_skips_incomplete_items() {
        let actions = vec![
            serde_json::json!({"key":"1","label":"接受"}),
            serde_json::json!({"key":"2"}),
            serde_json::json!({"key":"3","label":"修改"}),
        ];

        let line = pending_actions_line(&actions, 80).expect("pending action line");

        assert_eq!(line, "可执行：[1] 接受  [3] 修改");
    }

    #[test]
    fn pending_actions_line_truncates_by_display_width() {
        let actions = vec![serde_json::json!({"key":"1","label":"你好abc"})];

        let line = pending_actions_line(&actions, 12).expect("pending action line");

        assert_eq!(line, "可执行：[1]");
    }
}
