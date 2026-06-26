use std::{
    io::{self, BufRead},
    panic,
    sync::mpsc::{self, Receiver},
    thread,
    time::{Duration, Instant},
};

use crossterm::{
    cursor::Show,
    event::{self, Event, KeyCode, KeyEventKind, KeyModifiers},
    execute,
    terminal::{EnterAlternateScreen, LeaveAlternateScreen, disable_raw_mode, enable_raw_mode},
    tty::IsTty,
};
use ratatui::{Terminal, backend::CrosstermBackend};
use serde_json::json;

use self::{
    protocol::TaskEvent,
    state::{AppState, Overlay, UiState},
};

pub mod protocol;
pub mod state;
pub mod ui;

type TuiTerminal = Terminal<CrosstermBackend<io::Stdout>>;

enum StdinMessage {
    Line(String),
    Error(String),
    Eof,
}

pub fn run_workbench(demo: bool) -> Result<(), String> {
    if !io::stdout().is_tty() {
        return run_plain_transcript(demo);
    }
    install_panic_restore_hook();
    let mut terminal = TerminalGuard::enter()?;
    run_loop(&mut terminal.terminal, demo)
}

fn run_plain_transcript(demo: bool) -> Result<(), String> {
    let mut state = AppState::default();
    if demo {
        for event in scripted_demo_events() {
            state.reduce(&event);
            println!(
                "{}",
                transcript_jsonl_for_event(&event, &state)
                    .map_err(|error| format!("Failed to serialize transcript: {error}"))?
            );
        }
        return Ok(());
    }

    let stdin = io::stdin();
    for line in stdin.lock().lines() {
        let line = line.map_err(|error| format!("Failed to read stdin: {error}"))?;
        if line.trim().is_empty() {
            continue;
        }
        match serde_json::from_str::<TaskEvent>(&line) {
            Ok(event) => {
                state.reduce(&event);
                println!(
                    "{}",
                    transcript_jsonl_for_event(&event, &state)
                        .map_err(|error| format!("Failed to serialize transcript: {error}"))?
                );
            }
            Err(error) => {
                println!(
                    "{}",
                    serde_json::to_string(&json!({
                        "type": "workbench.error",
                        "error": format!("jsonl parse error: {error}"),
                        "line": line,
                    }))
                    .map_err(|error| format!("Failed to serialize transcript error: {error}"))?
                );
            }
        }
    }
    Ok(())
}

fn transcript_jsonl_for_event(
    event: &TaskEvent,
    state: &AppState,
) -> serde_json::Result<String> {
    let latest = state.timeline.last();
    serde_json::to_string(&json!({
        "type": "workbench.transcript",
        "event": event.event_type(),
        "status": state.status,
        "task": state.task.as_ref().map(|task| task.title.clone()),
        "symbol": latest.map(|line| line.status.clone()).unwrap_or_else(|| "?".to_string()),
        "label": latest.map(|line| line.label.clone()).unwrap_or_default(),
        "detail": latest.map(|line| line.detail.clone()).unwrap_or_default(),
    }))
}

fn run_loop(terminal: &mut TuiTerminal, demo: bool) -> Result<(), String> {
    let mut state = AppState::default();
    let mut ui_state = UiState::default();
    let mut input = String::new();
    let stdin = if demo { None } else { Some(spawn_stdin_reader()) };
    let demo_events = if demo { scripted_demo_events() } else { Vec::new() };
    let mut demo_index = 0usize;
    let mut next_demo = Instant::now();

    if demo {
        state.employee = Some(state::Employee {
            name: "AI 落地鲸".to_string(),
            role: "企业大模型落地顾问".to_string(),
            model: "demo".to_string(),
        });
        state.mode = "Trial".to_string();
    }

    loop {
        terminal
            .draw(|frame| ui::render(frame, &state, &ui_state, &input))
            .map_err(|error| format!("Failed to draw workbench: {error}"))?;

        if event::poll(Duration::from_millis(50))
            .map_err(|error| format!("Failed to poll terminal events: {error}"))?
        {
            if handle_terminal_event(&mut state, &mut ui_state, &mut input, terminal)?
                .then_some(())
                .is_some()
            {
                break;
            }
        }

        if demo {
            if demo_index < demo_events.len() && Instant::now() >= next_demo {
                state.reduce(&demo_events[demo_index]);
                demo_index += 1;
                next_demo = Instant::now() + Duration::from_millis(150);
            }
        } else if let Some(stdin) = &stdin {
            let mut saw_eof = false;
            while let Ok(message) = stdin.try_recv() {
                match message {
                    StdinMessage::Line(line) => {
                        if line.trim().is_empty() {
                            continue;
                        }
                        match serde_json::from_str::<TaskEvent>(&line) {
                            Ok(event) => state.reduce(&event),
                            Err(error) => state
                                .debug
                                .push(format!("jsonl parse error: {error}: {line}")),
                        }
                    }
                    StdinMessage::Error(error) => state.debug.push(format!("stdin error: {error}")),
                    StdinMessage::Eof => saw_eof = true,
                }
            }
            if saw_eof {
                terminal
                    .draw(|frame| ui::render(frame, &state, &ui_state, &input))
                    .map_err(|error| format!("Failed to draw final workbench frame: {error}"))?;
                break;
            }
        }
    }

    Ok(())
}

