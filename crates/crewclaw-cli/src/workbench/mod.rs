use std::{
    io::{self, BufRead, BufReader},
    panic,
    path::Path,
    process::{ChildStdin, Command, Stdio},
    sync::mpsc::{self, Receiver},
    thread,
    time::{Duration, Instant},
};

use crossterm::event::{DisableBracketedPaste, EnableBracketedPaste};
use crossterm::{
    cursor::Show,
    event::{self, Event, KeyCode, KeyEvent, KeyEventKind, KeyModifiers},
    execute,
    terminal::{EnterAlternateScreen, LeaveAlternateScreen, disable_raw_mode, enable_raw_mode},
    tty::IsTty,
};
use ratatui::{Terminal, backend::CrosstermBackend};
use serde_json::json;

use self::{
    actions::{
        artifact_action_for_selected, should_route_pending_action_digit,
        user_action_for_pending_digit, write_user_action,
    },
    input::InputBuffer,
    protocol::{TaskEvent, UserAction},
    refs::{picker_for_query, resolve_references},
    state::{AppState, Overlay, UiState},
};

pub mod actions;
pub mod input;
pub mod preview;
pub mod protocol;
pub mod refs;
pub mod state;
pub mod ui;
pub mod widgets;

type TuiTerminal = Terminal<CrosstermBackend<io::Stdout>>;

enum WorkbenchMessage {
    Event(TaskEvent),
    Debug(String),
    Error(String),
    Eof,
}

enum TerminalAction {
    Continue,
    Quit,
    Submit(String),
    SendAction(UserAction),
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

pub fn run_workbench_live(runtime_args: &[String], root: &Path) -> Result<i32, String> {
    if !io::stdout().is_tty() {
        return Err("Ratatui live workbench requires an interactive terminal.".to_string());
    }
    if runtime_args.is_empty() {
        return Err("Ratatui live workbench requires an employee name.".to_string());
    }

    install_panic_restore_hook();
    let script = root.join("packages/runtime/run.mjs");
    let mut child = Command::new("node")
        .arg(&script)
        .args(runtime_args)
        .current_dir(root)
        .env("CREW_TUI", "ratatui")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| {
            format!("failed to launch the Node runtime (is node on PATH?): {error}")
        })?;

    let Some(child_stdout) = child.stdout.take() else {
        let _ = child.kill();
        let _ = child.wait();
        return Err("failed to capture Node runtime stdout".to_string());
    };
    let Some(child_stderr) = child.stderr.take() else {
        let _ = child.kill();
        let _ = child.wait();
        return Err("failed to capture Node runtime stderr".to_string());
    };
    let Some(mut child_stdin) = child.stdin.take() else {
        let _ = child.kill();
        let _ = child.wait();
        return Err("failed to capture Node runtime stdin".to_string());
    };

    let events = spawn_task_event_reader(BufReader::new(child_stdout), "engine stdout");
    let debug = spawn_debug_line_reader(BufReader::new(child_stderr), "engine stderr");
    let mut terminal = match TerminalGuard::enter() {
        Ok(terminal) => terminal,
        Err(error) => {
            drop(child_stdin);
            let _ = child.kill();
            let _ = child.wait();
            return Err(error);
        }
    };

