use std::{
    io::{self, BufRead, BufReader, Write},
    panic,
    path::Path,
    process::{ChildStdin, Command, Stdio},
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

enum WorkbenchMessage {
    Event(TaskEvent),
    Error(String),
    Eof,
}

enum TerminalAction {
    Continue,
    Quit,
    Submit(String),
}

enum LiveLoopExit {
    UserQuit,
    ChildEof,
}

pub fn run_workbench(demo: bool) -> Result<(), String> {
    if !io::stdout().is_tty() {
        return run_plain_transcript(demo);
    }
    install_panic_restore_hook();
    let mut terminal = TerminalGuard::enter()?;
    run_loop(&mut terminal.terminal, demo)
}

pub fn run_workbench_live(agent: &str, root: &Path) -> Result<i32, String> {
    if !io::stdout().is_tty() {
        return Err("Ratatui live workbench requires an interactive terminal.".to_string());
    }

    install_panic_restore_hook();
    let script = root.join("packages/runtime/run.mjs");
    let mut child = Command::new("node")
        .arg(&script)
        .arg(agent)
        .current_dir(root)
        .env("CREW_TUI", "ratatui")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .map_err(|error| format!("failed to launch the Node runtime (is node on PATH?): {error}"))?;

    let Some(child_stdout) = child.stdout.take() else {
        let _ = child.kill();
        let _ = child.wait();
        return Err("failed to capture Node runtime stdout".to_string());
    };
    let Some(mut child_stdin) = child.stdin.take() else {
        let _ = child.kill();
        let _ = child.wait();
        return Err("failed to capture Node runtime stdin".to_string());
    };

    let events = spawn_task_event_reader(BufReader::new(child_stdout), "engine stdout");
    let mut terminal = match TerminalGuard::enter() {
        Ok(terminal) => terminal,
        Err(error) => {
            drop(child_stdin);
            let _ = child.kill();
            let _ = child.wait();
            return Err(error);
        }
    };

    let loop_result = run_live_loop(&mut terminal.terminal, events, &mut child_stdin);
    drop(terminal);
    drop(child_stdin);

    match loop_result {
        Ok(LiveLoopExit::UserQuit) => {
            let _ = child.kill();
            let _ = child.wait();
            Ok(0)
        }
        Ok(LiveLoopExit::ChildEof) => child
            .wait()
            .map(|status| status.code().unwrap_or(1))
            .map_err(|error| format!("failed to wait for Node runtime: {error}")),
        Err(error) => {
            let _ = child.kill();
            let _ = child.wait();
            Err(error)
        }
    }
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
        match parse_task_event_line(&line) {
            Ok(Some(event)) => {
                state.reduce(&event);
                println!(
                    "{}",
                    transcript_jsonl_for_event(&event, &state)
                        .map_err(|error| format!("Failed to serialize transcript: {error}"))?
                );
            }
            Ok(None) => continue,
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
            match handle_terminal_event(&mut state, &mut ui_state, &mut input, terminal)? {
                TerminalAction::Quit => break,
                TerminalAction::Submit(submitted) => {
                    state.debug.push(format!("slash command submitted: {submitted}"));
                }
                TerminalAction::Continue => {}
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
                    WorkbenchMessage::Event(event) => state.reduce(&event),
                    WorkbenchMessage::Error(error) => state.debug.push(error),
                    WorkbenchMessage::Eof => saw_eof = true,
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

fn run_live_loop(
    terminal: &mut TuiTerminal,
    events: Receiver<WorkbenchMessage>,
    child_stdin: &mut ChildStdin,
) -> Result<LiveLoopExit, String> {
    let mut state = AppState::default();
    let mut ui_state = UiState::default();
    let mut input = String::new();

    loop {
        terminal
            .draw(|frame| ui::render(frame, &state, &ui_state, &input))
            .map_err(|error| format!("Failed to draw live workbench: {error}"))?;

        if event::poll(Duration::from_millis(50))
            .map_err(|error| format!("Failed to poll terminal events: {error}"))?
        {
            match handle_terminal_event(&mut state, &mut ui_state, &mut input, terminal)? {
                TerminalAction::Quit => return Ok(LiveLoopExit::UserQuit),
                TerminalAction::Submit(submitted) => {
                    if submitted.trim() == "/exit" {
                        return Ok(LiveLoopExit::UserQuit);
                    }
                    writeln!(child_stdin, "{submitted}")
                        .map_err(|error| format!("Failed to write to Node runtime stdin: {error}"))?;
                    child_stdin
                        .flush()
                        .map_err(|error| format!("Failed to flush Node runtime stdin: {error}"))?;
                    state.debug.push(format!("user input sent: {submitted}"));
                }
                TerminalAction::Continue => {}
            }
        }

        let mut saw_eof = false;
        while let Ok(message) = events.try_recv() {
            match message {
                WorkbenchMessage::Event(event) => state.reduce(&event),
                WorkbenchMessage::Error(error) => state.debug.push(error),
                WorkbenchMessage::Eof => saw_eof = true,
            }
        }
        if saw_eof {
            terminal
                .draw(|frame| ui::render(frame, &state, &ui_state, &input))
                .map_err(|error| format!("Failed to draw final live workbench frame: {error}"))?;
            return Ok(LiveLoopExit::ChildEof);
        }
    }
}

fn handle_terminal_event(
    state: &mut AppState,
    ui_state: &mut UiState,
    input: &mut String,
    terminal: &mut TuiTerminal,
) -> Result<TerminalAction, String> {
    let event = event::read().map_err(|error| format!("Failed to read terminal event: {error}"))?;
    let key = match event {
        Event::Key(key) => key,
        Event::Resize(_, _) => {
            terminal
                .clear()
                .map_err(|error| format!("Failed to redraw after resize: {error}"))?;
            return Ok(TerminalAction::Continue);
        }
        _ => return Ok(TerminalAction::Continue),
    };
    if key.kind != KeyEventKind::Press {
        return Ok(TerminalAction::Continue);
    }

    let is_narrow = terminal
        .size()
        .map(|area| area.width < 70)
        .unwrap_or(false);

    match key.code {
        KeyCode::Char('q') if key.modifiers.is_empty() => Ok(TerminalAction::Quit),
        KeyCode::Char('c') if key.modifiers.contains(KeyModifiers::CONTROL) => {
            Ok(TerminalAction::Quit)
        }
        KeyCode::Char('p') if key.modifiers.contains(KeyModifiers::CONTROL) => {
            ui_state.overlay = Some(Overlay::CommandPalette);
            ui_state.input_focused = false;
            Ok(TerminalAction::Continue)
        }
        KeyCode::Char('?') if key.modifiers.is_empty() || key.modifiers == KeyModifiers::SHIFT => {
            ui_state.overlay = Some(Overlay::Help);
            ui_state.input_focused = false;
            Ok(TerminalAction::Continue)
        }
        KeyCode::Esc => {
            if !ui_state.close_overlay_or_input() {
                ui_state.focus_previous();
            }
            Ok(TerminalAction::Continue)
        }
        KeyCode::Tab => {
            if is_narrow {
                ui_state.next_tab();
            } else {
                ui_state.focus_next();
            }
            Ok(TerminalAction::Continue)
        }
        KeyCode::BackTab => {
            if is_narrow {
                ui_state.previous_tab();
            } else {
                ui_state.focus_previous();
            }
            Ok(TerminalAction::Continue)
        }
        KeyCode::Up => {
            ui_state.scroll_focused(-1);
            Ok(TerminalAction::Continue)
        }
        KeyCode::Down => {
            ui_state.scroll_focused(1);
            Ok(TerminalAction::Continue)
        }
        KeyCode::Backspace => {
            if ui_state.input_focused {
                input.pop();
            }
            Ok(TerminalAction::Continue)
        }
        KeyCode::Enter => {
            if ui_state.overlay.take().is_some() {
                return Ok(TerminalAction::Continue);
            }
            if ui_state.input_focused {
                let submitted = std::mem::take(input);
                input.clear();
                ui_state.input_focused = false;
                return Ok(TerminalAction::Submit(submitted));
            } else {
                state
                    .debug
                    .push(format!("activated panel: {:?}", ui_state.focus));
            }
            Ok(TerminalAction::Continue)
        }
        KeyCode::Char(ch @ '1'..='4')
            if is_narrow && !ui_state.input_focused && ui_state.overlay.is_none() =>
        {
            ui_state.set_tab_by_number(ch);
            Ok(TerminalAction::Continue)
        }
        KeyCode::Char('/') if key.modifiers.is_empty() => {
            ui_state.overlay = None;
            ui_state.input_focused = true;
            input.clear();
            input.push('/');
            Ok(TerminalAction::Continue)
        }
        KeyCode::Char(ch) => {
            if ui_state.input_focused
                && (key.modifiers.is_empty() || key.modifiers == KeyModifiers::SHIFT)
            {
                input.push(ch);
            }
            Ok(TerminalAction::Continue)
        }
        _ => Ok(TerminalAction::Continue),
    }
}

fn parse_task_event_line(line: &str) -> Result<Option<TaskEvent>, String> {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }
    serde_json::from_str::<TaskEvent>(trimmed)
        .map(Some)
        .map_err(|error| error.to_string())
}

fn spawn_stdin_reader() -> Receiver<WorkbenchMessage> {
    let (tx, rx) = mpsc::channel();
    thread::spawn(move || {
        let stdin = io::stdin();
        for line in stdin.lock().lines() {
            match line {
                Ok(line) => match parse_task_event_line(&line) {
                    Ok(Some(event)) => {
                        if tx.send(WorkbenchMessage::Event(event)).is_err() {
                            return;
                        }
                    }
                    Ok(None) => {}
                    Err(error) => {
                        if tx
                            .send(WorkbenchMessage::Error(format!(
                                "jsonl parse error: {error}: {line}"
                            )))
                            .is_err()
                        {
                            return;
                        }
                    }
                },
                Err(error) => {
                    let _ = tx.send(WorkbenchMessage::Error(format!("stdin error: {error}")));
                    return;
                }
            }
        }
        let _ = tx.send(WorkbenchMessage::Eof);
    });
    rx
}

fn spawn_task_event_reader<R>(reader: R, source: &'static str) -> Receiver<WorkbenchMessage>
where
    R: BufRead + Send + 'static,
{
    let (tx, rx) = mpsc::channel();
    thread::spawn(move || {
        for line in reader.lines() {
            match line {
                Ok(line) => match parse_task_event_line(&line) {
                    Ok(Some(event)) => {
                        if tx.send(WorkbenchMessage::Event(event)).is_err() {
                            return;
                        }
                    }
                    Ok(None) => {}
                    Err(error) => {
                        if tx
                            .send(WorkbenchMessage::Error(format!(
                                "{source} jsonl parse error: {error}: {line}"
                            )))
                            .is_err()
                        {
                            return;
                        }
                    }
                },
                Err(error) => {
                    let _ = tx.send(WorkbenchMessage::Error(format!("{source} error: {error}")));
                    return;
                }
            }
        }
        let _ = tx.send(WorkbenchMessage::Eof);
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

    #[test]
    fn task_event_line_parser_skips_blanks_and_reports_bad_json() {
        assert_eq!(parse_task_event_line("   ").expect("blank line"), None);

        let event = parse_task_event_line(
            r#"{"type":"token.delta","ts":1,"data":{"text":"hello"}}"#,
        )
        .expect("valid line")
        .expect("event");

        assert_eq!(event.event_type(), "token.delta");
        assert!(parse_task_event_line("{not json").is_err());
    }
}