fn handle_terminal_event(
    state: &mut AppState,
    ui_state: &mut UiState,
    input: &mut String,
    terminal: &mut TuiTerminal,
) -> Result<bool, String> {
    let event = event::read().map_err(|error| format!("Failed to read terminal event: {error}"))?;
    let key = match event {
        Event::Key(key) => key,
        Event::Resize(_, _) => {
            terminal
                .clear()
                .map_err(|error| format!("Failed to redraw after resize: {error}"))?;
            return Ok(false);
        }
        _ => return Ok(false),
    };
    if key.kind != KeyEventKind::Press {
        return Ok(false);
    }

    let is_narrow = terminal
        .size()
        .map(|area| area.width < 70)
        .unwrap_or(false);

    match key.code {
        KeyCode::Char('q') if key.modifiers.is_empty() => Ok(true),
        KeyCode::Char('c') if key.modifiers.contains(KeyModifiers::CONTROL) => Ok(true),
        KeyCode::Char('p') if key.modifiers.contains(KeyModifiers::CONTROL) => {
            ui_state.overlay = Some(Overlay::CommandPalette);
            ui_state.input_focused = false;
            Ok(false)
        }
        KeyCode::Char('?') if key.modifiers.is_empty() || key.modifiers == KeyModifiers::SHIFT => {
            ui_state.overlay = Some(Overlay::Help);
            ui_state.input_focused = false;
            Ok(false)
        }
        KeyCode::Esc => {
            if !ui_state.close_overlay_or_input() {
                ui_state.focus_previous();
            }
            Ok(false)
        }
        KeyCode::Tab => {
            if is_narrow {
                ui_state.next_tab();
            } else {
                ui_state.focus_next();
            }
            Ok(false)
        }
        KeyCode::BackTab => {
            if is_narrow {
                ui_state.previous_tab();
            } else {
                ui_state.focus_previous();
            }
            Ok(false)
        }
        KeyCode::Up => {
            ui_state.scroll_focused(-1);
            Ok(false)
        }
        KeyCode::Down => {
            ui_state.scroll_focused(1);
            Ok(false)
        }
        KeyCode::Backspace => {
            if ui_state.input_focused {
                input.pop();
            }
            Ok(false)
        }
        KeyCode::Enter => {
            if ui_state.overlay.take().is_some() {
                return Ok(false);
            }
            if ui_state.input_focused {
                state.debug.push(format!("slash command submitted: {input}"));
                input.clear();
                ui_state.input_focused = false;
            } else {
                state
                    .debug
                    .push(format!("activated panel: {:?}", ui_state.focus));
            }
            Ok(false)
        }
        KeyCode::Char(ch @ '1'..='4')
            if is_narrow && !ui_state.input_focused && ui_state.overlay.is_none() =>
        {
            ui_state.set_tab_by_number(ch);
            Ok(false)
        }
        KeyCode::Char('/') if key.modifiers.is_empty() => {
            ui_state.overlay = None;
            ui_state.input_focused = true;
            input.clear();
            input.push('/');
            Ok(false)
        }
        KeyCode::Char(ch) => {
            if ui_state.input_focused
                && (key.modifiers.is_empty() || key.modifiers == KeyModifiers::SHIFT)
            {
                input.push(ch);
            }
            Ok(false)
        }
        _ => Ok(false),
    }
}