    let loop_result = run_live_loop(&mut terminal.terminal, events, debug, &mut child_stdin);
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

fn transcript_jsonl_for_event(event: &TaskEvent, state: &AppState) -> serde_json::Result<String> {
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
    let mut input = InputBuffer::default();
    let stdin = if demo {
        None
    } else {
        Some(spawn_stdin_reader())
    };
    let demo_events = if demo {
        scripted_demo_events()
    } else {
        Vec::new()
    };
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
            .draw(|frame| {
                ui::render_with_input(frame, &state, &ui_state, input.as_str(), input.cursor())
            })
            .map_err(|error| format!("Failed to draw workbench: {error}"))?;

        if event::poll(Duration::from_millis(50))
            .map_err(|error| format!("Failed to poll terminal events: {error}"))?
        {
            match handle_terminal_event(&mut state, &mut ui_state, &mut input, terminal)? {
                TerminalAction::Quit => break,
                TerminalAction::Submit(submitted) => {
                    state
                        .debug
                        .push(format!("slash command submitted: {submitted}"));
                }
                TerminalAction::SendAction(action) => {
                    state.debug.push(format!(
                        "user action submitted: {}",
                        serde_json::to_string(&action).unwrap_or_else(|_| "<invalid>".to_string())
                    ));
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
                    WorkbenchMessage::Debug(line) => state.debug.push(line),
                    WorkbenchMessage::Error(error) => state.debug.push(error),
                    WorkbenchMessage::Eof => saw_eof = true,
                }
            }
            if saw_eof {
                terminal
                    .draw(|frame| {
                        ui::render_with_input(
                            frame,
                            &state,
                            &ui_state,
                            input.as_str(),
                            input.cursor(),
                        )
                    })
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
    debug: Receiver<WorkbenchMessage>,
    child_stdin: &mut ChildStdin,
) -> Result<LiveLoopExit, String> {
    let mut state = AppState::default();
    let mut ui_state = UiState::default();
    let mut input = InputBuffer::default();

    loop {
        terminal
            .draw(|frame| {
                ui::render_with_input(frame, &state, &ui_state, input.as_str(), input.cursor())
            })
            .map_err(|error| format!("Failed to draw live workbench: {error}"))?;

        if event::poll(Duration::from_millis(50))
            .map_err(|error| format!("Failed to poll terminal events: {error}"))?
        {
            if state.approval.is_some() {
                let terminal_event = event::read()
                    .map_err(|error| format!("Failed to read terminal event: {error}"))?;
                match terminal_event {
                    Event::Key(key) if key.kind == KeyEventKind::Press => {
                        let decision = match key.code {
                            KeyCode::Char('a') | KeyCode::Char('y') => Some("accept"),
                            KeyCode::Char('d') | KeyCode::Char('n') => Some("reject"),
                            _ => None,
                        };
                        if let Some(decision) = decision {
                            let id = state
                                .approval
                                .as_ref()
                                .and_then(|approval| approval.id.clone())
                                .unwrap_or_else(|| "approval".to_string());
                            write_user_action(
                                child_stdin,
                                &UserAction::approval_resolve(id, decision.to_string()),
                            )?;
                        }
                    }
                    Event::Resize(_, _) => {
                        terminal
                            .clear()
                            .map_err(|error| format!("Failed to redraw after resize: {error}"))?;
                    }
                    _ => {}
                }
                continue;
            }
            let terminal_event =
                event::read().map_err(|error| format!("Failed to read terminal event: {error}"))?;
            if let Event::Key(key) = &terminal_event {
                if key.kind == KeyEventKind::Press {
                    if let KeyCode::Char(ch) = key.code {
                        if should_route_pending_action_digit(&state, &ui_state, ch) {
                            if let Some(action) =
                                user_action_for_pending_digit(&state, &ui_state, ch)
                            {
                                write_user_action(child_stdin, &action)?;
                            }
                            continue;
                        }
                    }
                }
            }
            match handle_terminal_event_from_event(
                &mut state,
                &mut ui_state,
                &mut input,
                terminal,
                terminal_event,
            )? {
                TerminalAction::Quit => return Ok(LiveLoopExit::UserQuit),
                TerminalAction::Submit(submitted) => {
                    if submitted.trim() == "/exit" {
                        return Ok(LiveLoopExit::UserQuit);
                    }
                    let refs = resolve_references(&state, &submitted);
                    let action = UserAction::user_message(submitted.clone(), refs);
                    write_user_action(child_stdin, &action)?;
                    state.debug.push(format!("user input sent: {submitted}"));
                }
                TerminalAction::SendAction(action) => {
                    write_user_action(child_stdin, &action)?;
                    state.debug.push(format!(
                        "user action sent: {}",
                        serde_json::to_string(&action).unwrap_or_else(|_| "<invalid>".to_string())
                    ));
                }
                TerminalAction::Continue => {}
            }
        }

        let mut saw_eof = false;
        while let Ok(message) = events.try_recv() {
            match message {
                WorkbenchMessage::Event(event) => state.reduce(&event),
                WorkbenchMessage::Debug(line) => state.debug.push(line),
                WorkbenchMessage::Error(error) => state.debug.push(error),
                WorkbenchMessage::Eof => saw_eof = true,
            }
        }
        while let Ok(message) = debug.try_recv() {
            match message {
                WorkbenchMessage::Debug(line) | WorkbenchMessage::Error(line) => {
                    state.debug.push(line);
                }
                WorkbenchMessage::Event(event) => state.reduce(&event),
                WorkbenchMessage::Eof => {}
            }
        }
        if saw_eof {
            terminal
                .draw(|frame| {
                    ui::render_with_input(frame, &state, &ui_state, input.as_str(), input.cursor())
                })
                .map_err(|error| format!("Failed to draw final live workbench frame: {error}"))?;
            return Ok(LiveLoopExit::ChildEof);
        }
    }
}

fn handle_terminal_event(
    state: &mut AppState,
    ui_state: &mut UiState,
    input: &mut InputBuffer,
    terminal: &mut TuiTerminal,
) -> Result<TerminalAction, String> {
    let event = event::read().map_err(|error| format!("Failed to read terminal event: {error}"))?;
    handle_terminal_event_from_event(state, ui_state, input, terminal, event)
}

fn handle_terminal_event_from_event(
    state: &mut AppState,
    ui_state: &mut UiState,
    input: &mut InputBuffer,
    terminal: &mut TuiTerminal,
    event: Event,
) -> Result<TerminalAction, String> {
    let key = match event {
        Event::Key(key) => key,
        Event::Resize(_, _) => {
            terminal
                .clear()
                .map_err(|error| format!("Failed to redraw after resize: {error}"))?;
            return Ok(TerminalAction::Continue);
        }
        Event::Paste(text) => {
            append_paste_to_input(ui_state, input, &text);
            return Ok(TerminalAction::Continue);
        }
        _ => return Ok(TerminalAction::Continue),
    };
    if key.kind != KeyEventKind::Press {
        return Ok(TerminalAction::Continue);
    }

    let is_narrow = terminal.size().map(|area| area.width < 70).unwrap_or(false);

    handle_key_event(state, ui_state, input, is_narrow, key)
}

fn handle_key_event(
    state: &mut AppState,
    ui_state: &mut UiState,
    input: &mut InputBuffer,
    is_narrow: bool,
    key: KeyEvent,
) -> Result<TerminalAction, String> {
    let action = match key.code {
        KeyCode::Char('q') if key.modifiers.is_empty() && !ui_state.input_focused => {
            Ok(TerminalAction::Quit)
        }
        KeyCode::Char('c') if key.modifiers.contains(KeyModifiers::CONTROL) => {
            Ok(TerminalAction::Quit)
        }
        KeyCode::Char('g') if key.modifiers.contains(KeyModifiers::CONTROL) => {
            cancel_current_action(ui_state, input);
            Ok(TerminalAction::Continue)
        }
        KeyCode::Char('p') if key.modifiers.contains(KeyModifiers::CONTROL) => {
            ui_state.overlay = Some(Overlay::CommandPalette);
            ui_state.input_focused = false;
            Ok(TerminalAction::Continue)
        }
        KeyCode::Char('?')
            if !ui_state.input_focused
                && (key.modifiers.is_empty() || key.modifiers == KeyModifiers::SHIFT) =>
        {
            ui_state.overlay = Some(Overlay::Help);
            ui_state.input_focused = false;
            Ok(TerminalAction::Continue)
        }
        KeyCode::Esc => {
            if state.ref_picker.is_some() {
                state.set_ref_picker(None);
            } else if !ui_state.close_overlay_or_input() {
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
            if state.ref_picker.is_some() {
                state.move_ref_picker(-1);
            } else if ui_state.input_focused {
                input.history_previous();
            } else if ui_state.focus == state::FocusPanel::Artifacts {
                state.select_previous_artifact();
            } else {
                ui_state.scroll_focused(-1);
            }
            Ok(TerminalAction::Continue)
        }
        KeyCode::Down => {
            if state.ref_picker.is_some() {
                state.move_ref_picker(1);
            } else if ui_state.input_focused {
                input.history_next();
            } else if ui_state.focus == state::FocusPanel::Artifacts {
                state.select_next_artifact();
            } else {
                ui_state.scroll_focused(1);
            }
            Ok(TerminalAction::Continue)
        }
        KeyCode::Backspace => {
            if ui_state.input_focused {
                input.backspace();
            }
            Ok(TerminalAction::Continue)
        }
        KeyCode::Delete => {
            if ui_state.input_focused {
                input.delete();
            }
            Ok(TerminalAction::Continue)
        }
        KeyCode::Left => {
            if ui_state.input_focused {
                input.move_left();
            }
            Ok(TerminalAction::Continue)
        }
        KeyCode::Right => {
            if ui_state.input_focused {
                input.move_right();
            }
            Ok(TerminalAction::Continue)
        }
        KeyCode::Home => {
            if ui_state.input_focused {
                input.move_home();
            }
            Ok(TerminalAction::Continue)
        }
        KeyCode::End => {
            if ui_state.input_focused {
                input.move_end();
            }
            Ok(TerminalAction::Continue)
        }
        KeyCode::Enter => {
            if state.ref_picker.is_some() {
                if let Some(candidate) = state.selected_ref_candidate().cloned() {
                    input.replace_active_reference(&candidate.token);
                }
                state.set_ref_picker(None);
                return Ok(TerminalAction::Continue);
            }
            if ui_state.overlay.take().is_some() {
                return Ok(TerminalAction::Continue);
            }
            if ui_state.input_focused {
                if key.modifiers.contains(KeyModifiers::ALT) {
                    input.insert_char('\n');
                    return Ok(TerminalAction::Continue);
                }
                let submitted = input.submit();
                ui_state.input_focused = false;
                return Ok(TerminalAction::Submit(submitted));
            } else {
                state
                    .debug
                    .push(format!("activated panel: {:?}", ui_state.focus));
                if ui_state.focus == state::FocusPanel::Artifacts {
                    if let Some(action) = artifact_action_for_selected(state, "artifact.preview") {
                        return Ok(TerminalAction::SendAction(action));
                    }
                }
            }
            Ok(TerminalAction::Continue)
        }
        KeyCode::Char('d')
            if key.modifiers.is_empty()
                && !ui_state.input_focused
                && ui_state.focus == state::FocusPanel::Artifacts =>
        {
            Ok(artifact_action_for_selected(state, "artifact.delete")
                .map(TerminalAction::SendAction)
                .unwrap_or(TerminalAction::Continue))
        }
        KeyCode::Char('r')
            if key.modifiers.is_empty()
                && !ui_state.input_focused
                && ui_state.focus == state::FocusPanel::Artifacts =>
        {
            Ok(artifact_action_for_selected(state, "artifact.reveal")
                .map(TerminalAction::SendAction)
                .unwrap_or(TerminalAction::Continue))
        }
        KeyCode::Char('e')
            if key.modifiers.is_empty()
                && !ui_state.input_focused
                && ui_state.focus == state::FocusPanel::Artifacts =>
        {
            Ok(artifact_action_for_selected(state, "artifact.export")
                .map(TerminalAction::SendAction)
                .unwrap_or(TerminalAction::Continue))
        }
        KeyCode::Char(ch @ '1'..='4')
            if is_narrow && !ui_state.input_focused && ui_state.overlay.is_none() =>
        {
            ui_state.set_tab_by_number(ch);
            Ok(TerminalAction::Continue)
        }
        KeyCode::Char('/') if key.modifiers.is_empty() && !ui_state.input_focused => {
            ui_state.overlay = None;
            ui_state.input_focused = true;
            input.clear();
            input.insert_char('/');
            Ok(TerminalAction::Continue)
        }
        KeyCode::Char(ch) => {
            if ui_state.input_focused
                && (key.modifiers.is_empty() || key.modifiers == KeyModifiers::SHIFT)
            {
                input.insert_char(ch);
                if ch == '@' {
                    state.set_ref_picker(picker_for_query(state, ""));
                } else if state.ref_picker.is_some() {
                    let picker = input
                        .active_reference_query()
                        .and_then(|query| picker_for_query(state, &query));
                    state.set_ref_picker(picker);
                }
            }
            Ok(TerminalAction::Continue)
        }
        _ => Ok(TerminalAction::Continue),
    };
    if action.is_ok() {
        state.sync_focus(ui_state);
    }
    action
}

fn cancel_current_action(ui_state: &mut UiState, input: &mut InputBuffer) -> bool {
    let had_input = ui_state.input_focused || !input.is_empty();
    ui_state.overlay = None;
    ui_state.input_focused = false;
    input.clear();
    had_input
}

fn append_paste_to_input(ui_state: &UiState, input: &mut InputBuffer, text: &str) -> bool {
    if !ui_state.input_focused {
        return false;
    }
    input.insert_str(text);
    true
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

fn spawn_debug_line_reader<R>(reader: R, source: &'static str) -> Receiver<WorkbenchMessage>
where
    R: BufRead + Send + 'static,
{
    let (tx, rx) = mpsc::channel();
    thread::spawn(move || {
        for line in reader.lines() {
            match line {
                Ok(line) => {
                    if line.trim().is_empty() {
                        continue;
                    }
                    if tx
                        .send(WorkbenchMessage::Debug(format!("{source}: {line}")))
                        .is_err()
                    {
                        return;
                    }
                }
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
        execute!(stdout, EnableBracketedPaste)
            .map_err(|error| format!("Failed to enable bracketed paste: {error}"))?;
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
        let _ = execute!(self.terminal.backend_mut(), DisableBracketedPaste);
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
    execute!(
        io::stdout(),
        DisableBracketedPaste,
        LeaveAlternateScreen,
        Show
    )?;
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

        let event =
            parse_task_event_line(r#"{"type":"token.delta","ts":1,"data":{"text":"hello"}}"#)
                .expect("valid line")
                .expect("event");

        assert_eq!(event.event_type(), "token.delta");
        assert!(parse_task_event_line("{not json").is_err());
    }

    #[test]
    fn stderr_debug_reader_wraps_lines_for_inspect() {
        let reader = std::io::Cursor::new("raw response\nstack trace\n");
        let messages = spawn_debug_line_reader(reader, "engine stderr");

        match messages
            .recv_timeout(Duration::from_secs(1))
            .expect("first debug line")
        {
            WorkbenchMessage::Debug(line) => {
                assert_eq!(line, "engine stderr: raw response");
            }
            _ => panic!("expected debug line"),
        }
        match messages
            .recv_timeout(Duration::from_secs(1))
            .expect("second debug line")
        {
            WorkbenchMessage::Debug(line) => {
                assert_eq!(line, "engine stderr: stack trace");
            }
            _ => panic!("expected debug line"),
        }
        assert!(matches!(
            messages.recv_timeout(Duration::from_secs(1)).expect("eof"),
            WorkbenchMessage::Eof
        ));
    }

    #[test]
    fn pending_action_digit_routes_only_when_unfocused_and_matching() {
        let mut state = AppState::default();
        state.pending_actions = vec![
            state::PendingAction {
                key: "2".to_string(),
                label: "修改".to_string(),
                command: Some("revise".to_string()),
            },
            state::PendingAction {
                key: "9".to_string(),
                label: "忽略".to_string(),
                command: None,
            },
        ];
        let mut ui_state = UiState::default();

        assert!(should_route_pending_action_digit(&state, &ui_state, '2'));
        assert!(!should_route_pending_action_digit(&state, &ui_state, '1'));
        assert!(!should_route_pending_action_digit(&state, &ui_state, 'x'));

        ui_state.input_focused = true;
        assert!(!should_route_pending_action_digit(&state, &ui_state, '2'));
    }

    #[test]
    fn pending_action_digit_does_not_route_while_approval_is_active() {
        let mut state = AppState::default();
        state.pending_actions = vec![state::PendingAction {
            key: "1".to_string(),
            label: "接受".to_string(),
            command: None,
        }];
        state.approval = Some(state::Approval {
            id: Some("a1".to_string()),
            tool: Some("tool".to_string()),
            reason: Some("confirm".to_string()),
            scope: None,
        });

        assert!(!should_route_pending_action_digit(
            &state,
            &UiState::default(),
            '1'
        ));
    }

    #[test]
    fn pending_action_digit_builds_structured_user_action() {
        let mut state = AppState::default();
        state.pending_actions = vec![state::PendingAction {
            key: "1".to_string(),
            label: "生成 ROI 示例".to_string(),
            command: Some("run_roi_demo".to_string()),
        }];

        let action = user_action_for_pending_digit(&state, &UiState::default(), '1')
            .expect("pending action");

        assert_eq!(
            serde_json::to_value(&action).expect("serialize action"),
            json!({"type":"pending.run","data":{"key":"1","command":"run_roi_demo"}})
        );
    }

    #[test]
    fn artifact_panel_keys_emit_structured_actions() {
        let mut state = AppState::default();
        state.artifacts.push(state::Artifact {
            id: Some("a1".to_string()),
            name: Some("roi_report.md".to_string()),
            kind: Some("markdown".to_string()),
            artifact_type: None,
            path: Some("/tmp/roi_report.md".to_string()),
            status: "ready".to_string(),
            summary: Some("ROI".to_string()),
            checks: Vec::new(),
        });
        state.selected_artifact = Some("a1".to_string());
        let mut ui_state = UiState::default();
        ui_state.focus = state::FocusPanel::Artifacts;

        let preview = handle_key_event(
            &mut state,
            &mut ui_state,
            &mut InputBuffer::default(),
            false,
            KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE),
        )
        .expect("preview action");
        assert!(matches!(preview, TerminalAction::SendAction(_)));

        let delete = handle_key_event(
            &mut state,
            &mut ui_state,
            &mut InputBuffer::default(),
            false,
            KeyEvent::new(KeyCode::Char('d'), KeyModifiers::NONE),
        )
        .expect("delete action");
        match delete {
            TerminalAction::SendAction(action) => {
                assert_eq!(
                    serde_json::to_string(&action).expect("delete action json"),
                    r#"{"type":"artifact.delete","data":{"artifact_id":"a1"}}"#
                );
            }
            _ => panic!("expected artifact action"),
        }
    }

    #[test]
    fn at_reference_picker_inserts_canonical_token() {
        let mut state = AppState::default();
        state.employee = Some(state::Employee {
            name: "Zeneth".to_string(),
            role: "社群运营".to_string(),
            model: "demo".to_string(),
        });
        state.task = Some(state::Task {
            id: Some("task1".to_string()),
            title: "生成报告".to_string(),
            status: "running".to_string(),
        });
        state.artifacts.push(state::Artifact {
            id: Some("a1".to_string()),
            name: Some("roi_report.md".to_string()),
            kind: Some("markdown".to_string()),
            artifact_type: None,
            path: None,
            status: "ready".to_string(),
            summary: None,
            checks: Vec::new(),
        });
        let mut ui_state = UiState::default();
        ui_state.input_focused = true;
        let mut input = InputBuffer::default();

        handle_key_event(
            &mut state,
            &mut ui_state,
            &mut input,
            false,
            KeyEvent::new(KeyCode::Char('@'), KeyModifiers::NONE),
        )
        .expect("open picker");
        assert!(state.ref_picker.is_some());

        handle_key_event(
            &mut state,
            &mut ui_state,
            &mut input,
            false,
            KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE),
        )
        .expect("insert reference");

        assert_eq!(input.as_str(), "@artifact:a1");
        assert!(state.ref_picker.is_none());
    }

    #[test]
    fn ctrl_g_cancels_focused_input_and_clears_buffer() {
        let mut ui_state = UiState::default();
        ui_state.input_focused = true;
        let mut input = InputBuffer::default();
        input.insert_str("/run roi-demo");

        assert!(cancel_current_action(&mut ui_state, &mut input));
        assert!(!ui_state.input_focused);
        assert!(input.is_empty());
        assert_eq!(input.cursor(), 0);
    }

    #[test]
    fn paste_appends_only_when_input_is_focused() {
        let mut focused = UiState::default();
        focused.input_focused = true;
        let mut input = InputBuffer::default();
        input.insert_str("/run ");

        assert!(append_paste_to_input(
            &focused,
            &mut input,
            "ROI 示例\n第二行"
        ));
        assert_eq!(input.as_str(), "/run ROI 示例\n第二行");
        assert_eq!(input.cursor(), "/run ROI 示例\n第二行".len());

        focused.input_focused = false;
        assert!(!append_paste_to_input(&focused, &mut input, " ignored"));
        assert_eq!(input.as_str(), "/run ROI 示例\n第二行");
    }

    #[test]
    fn input_buffer_moves_and_deletes_on_char_boundaries() {
        let mut input = InputBuffer::default();
        input.insert_str("a你b");

        input.move_left();
        input.delete();
        assert_eq!(input.as_str(), "a你");
        assert_eq!(input.cursor(), "a你".len());

        input.move_end();
        input.backspace();
        assert_eq!(input.as_str(), "a");
        assert_eq!(input.cursor(), "a".len());

        input.move_home();
        input.insert_str("新");
        input.move_end();
        input.insert_str("z");
        assert_eq!(input.take(), "新az");
        assert!(input.as_str().is_empty());
        assert_eq!(input.cursor(), 0);
    }

    #[test]
    fn input_buffer_records_history_and_restores_draft() {
        let mut input = InputBuffer::default();
        input.insert_str("/run roi-demo");
        assert_eq!(input.submit(), "/run roi-demo");
        input.insert_str("/doctor");
        assert_eq!(input.submit(), "/doctor");

        input.insert_str("/draft");
        assert!(input.history_previous());
        assert_eq!(input.as_str(), "/doctor");
        assert_eq!(input.cursor(), "/doctor".len());

        assert!(input.history_previous());
        assert_eq!(input.as_str(), "/run roi-demo");

        assert!(input.history_next());
        assert_eq!(input.as_str(), "/doctor");

        assert!(input.history_next());
        assert_eq!(input.as_str(), "/draft");
        assert_eq!(input.cursor(), "/draft".len());
    }

    #[test]
    fn focused_input_up_down_navigates_history_instead_of_scrolling() {
        let mut state = AppState::default();
        let mut ui_state = UiState::default();
        ui_state.input_focused = true;
        let original_scroll = ui_state.scroll_for(ui_state.focus);
        let mut input = InputBuffer::default();
        input.insert_str("/run roi-demo");
        assert_eq!(input.submit(), "/run roi-demo");
        input.insert_str("/doctor");
        assert_eq!(input.submit(), "/doctor");

        let action = handle_key_event(
            &mut state,
            &mut ui_state,
            &mut input,
            false,
            crossterm::event::KeyEvent::new(KeyCode::Up, KeyModifiers::NONE),
        )
        .expect("up action");

        assert!(matches!(action, TerminalAction::Continue));
        assert_eq!(input.as_str(), "/doctor");
        assert_eq!(ui_state.scroll_for(ui_state.focus), original_scroll);

        handle_key_event(
            &mut state,
            &mut ui_state,
            &mut input,
            false,
            crossterm::event::KeyEvent::new(KeyCode::Up, KeyModifiers::NONE),
        )
        .expect("second up action");
        assert_eq!(input.as_str(), "/run roi-demo");

        handle_key_event(
            &mut state,
            &mut ui_state,
            &mut input,
            false,
            crossterm::event::KeyEvent::new(KeyCode::Down, KeyModifiers::NONE),
        )
        .expect("down action");
        assert_eq!(input.as_str(), "/doctor");
    }

    #[test]
    fn alt_enter_inserts_newline_and_plain_enter_submits_multiline_input() {
        let mut state = AppState::default();
        let mut ui_state = UiState::default();
        ui_state.input_focused = true;
        let mut input = InputBuffer::default();
        input.insert_str("/revise 第一行");

        let action = handle_key_event(
            &mut state,
            &mut ui_state,
            &mut input,
            false,
            crossterm::event::KeyEvent::new(KeyCode::Enter, KeyModifiers::ALT),
        )
        .expect("alt enter action");

        assert!(matches!(action, TerminalAction::Continue));
        assert!(ui_state.input_focused);
        input.insert_str("第二行");
        assert_eq!(input.as_str(), "/revise 第一行\n第二行");

        let action = handle_key_event(
            &mut state,
            &mut ui_state,
            &mut input,
            false,
            crossterm::event::KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE),
        )
        .expect("submit action");

        assert!(matches!(
            action,
            TerminalAction::Submit(value) if value == "/revise 第一行\n第二行"
        ));
        assert!(!ui_state.input_focused);
        assert!(input.as_str().is_empty());
    }

    #[test]
    fn input_focus_treats_quit_letters_as_text() {
        let mut state = AppState::default();
        let mut ui_state = UiState::default();
        ui_state.input_focused = true;
        let mut input = InputBuffer::default();

        let action = handle_key_event(
            &mut state,
            &mut ui_state,
            &mut input,
            false,
            crossterm::event::KeyEvent::new(KeyCode::Char('q'), KeyModifiers::NONE),
        )
        .expect("key action");

        assert!(matches!(action, TerminalAction::Continue));
        assert_eq!(input.as_str(), "q");
        assert!(ui_state.input_focused);
    }
}
