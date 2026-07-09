use std::{
    io::{self, BufRead, BufReader},
    panic,
    path::{Path, PathBuf},
    process::{ChildStdin, Command, Stdio},
    sync::mpsc::{self, Receiver},
    thread,
    time::{Duration, Instant},
};

use crossterm::event::{
    DisableBracketedPaste, DisableMouseCapture, EnableBracketedPaste, EnableMouseCapture,
    MouseEventKind,
};
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
    state::{AppState, InputMode, Overlay, Screen, UiState},
};

pub mod actions;
pub mod config;
pub mod fuzzy;
pub mod input;
pub mod preview;
pub mod protocol;
pub mod refs;
pub mod screens;
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
    /// 提交文本 + v0.8 M6 结构化 parts（文件附件；无附件时为空 Vec）。
    Submit(String, Vec<serde_json::Value>),
    SendAction(UserAction),
}

enum LiveLoopExit {
    UserQuit,
    ChildEof,
}

/// 生成态提频到 ~10fps 驱动 spinner/秒数动画；空闲降频省 CPU。
const POLL_BUSY_MS: u64 = 100;
const POLL_IDLE_MS: u64 = 250;

fn poll_interval(state: &AppState) -> Duration {
    if state.is_busy() {
        Duration::from_millis(POLL_BUSY_MS)
    } else {
        Duration::from_millis(POLL_IDLE_MS)
    }
}