fn spawn_stdin_reader() -> Receiver<StdinMessage> {
    let (tx, rx) = mpsc::channel();
    thread::spawn(move || {
        let stdin = io::stdin();
        for line in stdin.lock().lines() {
            match line {
                Ok(line) => {
                    if tx.send(StdinMessage::Line(line)).is_err() {
                        return;
                    }
                }
                Err(error) => {
                    let _ = tx.send(StdinMessage::Error(error.to_string()));
                    return;
                }
            }
        }
        let _ = tx.send(StdinMessage::Eof);
    });
    rx
}

fn scripted_demo_events() -> Vec<TaskEvent> {
    vec![
        TaskEvent::from_parts(
            "task.started",
            1,
            json!({"id":"demo-task","title":"ROI 示例试岗","mode":"Trial"}),
        ),
        TaskEvent::from_parts(
            "plan.created",
            2,
            json!({"id":"demo-plan","steps":["确认假设","检查工具","生成报告","请求验收"]}),
        ),
        TaskEvent::from_parts(
            "tool.requested",
            3,
            json!({"id":"search","tool":"web.search","label":"search","reason":"需要官方资料","needsApproval":false}),
        ),
        TaskEvent::from_parts(
            "tool.failed",
            4,
            json!({"id":"search","code":"missing_key"}),
        ),
        TaskEvent::from_parts(
            "tool.requested",
            5,
            json!({"id":"artifact","tool":"artifact.write","label":"artifact.write"}),
        ),
        TaskEvent::from_parts(
            "tool.succeeded",
            6,
            json!({"id":"artifact","summary":"roi_report.md"}),
        ),
        TaskEvent::from_parts(
            "evidence.created",
            7,
            json!({"id":"ev1","fact":"试岗报告需要明确假设和来源","source":"CrewClaw PRD","confidence":0.9}),
        ),
        TaskEvent::from_parts(
            "token.delta",
            8,
            json!({"text":"已生成 ROI 试岗报告草稿，等待验收。"}),
        ),
        TaskEvent::from_parts(
            "artifact.created",
            9,
            json!({"id":"art1","name":"roi_report.md","kind":"report","path":".crewclaw/artifacts/demo-task/roi_report.md","status":"draft","checks":["假设已标注","工具状态真实"]}),
        ),
        TaskEvent::from_parts("task.completed", 10, json!({"id":"demo-task"})),
        TaskEvent::from_parts(
            "approval.requested",
            11,
            json!({"id":"approval1","tool":"review","reason":"请验收试岗输出","scope":{"artifact":"roi_report.md"}}),
        ),
    ]
}

struct TerminalGuard {
    terminal: TuiTerminal,
}

impl TerminalGuard {
    fn enter() -> Result<Self, String> {
        enable_raw_mode().map_err(|error| format!("Failed to enable raw mode: {error}"))?;
        let mut stdout = io::stdout();
        execute!(stdout, EnterAlternateScreen)
            .map_err(|error| format!("Failed to enter alternate screen: {error}"))?;
        let backend = CrosstermBackend::new(stdout);
        let mut terminal = Terminal::new(backend)
            .map_err(|error| format!("Failed to initialize terminal: {error}"))?;
        terminal
            .clear()
            .map_err(|error| format!("Failed to clear terminal: {error}"))?;
        Ok(Self { terminal })
    }
}

impl Drop for TerminalGuard {
    fn drop(&mut self) {
        let _ = self.terminal.show_cursor();
        let _ = disable_raw_mode();
        let _ = execute!(self.terminal.backend_mut(), LeaveAlternateScreen, Show);
    }
}

fn install_panic_restore_hook() {
    let previous = panic::take_hook();
    panic::set_hook(Box::new(move |info| {
        let _ = restore_terminal();
        previous(info);
    }));
}

fn restore_terminal() -> io::Result<()> {
    disable_raw_mode()?;
    execute!(io::stdout(), LeaveAlternateScreen, Show)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn transcript_jsonl_has_no_ansi_and_includes_symbol_status() {
        let event = TaskEvent::from_parts(
            "task.started",
            1,
            json!({"id":"t","title":"处理中文任务","mode":"Trial"}),
        );
        let mut state = AppState::default();
        state.reduce(&event);

        let line = transcript_jsonl_for_event(&event, &state).expect("json line");

        assert!(!line.contains("\u{1b}["));
        assert!(line.contains("task.started"));
        assert!(line.contains("→"));
        assert!(line.contains("处理中文任务"));
    }
}