pub fn run_workbench(demo: bool) -> Result<(), String> {
    if !io::stdout().is_tty() {
        return run_plain_transcript(demo);
    }
    install_panic_restore_hook();
    // demo/离线路径无 root，用默认配置（mouse=true, dark）。
    let mut terminal = TerminalGuard::enter(config::TuiConfig::default().mouse)?;
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
    // v0.8 M7：先按 .crewclaw/tui.json 装配主题与鼠标策略（进入 alternate screen 前）。
    // v0.11 M1：在基底主题上按员工 slug 派生 accent——不同数字员工进来 chrome 主色不同。
    let tui_config = config::TuiConfig::load(root);
    let mut theme = tui_config.theme.theme();
    theme.accent = config::employee_accent(&runtime_args[0]);
    config::set_theme(theme);
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
    let mut terminal = match TerminalGuard::enter(tui_config.mouse) {
        Ok(terminal) => terminal,
        Err(error) => {
            drop(child_stdin);
            let _ = child.kill();
            let _ = child.wait();
            return Err(error);
        }
    };

    let loop_result = run_live_loop(
        &mut terminal.terminal,
        events,
        debug,
        &mut child_stdin,
        root,
    );
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
    let mut input = InputBuffer::with_history_path(current_prompt_history_path());
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
            skills: Vec::new(),
            avatar: Vec::new(),
        });
        state.mode = "Trial".to_string();
    }

    loop {
        terminal
            .draw(|frame| {
                ui::render_with_input_spans(frame, &state, &ui_state, input.as_str(), input.cursor(), &input.span_ranges())
            })
            .map_err(|error| format!("Failed to draw workbench: {error}"))?;

        // Demo mode drives events on a 150ms timer; cap the idle poll so pacing stays tight.
        let poll = poll_interval(&state).min(Duration::from_millis(50));
        if event::poll(poll).map_err(|error| format!("Failed to poll terminal events: {error}"))? {
            match handle_terminal_event(&mut state, &mut ui_state, &mut input, terminal)? {
                TerminalAction::Quit => break,
                TerminalAction::Submit(submitted, _parts) => {
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
    root: &Path,
) -> Result<LiveLoopExit, String> {
    let mut state = AppState::default();
    let mut ui_state = UiState::default();
    // v0.10：Enter 突发启发式开关来自 tui.json（默认开）。
    ui_state.paste_enter_heuristic = config::TuiConfig::load(root).paste_enter_heuristic;
    // v0.15 P1-1：偏好设置（SETTINGS）从 .crewclaw/prefs.json 恢复——APPEARANCE 立即生效。
    ui_state.prefs = config::Prefs::load(root);
    ui_state.prefs_root = Some(root.to_path_buf());
    ui_state.theme_index = ui_state.prefs.theme_index % config::THEME_NAMES.len();
    ui_state.scanlines = ui_state.prefs.scanlines;
    config::apply_theme_index(ui_state.theme_index, Some(config::accent()));
    // v0.12 M2+M3：MARKET/HIRE 屏一次性读 registry 真实员工 + 跑 doctor 体检（非 live）。
    // 读取失败则留空列表（屏显占位），不影响 WORKBENCH live 流。
    let (market, hire_reports) = load_marketplace(root);
    ui_state.market = market;
    ui_state.hire_reports = hire_reports;
    let mut input = InputBuffer::with_history_path(prompt_history_path(root));

    loop {
        terminal
            .draw(|frame| {
                ui::render_with_input_spans(frame, &state, &ui_state, input.as_str(), input.cursor(), &input.span_ranges())
            })
            .map_err(|error| format!("Failed to draw live workbench: {error}"))?;

        if event::poll(poll_interval(&state))
            .map_err(|error| format!("Failed to poll terminal events: {error}"))?
        {
            if state.approval.is_some() {
                let terminal_event = event::read()
                    .map_err(|error| format!("Failed to read terminal event: {error}"))?;
                match terminal_event {
                    Event::Key(key) if key.kind == KeyEventKind::Press => {
                        let decision = match key.code {
                            KeyCode::Char('a') | KeyCode::Char('y') => Some("accept"),
                            // v0.13 M4：设计规范键位 [a]/[r]；d/n 保留兼容。
                            KeyCode::Char('r') | KeyCode::Char('d') | KeyCode::Char('n') => {
                                Some("reject")
                            }
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
                        if should_route_pending_action_digit(
                            &state,
                            &ui_state,
                            input.is_empty(),
                            ch,
                        ) {
                            if let Some(action) = user_action_for_pending_digit(
                                &state,
                                &ui_state,
                                input.is_empty(),
                                ch,
                            ) {
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
                TerminalAction::Submit(submitted, parts) => {
                    if submitted.trim() == "/exit" {
                        return Ok(LiveLoopExit::UserQuit);
                    }
                    if submitted.trim().is_empty() && parts.is_empty() {
                        continue;
                    }
                    let refs = resolve_references(&state, &submitted);
                    // 无附件走原 user_message（线上形状不变）；有附件才带 parts。
                    let action = if parts.is_empty() {
                        UserAction::user_message(submitted.clone(), refs)
                    } else {
                        UserAction::user_message_with_parts(submitted.clone(), refs, parts)
                    };
                    write_user_action(child_stdin, &action)?;
                    state.push_user_message(submitted.clone());
                    ui_state.follow = true;
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
                    ui::render_with_input_spans(frame, &state, &ui_state, input.as_str(), input.cursor(), &input.span_ranges())
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
        Event::Mouse(mouse) => {
            handle_mouse_scroll(ui_state, mouse.kind);
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

/// v0.8 M5：滚轮滚动消息流（±3 行）。抽屉/浮层打开时不动消息流。终端在鼠标捕获下仍会用
/// Shift+滚轮走原生选择，故此处只处理裸滚轮。
fn handle_mouse_scroll(ui_state: &mut UiState, kind: MouseEventKind) {
    if ui_state.drawer.is_some() || ui_state.overlay.is_some() {
        return;
    }
    match kind {
        MouseEventKind::ScrollUp => ui_state.scroll_messages(-3),
        MouseEventKind::ScrollDown => ui_state.scroll_messages(3),
        _ => {}
    }
}

/// v0.12 M2+M3：从 registry/experts.json 读**真实**员工，并为每个员工跑 doctor 体检。
/// 返回平行的 (market, hire_reports)。任何读取/解析失败 → 空列表（屏显占位），不 panic、不碰 live 流。
fn load_marketplace(root: &Path) -> (Vec<state::MarketEntry>, Vec<state::HireHealth>) {
    let Ok(registry) = crate::read_registry(root) else {
        return (Vec::new(), Vec::new());
    };
    // 团队状态读一次，供每个员工的 doctor 体检复用。
    let team = crate::team::read_team(root).unwrap_or_default();
    let mut market = Vec::with_capacity(registry.experts.len());
    let mut reports = Vec::with_capacity(registry.experts.len());
    for e in &registry.experts {
        // M3：真实 doctor 体检——读该员工 manifest，跑 build_report（与 crew doctor 同路径）。
        let manifest = e
            .local_source
            .as_deref()
            .ok_or_else(|| "no local package".to_string())
            .and_then(|ls| crate::manifest::read_manifest(root, ls));
        let report = crate::doctor::build_report(e, manifest, &team);
        reports.push(state::HireHealth {
            status: report.health_status.as_str().to_string(),
            issues: report.issues,
            suggestions: report.suggestions,
        });
        market.push(state::MarketEntry {
            name: e.name.clone(),
            display_name: e.display_name.clone(),
            status: e.status.clone(),
            certification: e.certification.clone(),
            category: e.category.clone(),
            description: e.description.clone(),
            tags: e.tags.clone(),
            hermes_req: e.requires.hermes.clone(),
            env_reqs: e.requires.env.clone(),
            first_task: e.first_task.clone(),
        });
    }
    (market, reports)
}

/// v0.12：NORMAL 模式 j/k 在当前屏的列表游标上移动（MARKET/HIRE），按真实市场长度收敛上界。
fn nav_screen_cursor(ui_state: &mut UiState, delta: i32) {
    // v0.16 W6.2：DREAM 的 MEMORY 列表游标——数据是编译期定长 MOCK 数组,松量上界(20)由
    // render 侧再按 filtered 列表真实长度 `.min(len-1)` 兜底钳制,这里不需要跨模块暴露长度。
    if ui_state.screen == Screen::Dream {
        let upper = 20i32;
        ui_state.dream_mem_cursor =
            (ui_state.dream_mem_cursor as i32 + delta).clamp(0, upper) as usize;
        return;
    }
    // v0.17 P1-B1：MARKET 游标要按 filtered 列表长度收敛（过滤生效时比 market.len() 短）。
    let upper = if ui_state.screen == Screen::Market {
        ui_state.market_filtered().len().saturating_sub(1) as i32
    } else {
        ui_state.market.len().saturating_sub(1) as i32
    };
    let cursor = match ui_state.screen {
        Screen::Market => &mut ui_state.market_cursor,
        Screen::Hire => &mut ui_state.hire_cursor,
        _ => return,
    };
    *cursor = (*cursor as i32 + delta).clamp(0, upper.max(0)) as usize;
}

/// v0.13 M4：WORKBENCH NORMAL j/k——SESSION 事件游标（timeline 下标），EVENT DETAIL 跟随。
/// 首按从最后一条事件开始；到边界钳制。选择时脱离 follow（回看语义）。
fn nav_session_cursor(state: &AppState, ui_state: &mut UiState, delta: i32) {
    if state.timeline.is_empty() {
        return;
    }
    let last = state.timeline.len() - 1;
    let next = match ui_state.session_cursor {
        None => last as i32, // 首按落在最新事件
        Some(cur) => cur as i32 + delta,
    }
    .clamp(0, last as i32) as usize;
    ui_state.session_cursor = Some(next);
    ui_state.follow = false;
}

fn handle_key_event(
    state: &mut AppState,
    ui_state: &mut UiState,
    input: &mut InputBuffer,
    _is_narrow: bool,
    key: KeyEvent,
) -> Result<TerminalAction, String> {
    // v0.10：Enter 突发启发式。Windows Terminal 拦截 Ctrl+V 后把剪贴板按键序列注入（应用永远
    // 收不到 Ctrl+V/Event::Paste），多行内容的换行以 <10ms 间隔的裸 Enter 到达 → 视为粘贴换行
    // 插 `\n`，不提交。仅对裸 Enter 生效；浮层/抽屉打开时不干预（那里的 Enter 是选择键）。
    let key_burst = ui_state.record_key_burst();
    if ui_state.paste_enter_heuristic
        && key_burst
        && key.code == KeyCode::Enter
        && key.modifiers.is_empty()
        && ui_state.overlay.is_none()
        && ui_state.drawer.is_none()
        && state.ref_picker.is_none()
        && state.command_picker.is_none()
        && state.approval.is_none()
    {
        input.insert_char('\n');
        return Ok(TerminalAction::Continue);
    }
    // Ctrl+C always quits, regardless of focus/overlay/drawer state.
    if key.code == KeyCode::Char('c') && key.modifiers.contains(KeyModifiers::CONTROL) {
        return Ok(TerminalAction::Quit);
    }
    // Ctrl+O toggles the panel drawer, and always closes any transient overlay first.
    if key.code == KeyCode::Char('o') && key.modifiers.contains(KeyModifiers::CONTROL) {
        ui_state.overlay = None;
        ui_state.toggle_drawer();
        state.sync_focus(ui_state);
        return Ok(TerminalAction::Continue);
    }

    // ── v0.12 多屏：模式/切屏键处理（在 drawer/overlay/chat 分发之前）─────────────────────
    // v0.15 P1-5：产物预览浮层是最内层——Esc/q 关闭；[ ] 换产物（联动预览）；其余吞掉。
    // v0.16 W4.1：补 j/k 滚动正文（设计稿"j/k 滚动 · [ ] 切换文件 · Esc 关闭"）；换产物时滚动归零。
    if ui_state.preview_open {
        match key.code {
            KeyCode::Esc | KeyCode::Char('q') => ui_state.preview_open = false,
            KeyCode::Char('[') => {
                state.select_previous_artifact();
                ui_state.preview_scroll = 0;
            }
            KeyCode::Char(']') => {
                state.select_next_artifact();
                ui_state.preview_scroll = 0;
            }
            KeyCode::Char('j') | KeyCode::Down => {
                ui_state.preview_scroll = ui_state.preview_scroll.saturating_add(1);
            }
            KeyCode::Char('k') | KeyCode::Up => {
                ui_state.preview_scroll = ui_state.preview_scroll.saturating_sub(1);
            }
            KeyCode::PageDown => {
                ui_state.preview_scroll = ui_state.preview_scroll.saturating_add(10);
            }
            KeyCode::PageUp => {
                ui_state.preview_scroll = ui_state.preview_scroll.saturating_sub(10);
            }
            _ => {}
        }
        return Ok(TerminalAction::Continue);
    }
    // v0.15 P1-4：PUBLISH 发布浮层——Enter 推进/末步完成关闭；Esc/q 取消。
    if let Some(step) = ui_state.publish_step {
        use crate::workbench::widgets::overlay_publish::STEP_COUNT;
        match key.code {
            KeyCode::Esc | KeyCode::Char('q') => ui_state.publish_step = None,
            KeyCode::Enter | KeyCode::Char('l') | KeyCode::Right => {
                if step + 1 >= STEP_COUNT {
                    ui_state.publish_step = None; // 末步 → 完成关闭
                } else {
                    ui_state.publish_step = Some(step + 1);
                }
            }
            _ => {}
        }
        return Ok(TerminalAction::Continue);
    }
    // v0.15 P1-1：SETTINGS 浮层——j/k 选、h/l/Enter 改值、Esc/q/, 关。改值即持久化。
    if ui_state.settings_open {
        use crate::workbench::widgets::overlay_settings::{cycle, ROW_COUNT};
        let mut changed = false;
        match key.code {
            KeyCode::Esc | KeyCode::Char('q') | KeyCode::Char(',') => ui_state.settings_open = false,
            KeyCode::Char('j') | KeyCode::Down => {
                ui_state.settings_cursor = (ui_state.settings_cursor + 1).min(ROW_COUNT - 1);
            }
            KeyCode::Char('k') | KeyCode::Up => {
                ui_state.settings_cursor = ui_state.settings_cursor.saturating_sub(1);
            }
            KeyCode::Char('l') | KeyCode::Right | KeyCode::Enter => changed = cycle(ui_state, 1),
            KeyCode::Char('h') | KeyCode::Left => changed = cycle(ui_state, -1),
            _ => {}
        }
        if changed {
            if let Some(root) = ui_state.prefs_root.clone() {
                ui_state.prefs.save(&root); // best-effort 落盘 .crewclaw/prefs.json
            }
        }
        return Ok(TerminalAction::Continue);
    }
    // v0.15 P1-2：通知中心浮层——j/k 选、Enter 跳转并已读、R 全读、Esc/q/n 关。
    if ui_state.notif_open {
        let n = state.notices.len();
        match key.code {
            KeyCode::Esc | KeyCode::Char('q') | KeyCode::Char('n') => ui_state.notif_open = false,
            KeyCode::Char('j') | KeyCode::Down => {
                if n > 0 {
                    ui_state.notif_cursor = (ui_state.notif_cursor + 1).min(n - 1);
                }
            }
            KeyCode::Char('k') | KeyCode::Up => {
                ui_state.notif_cursor = ui_state.notif_cursor.saturating_sub(1);
            }
            KeyCode::Char('R') => {
                for notice in state.notices.iter_mut() {
                    notice.read = true;
                }
            }
            KeyCode::Enter => {
                // v0.17 P0-3：按通知类别分屏跳转(设计稿 go.screen)——此前一律跳 WORKBENCH,
                // Accepted 的行动文案写着"→ 看 KPI"却从不带你去 EVAL 屏,是半做。
                let kind = crate::workbench::widgets::overlay_notifications::mark_selected_read(
                    state,
                    ui_state.notif_cursor,
                );
                ui_state.notif_open = false;
                let target = match kind {
                    Some(crate::workbench::state::NoticeKind::Accepted) => Screen::Eval,
                    _ => Screen::Workbench, // Approval/Delivered/Rejected 都指向任务详情,在 WORKBENCH
                };
                ui_state.set_screen(target);
            }
            _ => {}
        }
        return Ok(TerminalAction::Continue);
    }
    // v0.17 P1-B2：COMPARE 对比浮层打开时——Esc/q/c 关，其它键吞掉。
    if ui_state.compare_open {
        if matches!(key.code, KeyCode::Esc | KeyCode::Char('q') | KeyCode::Char('c')) {
            ui_state.compare_open = false;
        }
        return Ok(TerminalAction::Continue);
    }
    // v0.17 P1-B1：MARKET 搜索输入编辑态——字符写入 filter,Backspace 删,Enter/Esc 收起
    // 输入框(过滤结果保留;Esc 额外清空 filter 文本,回到全量列表——两层退出对齐既有 Esc 语义)。
    if ui_state.market_filter_active {
        match key.code {
            KeyCode::Esc => {
                ui_state.market_filter.clear();
                ui_state.market_filter_active = false;
                ui_state.market_cursor = 0;
            }
            KeyCode::Enter => {
                ui_state.market_filter_active = false;
            }
            KeyCode::Backspace => {
                ui_state.market_filter.pop();
                ui_state.market_cursor = 0;
            }
            KeyCode::Char(c) if key.modifiers.is_empty() || key.modifiers == KeyModifiers::SHIFT => {
                ui_state.market_filter.push(c);
                ui_state.market_cursor = 0;
            }
            _ => {}
        }
        return Ok(TerminalAction::Continue);
    }
    // v0.15 P1-3：TASK DETAIL 全屏浮层打开时，Esc/q/o 关闭；其它键吞掉（不穿透到工作台）。
    if ui_state.task_detail_open {
        if matches!(key.code, KeyCode::Esc | KeyCode::Char('q') | KeyCode::Char('o')) {
            ui_state.task_detail_open = false;
        }
        return Ok(TerminalAction::Continue);
    }
    // 入职仪式浮层优先吃键：Enter 下一步 / Esc 跳过。
    if let Some(ob) = ui_state.onboarding {
        match key.code {
            KeyCode::Enter => {
                ui_state.onboarding = if ob.step + 1 >= 3 {
                    None
                } else {
                    Some(state::OnboardingState { step: ob.step + 1 })
                };
            }
            KeyCode::Esc => ui_state.onboarding = None,
            _ => {}
        }
        return Ok(TerminalAction::Continue);
    }
    // which-key 面板打开时 Space/Esc 关闭。
    if ui_state.which_key && matches!(key.code, KeyCode::Char(' ') | KeyCode::Esc) {
        ui_state.which_key = false;
        return Ok(TerminalAction::Continue);
    }
    // v0.13 M4：Esc 逐层退出（设计规范）：补全/浮层（下游处理）→ **清非空输入** → INSERT→NORMAL。
    // 有审批时不让切模式（审批闸不可绕过）。
    if key.code == KeyCode::Esc
        && ui_state.mode == InputMode::Insert
        && ui_state.overlay.is_none()
        && ui_state.drawer.is_none()
        && state.ref_picker.is_none()
        && state.command_picker.is_none()
        && state.approval.is_none()
    {
        if !input.is_empty() {
            input.clear(); // 第一层：清空正在输入的内容
        } else {
            ui_state.mode = InputMode::Normal; // 第二层：离开输入态
        }
        return Ok(TerminalAction::Continue);
    }
    // NORMAL 模式命令键。数字若命中 pending action，已在 handle_key_event 之前被 mod.rs:381
    // 拦截并 continue，不会到这——故此处 1-5 只在无匹配待办时切屏（待办优先）。
    if ui_state.mode == InputMode::Normal
        && ui_state.drawer.is_none()
        && ui_state.overlay.is_none()
        && state.approval.is_none()
    {
        // MARKET 上 h/Enter → 把当前选中员工带入 HIRE 屏体检。
        // v0.17 P1-B1：market_cursor 现在是 filtered 列表下标，过滤生效时不再等于 market 真实
        // 下标——必须经 market_selected_index() 翻译，否则搜索后 h/Enter 会带错员工进 HIRE。
        if ui_state.screen == Screen::Market
            && matches!(key.code, KeyCode::Char('h') | KeyCode::Enter)
        {
            if let Some(idx) = ui_state.market_selected_index() {
                ui_state.hire_cursor = idx;
                ui_state.set_screen(Screen::Hire);
            }
            return Ok(TerminalAction::Continue);
        }
        // v0.15 P1-4：MARKET 上 p → 打开发布浮层（对选中员工;步骤1真校验,2-4 MOCK）。
        if ui_state.screen == Screen::Market && key.code == KeyCode::Char('p') {
            if ui_state.market_selected_index().is_some() {
                ui_state.publish_step = Some(0);
            }
            return Ok(TerminalAction::Continue);
        }
        // v0.17 P1-B1：MARKET 上 `/` 进入本地搜索过滤(与全局 `/` 命令面板不同浮层——只在
        // MARKET 屏拦截,别的屏 `/` 仍走下面的自动进 INSERT 打字聊天)。
        if ui_state.screen == Screen::Market && key.code == KeyCode::Char('/') {
            ui_state.market_filter_active = true;
            ui_state.market_cursor = 0;
            return Ok(TerminalAction::Continue);
        }
        // v0.17 P1-B2：MARKET 上 `x` 勾选/取消当前员工进对比候选(≤2 个)。
        if ui_state.screen == Screen::Market && key.code == KeyCode::Char('x') {
            ui_state.toggle_compare_selection();
            return Ok(TerminalAction::Continue);
        }
        // v0.17 P1-B2：MARKET 上 `c` 打开对比浮层——须先勾满 2 个候选。
        if ui_state.screen == Screen::Market && key.code == KeyCode::Char('c') {
            if ui_state.compare_selection.len() == 2 {
                ui_state.compare_open = true;
            }
            return Ok(TerminalAction::Continue);
        }
        match key.code {
            KeyCode::Char(c @ '1'..='5') => {
                if let Some(screen) = Screen::from_digit(c) {
                    ui_state.set_screen(screen);
                }
                return Ok(TerminalAction::Continue);
            }
            KeyCode::Tab => {
                ui_state.set_screen(ui_state.screen.next());
                return Ok(TerminalAction::Continue);
            }
            KeyCode::BackTab => {
                ui_state.set_screen(ui_state.screen.prev());
                return Ok(TerminalAction::Continue);
            }
            KeyCode::Char('t') => {
                let idx = ui_state.cycle_theme();
                // 保留员工派生 accent（当前 THEME.accent 即员工色），只换底/命名色。
                config::apply_theme_index(idx, Some(config::accent()));
                return Ok(TerminalAction::Continue);
            }
            KeyCode::Char('i') => {
                ui_state.mode = InputMode::Insert;
                // 回输入即回到跟随流（清事件游标）。
                ui_state.session_cursor = None;
                ui_state.follow = true;
                return Ok(TerminalAction::Continue);
            }
            KeyCode::Char(' ') => {
                ui_state.which_key = !ui_state.which_key;
                return Ok(TerminalAction::Continue);
            }
            KeyCode::Char('s') => {
                ui_state.scanlines = !ui_state.scanlines;
                return Ok(TerminalAction::Continue);
            }
            // v0.16 W6.2：DREAM 屏 f 循环 MEMORY 浏览器的 tab(全部/K/P/E),换 tab 重置游标。
            KeyCode::Char('f') if ui_state.screen == Screen::Dream => {
                ui_state.dream_mem_tab = (ui_state.dream_mem_tab + 1) % 4;
                ui_state.dream_mem_cursor = 0;
                return Ok(TerminalAction::Continue);
            }
            // v0.15 P1-2：n 打开通知中心（任意屏可开）。
            KeyCode::Char('n') => {
                ui_state.notif_open = true;
                ui_state.notif_cursor = 0;
                return Ok(TerminalAction::Continue);
            }
            // v0.15 P1-1：, 打开偏好设置。
            KeyCode::Char(',') => {
                ui_state.settings_open = true;
                ui_state.settings_cursor = 0;
                return Ok(TerminalAction::Continue);
            }
            KeyCode::Char('o') => {
                // v0.15 P1-3：WORKBENCH 上裸 o = 打开 TASK DETAIL 全屏详情（设计稿键位）；
                // 其它屏保留入职仪式浮层（Ctrl+O 是抽屉，已在前面拦截）。
                if ui_state.screen == Screen::Workbench {
                    ui_state.task_detail_open = true;
                } else {
                    ui_state.onboarding = Some(state::OnboardingState { step: 0 });
                }
                return Ok(TerminalAction::Continue);
            }
            KeyCode::Char('j') | KeyCode::Down => {
                // v0.13 M4：WORKBENCH 上 j/k 选 SESSION 事件（EVENT DETAIL 跟随）；其余屏走列表游标。
                if ui_state.screen == Screen::Workbench {
                    nav_session_cursor(state, ui_state, 1);
                } else {
                    nav_screen_cursor(ui_state, 1);
                }
                return Ok(TerminalAction::Continue);
            }
            KeyCode::Char('k') | KeyCode::Up => {
                if ui_state.screen == Screen::Workbench {
                    nav_session_cursor(state, ui_state, -1);
                } else {
                    nav_screen_cursor(ui_state, -1);
                }
                return Ok(TerminalAction::Continue);
            }
            // v0.13 M4：g/G 顶/底（设计规范键位）。
            KeyCode::Char('g') => {
                if ui_state.screen == Screen::Workbench && !state.timeline.is_empty() {
                    ui_state.session_cursor = Some(0);
                    ui_state.follow = false;
                    ui_state.messages_scroll = 0;
                }
                return Ok(TerminalAction::Continue);
            }
            KeyCode::Char('G') => {
                if ui_state.screen == Screen::Workbench {
                    ui_state.session_cursor = None;
                    ui_state.follow = true; // 回到贴底跟随
                }
                return Ok(TerminalAction::Continue);
            }
            // v0.13 M4：[ ] 循环切换选中 artifact（右栏/抽屉预览联动）。
            KeyCode::Char('[') => {
                state.select_previous_artifact();
                return Ok(TerminalAction::Continue);
            }
            KeyCode::Char(']') => {
                state.select_next_artifact();
                return Ok(TerminalAction::Continue);
            }
            // v0.15 P1-5：WORKBENCH 上有选中产物时 Enter → 打开预览浮层（真读文件）。
            // 无选中产物则不拦截,落到下游 handle_chat_key（保留 Enter 提交等既有行为）。
            KeyCode::Enter
                if ui_state.screen == Screen::Workbench && state.selected_artifact().is_some() =>
            {
                ui_state.preview_open = true;
                ui_state.preview_scroll = 0; // v0.16 W4.1：每次打开从顶部看起。
                return Ok(TerminalAction::Continue);
            }
            KeyCode::Esc => {
                // v0.13 M4：Esc 逐层退出——先清事件游标（恢复跟随），已无层则吞掉。
                if ui_state.session_cursor.is_some() {
                    ui_state.session_cursor = None;
                    ui_state.follow = true;
                }
                return Ok(TerminalAction::Continue);
            }
            // v0.17 P1-B3：`:` 是设计稿的命令行前缀(`:settings`/`:help` 等)——别名到既有
            // `/` 命令面板(同一浮层,不新增一套解析规则;之前 `:` 完全没有处理,会被当成
            // 普通字符打进聊天框)。
            KeyCode::Char(':') => {
                ui_state.mode = InputMode::Insert;
                ui_state.session_cursor = None;
                ui_state.follow = true;
                input.insert_char('/');
                state.refresh_command_picker("");
                return Ok(TerminalAction::Continue);
            }
            // v0.15 P0-1：NORMAL 下未绑定的可打印字符 → 自动进入 INSERT 并把它打进输入框。
            // (CJK/多数字母直打即聊,不破坏"输入即对话";1-5/t/i/j/k 等已在上面各臂拦截。)
            // 不 return——落到下面的 handle_chat_key 完成这个字符的插入。
            KeyCode::Char(_) if key.modifiers.is_empty() => {
                ui_state.mode = InputMode::Insert;
                ui_state.session_cursor = None;
                ui_state.follow = true;
            }
            _ => {}
        }
    }
    // ────────────────────────────────────────────────────────────────────────────────────

    let action = if ui_state.drawer.is_some() {
        handle_drawer_key(state, ui_state, key)
    } else if ui_state.overlay.is_some() {
        handle_overlay_key(ui_state, key)
    } else {
        handle_chat_key(state, ui_state, input, key)
    };

    if let Ok(TerminalAction::Continue) = &action {
        state.sync_focus(ui_state);
    }
    action
}

/// 抽屉打开时的键位：切页 / 滚动 / 产物操作 / 关闭。
fn handle_drawer_key(
    state: &mut AppState,
    ui_state: &mut UiState,
    key: KeyEvent,
) -> Result<TerminalAction, String> {
    match key.code {
        KeyCode::Esc => {
            ui_state.close_overlay_or_drawer();
        }
        KeyCode::Tab => ui_state.drawer_next(),
        KeyCode::BackTab => ui_state.drawer_prev(),
        KeyCode::Char(ch @ '1'..='4') => {
            ui_state.set_drawer_page_by_number(ch);
        }
        KeyCode::Up => {
            if ui_state.drawer == Some(state::FocusPanel::Artifacts) {
                state.select_previous_artifact();
            } else {
                ui_state.scroll_drawer(-1);
            }
        }
        KeyCode::Down => {
            if ui_state.drawer == Some(state::FocusPanel::Artifacts) {
                state.select_next_artifact();
            } else {
                ui_state.scroll_drawer(1);
            }
        }
        KeyCode::PageUp => ui_state.scroll_drawer(-10),
        KeyCode::PageDown => ui_state.scroll_drawer(10),
        KeyCode::Enter => {
            if ui_state.drawer == Some(state::FocusPanel::Artifacts) {
                if let Some(action) = artifact_action_for_selected(state, "artifact.preview") {
                    return Ok(TerminalAction::SendAction(action));
                }
            }
        }
        KeyCode::Char('d') if key.modifiers.is_empty() => {
            if ui_state.drawer == Some(state::FocusPanel::Artifacts) {
                if let Some(action) = artifact_action_for_selected(state, "artifact.delete") {
                    return Ok(TerminalAction::SendAction(action));
                }
            }
        }
        KeyCode::Char('r') if key.modifiers.is_empty() => {
            if ui_state.drawer == Some(state::FocusPanel::Artifacts) {
                if let Some(action) = artifact_action_for_selected(state, "artifact.reveal") {
                    return Ok(TerminalAction::SendAction(action));
                }
            }
        }
        KeyCode::Char('e') if key.modifiers.is_empty() => {
            if ui_state.drawer == Some(state::FocusPanel::Artifacts) {
                if let Some(action) = artifact_action_for_selected(state, "artifact.export") {
                    return Ok(TerminalAction::SendAction(action));
                }
            }
        }
        _ => {}
    }
    Ok(TerminalAction::Continue)
}

/// 命令面板 / 帮助浮层打开时的键位：Esc / Enter 关闭。
fn handle_overlay_key(ui_state: &mut UiState, key: KeyEvent) -> Result<TerminalAction, String> {
    if matches!(key.code, KeyCode::Esc | KeyCode::Enter) {
        ui_state.overlay = None;
    }
    Ok(TerminalAction::Continue)
}

/// 聊天主模式：输入框常聚焦，可打印字符永远进输入。
fn handle_chat_key(
    state: &mut AppState,
    ui_state: &mut UiState,
    input: &mut InputBuffer,
    key: KeyEvent,
) -> Result<TerminalAction, String> {
    match key.code {
        KeyCode::Char('g') if key.modifiers.contains(KeyModifiers::CONTROL) => {
            cancel_current_action(state, input);
        }
        KeyCode::Char('p') if key.modifiers.contains(KeyModifiers::CONTROL) => {
            // Ctrl+P is the searchable command palette. It shares the slash registry: seed the
            // input with "/" and open the fuzzy command popup, so typing filters and Enter runs
            // the same engine-executed command path as a typed slash command.
            if state.commands.is_empty() {
                ui_state.overlay = Some(Overlay::CommandPalette);
            } else {
                input.clear();
                input.insert_char('/');
                state.set_ref_picker(None);
                state.refresh_command_picker("");
            }
        }
        KeyCode::Char('r') if key.modifiers.contains(KeyModifiers::CONTROL) => {
            // v0.8 M4: toggle the most recent collapsible tool line (expand to see full output).
            state.toggle_last_tool();
        }
        KeyCode::F(1) => {
            ui_state.overlay = Some(Overlay::Help);
        }
        KeyCode::Char('a') if key.modifiers.contains(KeyModifiers::CONTROL) => {
            input.move_line_start();
        }
        KeyCode::Char('e') if key.modifiers.contains(KeyModifiers::CONTROL) => {
            input.move_line_end();
        }
        KeyCode::Char('w') if key.modifiers.contains(KeyModifiers::CONTROL) => {
            input.delete_word_before();
        }
        KeyCode::Char('k') if key.modifiers.contains(KeyModifiers::CONTROL) => {
            input.delete_to_line_end();
        }
        KeyCode::Char('u') if key.modifiers.contains(KeyModifiers::CONTROL) => {
            input.delete_to_line_start();
        }
        KeyCode::Char('j') if key.modifiers.contains(KeyModifiers::CONTROL) => {
            input.insert_char('\n');
        }
        KeyCode::Char('v') if key.modifiers.contains(KeyModifiers::CONTROL) => {
            // v0.8 M6：Windows 无 bracketed paste（crossterm 在 WinAPI 事件源不产 Event::Paste），
            // Ctrl+V 是可靠的多行粘贴入口——读剪贴板文本走折叠路径，失败静默忽略（不 panic）。
            if let Some(text) = read_clipboard_text() {
                input.insert_paste(&text);
                refresh_completions(state, input);
            }
        }
        KeyCode::Char('b') if key.modifiers.contains(KeyModifiers::ALT) => {
            input.move_word_left();
        }
        KeyCode::Char('f') if key.modifiers.contains(KeyModifiers::ALT) => {
            input.move_word_right();
        }
        KeyCode::PageUp => ui_state.scroll_messages(-10),
        KeyCode::PageDown => ui_state.scroll_messages(10),
        KeyCode::Esc => {
            if state.ref_picker.is_some() {
                state.set_ref_picker(None);
            } else if state.command_picker.is_some() {
                state.close_command_picker();
            }
        }
        KeyCode::Up => {
            if state.ref_picker.is_some() {
                state.move_ref_picker(-1);
            } else if state.command_picker.is_some() {
                state.move_command_picker(-1);
            } else if input.cursor_at_first_line_start() {
                input.history_previous();
            } else {
                input.move_line_up();
            }
        }
        KeyCode::Down => {
            if state.ref_picker.is_some() {
                state.move_ref_picker(1);
            } else if state.command_picker.is_some() {
                state.move_command_picker(1);
            } else if input.cursor_at_end() {
                input.history_next();
            } else {
                input.move_line_down();
            }
        }
        KeyCode::Tab => {
            // Tab completes the highlighted picker entry (either surface), like opencode.
            if complete_active_picker(state, input) {
                return Ok(TerminalAction::Continue);
            }
        }
        KeyCode::Backspace => {
            if key.modifiers.contains(KeyModifiers::ALT) {
                input.delete_word_before();
            } else {
                input.backspace();
            }
            refresh_completions(state, input);
        }
        KeyCode::Delete => {
            input.delete();
            refresh_completions(state, input);
        }
        KeyCode::Left => input.move_left(),
        KeyCode::Right => input.move_right(),
        KeyCode::Home => input.move_home(),
        KeyCode::End => {
            // With an empty input, End jumps the transcript back to the bottom and resumes
            // follow (AC-SCR-001). While typing, End keeps its line-end editing meaning.
            if input.is_empty() {
                ui_state.scroll_to_bottom();
            } else {
                input.move_end();
            }
        }
        KeyCode::Enter => {
            if state.ref_picker.is_some() {
                if let Some(candidate) = state.selected_ref_candidate().cloned() {
                    input.replace_active_reference(&candidate.token);
                }
                state.set_ref_picker(None);
                return Ok(TerminalAction::Continue);
            }
            // Slash popup: Enter completes the command name (does NOT auto-submit), so args can
            // still be typed. A second Enter (popup closed) submits the line to the engine.
            if state.command_picker.is_some() {
                complete_active_picker(state, input);
                return Ok(TerminalAction::Continue);
            }
            if key.modifiers.contains(KeyModifiers::ALT)
                || key.modifiers.contains(KeyModifiers::SHIFT)
            {
                input.insert_char('\n');
                return Ok(TerminalAction::Continue);
            }
            // v0.8 M6：引擎支持 parts 时，把 FilePart 占位块转成 file parts 随本轮下发；否则只发文本
            // （占位符已作为降级可读文本留在 submitted 里）。
            let parts = if state.caps_parts {
                input
                    .file_parts()
                    .into_iter()
                    .map(|path| json!({ "type": "file", "path": path }))
                    .collect()
            } else {
                Vec::new()
            };
            let submitted = input.submit();
            return Ok(TerminalAction::Submit(submitted, parts));
        }
        KeyCode::Char(ch) if key.modifiers.is_empty() || key.modifiers == KeyModifiers::SHIFT => {
            input.insert_char(ch);
            if ch == '@' {
                state.set_ref_picker(picker_for_query(state, ""));
            } else {
                refresh_completions(state, input);
            }
        }
        _ => {}
    }
    Ok(TerminalAction::Continue)
}

/// 补全触发条件：光标所在缓冲区首字符为 `/`（位置 0），即行首斜杠。返回正在输入的命令名
/// （`/` 与首个空格之间的片段）。消息中途的斜杠（如 "a/b"）不满足，返回 None。
fn slash_command_query(input: &InputBuffer) -> Option<String> {
    let text = input.as_str();
    let rest = text.strip_prefix('/')?;
    // 命令名到首个空白为止；含换行说明已是多行内容，不再当命令补全。
    if rest.contains('\n') {
        return None;
    }
    let name = rest.split(char::is_whitespace).next().unwrap_or("");
    Some(name.to_string())
}

/// 输入变化后刷新当前活动的补全浮层（@ 引用优先，其次行首 slash 命令）。
fn refresh_completions(state: &mut AppState, input: &InputBuffer) {
    if state.ref_picker.is_some() {
        refresh_ref_picker(state, input);
        return;
    }
    match slash_command_query(input) {
        Some(query) => state.refresh_command_picker(&query),
        None => state.close_command_picker(),
    }
}

/// 输入变化后，若引用选择器打开则用当前 @query 刷新候选。
fn refresh_ref_picker(state: &mut AppState, input: &InputBuffer) {
    if state.ref_picker.is_none() {
        return;
    }
    let picker = input
        .active_reference_query()
        .and_then(|query| picker_for_query(state, &query));
    state.set_ref_picker(picker);
}

/// Tab/Enter 补全当前活动浮层的高亮项：@ → token；slash → `/命令 `（补空格接参数）。
/// 返回是否消费了按键。
fn complete_active_picker(state: &mut AppState, input: &mut InputBuffer) -> bool {
    if state.ref_picker.is_some() {
        if let Some(candidate) = state.selected_ref_candidate().cloned() {
            input.replace_active_reference(&candidate.token);
        }
        state.set_ref_picker(None);
        return true;
    }
    if state.command_picker.is_some() {
        if let Some(command) = state.selected_command().cloned() {
            input.replace_slash_command(&command.name);
        }
        state.close_command_picker();
        return true;
    }
    false
}

fn cancel_current_action(state: &mut AppState, input: &mut InputBuffer) -> bool {
    let had_input =
        !input.is_empty() || state.ref_picker.is_some() || state.command_picker.is_some();
    state.set_ref_picker(None);
    state.close_command_picker();
    input.clear();
    had_input
}

/// v0.8 M6：读剪贴板纯文本。全路径 Result 化——无剪贴板服务/RDP/空剪贴板均返回 None，绝不 panic
/// （AC-PASTE-002）。arboard 每次现开 Clipboard 句柄，避免长期持有跨平台句柄的生命周期麻烦。
fn read_clipboard_text() -> Option<String> {
    let mut clipboard = arboard::Clipboard::new().ok()?;
    let text = clipboard.get_text().ok()?;
    if text.is_empty() { None } else { Some(text) }
}

fn append_paste_to_input(ui_state: &UiState, input: &mut InputBuffer, text: &str) -> bool {
    // Paste only lands in the chat input, never while a drawer/overlay captures keys.
    if ui_state.drawer.is_some() || ui_state.overlay.is_some() {
        return false;
    }
    // v0.8 M6：走折叠路径（≥3 行/>150 字符 → 原子占位块 + CRLF 归一化）。
    input.insert_paste(text);
    true
}

fn current_prompt_history_path() -> PathBuf {
    std::env::current_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join(".crewclaw")
        .join("prompt-history.jsonl")
}

fn prompt_history_path(root: &Path) -> PathBuf {
    root.join(".crewclaw").join("prompt-history.jsonl")
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
    mouse: bool,
}

impl TerminalGuard {
    /// v0.8 M7：`mouse` 由 tui.json 控制。false 时不 EnableMouseCapture，终端原生滚动/复制可用
    /// （AC-THM-003），Drop 时也据此对称收尾。
    fn enter(mouse: bool) -> Result<Self, String> {
        enable_raw_mode().map_err(|error| format!("Failed to enable raw mode: {error}"))?;
        let mut stdout = io::stdout();
        execute!(stdout, EnterAlternateScreen)
            .map_err(|error| format!("Failed to enter alternate screen: {error}"))?;
        execute!(stdout, EnableBracketedPaste)
            .map_err(|error| format!("Failed to enable bracketed paste: {error}"))?;
        if mouse {
            // v0.8 M5: capture the wheel for message scrolling. Shift+wheel/Shift+drag falls through
            // to the terminal's native selection so copy still works (documented in F1 help).
            execute!(stdout, EnableMouseCapture)
                .map_err(|error| format!("Failed to enable mouse capture: {error}"))?;
        }
        let backend = CrosstermBackend::new(stdout);
        let mut terminal = Terminal::new(backend)
            .map_err(|error| format!("Failed to initialize terminal: {error}"))?;
        terminal
            .clear()
            .map_err(|error| format!("Failed to clear terminal: {error}"))?;
        Ok(Self { terminal, mouse })
    }
}

impl Drop for TerminalGuard {
    fn drop(&mut self) {
        let _ = self.terminal.show_cursor();
        let _ = disable_raw_mode();
        if self.mouse {
            let _ = execute!(self.terminal.backend_mut(), DisableMouseCapture);
        }
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
        DisableMouseCapture,
        DisableBracketedPaste,
        LeaveAlternateScreen,
        Show
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// v0.10：Enter 突发启发式——<10ms 间隔到达的裸 Enter 是粘贴注入的换行，插 `\n` 不提交；
    /// 正常敲击（间隔大）仍提交。这是 Windows Terminal 拦截 Ctrl+V 后唯一可靠的多行粘贴修法。
    #[test]
    fn burst_enter_inserts_newline_instead_of_submitting() {
        let mut state = AppState::default();
        let mut ui_state = UiState::default();
        ui_state.paste_enter_heuristic = true;
        let mut input = InputBuffer::default();
        input.insert_str("第一行");

        // 模拟粘贴突发：上一键刚刚发生（间隔 ~0ms）。
        ui_state.last_key_at = Some(std::time::Instant::now());
        let action = handle_key_event(
            &mut state,
            &mut ui_state,
            &mut input,
            false,
            KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE),
        )
        .expect("burst enter handled");
        assert!(matches!(action, TerminalAction::Continue));
        assert_eq!(input.as_str(), "第一行\n", "burst Enter must insert newline");

        // 人手敲击：上一键在 50ms 前 → 正常提交。
        input.insert_str("第二行");
        ui_state.last_key_at =
            Some(std::time::Instant::now() - std::time::Duration::from_millis(50));
        let action = handle_key_event(
            &mut state,
            &mut ui_state,
            &mut input,
            false,
            KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE),
        )
        .expect("slow enter handled");
        match action {
            TerminalAction::Submit(text, _) => assert_eq!(text, "第一行\n第二行"),
            _ => panic!("slow Enter must submit"),
        }
    }

    /// 启发式关闭（tui.json paste_enter_heuristic:false）时，突发 Enter 照旧提交。
    #[test]
    fn burst_enter_submits_when_heuristic_disabled() {
        let mut state = AppState::default();
        let mut ui_state = UiState::default(); // heuristic 默认 false（测试态）
        let mut input = InputBuffer::default();
        input.insert_str("hello");
        ui_state.last_key_at = Some(std::time::Instant::now());
        let action = handle_key_event(
            &mut state,
            &mut ui_state,
            &mut input,
            false,
            KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE),
        )
        .expect("enter handled");
        assert!(matches!(action, TerminalAction::Submit(text, _) if text == "hello"));
    }

    // ── v0.12 多屏：模式/切屏键位 ────────────────────────────────────────────────────
    fn press(state: &mut AppState, ui: &mut UiState, input: &mut InputBuffer, code: KeyCode) {
        // 每次按键把 last_key_at 拨到过去，避免 Enter 突发启发式误判。
        ui.last_key_at = Some(std::time::Instant::now() - std::time::Duration::from_millis(200));
        handle_key_event(state, ui, input, false, KeyEvent::new(code, KeyModifiers::NONE))
            .expect("key handled");
    }

    #[test]
    fn load_marketplace_reads_real_registry_and_runs_doctor() {
        // v0.12 M2+M3 真实数据端到端：从仓库真实 registry/experts.json 读员工，并为每个跑 doctor。
        // 证明 MARKET/HIRE 接的是真数据源（完成标准），不是 mock。
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
        let (market, reports) = load_marketplace(&root);
        assert!(
            market.len() >= 5,
            "real registry should list the experts, got {}",
            market.len()
        );
        assert_eq!(market.len(), reports.len(), "one doctor report per expert");
        // 至少有一个已知在岗员工，且每份体检结论是三态之一。
        assert!(
            market.iter().any(|e| e.status.eq_ignore_ascii_case("available")),
            "at least one available expert"
        );
        for r in &reports {
            assert!(
                matches!(r.status.as_str(), "healthy" | "warning" | "broken"),
                "doctor status is a real tri-state, got {:?}",
                r.status
            );
        }
    }

    #[test]
    fn insert_mode_digit_types_into_input_not_switch() {
        // INSERT 下数字进输入框，不切屏——保持既有打字行为。
        // (v0.15：冷启动默认 NORMAL,故这里显式进 INSERT 测打字语义。)
        let mut state = AppState::default();
        let mut ui = UiState::default();
        ui.mode = InputMode::Insert;
        let mut input = InputBuffer::default();
        press(&mut state, &mut ui, &mut input, KeyCode::Char('2'));
        assert_eq!(input.as_str(), "2", "INSERT digit types");
        assert_eq!(ui.screen, Screen::Workbench, "INSERT digit does not switch screen");
    }

    #[test]
    fn esc_enters_normal_then_digit_switches_screen() {
        let mut state = AppState::default();
        let mut ui = UiState::default();
        let mut input = InputBuffer::default();
        // Esc（空输入）→ NORMAL。
        press(&mut state, &mut ui, &mut input, KeyCode::Esc);
        assert_eq!(ui.mode, InputMode::Normal);
        // NORMAL 下 2 → MARKET，且不打字。
        press(&mut state, &mut ui, &mut input, KeyCode::Char('2'));
        assert_eq!(ui.screen, Screen::Market);
        assert_eq!(input.as_str(), "", "NORMAL digit must not type");
        // i → 回 INSERT。
        press(&mut state, &mut ui, &mut input, KeyCode::Char('i'));
        assert_eq!(ui.mode, InputMode::Insert);
    }

    /// v0.15 P1-3：WORKBENCH 上裸 o 开 TASK DETAIL；Esc/q/o 都能关。
    #[test]
    fn o_key_toggles_task_detail_on_workbench() {
        let mut state = AppState::default();
        let mut ui = UiState::default();
        ui.mode = InputMode::Normal;
        let mut input = InputBuffer::default();
        assert!(!ui.task_detail_open);
        press(&mut state, &mut ui, &mut input, KeyCode::Char('o'));
        assert!(ui.task_detail_open, "o opens TASK DETAIL on WORKBENCH");
        press(&mut state, &mut ui, &mut input, KeyCode::Esc);
        assert!(!ui.task_detail_open, "Esc closes it");
        press(&mut state, &mut ui, &mut input, KeyCode::Char('o'));
        assert!(ui.task_detail_open, "o reopens");
        press(&mut state, &mut ui, &mut input, KeyCode::Char('q'));
        assert!(!ui.task_detail_open, "q closes it");
    }

    /// v0.15 P1-5：WORKBENCH 上有选中产物时 Enter 开预览浮层；无产物时 Enter 不开；Esc/q 关。
    #[test]
    fn enter_opens_artifact_preview_when_selected() {
        use crate::workbench::state::Artifact;
        let mut state = AppState::default();
        let mut ui = UiState::default();
        ui.mode = InputMode::Normal;
        let mut input = InputBuffer::default();

        // 无产物：Enter 不开。
        press(&mut state, &mut ui, &mut input, KeyCode::Enter);
        assert!(!ui.preview_open, "no artifact → Enter does not open preview");

        // 有产物：Enter 开，Esc 关。
        state.artifacts.push(Artifact {
            id: Some("a1".to_string()),
            name: Some("report.md".to_string()),
            kind: Some("report".to_string()),
            artifact_type: None,
            path: Some("nonexistent.md".to_string()),
            status: "draft".to_string(),
            summary: None,
            checks: Vec::new(),
            bytes: Some(1200),
            created_ts: 0,
        });
        press(&mut state, &mut ui, &mut input, KeyCode::Enter);
        assert!(ui.preview_open, "selected artifact → Enter opens preview");
        press(&mut state, &mut ui, &mut input, KeyCode::Esc);
        assert!(!ui.preview_open, "Esc closes preview");
        press(&mut state, &mut ui, &mut input, KeyCode::Enter);
        assert!(ui.preview_open, "reopens");
        press(&mut state, &mut ui, &mut input, KeyCode::Char('q'));
        assert!(!ui.preview_open, "q closes preview");
    }

    /// v0.16 W4.1：预览浮层 j/k/PageDown/PageUp 滚动正文,`[`/`]` 换产物时滚动归零
    /// (设计稿"j/k 滚动 · [ ] 切换文件"——v0.15 只做了切换,滚动是缺失的一半)。
    #[test]
    fn preview_j_k_scrolls_and_switching_artifact_resets_scroll() {
        use crate::workbench::state::Artifact;
        let mut state = AppState::default();
        for (id, name) in [("a1", "first.md"), ("a2", "second.md")] {
            state.artifacts.push(Artifact {
                id: Some(id.to_string()),
                name: Some(name.to_string()),
                kind: Some("report".to_string()),
                artifact_type: None,
                path: Some("nonexistent.md".to_string()),
                status: "draft".to_string(),
                summary: None,
                checks: Vec::new(),
                bytes: Some(100),
                created_ts: 0,
            });
        }
        let mut ui = UiState::default();
        ui.mode = InputMode::Normal;
        let mut input = InputBuffer::default();

        press(&mut state, &mut ui, &mut input, KeyCode::Enter); // open preview
        assert!(ui.preview_open);
        assert_eq!(ui.preview_scroll, 0, "opens at top");

        press(&mut state, &mut ui, &mut input, KeyCode::Char('j'));
        press(&mut state, &mut ui, &mut input, KeyCode::Char('j'));
        assert_eq!(ui.preview_scroll, 2, "j increments scroll");
        press(&mut state, &mut ui, &mut input, KeyCode::Char('k'));
        assert_eq!(ui.preview_scroll, 1, "k decrements scroll");
        press(&mut state, &mut ui, &mut input, KeyCode::PageDown);
        assert_eq!(ui.preview_scroll, 11, "PageDown jumps by 10");
        press(&mut state, &mut ui, &mut input, KeyCode::PageUp);
        assert_eq!(ui.preview_scroll, 1, "PageUp jumps back by 10");

        press(&mut state, &mut ui, &mut input, KeyCode::Char(']'));
        assert_eq!(ui.preview_scroll, 0, "] switches artifact and resets scroll");
        press(&mut state, &mut ui, &mut input, KeyCode::Char('j'));
        press(&mut state, &mut ui, &mut input, KeyCode::Char('['));
        assert_eq!(ui.preview_scroll, 0, "[ switches artifact and resets scroll");
    }

    /// v0.17 P1-B3：NORMAL 下 `:` 别名到既有 `/` 命令面板(设计稿 `:settings` 等命令行前缀,
    /// 之前完全没处理,会被当普通字符打进聊天框)——断言输入框落的是 `/` 不是 `:`,且命令面板打开。
    #[test]
    fn colon_key_aliases_to_slash_command_palette() {
        use crate::workbench::state::CommandInfo;
        let mut state = AppState::default();
        state.commands = vec![CommandInfo { name: "/help".to_string(), desc: "帮助".to_string() }];
        let mut ui = UiState::default();
        ui.mode = InputMode::Normal;
        let mut input = InputBuffer::default();

        press(&mut state, &mut ui, &mut input, KeyCode::Char(':'));
        assert_eq!(ui.mode, InputMode::Insert, ": switches to INSERT");
        assert_eq!(input.as_str(), "/", ": inserts / not literal :");
        assert!(state.command_picker.is_some(), ": opens the command palette");
    }

    /// v0.16 W6.2：DREAM 上 f 键循环 MEMORY tab(全部→K→P→E→全部),换 tab 重置游标。
    #[test]
    fn dream_f_key_cycles_memory_tabs() {
        let mut state = AppState::default();
        let mut ui = UiState::default();
        ui.mode = InputMode::Normal;
        ui.screen = Screen::Dream;
        let mut input = InputBuffer::default();
        assert_eq!(ui.dream_mem_tab, 0);
        press(&mut state, &mut ui, &mut input, KeyCode::Char('f'));
        assert_eq!(ui.dream_mem_tab, 1, "f cycles to tab 1 (K)");
        press(&mut state, &mut ui, &mut input, KeyCode::Char('f'));
        press(&mut state, &mut ui, &mut input, KeyCode::Char('f'));
        assert_eq!(ui.dream_mem_tab, 3, "f cycles to tab 3 (E)");
        press(&mut state, &mut ui, &mut input, KeyCode::Char('f'));
        assert_eq!(ui.dream_mem_tab, 0, "f wraps back to tab 0 (全部)");
    }

    /// v0.15 P1-2：n 开通知中心；j/k 移游标；R 全读；Enter 跳工作台并已读+关闭；Esc 关。
    #[test]
    fn n_opens_notifications_and_keys_navigate_and_read() {
        use crate::workbench::state::{Notice, NoticeKind};
        let mut state = AppState::default();
        state.notices = vec![
            Notice { ts: 0, kind: NoticeKind::Approval, title: "等待批准".into(), body: "x".into(), read: false },
            Notice { ts: 0, kind: NoticeKind::Delivered, title: "已交付".into(), body: "y".into(), read: false },
        ];
        let mut ui = UiState::default();
        ui.mode = InputMode::Normal;
        ui.set_screen(Screen::Market);
        let mut input = InputBuffer::default();

        press(&mut state, &mut ui, &mut input, KeyCode::Char('n'));
        assert!(ui.notif_open, "n opens notifications");
        press(&mut state, &mut ui, &mut input, KeyCode::Char('j'));
        assert_eq!(ui.notif_cursor, 1, "j moves cursor down");
        press(&mut state, &mut ui, &mut input, KeyCode::Char('R'));
        assert_eq!(state.unread_notices(), 0, "R marks all read");
        press(&mut state, &mut ui, &mut input, KeyCode::Esc);
        assert!(!ui.notif_open, "Esc closes");

        // Enter 跳工作台并关闭（选中的是 Delivered 通知——去看任务详情，在 WORKBENCH）。
        press(&mut state, &mut ui, &mut input, KeyCode::Char('n'));
        press(&mut state, &mut ui, &mut input, KeyCode::Enter);
        assert!(!ui.notif_open, "Enter closes");
        assert_eq!(ui.screen, Screen::Workbench, "Enter jumps to workbench");
    }

    /// v0.17 P0-3：Accepted 通知的行动文案是"→ 看 KPI"——Enter 必须真的跳 EVAL(4),
    /// 不能像此前那样一律跳 WORKBENCH(半做)。
    #[test]
    fn n_enter_on_accepted_notice_jumps_to_eval_screen() {
        use crate::workbench::state::{Notice, NoticeKind};
        let mut state = AppState::default();
        state.notices = vec![Notice {
            ts: 0,
            kind: NoticeKind::Accepted,
            title: "已验收".into(),
            body: "交付物已接受".into(),
            read: false,
        }];
        let mut ui = UiState::default();
        ui.mode = InputMode::Normal;
        ui.set_screen(Screen::Market);
        let mut input = InputBuffer::default();

        press(&mut state, &mut ui, &mut input, KeyCode::Char('n'));
        press(&mut state, &mut ui, &mut input, KeyCode::Enter);
        assert_eq!(ui.screen, Screen::Eval, "Accepted notice routes to EVAL (看 KPI)");
        assert!(state.notices[0].read, "selected notice marked read");
    }

    /// v0.15 P1-1：, 开 SETTINGS；j/k 移游标；l 循环 theme（真生效,theme_index 变）；
    /// density 改动落盘 prefs.json 且可被 Prefs::load 读回；Esc 关。
    #[test]
    fn settings_opens_cycles_and_persists() {
        // v0.16：这条测试真的循环了主题(l 在 theme 行)——共享锁避免和其它读主题色的测试互踩。
        let _guard = crate::workbench::config::THEME_TEST_LOCK
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let mut state = AppState::default();
        let mut ui = UiState::default();
        ui.mode = InputMode::Normal;
        // 落盘到独立临时目录（避免污染仓库 .crewclaw）。
        let mut root = std::env::temp_dir();
        root.push(format!("crewclaw_prefs_test_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        ui.prefs_root = Some(root.clone());
        let mut input = InputBuffer::default();

        press(&mut state, &mut ui, &mut input, KeyCode::Char(','));
        assert!(ui.settings_open, ", opens SETTINGS");

        // theme 行（cursor 0）l 循环 → theme_index 前进。
        let before = ui.theme_index;
        press(&mut state, &mut ui, &mut input, KeyCode::Char('l'));
        assert_ne!(ui.theme_index, before, "l cycles theme (real effect)");

        // 移到 density 行（cursor 2）改值 → 落盘。
        press(&mut state, &mut ui, &mut input, KeyCode::Char('j'));
        press(&mut state, &mut ui, &mut input, KeyCode::Char('j'));
        assert_eq!(ui.settings_cursor, 2, "j moves to density row");
        let d0 = ui.prefs.density;
        press(&mut state, &mut ui, &mut input, KeyCode::Char('l'));
        assert_ne!(ui.prefs.density, d0, "l changes density");

        // 持久化真发生：prefs.json 可读回，值一致。
        let reloaded = crate::workbench::config::Prefs::load(&root);
        assert_eq!(reloaded.density, ui.prefs.density, "density persisted to prefs.json");
        assert_eq!(reloaded.theme_index, ui.theme_index, "theme persisted");

        press(&mut state, &mut ui, &mut input, KeyCode::Esc);
        assert!(!ui.settings_open, "Esc closes SETTINGS");
        let _ = std::fs::remove_dir_all(&root);
        // v0.16：主题是进程级 RwLock,`l` 循环过 theme 行真的 set_theme 了——收尾恢复默认,
        // 避免污染后续按 Theme::DARK 断言底色的测试(被 W6.1 eval 测试发现的真串扰)。
        crate::workbench::config::set_theme(crate::workbench::config::Theme::DARK);
    }

    /// v0.15 P1-4：MARKET 上 p 开 PUBLISH；Enter 推进 4 步后关闭；Esc 取消。
    #[test]
    fn p_opens_publish_on_market_and_enter_advances() {
        use crate::workbench::state::MarketEntry;
        let mut state = AppState::default();
        let mut ui = UiState::default();
        ui.mode = InputMode::Normal;
        ui.market = vec![MarketEntry { name: "whale".into(), display_name: "AI落地鲸".into(), ..Default::default() }];
        ui.set_screen(Screen::Market);
        let mut input = InputBuffer::default();

        press(&mut state, &mut ui, &mut input, KeyCode::Char('p'));
        assert_eq!(ui.publish_step, Some(0), "p opens publish at step 0");
        press(&mut state, &mut ui, &mut input, KeyCode::Enter);
        assert_eq!(ui.publish_step, Some(1), "Enter advances");
        press(&mut state, &mut ui, &mut input, KeyCode::Enter);
        press(&mut state, &mut ui, &mut input, KeyCode::Enter);
        assert_eq!(ui.publish_step, Some(3), "at last step");
        press(&mut state, &mut ui, &mut input, KeyCode::Enter);
        assert_eq!(ui.publish_step, None, "Enter on last step finishes/closes");

        // Esc 取消。
        press(&mut state, &mut ui, &mut input, KeyCode::Char('p'));
        press(&mut state, &mut ui, &mut input, KeyCode::Esc);
        assert_eq!(ui.publish_step, None, "Esc cancels");
        // p 在非 MARKET 屏不开。
        ui.set_screen(Screen::Workbench);
        press(&mut state, &mut ui, &mut input, KeyCode::Char('p'));
        assert_eq!(ui.publish_step, None, "p does nothing off MARKET");
    }

    /// v0.17 P1-B2：MARKET `x` 勾选 ≤2 员工，`c` 打开 COMPARE 浮层；Esc/q/c 关闭。
    /// 已选满 2 个时再对第三个按 x 应该无效（逼用户先取消一个），且 x 对已选中的项是切换
    /// (再按一次取消勾选)。
    #[test]
    fn x_selects_up_to_two_for_compare_and_c_opens_overlay() {
        use crate::workbench::state::MarketEntry;
        let mut state = AppState::default();
        let mut ui = UiState::default();
        ui.mode = InputMode::Normal;
        ui.market = vec![
            MarketEntry { name: "whale".into(), display_name: "AI落地鲸".into(), ..Default::default() },
            MarketEntry { name: "octopus".into(), display_name: "Docs Octopus".into(), ..Default::default() },
            MarketEntry { name: "third".into(), display_name: "第三位".into(), ..Default::default() },
        ];
        ui.set_screen(Screen::Market);
        let mut input = InputBuffer::default();

        // c 在选够 2 个之前不开。
        press(&mut state, &mut ui, &mut input, KeyCode::Char('c'));
        assert!(!ui.compare_open, "c does nothing until 2 are selected");

        // 勾选 market[0]（cursor 0）。
        press(&mut state, &mut ui, &mut input, KeyCode::Char('x'));
        assert_eq!(ui.compare_selection, vec![0]);

        // 移到 market[1] 勾选。
        press(&mut state, &mut ui, &mut input, KeyCode::Char('j'));
        press(&mut state, &mut ui, &mut input, KeyCode::Char('x'));
        assert_eq!(ui.compare_selection, vec![0, 1]);

        // 已选满：对第三个按 x 无效。
        press(&mut state, &mut ui, &mut input, KeyCode::Char('j'));
        press(&mut state, &mut ui, &mut input, KeyCode::Char('x'));
        assert_eq!(ui.compare_selection, vec![0, 1], "x is a no-op once 2 are already selected");

        // c 打开对比浮层。
        press(&mut state, &mut ui, &mut input, KeyCode::Char('c'));
        assert!(ui.compare_open, "c opens the overlay once 2 are selected");

        // Esc 关闭浮层（不清空选择——只是关窗）。
        press(&mut state, &mut ui, &mut input, KeyCode::Esc);
        assert!(!ui.compare_open, "Esc closes the overlay");
        assert_eq!(ui.compare_selection, vec![0, 1], "closing the overlay keeps the selection");

        // 回到 market[0]（第三个员工在 cursor 位置向上两次）再取消勾选。
        press(&mut state, &mut ui, &mut input, KeyCode::Char('k'));
        press(&mut state, &mut ui, &mut input, KeyCode::Char('k'));
        press(&mut state, &mut ui, &mut input, KeyCode::Char('x'));
        assert_eq!(ui.compare_selection, vec![1], "x on an already-selected entry deselects it");
    }

    /// v0.17 P1-B1：MARKET `/` 进入真过滤(不是全局命令面板)——键入缩小 filtered 列表，
    /// Esc 清空恢复全量，且过滤态下 h/Enter 必须经 market_selected_index() 翻译真下标，
    /// 不能拿 filtered 位置直接当 market 下标用（否则会带错员工进 HIRE）。
    #[test]
    fn market_slash_filters_list_and_selection_maps_to_real_index() {
        use crate::workbench::state::MarketEntry;
        let mut state = AppState::default();
        let mut ui = UiState::default();
        ui.mode = InputMode::Normal;
        ui.market = vec![
            MarketEntry { name: "whale".into(), display_name: "AI落地鲸".into(), status: "available".into(), ..Default::default() },
            MarketEntry { name: "octopus".into(), display_name: "Docs Octopus".into(), status: "available".into(), ..Default::default() },
        ];
        ui.set_screen(Screen::Market);
        let mut input = InputBuffer::default();

        press(&mut state, &mut ui, &mut input, KeyCode::Char('/'));
        assert!(ui.market_filter_active, "/ opens MARKET-local filter, not the command palette");
        assert!(state.command_picker.is_none(), "/ on MARKET must not open the global command palette");

        for c in "octo".chars() {
            press(&mut state, &mut ui, &mut input, KeyCode::Char(c));
        }
        assert_eq!(ui.market_filter, "octo");
        assert_eq!(ui.market_filtered().len(), 1, "filter narrows to the matching expert only");
        assert_eq!(ui.market_filtered()[0].name, "octopus");

        press(&mut state, &mut ui, &mut input, KeyCode::Enter);
        assert!(!ui.market_filter_active, "Enter closes the filter editor, keeps the filter applied");
        assert_eq!(ui.market_cursor, 0, "cursor reset into the filtered list");

        // h/Enter 必须带对真实员工（filtered[0] == octopus，而非 market[0] == whale）。
        press(&mut state, &mut ui, &mut input, KeyCode::Char('h'));
        assert_eq!(ui.screen, Screen::Hire);
        assert_eq!(ui.hire_cursor, 1, "hire_cursor resolves to octopus's real market index (1), not filtered index (0)");

        // Esc 清空过滤，恢复全量列表。
        ui.set_screen(Screen::Market);
        press(&mut state, &mut ui, &mut input, KeyCode::Char('/'));
        press(&mut state, &mut ui, &mut input, KeyCode::Esc);
        assert!(ui.market_filter.is_empty(), "Esc clears the filter text");
        assert_eq!(ui.market_filtered().len(), 2, "empty filter shows all experts again");
    }

    #[test]
    fn tab_and_backtab_cycle_screens_in_normal() {
        let mut state = AppState::default();
        let mut ui = UiState::default();
        ui.mode = InputMode::Normal;
        let mut input = InputBuffer::default();
        press(&mut state, &mut ui, &mut input, KeyCode::Tab);
        assert_eq!(ui.screen, Screen::Market);
        press(&mut state, &mut ui, &mut input, KeyCode::BackTab);
        assert_eq!(ui.screen, Screen::Workbench);
        press(&mut state, &mut ui, &mut input, KeyCode::BackTab);
        assert_eq!(ui.screen, Screen::Dream, "BackTab wraps to last");
    }

    #[test]
    fn t_key_cycles_theme_index_in_normal() {
        let mut state = AppState::default();
        let mut ui = UiState::default();
        ui.mode = InputMode::Normal;
        let mut input = InputBuffer::default();
        assert_eq!(ui.theme_index, 0);
        press(&mut state, &mut ui, &mut input, KeyCode::Char('t'));
        assert_eq!(ui.theme_index, 1);
    }

    #[test]
    fn normal_o_opens_onboarding_and_enter_advances_then_closes() {
        let mut state = AppState::default();
        let mut ui = UiState::default();
        ui.mode = InputMode::Normal;
        // v0.15 P1-3：WORKBENCH 的 o 已改为 TASK DETAIL；入职仪式在非工作台屏用 o 触发。
        ui.set_screen(Screen::Market);
        let mut input = InputBuffer::default();
        press(&mut state, &mut ui, &mut input, KeyCode::Char('o'));
        assert_eq!(ui.onboarding.map(|o| o.step), Some(0), "o opens onboarding at step 0");
        press(&mut state, &mut ui, &mut input, KeyCode::Enter);
        assert_eq!(ui.onboarding.map(|o| o.step), Some(1), "Enter advances");
        press(&mut state, &mut ui, &mut input, KeyCode::Enter); // step 2
        press(&mut state, &mut ui, &mut input, KeyCode::Enter); // past last → close
        assert_eq!(ui.onboarding, None, "Enter past last step closes onboarding");
    }

    #[test]
    fn normal_space_toggles_which_key() {
        let mut state = AppState::default();
        let mut ui = UiState::default();
        ui.mode = InputMode::Normal;
        let mut input = InputBuffer::default();
        assert!(!ui.which_key);
        press(&mut state, &mut ui, &mut input, KeyCode::Char(' '));
        assert!(ui.which_key, "Space opens which-key");
        press(&mut state, &mut ui, &mut input, KeyCode::Char(' '));
        assert!(!ui.which_key, "Space closes which-key");
    }

    /// v0.13 M4：WORKBENCH NORMAL j/k 选 SESSION 事件；Esc 清游标恢复跟随；g 顶 / G 回跟随。
    #[test]
    fn session_cursor_jk_esc_g_capital_g() {
        use crate::workbench::protocol::TaskEvent;
        let mut state = AppState::default();
        for i in 0..3 {
            state.reduce(&TaskEvent::from_parts(
                "task.started",
                1_000 + i,
                json!({"id": format!("t{i}"), "title": format!("任务{i}"), "mode": "Chat"}),
            ));
        }
        let mut ui = UiState::default();
        ui.mode = InputMode::Normal;
        let mut input = InputBuffer::default();

        // 首按 j 落在最新事件；k 上移；follow 脱离。
        press(&mut state, &mut ui, &mut input, KeyCode::Char('j'));
        assert_eq!(ui.session_cursor, Some(state.timeline.len() - 1), "first j → newest");
        assert!(!ui.follow, "selection detaches follow");
        press(&mut state, &mut ui, &mut input, KeyCode::Char('k'));
        assert_eq!(ui.session_cursor, Some(state.timeline.len() - 2), "k moves up");
        // g → 顶。
        press(&mut state, &mut ui, &mut input, KeyCode::Char('g'));
        assert_eq!(ui.session_cursor, Some(0), "g jumps to top");
        // Esc → 清游标恢复跟随。
        press(&mut state, &mut ui, &mut input, KeyCode::Esc);
        assert_eq!(ui.session_cursor, None, "Esc clears cursor");
        assert!(ui.follow, "Esc restores follow");
        // G（先建游标再 G）→ 回跟随。
        press(&mut state, &mut ui, &mut input, KeyCode::Char('j'));
        press(&mut state, &mut ui, &mut input, KeyCode::Char('G'));
        assert_eq!(ui.session_cursor, None, "G returns to follow");
        assert!(ui.follow);
    }

    /// v0.13 M4：Esc 逐层退出——INSERT 非空输入先清空，再离开输入态。
    #[test]
    fn esc_clears_input_before_leaving_insert() {
        let mut state = AppState::default();
        let mut ui = UiState::default();
        ui.mode = InputMode::Insert; // v0.15：冷启动默认 NORMAL,先进 INSERT 测分层 Esc。
        let mut input = InputBuffer::default();
        input.insert_str("写一半的话");
        press(&mut state, &mut ui, &mut input, KeyCode::Esc);
        assert_eq!(input.as_str(), "", "first Esc clears the draft");
        assert_eq!(ui.mode, InputMode::Insert, "still INSERT after clearing");
        press(&mut state, &mut ui, &mut input, KeyCode::Esc);
        assert_eq!(ui.mode, InputMode::Normal, "second Esc leaves INSERT");
    }

    #[test]
    fn pending_digit_routing_is_independent_of_input_mode() {
        // 回归：待办数字拦截在 handle_key_event 之前（mod.rs:381），其判定 should_route_pending_action_digit
        // 不看 InputMode——故 NORMAL 下命中的待办数字仍走 PendingAction，不会被切屏吞掉（待办优先）。
        use crate::workbench::state::PendingAction;
        let mut state = AppState::default();
        state.pending_actions = vec![PendingAction {
            key: "2".to_string(),
            label: "修订".to_string(),
            command: Some("{\"type\":\"pending.run\"}".to_string()),
        }];
        let mut ui = UiState::default();
        for mode in [InputMode::Insert, InputMode::Normal] {
            ui.mode = mode;
            assert!(
                should_route_pending_action_digit(&state, &ui, true, '2'),
                "matching pending digit routes regardless of mode ({mode:?})"
            );
        }
        // 无匹配待办的数字则不拦截（NORMAL 下交给切屏，INSERT 下打字）。
        assert!(!should_route_pending_action_digit(&state, &ui, true, '5'));
    }

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
    fn pending_action_digit_routes_only_when_input_empty_and_matching() {
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

        assert!(should_route_pending_action_digit(
            &state, &ui_state, true, '2'
        ));
        assert!(!should_route_pending_action_digit(
            &state, &ui_state, true, '1'
        ));
        assert!(!should_route_pending_action_digit(
            &state, &ui_state, true, 'x'
        ));

        // Non-empty input means the digit is text, not an action trigger.
        assert!(!should_route_pending_action_digit(
            &state, &ui_state, false, '2'
        ));

        // An open drawer captures keys, so digits never trigger actions there either.
        ui_state.drawer = Some(state::FocusPanel::Timeline);
        assert!(!should_route_pending_action_digit(
            &state, &ui_state, true, '2'
        ));
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
            true,
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

        let action = user_action_for_pending_digit(&state, &UiState::default(), true, '1')
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
            bytes: None,
            created_ts: 0,
        });
        state.selected_artifact = Some("a1".to_string());
        let mut ui_state = UiState::default();
        ui_state.drawer = Some(state::FocusPanel::Artifacts);

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
    fn typing_a_char_always_inserts_into_the_always_focused_input() {
        // v0.15：冷启动默认 NORMAL(命令模式)——"ni hao" 以 n(通知)/i(进 INSERT) 等绑定键开头,
        // 故显式进 INSERT 测"打字即入框"语义(NORMAL 下未绑定字符会自动落回 INSERT,见 catch-all 臂)。
        let mut state = AppState::default();
        let mut ui_state = UiState::default();
        ui_state.mode = InputMode::Insert;
        let mut input = InputBuffer::default();

        for ch in "ni hao".chars() {
            handle_key_event(
                &mut state,
                &mut ui_state,
                &mut input,
                false,
                KeyEvent::new(KeyCode::Char(ch), KeyModifiers::NONE),
            )
            .expect("char handled");
        }

        assert_eq!(input.as_str(), "ni hao");

        // 'q' is plain text now — it must not quit while you're composing a message.
        let action = handle_key_event(
            &mut state,
            &mut ui_state,
            &mut input,
            false,
            KeyEvent::new(KeyCode::Char('q'), KeyModifiers::NONE),
        )
        .expect("q handled");
        assert!(matches!(action, TerminalAction::Continue));
        assert_eq!(input.as_str(), "ni haoq");

        // Enter submits the full message (the exact text the live loop forwards to run.mjs)
        // and clears the buffer, so the next keystroke starts a fresh message.
        let submit = handle_key_event(
            &mut state,
            &mut ui_state,
            &mut input,
            false,
            KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE),
        )
        .expect("enter handled");
        match submit {
            TerminalAction::Submit(text, _) => assert_eq!(text, "ni haoq"),
            _ => panic!("expected Submit action from Enter"),
        }
        assert!(input.is_empty(), "input clears after submit");
    }

    #[test]
    fn ctrl_c_quits_but_q_is_plain_text() {
        let mut state = AppState::default();
        let mut ui_state = UiState::default();
        let mut input = InputBuffer::default();

        // Bare 'q' is text, never Quit.
        let q = handle_key_event(
            &mut state,
            &mut ui_state,
            &mut input,
            false,
            KeyEvent::new(KeyCode::Char('q'), KeyModifiers::NONE),
        )
        .expect("q handled");
        assert!(matches!(q, TerminalAction::Continue));
        assert_eq!(input.as_str(), "q");

        // Ctrl+C is the primary exit and works regardless of buffer contents.
        let quit = handle_key_event(
            &mut state,
            &mut ui_state,
            &mut input,
            false,
            KeyEvent::new(KeyCode::Char('c'), KeyModifiers::CONTROL),
        )
        .expect("ctrl-c handled");
        assert!(matches!(quit, TerminalAction::Quit));
    }

    #[test]
    fn ctrl_o_toggles_the_panel_drawer() {
        let mut state = AppState::default();
        let mut ui_state = UiState::default();
        let mut input = InputBuffer::default();
        assert!(ui_state.drawer.is_none());

        handle_key_event(
            &mut state,
            &mut ui_state,
            &mut input,
            false,
            KeyEvent::new(KeyCode::Char('o'), KeyModifiers::CONTROL),
        )
        .expect("ctrl-o open");
        assert_eq!(ui_state.drawer, Some(state::FocusPanel::Tasks));

        // While the drawer is open, printable keys are captured by the drawer, not the input.
        handle_key_event(
            &mut state,
            &mut ui_state,
            &mut input,
            false,
            KeyEvent::new(KeyCode::Char('x'), KeyModifiers::NONE),
        )
        .expect("drawer swallows text");
        assert!(input.is_empty(), "drawer must not leak text into the input");

        handle_key_event(
            &mut state,
            &mut ui_state,
            &mut input,
            false,
            KeyEvent::new(KeyCode::Char('o'), KeyModifiers::CONTROL),
        )
        .expect("ctrl-o close");
        assert!(ui_state.drawer.is_none());
    }

    #[test]
    fn page_up_scrolls_messages_and_pauses_follow_while_page_down_resumes() {
        let mut state = AppState::default();
        let mut ui_state = UiState::default();
        let mut input = InputBuffer::default();
        // Simulate a rendered frame with scrollable content (render writes this each frame).
        ui_state.content_max_scroll.set(50);
        assert!(ui_state.follow, "follow starts enabled (sticky bottom)");

        handle_key_event(
            &mut state,
            &mut ui_state,
            &mut input,
            false,
            KeyEvent::new(KeyCode::PageUp, KeyModifiers::NONE),
        )
        .expect("page up");
        assert!(!ui_state.follow, "scrolling up pauses sticky-bottom follow");
        assert!(input.is_empty(), "PageUp must not type into the input");

        // Page down repeatedly until it reaches the bottom → follow resumes.
        for _ in 0..10 {
            handle_key_event(
                &mut state,
                &mut ui_state,
                &mut input,
                false,
                KeyEvent::new(KeyCode::PageDown, KeyModifiers::NONE),
            )
            .expect("page down");
        }
        assert!(
            ui_state.follow,
            "scrolling back to the bottom resumes follow"
        );
    }

    #[test]
    fn wheel_up_detaches_follow_and_wheel_down_to_bottom_resumes() {
        use crossterm::event::MouseEventKind;
        let mut ui_state = UiState::default();
        ui_state.content_max_scroll.set(20);

        handle_mouse_scroll(&mut ui_state, MouseEventKind::ScrollUp);
        assert!(!ui_state.follow, "wheel up detaches follow");
        assert!(ui_state.unseen_below() > 0, "unseen badge count grows");

        // Wheel down enough to hit the bottom → follow resumes, badge clears.
        for _ in 0..10 {
            handle_mouse_scroll(&mut ui_state, MouseEventKind::ScrollDown);
        }
        assert!(ui_state.follow, "wheel down to the bottom resumes follow");
        assert_eq!(ui_state.unseen_below(), 0, "badge clears at the bottom");

        // A drawer captures the wheel: message flow stays put.
        ui_state.follow = false;
        ui_state.messages_scroll = 3;
        ui_state.drawer = Some(state::FocusPanel::Timeline);
        handle_mouse_scroll(&mut ui_state, MouseEventKind::ScrollUp);
        assert_eq!(
            ui_state.messages_scroll, 3,
            "drawer open → wheel leaves message flow"
        );
    }

    #[test]
    fn end_with_empty_input_returns_to_bottom() {
        let mut state = AppState::default();
        let mut ui_state = UiState::default();
        let mut input = InputBuffer::default();
        ui_state.content_max_scroll.set(30);
        ui_state.follow = false;
        ui_state.messages_scroll = 5;

        handle_key_event(
            &mut state,
            &mut ui_state,
            &mut input,
            false,
            KeyEvent::new(KeyCode::End, KeyModifiers::NONE),
        )
        .expect("end");
        assert!(ui_state.follow, "End on empty input resumes follow");
    }

    #[test]
    fn at_reference_picker_inserts_canonical_token() {
        let mut state = AppState::default();
        state.employee = Some(state::Employee {
            name: "Zeneth".to_string(),
            role: "社群运营".to_string(),
            model: "demo".to_string(),
            skills: Vec::new(),
            avatar: Vec::new(),
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
            bytes: None,
            created_ts: 0,
        });
        let mut ui_state = UiState::default();
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
    fn ctrl_g_clears_the_input_buffer() {
        let mut state = AppState::default();
        let mut input = InputBuffer::default();
        input.insert_str("/run roi-demo");

        assert!(cancel_current_action(&mut state, &mut input));
        assert!(input.is_empty());
        assert_eq!(input.cursor(), 0);
        assert!(state.ref_picker.is_none());
    }

    fn state_with_commands() -> AppState {
        let mut state = AppState::default();
        state.commands = vec![
            state::CommandInfo {
                name: "/help".to_string(),
                desc: "Show commands.".to_string(),
            },
            state::CommandInfo {
                name: "/model".to_string(),
                desc: "Show model.".to_string(),
            },
            state::CommandInfo {
                name: "/clear".to_string(),
                desc: "Clear context.".to_string(),
            },
        ];
        state
    }

    #[test]
    fn slash_query_triggers_at_line_start_only() {
        let mut input = InputBuffer::default();
        input.insert_str("/mo");
        assert_eq!(slash_command_query(&input).as_deref(), Some("mo"));

        // Mid-message slash (e.g. a path) must NOT trigger the command popup (AC-CMD-004).
        let mut mid = InputBuffer::default();
        mid.insert_str("a/b");
        assert!(slash_command_query(&mid).is_none());
    }

    #[test]
    fn typing_slash_prefix_opens_and_filters_command_popup() {
        let mut state = state_with_commands();
        let mut ui_state = UiState::default();
        let mut input = InputBuffer::default();

        for ch in "/mo".chars() {
            handle_key_event(
                &mut state,
                &mut ui_state,
                &mut input,
                false,
                KeyEvent::new(KeyCode::Char(ch), KeyModifiers::NONE),
            )
            .expect("key");
        }
        let picker = state.command_picker.as_ref().expect("command popup open");
        assert_eq!(
            picker.matches.first().map(|c| c.name.as_str()),
            Some("/model")
        );

        // Enter completes the command name (adds trailing space) and closes the popup, no submit.
        let action = handle_key_event(
            &mut state,
            &mut ui_state,
            &mut input,
            false,
            KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE),
        )
        .expect("enter");
        assert!(matches!(action, TerminalAction::Continue));
        assert_eq!(input.as_str(), "/model ");
        assert!(state.command_picker.is_none());
    }

    #[test]
    fn mid_message_slash_does_not_open_command_popup() {
        let mut state = state_with_commands();
        let mut ui_state = UiState::default();
        let mut input = InputBuffer::default();
        for ch in "a/b".chars() {
            handle_key_event(
                &mut state,
                &mut ui_state,
                &mut input,
                false,
                KeyEvent::new(KeyCode::Char(ch), KeyModifiers::NONE),
            )
            .expect("key");
        }
        assert!(
            state.command_picker.is_none(),
            "no popup for mid-message slash"
        );
    }

    #[test]
    fn ctrl_p_opens_searchable_command_palette() {
        let mut state = state_with_commands();
        let mut ui_state = UiState::default();
        let mut input = InputBuffer::default();
        handle_key_event(
            &mut state,
            &mut ui_state,
            &mut input,
            false,
            KeyEvent::new(KeyCode::Char('p'), KeyModifiers::CONTROL),
        )
        .expect("ctrl+p");
        assert_eq!(input.as_str(), "/");
        assert!(
            state.command_picker.is_some(),
            "palette open with all commands"
        );
        assert_eq!(state.command_picker.as_ref().unwrap().matches.len(), 3);
    }

    #[test]
    fn replace_slash_command_completes_with_trailing_space() {
        let mut input = InputBuffer::default();
        input.insert_str("/mo");
        assert!(input.replace_slash_command("/model"));
        assert_eq!(input.as_str(), "/model ");
        assert_eq!(input.cursor(), "/model ".len());
    }

    #[test]
    fn paste_appends_unless_a_drawer_or_overlay_captures_keys() {
        let mut ui_state = UiState::default();
        let mut input = InputBuffer::default();
        input.insert_str("/run ");

        assert!(append_paste_to_input(
            &ui_state,
            &mut input,
            "ROI 示例\n第二行"
        ));
        assert_eq!(input.as_str(), "/run ROI 示例\n第二行");
        assert_eq!(input.cursor(), "/run ROI 示例\n第二行".len());

        // An open drawer captures keys, so pastes must not land in the chat input.
        ui_state.drawer = Some(state::FocusPanel::Tasks);
        assert!(!append_paste_to_input(&ui_state, &mut input, " ignored"));
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
    fn focused_input_supports_emacs_line_and_word_keys() {
        let mut state = AppState::default();
        let mut ui_state = UiState::default();
        ui_state.mode = InputMode::Insert; // v0.15：焦点输入行为测,显式 INSERT。
        let mut input = InputBuffer::default();
        input.insert_str("hello 你world\nsecond line");

        handle_key_event(
            &mut state,
            &mut ui_state,
            &mut input,
            false,
            crossterm::event::KeyEvent::new(KeyCode::Char('a'), KeyModifiers::CONTROL),
        )
        .expect("ctrl-a");
        assert_eq!(input.cursor(), "hello 你world\n".len());

        handle_key_event(
            &mut state,
            &mut ui_state,
            &mut input,
            false,
            crossterm::event::KeyEvent::new(KeyCode::Char('e'), KeyModifiers::CONTROL),
        )
        .expect("ctrl-e");
        assert_eq!(input.cursor(), input.as_str().len());

        handle_key_event(
            &mut state,
            &mut ui_state,
            &mut input,
            false,
            crossterm::event::KeyEvent::new(KeyCode::Char('b'), KeyModifiers::ALT),
        )
        .expect("alt-b");
        assert_eq!(input.cursor(), "hello 你world\nsecond ".len());

        handle_key_event(
            &mut state,
            &mut ui_state,
            &mut input,
            false,
            crossterm::event::KeyEvent::new(KeyCode::Char('f'), KeyModifiers::ALT),
        )
        .expect("alt-f");
        assert_eq!(input.cursor(), input.as_str().len());

        handle_key_event(
            &mut state,
            &mut ui_state,
            &mut input,
            false,
            crossterm::event::KeyEvent::new(KeyCode::Char('w'), KeyModifiers::CONTROL),
        )
        .expect("ctrl-w");
        assert_eq!(input.as_str(), "hello 你world\nsecond ");

        handle_key_event(
            &mut state,
            &mut ui_state,
            &mut input,
            false,
            crossterm::event::KeyEvent::new(KeyCode::Backspace, KeyModifiers::ALT),
        )
        .expect("alt-backspace");
        assert_eq!(input.as_str(), "hello 你world\n");

        input.insert_str("tail");
        handle_key_event(
            &mut state,
            &mut ui_state,
            &mut input,
            false,
            crossterm::event::KeyEvent::new(KeyCode::Char('u'), KeyModifiers::CONTROL),
        )
        .expect("ctrl-u");
        assert_eq!(input.as_str(), "hello 你world\n");

        input.insert_str("tail");
        input.move_line_start();
        handle_key_event(
            &mut state,
            &mut ui_state,
            &mut input,
            false,
            crossterm::event::KeyEvent::new(KeyCode::Char('k'), KeyModifiers::CONTROL),
        )
        .expect("ctrl-k");
        assert_eq!(input.as_str(), "hello 你world\n");

        handle_key_event(
            &mut state,
            &mut ui_state,
            &mut input,
            false,
            crossterm::event::KeyEvent::new(KeyCode::Char('j'), KeyModifiers::CONTROL),
        )
        .expect("ctrl-j");
        assert_eq!(input.as_str(), "hello 你world\n\n");
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
    fn input_buffer_persists_prompt_history_jsonl_with_parts_shape() {
        let history_path = std::env::temp_dir()
            .join(format!("crewclaw-history-test-{}", std::process::id()))
            .join(".crewclaw")
            .join("prompt-history.jsonl");
        if let Some(root) = history_path.parent().and_then(|path| path.parent()) {
            let _ = std::fs::remove_dir_all(root);
        }

        let mut input = InputBuffer::with_history_path(history_path.clone());
        for index in 0..55 {
            input.insert_str(&format!("prompt {index}"));
            assert_eq!(input.submit(), format!("prompt {index}"));
        }

        let contents = std::fs::read_to_string(&history_path).expect("history file");
        let lines = contents.lines().collect::<Vec<_>>();
        assert_eq!(lines.len(), 50);
        let first: serde_json::Value = serde_json::from_str(lines[0]).expect("first record");
        assert_eq!(first["text"], "prompt 5");
        assert_eq!(first["parts"].as_array().map(Vec::len), Some(0));

        let mut restored = InputBuffer::with_history_path(history_path.clone());
        assert!(restored.history_previous());
        assert_eq!(restored.as_str(), "prompt 54");

        if let Some(root) = history_path.parent().and_then(|path| path.parent()) {
            let _ = std::fs::remove_dir_all(root);
        }
    }

    #[test]
    fn focused_input_up_down_navigates_history_only_at_buffer_edges() {
        let mut state = AppState::default();
        let mut ui_state = UiState::default();
        ui_state.mode = InputMode::Insert; // v0.15：焦点输入历史导航测,显式 INSERT。
        let original_scroll = ui_state.messages_scroll;
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
        assert_eq!(ui_state.messages_scroll, original_scroll);

        handle_key_event(
            &mut state,
            &mut ui_state,
            &mut input,
            false,
            crossterm::event::KeyEvent::new(KeyCode::Up, KeyModifiers::NONE),
        )
        .expect("up at history line end is line movement, not history");
        assert_eq!(input.as_str(), "/doctor");

        input.move_home();
        handle_key_event(
            &mut state,
            &mut ui_state,
            &mut input,
            false,
            crossterm::event::KeyEvent::new(KeyCode::Up, KeyModifiers::NONE),
        )
        .expect("second up action");
        assert_eq!(input.as_str(), "/run roi-demo");

        input.move_end();
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
    fn focused_multiline_input_up_down_moves_lines_without_history() {
        let mut state = AppState::default();
        let mut ui_state = UiState::default();
        ui_state.mode = InputMode::Insert; // v0.15：多行移行行为测,显式 INSERT。
        let mut input = InputBuffer::default();
        input.insert_str("old one");
        assert_eq!(input.submit(), "old one");
        input.insert_str("第一行\n第二你行");

        handle_key_event(
            &mut state,
            &mut ui_state,
            &mut input,
            false,
            crossterm::event::KeyEvent::new(KeyCode::Up, KeyModifiers::NONE),
        )
        .expect("line up");
        assert_eq!(input.as_str(), "第一行\n第二你行");
        assert_ne!(input.as_str(), "old one");
        assert_eq!(input.cursor(), "第一行".len());

        handle_key_event(
            &mut state,
            &mut ui_state,
            &mut input,
            false,
            crossterm::event::KeyEvent::new(KeyCode::Down, KeyModifiers::NONE),
        )
        .expect("line down");
        assert_eq!(input.cursor(), "第一行\n第二你".len());
    }

    #[test]
    fn alt_or_shift_enter_inserts_newline_and_plain_enter_submits_multiline_input() {
        let mut state = AppState::default();
        let mut ui_state = UiState::default();
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
        input.insert_str("第二行");

        let action = handle_key_event(
            &mut state,
            &mut ui_state,
            &mut input,
            false,
            crossterm::event::KeyEvent::new(KeyCode::Enter, KeyModifiers::SHIFT),
        )
        .expect("shift enter action");

        assert!(matches!(action, TerminalAction::Continue));
        input.insert_str("第三行");
        assert_eq!(input.as_str(), "/revise 第一行\n第二行\n第三行");

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
            TerminalAction::Submit(value, _) if value == "/revise 第一行\n第二行\n第三行"
        ));
        assert!(input.as_str().is_empty());
    }
}
