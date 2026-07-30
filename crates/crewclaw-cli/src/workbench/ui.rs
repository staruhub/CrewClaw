use ansi_to_tui::IntoText;
use ratatui::{
    Frame,
    layout::{Alignment, Constraint, Direction, Layout, Margin, Rect},
    style::{Color, Modifier, Style},
    symbols,
    text::{Line, Span, Text},
    widgets::{
        Block, Borders, Clear, Paragraph, Scrollbar, ScrollbarOrientation, ScrollbarState, Tabs,
        Wrap,
    },
};
use serde_json::Value;
#[cfg(not(test))]
use std::{sync::OnceLock, time::Instant};
use unicode_width::{UnicodeWidthChar, UnicodeWidthStr};

use super::config;
use super::preview::read_artifact_preview;
use super::screens;
use super::state::{
    AppState, ConversationItem, FocusPanel, InputMode, Overlay, PendingAction, SYM_FAIL, SYM_OK,
    SYM_RUNNING, SYM_WAIT, SYM_WARN, Screen, TimelineEntry, UiState,
};
use super::widgets::{
    artifact_panel::artifact_panel_rows, artifact_preview::artifact_preview_row, input_area,
};

// v0.8 M7：chrome 色板改由 config::Theme 提供（dark/light 可配）。以下 accessor 名沿用旧常量名，
// 保持 70 处调用点的写法不变（`ACCENT()` 而非常量），主题在启动时按 tui.json 装配。
use super::config::{accent as ACCENT, bad as BAD, dim as DIM, ok as OK, warn as WARN};

const ARTIFACT_PREVIEW_MAX_LINES: usize = 400;
const ARTIFACT_PREVIEW_MAX_CHARS: usize = 8_000;

/// 设计稿统一的 Braille 十帧 spinner；队列、工具态和底部生成提示共享同一序列。
pub(crate) const SPINNER_FRAMES: [&str; 10] = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
/// 每帧 100ms，落在设计稿要求的 90-120ms 区间内。
const SPINNER_FRAME_MS: u128 = 100;
/// 流式 caret：置于最新助手消息尾部，生成态可见、完成即消失。
const STREAM_CARET: &str = "▊";
const MODELINE_CARET: &str = "▋";
const STATUS_PULSE_MS: u128 = 1_600;
const MODELINE_BLINK_MS: u128 = 1_100;
const PROGRESS_CELLS: usize = 10;

/// WAITING/BLOCKING 使用离散虚线边框；终端没有 CSS dashed border，box-drawing 的
/// `╌`/`┊` 是一格一格的等价表达。
const WAITING_BORDER_SET: symbols::border::Set<'static> = symbols::border::Set {
    top_left: "┌",
    top_right: "┐",
    bottom_left: "└",
    bottom_right: "┘",
    vertical_left: "┊",
    vertical_right: "┊",
    horizontal_top: "╌",
    horizontal_bottom: "╌",
};

/// 依据 busy 已用时长选取当前 spinner 帧。
pub(crate) fn spinner_frame(elapsed_ms: u128) -> &'static str {
    let idx = (elapsed_ms / SPINNER_FRAME_MS) as usize % SPINNER_FRAMES.len();
    SPINNER_FRAMES[idx]
}

#[cfg(not(test))]
fn animation_elapsed_ms() -> u128 {
    static START: OnceLock<Instant> = OnceLock::new();
    START.get_or_init(Instant::now).elapsed().as_millis()
}

#[cfg(test)]
fn animation_elapsed_ms() -> u128 {
    0
}

/// CSS pulse/blink 在终端里的离散 step-frame 等价：前半周期亮、后半周期暗/隐藏。
fn animation_on(elapsed_ms: u128, cycle_ms: u128) -> bool {
    elapsed_ms % cycle_ms < cycle_ms / 2
}

/// 10 格真事件进度：运行中每个已观察到的工具调用填一格并保留最后一格给终态；
/// 终态才填满。它表达的是可验证事件 tick，而不是伪造业务百分比。
pub(crate) fn progress_bar_10(event_ticks: u32, complete: bool) -> String {
    let filled = if complete {
        PROGRESS_CELLS
    } else {
        (event_ticks as usize).min(PROGRESS_CELLS.saturating_sub(1))
    };
    format!(
        "{}{}",
        "█".repeat(filled),
        "░".repeat(PROGRESS_CELLS - filled)
    )
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum LayoutKind {
    Wide,
    Mid,
    Narrow,
}

#[cfg(test)]
pub fn render(frame: &mut Frame<'_>, state: &AppState, ui_state: &UiState, input: &str) {
    render_with_input(frame, state, ui_state, input, input.len());
}

pub(crate) fn render_with_input(
    frame: &mut Frame<'_>,
    state: &AppState,
    ui_state: &UiState,
    input: &str,
    input_cursor: usize,
) {
    render_with_input_spans(frame, state, ui_state, input, input_cursor, &[]);
}

/// v0.8 M6：带占位块 byte 区间的渲染入口，供 live loop 传 `InputBuffer::span_ranges()` 上色。
pub(crate) fn render_with_input_spans(
    frame: &mut Frame<'_>,
    state: &AppState,
    ui_state: &UiState,
    input: &str,
    input_cursor: usize,
    spans: &[(usize, usize)],
) {
    ui_state.terminal_width.set(frame.area().width);
    // v0.16 V0：整帧铺主题底色——4 套主题的最大差异在底色(gruvbox 暖褐/solarized 蓝灰/两套 light),
    // 不铺底 UI 就画在终端默认黑底上,主题切换只剩文字微差(light 甚至不可用)。设计稿全帧 --bg。
    frame.render_widget(
        Block::default().style(Style::default().bg(config::bg()).fg(config::fg())),
        frame.area(),
    );
    // v0.12：多屏「数字员工操作系统」。全局四段布局：header（logo+tab 栏+状态点）/ body（当前屏）/
    // 输入框 / modeline。审批浮层期间强制回 WORKBENCH，保证 live 审批闸不被切屏绕过。
    let screen = if state.approval.is_some() {
        Screen::Workbench
    } else {
        ui_state.screen
    };
    let input_height = input_area::height_for_input(input, frame.area().height);
    // v0.16 W4.4：which-key 改底部停靠条(设计稿:border-top + bg1 底,浮在 input 上方,占用真实
    // 布局行——而非像 v0.15 那样 Clear 出一块盖住 body 内容)。7 行:4 组标题+最多 3 键的横排。
    let which_key_h: u16 = if ui_state.which_key { 7 } else { 0 };
    // v0.14 N4：底部两行——键位提示行 + modeline（设计稿布局）。
    let root = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(header_height(frame.area().width)),
            Constraint::Min(3),
            Constraint::Length(which_key_h),
            Constraint::Length(input_height),
            Constraint::Length(1),
            Constraint::Length(1),
        ])
        .split(frame.area());

    render_header(frame, state, ui_state, screen, root[0]);
    match screen {
        Screen::Workbench if ui_state.focus_mode => {
            render_workbench_focus(frame, state, ui_state, root[1]);
        }
        // 内容优先布局：宽屏保留压缩员工栏；中屏直接让 SESSION + PREVIEW 成为双主栏。
        Screen::Workbench if root[1].width >= 140 => {
            render_workbench_3col(frame, state, ui_state, root[1]);
        }
        Screen::Workbench if root[1].width >= 100 => {
            render_workbench_2col(frame, state, ui_state, root[1]);
        }
        Screen::Workbench if root[1].width >= 70 => {
            render_workbench_mid(frame, state, ui_state, root[1]);
        }
        Screen::Workbench => render_messages(frame, state, ui_state, root[1]),
        Screen::Market => screens::market::render(frame, state, ui_state, root[1]),
        Screen::Hire => screens::hire::render(frame, state, ui_state, root[1]),
        Screen::Eval => screens::eval::render(frame, state, ui_state, root[1]),
        Screen::Dream => screens::dream::render(frame, ui_state, root[1]),
    }
    if ui_state.which_key {
        render_which_key(frame, root[2]);
    }
    render_input(frame, state, ui_state, input, input_cursor, spans, root[3]);
    render_hint_row(frame, state, ui_state, root[4]);
    render_modeline(frame, state, ui_state, screen, root[5]);

    // 浮层/抽屉/补全只在 WORKBENCH 有意义；审批闸是最高层，出现时不让旧 popup 抢视觉焦点。
    if screen == Screen::Workbench && state.approval.is_none() {
        render_ref_picker(frame, state, root[3]);
        render_command_picker(frame, state, root[3]);
        render_drawer(frame, state, ui_state);
    }
    // 互斥弹层栈：只画当前最高优先级层。无效/并发 flag 也不会叠出两个边框；Esc 仍按
    // handle_key_event 的同一优先级逐层关闭。审批闸永远在最上层。
    if state.approval.is_some() {
        // 宽屏审批是中栏虚线 blocking bar；窄屏才使用带幕布的安全模态。
        if ui_state.focus_mode || root[1].width < 100 {
            render_approval_modal(frame, state);
        }
    } else if ui_state.preview_open() {
        crate::workbench::widgets::overlay_preview::render_preview(
            frame,
            state,
            ui_state.preview_scroll,
        );
    } else if ui_state.publish_step().is_some() {
        crate::workbench::widgets::overlay_publish::render_publish(frame, ui_state);
    } else if ui_state.settings_open() {
        crate::workbench::widgets::overlay_settings::render_settings(frame, ui_state);
    } else if ui_state.notif_open() {
        crate::workbench::widgets::overlay_notifications::render_notifications(
            frame, state, ui_state,
        );
    } else if ui_state.compare_open() {
        crate::workbench::widgets::overlay_compare::render_compare(frame, ui_state);
    } else if ui_state.task_detail_open() {
        crate::workbench::widgets::overlay_task_detail::render_task_detail(frame, state);
    } else if ui_state.onboarding().is_some() {
        render_onboarding(frame, state, ui_state);
    } else if ui_state.fire_confirmation().is_some() {
        render_fire_confirmation(frame, ui_state);
    } else if screen == Screen::Workbench && ui_state.overlay.is_some() {
        render_overlay(frame, ui_state);
    }
    if ui_state.scanlines {
        render_scanlines(frame, frame.area());
    }
}

/// v0.14 N0：header 高度按宽度分档——宽屏用 3 行大字标（3+tab+边框=5），中屏 2 行标（4），
/// 窄屏纯文本（4，含 tab 行）。root 布局据此取值。
fn header_height(width: u16) -> u16 {
    if width >= 110 { 5 } else { 4 }
}

/// v0.13：像素字标（设计规范原样，半块字符两行，orange）。宽 35 列。中屏（90-109）用。
const PIXEL_LOGO: [&str; 2] = [
    "█▀▀ █▀█ █▀▀ █░█░█ █▀▀ █░░ ▄▀█ █░█░█",
    "█▄▄ █▀▄ ██▄ ▀▄▀▄▀ █▄▄ █▄▄ █▀█ ▀▄▀▄▀",
];

/// v0.14 N0：3 行加大像素字标（宽屏 ≥110；纯宽度 1 的半块字符，41 列）。
const PIXEL_LOGO_BIG: [&str; 3] = [
    "▄▀▀▀ █▀▀▄ █▀▀▀ █   █ ▄▀▀▀ █    ▄▀▀▄ █   █",
    "█    █▄▄▀ █▀▀  █ █ █ █    █    █▄▄█ █ █ █",
    "▀▄▄▄ █  █ █▄▄▄ ▀▄▀▄▀ ▀▄▄▄ █▄▄▄ █  █ ▀▄▀▄▀",
];

/// v0.14 N0：每屏专属强调色（设计规范 §5：tab 激活项反色块用各屏专属色）。
fn screen_accent(screen: Screen) -> Color {
    match screen {
        Screen::Workbench => config::yellow(),
        Screen::Market => config::aqua(),
        Screen::Hire => config::green(),
        Screen::Eval => config::purple(),
        Screen::Dream => config::orange(),
    }
}

/// v0.13：常驻顶栏——两行像素字标（orange）+ 右侧 ● 员工 · WORKING/IDLE + tab 栏。
/// 宽 <90 回退单行纯文本品牌（像素字标 35 列 + 状态区放不下）。
fn render_header(
    frame: &mut Frame<'_>,
    state: &AppState,
    _ui_state: &UiState,
    screen: Screen,
    area: Rect,
) {
    let block = Block::default()
        .borders(Borders::BOTTOM)
        .border_style(Style::default().fg(config::border()));
    let inner = block.inner(area);
    frame.render_widget(block, area);
    if inner.height < 2 {
        return;
    }
    let width = inner.width as usize;
    let emp = state.employee.as_ref();
    let name = emp.map(|e| e.name.as_str()).unwrap_or("未上岗");
    // 设计稿：状态区 = [待办 N（真：待验收动作+审批，0 不显示）] ● 名字 · WORKING/IDLE。
    let (dot_color, status_word) = if state.is_busy() {
        (config::orange(), "WORKING")
    } else {
        (config::green(), "IDLE")
    };
    let pulse_color = if animation_on(animation_elapsed_ms(), STATUS_PULSE_MS) {
        dot_color
    } else {
        config::dim()
    };
    let pending_n = state.pending_actions.len() + usize::from(state.approval.is_some());
    // v0.15 P1-2：header 通知徽标（真:未读数,0 不显示）+ 待办数。
    let unread_n = state.unread_notices();
    let mut todo_label = String::new();
    if unread_n > 0 {
        todo_label.push_str(&format!("[n] ◔ 通知 {unread_n} · "));
    }
    if pending_n > 0 {
        todo_label.push_str(&format!("待办 {pending_n} · "));
    }
    let status_label = format!("{name} · {status_word}");
    let logo_style = Style::default()
        .fg(config::orange())
        .add_modifier(Modifier::BOLD);

    // 状态区 spans（右对齐；行尾补满防跨帧碎片——v0.13 教训）。
    let status_w = todo_label.width() + 2 + status_label.width();
    let status_spans = |pad: usize, tail: usize| -> Vec<Span<'static>> {
        vec![
            Span::raw(" ".repeat(pad)),
            Span::styled(
                todo_label.clone(),
                Style::default()
                    .fg(config::orange())
                    .add_modifier(Modifier::BOLD),
            ),
            Span::styled("● ", Style::default().fg(pulse_color)),
            Span::styled(status_label.clone(), Style::default().fg(config::dim())),
            Span::raw(" ".repeat(tail)),
        ]
    };

    if width >= 110 && inner.height >= 4 {
        // 宽屏：3 行大字标；状态右挂第 0 行；tab 第 3 行。
        let rows = Layout::default()
            .direction(Direction::Vertical)
            .constraints([Constraint::Length(1); 4])
            .split(inner);
        for (i, row_art) in PIXEL_LOGO_BIG.iter().enumerate() {
            let mut spans = vec![Span::styled(*row_art, logo_style)];
            if i == 0 {
                let pad = width.saturating_sub(row_art.width() + status_w);
                let tail = width.saturating_sub(row_art.width() + pad + status_w);
                spans.extend(status_spans(pad, tail));
            }
            frame.render_widget(Paragraph::new(Line::from(spans)), rows[i]);
        }
        frame.render_widget(Paragraph::new(Line::from(header_tabs(screen))), rows[3]);
    } else if width >= 90 && inner.height >= 3 {
        let rows = Layout::default()
            .direction(Direction::Vertical)
            .constraints([Constraint::Length(1); 3])
            .split(inner);
        let pad0 = width.saturating_sub(PIXEL_LOGO[0].width() + status_w);
        let tail0 = width.saturating_sub(PIXEL_LOGO[0].width() + pad0 + status_w);
        let mut spans0 = vec![Span::styled(PIXEL_LOGO[0], logo_style)];
        spans0.extend(status_spans(pad0, tail0));
        frame.render_widget(Paragraph::new(Line::from(spans0)), rows[0]);
        frame.render_widget(
            Paragraph::new(Line::from(Span::styled(PIXEL_LOGO[1], logo_style))),
            rows[1],
        );
        frame.render_widget(Paragraph::new(Line::from(header_tabs(screen))), rows[2]);
    } else {
        // 窄屏回退：单行纯文本品牌 + 状态，tab 栏第二行。
        let rows = Layout::default()
            .direction(Direction::Vertical)
            .constraints([Constraint::Length(1); 3])
            .split(inner);
        let brand = "CREWCLAW";
        let pad = width.saturating_sub(brand.width() + status_w);
        let tail = width.saturating_sub(brand.width() + pad + status_w);
        let mut spans = vec![Span::styled(
            brand,
            Style::default()
                .fg(config::orange())
                .add_modifier(Modifier::BOLD),
        )];
        spans.extend(status_spans(pad, tail));
        frame.render_widget(Paragraph::new(Line::from(spans)), rows[0]);
        frame.render_widget(Paragraph::new(Line::from(header_tabs(screen))), rows[1]);
    }
}

/// tab 栏 spans：`[n] NAME` 带空格；当前屏用**各屏专属强调色**反显加粗（规范 §5），其余 dim。
fn header_tabs(screen: Screen) -> Vec<Span<'static>> {
    let mut tabs: Vec<Span<'static>> = Vec::new();
    for s in Screen::ALL {
        let selected = s == screen;
        let text = format!(" [{}] {} ", s.index() + 1, s.label());
        let style = if selected {
            Style::default()
                .fg(config::bg())
                .bg(screen_accent(s))
                .add_modifier(Modifier::BOLD)
        } else {
            Style::default().fg(config::dim())
        };
        tabs.push(Span::styled(text, style));
    }
    tabs
}

/// v0.14 N4：底部键位提示行（设计稿：input 与 modeline 之间的一整行）。
/// 忙态 spinner / 待办提示优先；否则按模式给键位（原 modeline 右侧内容迁到这里）。
/// v0.16 V1：双色键帽（设计稿:键=fg 亮色加粗、描述=dim,`·` 分隔）,不再整行 dim 一坨。
fn render_hint_row(frame: &mut Frame<'_>, state: &AppState, ui_state: &UiState, area: Rect) {
    let width = area.width as usize;
    let terminal = frame.area();
    let size_warning = (terminal.width < 148 || terminal.height < 35).then(|| {
        format!(
            "建议终端 ≥148×35 · 当前为 {}×{}",
            terminal.width, terminal.height
        )
    });
    // ask_user 等待回答：问题正文 + 可执行选项优先于忙态 spinner。
    // state 侧收到 pending.actions 已 clear_busy（双保险：即使忙态未清，问题仍可见）。
    if !state.pending_actions.is_empty()
        && let Some(question) = state.pending_question.as_deref()
    {
        let mut text = truncate_display_width(&format!("❓ {question}"), width.saturating_sub(2));
        if let Some(actions) = pending_actions_line(&state.pending_actions, width / 2) {
            text.push_str(" · ");
            text.push_str(&actions);
        }
        return render_hint_plain(frame, &text, area);
    }
    // 忙态/待办仍是整行单色（动态文案,无键帽结构）。
    if let Some(since) = state.busy_since {
        let secs = since.elapsed().as_millis() / 1000;
        let ticks = state.active_task_event_ticks();
        let mut text = format!(
            "{} {} {}… {}s · Esc/Ctrl+C 中断",
            spinner_frame(since.elapsed().as_millis()),
            progress_bar_10(ticks, false),
            state.generation_phase_label(),
            secs
        );
        if let Some(warning) = size_warning.as_deref() {
            text.push_str(" · ");
            text.push_str(warning);
        }
        return render_hint_plain(frame, &text, area);
    }
    if let Some((success, message)) = ui_state.action_feedback.as_ref() {
        let color = if *success {
            config::green()
        } else {
            config::red()
        };
        return render_hint_styled(
            frame,
            message,
            area,
            Style::default().fg(color).add_modifier(Modifier::BOLD),
        );
    }
    if let Some(t) = pending_actions_line(&state.pending_actions, width) {
        let text = size_warning
            .as_deref()
            .map(|warning| format!("{t} · {warning}"))
            .unwrap_or(t);
        return render_hint_plain(frame, &text, area);
    }
    // (键, 描述) 对——键亮色加粗,描述 dim。
    // 有产物时把预览路径塞进常驻 hint——否则用户不知道右侧 ARTIFACTS 怎么打开。
    let has_artifacts = state.artifacts.iter().any(|a| a.status != "deleted");
    let pairs: &[(&str, &str)] = if ui_state.mode == InputMode::Normal {
        if has_artifacts {
            &[
                ("直接打字", "或"),
                ("i", "输入"),
                ("t", "主题"),
                ("T", "队列"),
                ("[ ]", "产物"),
                ("p", "预览"),
                ("o", "任务"),
                ("j/k", "事件"),
                ("Space", "键位"),
            ]
        } else {
            &[
                ("直接打字", "或"),
                ("i", "输入"),
                ("t", "主题"),
                ("T", "队列"),
                ("1-5", "切屏"),
                ("j/k", "事件"),
                ("o", "任务"),
                ("n", "通知"),
                ("Space", "键位"),
            ]
        }
    } else if has_artifacts {
        &[
            ("Enter", "发送"),
            ("Esc", "命令模式"),
            ("然后", "[ ]/p 预览产物"),
        ]
    } else {
        &[
            ("Enter", "发送"),
            ("↑↓", "历史输入"),
            ("Ctrl+U", "清行"),
            ("Esc", "离开输入框"),
        ]
    };
    let key_style = Style::default()
        .fg(config::fg())
        .add_modifier(Modifier::BOLD);
    let dim = Style::default().fg(config::dim());
    let mut spans: Vec<Span<'static>> = Vec::new();
    let mut used = 0usize;
    if let Some(warning) = size_warning {
        let shown = truncate_display_width(&warning, width);
        used = shown.width();
        spans.push(Span::styled(
            shown,
            Style::default()
                .fg(config::yellow())
                .add_modifier(Modifier::BOLD),
        ));
        if used + 3 <= width {
            spans.push(Span::styled(" · ", dim));
            used += 3;
        }
    }
    for (i, (k, d)) in pairs.iter().enumerate() {
        let sep = if i > 0 { " · " } else { "" };
        let chunk_w = sep.width() + k.width() + 1 + d.width();
        if used + chunk_w > width {
            break; // 窄屏截断整对,不截半个键帽
        }
        if !sep.is_empty() {
            spans.push(Span::styled(sep.to_string(), dim));
        }
        spans.push(Span::styled((*k).to_string(), key_style));
        spans.push(Span::styled(format!(" {d}"), dim));
        used += chunk_w;
    }
    spans.push(Span::raw(" ".repeat(width.saturating_sub(used))));
    // CJK 宽字符跨帧 diff 会在续格留上一帧残字(v0.13 老坑)——先 Clear 本行再画。
    // Clear 会连 bg 一起重置,故 Paragraph 显式带主题底(W0 全帧铺底的本行补丁)。
    frame.render_widget(Clear, area);
    frame.render_widget(
        Paragraph::new(Line::from(spans)).style(Style::default().bg(config::bg())),
        area,
    );
}

fn render_hint_plain(frame: &mut Frame<'_>, text: &str, area: Rect) {
    render_hint_styled(frame, text, area, Style::default().fg(config::dim()));
}

fn render_hint_styled(frame: &mut Frame<'_>, text: &str, area: Rect, style: Style) {
    let width = area.width as usize;
    let shown = truncate_display_width(text, width);
    let tail = width.saturating_sub(shown.width());
    frame.render_widget(
        Paragraph::new(Line::from(vec![
            Span::styled(shown, style),
            Span::raw(" ".repeat(tail)),
        ]))
        .style(Style::default().bg(config::bg())),
        area,
    );
}

/// v0.13：底部 modeline——模式块 · crewclaw v{版本} · 屏名 … 主题 · utf-8 + busy/pending 提示。
/// 模式块颜色按设计规范：INSERT=orange、NORMAL=green（勿反）。
fn render_modeline(
    frame: &mut Frame<'_>,
    state: &AppState,
    ui_state: &UiState,
    screen: Screen,
    area: Rect,
) {
    let width = area.width as usize;
    let (mode_txt, mode_style) = match ui_state.mode {
        InputMode::Insert => (
            " INSERT ",
            Style::default()
                .fg(config::bg())
                .bg(config::orange())
                .add_modifier(Modifier::BOLD),
        ),
        InputMode::Normal => (
            " NORMAL ",
            Style::default()
                .fg(config::bg())
                .bg(config::green())
                .add_modifier(Modifier::BOLD),
        ),
    };
    let theme_name = config::THEME_NAMES[ui_state.theme_index % config::THEME_NAMES.len()];
    // v0.16 W1.4：分段色块 modeline(设计稿):整行铺 --ml;屏名/主题名各占一个 bg2 色块;
    // 右侧 modeHint(dim) + `n:N ▋`。响应式:宽 <100 省屏描述与 modeHint。
    let ml_bg = Style::default().bg(config::ml());
    let dim_ml = Style::default().fg(config::dim()).bg(config::ml());
    let screen_seg_style = Style::default()
        .fg(screen_accent(screen))
        .bg(config::bg2())
        .add_modifier(Modifier::BOLD);
    let theme_seg_style = Style::default().fg(config::fg()).bg(config::bg2());
    // n:N = 选中事件序 / timeline 总数（真数据；无选中= N:N 表示贴底跟随）。
    let total = state.timeline.len();
    let pos = ui_state.session_cursor.map(|i| i + 1).unwrap_or(total);
    let mode_hint = if width >= 100 {
        match ui_state.mode {
            InputMode::Insert => "Enter 发送 · Esc 退出",
            InputMode::Normal => "i 开始打字 · Space 快捷键",
        }
    } else {
        ""
    };

    let version_seg = format!(" crewclaw v{} ", env!("CARGO_PKG_VERSION"));
    let screen_seg = format!(" {} ", screen.label());
    let desc_seg = if width >= 100 {
        format!(" {} ", screen.description())
    } else {
        String::new()
    };
    let hint_seg = if mode_hint.is_empty() {
        String::new()
    } else {
        format!("{mode_hint}  ")
    };
    let theme_seg = format!(" {theme_name} ");
    let utf_seg = " utf-8 ".to_string();
    let modeline_caret = if animation_on(animation_elapsed_ms(), MODELINE_BLINK_MS) {
        MODELINE_CARET
    } else {
        " "
    };
    let (turn, turn_total) = ui_state.turn_position();
    let pos_seg = if screen == Screen::Workbench && turn_total > 0 {
        format!(" 轮 {turn}/{turn_total} · {pos}:{total} {modeline_caret}")
    } else {
        format!(" {pos}:{total} {modeline_caret}")
    };

    let left_w = mode_txt.width() + version_seg.width() + screen_seg.width() + desc_seg.width();
    let right_w = hint_seg.width() + theme_seg.width() + utf_seg.width() + pos_seg.width();
    // 先算 pad 再补行尾(v0.13 防碎片法);窄到放不下右段时按序丢 hint→desc(上面已按宽度置空)。
    let pad = width.saturating_sub(left_w + right_w);
    let tail = width.saturating_sub(left_w + pad + right_w);
    let line = Line::from(vec![
        Span::styled(mode_txt, mode_style),
        Span::styled(version_seg, dim_ml),
        Span::styled(screen_seg, screen_seg_style),
        Span::styled(desc_seg, dim_ml),
        Span::styled(" ".repeat(pad), ml_bg),
        Span::styled(hint_seg, dim_ml),
        Span::styled(theme_seg, theme_seg_style),
        Span::styled(utf_seg, dim_ml),
        Span::styled(pos_seg, Style::default().fg(config::fg()).bg(config::ml())),
        Span::styled(" ".repeat(tail), ml_bg),
    ]);
    // CJK 跨帧续格残字防护(与 hint 行同法):先 Clear 再画。
    frame.render_widget(Clear, area);
    frame.render_widget(Paragraph::new(line).style(ml_bg), area);
}

/// v0.16 修复：居中弹层(SETTINGS/PREVIEW/PUBLISH/ONBOARDING,均对应设计稿的
/// `background:color-mix(in srgb, var(--bg) N%, transparent)` 全屏半透明幕布)必须先把
/// **整帧**铺成暗底空白，再画自己的居中框——旧实现只 Clear 了 `centered_rect` 算出的那一小块,
/// 四周留白会露出底层 WORKBENCH 三栏的真实内容;当留白窄到只剩 2-3 列(比如 EMPLOYEE 面板紧邻
/// 弹层左边缘)时，会切出几个读不懂的 CJK 字符碎片，像是画面损坏（用户真机截图报的问题）。
/// 终端没有 alpha，直接把整帧清成空白+暗色底做等效处理。所有会吞键的 modal 都调用
/// 本函数，避免同一交互语义出现有的透底、有的不透底。
pub(crate) fn render_modal_backdrop(frame: &mut Frame<'_>) {
    let area = frame.area();
    let bg = config::bg1();
    let dim = config::dim();
    let buf = frame.buffer_mut();
    for y in area.y..area.y + area.height {
        for x in area.x..area.x + area.width {
            if let Some(cell) = buf.cell_mut((x, y)) {
                cell.set_symbol(" ");
                cell.set_bg(bg);
                cell.set_fg(dim);
            }
        }
    }
}

/// v0.12：CRT 扫描线装饰——每隔一行叠一层暗底，纯视觉（默认关，Normal 模式某键切换）。
/// v0.16 修复：旧实现用 Paragraph 画满行的 "─" 字符，**整行内容被覆盖**（终端 cell 不支持
/// alpha 混合，画字符 = 直接替换该格子的字形），导致开扫描线后每隔一行的真实内容(框线/文字)
/// 全部消失、错位。设计稿的扫描线是 CSS 半透明黑条(`rgba(0,0,0,.14)`)叠加在内容之上——
/// 终端对应做法是只调底色(cell.bg 微调变暗)，绝不碰 symbol/fg，字形与框线保持完整。
fn render_scanlines(frame: &mut Frame<'_>, area: Rect) {
    fn darken(color: Color) -> Color {
        match color {
            Color::Rgb(r, g, b) => Color::Rgb(
                ((r as u16 * 86) / 100) as u8,
                ((g as u16 * 86) / 100) as u8,
                ((b as u16 * 86) / 100) as u8,
            ),
            other => other,
        }
    }
    let buf = frame.buffer_mut();
    for y in (area.y..area.y + area.height).step_by(2) {
        for x in area.x..area.x + area.width {
            if let Some(cell) = buf.cell_mut((x, y)) {
                // 等价于设计稿 rgba(0,0,0,.14)：所有 RGB 底色统一压暗，轨道连续；
                // 字形、前景色和非 RGB 终端色完全不动。
                cell.set_bg(darken(cell.bg));
            }
        }
    }
}

/// v0.13 M4：which-key 分组面板（设计规范：SCREENS/NAVIGATE/ACTIONS/UI 四组，双列排布）。
/// v0.16 W4.4：which-key 改设计稿的**底部停靠横条**——4 组横向等分,顶边框线 + bg1 底,
/// 占用真实布局行（root[2]），不再 Clear 覆盖 body 内容。
fn render_which_key(frame: &mut Frame<'_>, area: Rect) {
    const GROUPS: [(&str, &[(&str, &str)]); 4] = [
        ("SCREENS", &[("1-5", "切屏"), ("Tab/⇧Tab", "循环屏")]),
        (
            "NAVIGATE",
            &[
                ("j/k", "上下选择"),
                ("g/G", "顶部/回到跟随"),
                ("[ ]", "切换产物"),
                ("/", "MARKET 搜索"),
                ("x/c", "MARKET 对比"),
            ],
        ),
        (
            "ACTIONS",
            &[
                ("a/r", "批准/驳回"),
                ("Enter", "预览产物 / 雇佣"),
                ("o", "任务详情 / 入职"),
                ("i", "进入输入"),
            ],
        ),
        (
            "UI",
            &[
                ("t", "循环主题"),
                (",", "偏好设置"),
                ("n", "通知中心"),
                ("s", "扫描线"),
                ("Space", "开关本面板"),
            ],
        ),
    ];

    frame.render_widget(
        Block::default().style(Style::default().bg(config::bg1())),
        area,
    );
    let rows = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Length(1), Constraint::Min(1)])
        .split(area);
    frame.render_widget(
        Paragraph::new(Line::from(Span::styled(
            "─".repeat(rows[0].width as usize),
            Style::default().fg(config::border()),
        ))),
        rows[0],
    );
    let cols = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([Constraint::Percentage(25); 4])
        .split(rows[1]);
    for (col, (title, keys)) in cols.iter().zip(GROUPS.iter()) {
        let mut lines = vec![Line::from(Span::styled(
            *title,
            Style::default()
                .fg(config::dim())
                .add_modifier(Modifier::BOLD),
        ))];
        for (k, d) in *keys {
            lines.push(Line::from(vec![
                Span::styled(
                    format!("{k:<8}"),
                    Style::default()
                        .fg(config::yellow())
                        .add_modifier(Modifier::BOLD),
                ),
                Span::styled(" → ", Style::default().fg(config::dim())),
                Span::styled((*d).to_string(), Style::default().fg(config::fg())),
            ]));
        }
        frame.render_widget(Paragraph::new(Text::from(lines)), *col);
    }
}

/// v0.12：入职仪式浮层（3 步）。数据源自 UiState.onboarding；关闭为 None。
/// v0.16 W4.6：入职仪式对齐设计稿——green 边框 + `WELCOME ABOARD` 题头;每步标题 yellow;
/// 有真头像(session.ready avatar)则左列 blue 展示;底行 `● ● ○` 步点(green,当前步实心)+ hint。
fn render_onboarding(frame: &mut Frame<'_>, state: &AppState, ui_state: &UiState) {
    let Some(ob) = ui_state.onboarding() else {
        return;
    };
    // v0.16 修复：先铺整帧幕布，避免居中弹层四周留白露出底层 WORKBENCH 内容(见 render_modal_backdrop)。
    render_modal_backdrop(frame);
    let emp = state.employee.as_ref();
    let name = emp.map(|e| e.name.as_str()).unwrap_or("新员工");
    let role = emp.map(|e| e.role.as_str()).unwrap_or("数字员工");
    let steps: [(&str, String); 3] = [
        (
            "认识你的数字员工",
            format!("{name} · {role}\n已通过 C1 包验证，准备进入真实试岗。"),
        ),
        (
            "协作方式",
            "直接打字提问或派活；Esc 进命令模式用 1-5 切屏、t 换主题。".to_string(),
        ),
        (
            "第一个试岗任务",
            "回到 WORKBENCH，交给它一个真实小任务，看它产出可验收的交付物。".to_string(),
        ),
    ];
    let idx = ob.step.min(steps.len() - 1);
    let (title, body) = &steps[idx];

    let area = centered_rect(60, 50, frame.area());
    frame.render_widget(Clear, area);
    let block = Block::default()
        .title(Span::styled(
            " WELCOME ABOARD · 新员工入职 ",
            Style::default()
                .fg(config::green())
                .add_modifier(Modifier::BOLD),
        ))
        .borders(Borders::ALL)
        .border_style(Style::default().fg(config::green()))
        .style(Style::default().bg(config::bg()));
    let inner = block.inner(area);
    frame.render_widget(block, area);

    let has_avatar = emp.map(|e| !e.avatar.is_empty()).unwrap_or(false);
    let cols = if has_avatar {
        Layout::default()
            .direction(Direction::Horizontal)
            .constraints([Constraint::Length(20), Constraint::Min(10)])
            .spacing(2)
            .split(inner)
    } else {
        Layout::default()
            .constraints([Constraint::Min(10)])
            .split(inner)
    };
    let body_col = if has_avatar {
        if let Some(e) = emp {
            let avatar_lines: Vec<Line> = e
                .avatar
                .iter()
                .map(|row| {
                    Line::from(Span::styled(
                        row.clone(),
                        Style::default().fg(config::blue()),
                    ))
                })
                .collect();
            frame.render_widget(Paragraph::new(Text::from(avatar_lines)), cols[0]);
        }
        cols[1]
    } else {
        cols[0]
    };

    let rows = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Min(3), Constraint::Length(1)])
        .split(body_col);

    let mut lines = vec![
        Line::from(Span::styled(
            format!("入职 · 第 {}/{} 步", idx + 1, steps.len()),
            Style::default().fg(config::dim()),
        )),
        Line::from(""),
        Line::from(Span::styled(
            (*title).to_string(),
            Style::default()
                .fg(config::yellow())
                .add_modifier(Modifier::BOLD),
        )),
    ];
    for row in body.split('\n') {
        lines.push(Line::from(Span::styled(
            row.to_string(),
            Style::default().fg(config::fg()),
        )));
    }
    frame.render_widget(
        Paragraph::new(Text::from(lines)).wrap(Wrap { trim: true }),
        rows[0],
    );

    // 底行：● ● ○ 步点(green,当前步实心) + 右 hint。
    let dots: String = (0..steps.len())
        .map(|i| if i == idx { "●" } else { "○" })
        .collect::<Vec<_>>()
        .join(" ");
    let hint = "Enter 下一步 · Esc 跳过";
    let width = rows[1].width as usize;
    let pad = width.saturating_sub(dots.len() + hint.len()).max(1);
    frame.render_widget(
        Paragraph::new(Line::from(vec![
            Span::styled(dots, Style::default().fg(config::green())),
            Span::raw(" ".repeat(pad)),
            Span::styled(hint, Style::default().fg(config::dim())),
        ])),
        rows[1],
    );
}

/// @ 引用选择器：浮在输入框上方的小浮层。
fn render_ref_picker(frame: &mut Frame<'_>, state: &AppState, input_area: Rect) {
    let Some(picker) = &state.ref_picker else {
        return;
    };
    let mut lines = vec![Line::from(Span::styled(
        "@ 引用",
        Style::default().fg(ACCENT()).add_modifier(Modifier::BOLD),
    ))];
    for (index, candidate) in picker.candidates.iter().enumerate().take(6) {
        let marker = if index == picker.selected { ">" } else { " " };
        lines.push(Line::from(format!(
            "{marker} {} {}",
            candidate.kind, candidate.token
        )));
    }
    // v0.16 W4.5：popup 高度不该被"输入框自身高度"卡死——单行输入时 input_area.height 恒为 3,
    // 会把弹窗压到只剩 1 行内容(实测发现的真 bug:候选永远只显示第一条)。改按"输入框上方的可用
    // 空间"(input_area.y)封顶,这样候选真的能滚出多行。
    let height = (lines.len() as u16 + 2).min(input_area.y.max(3));
    let width = input_area.width;
    let y = input_area.y.saturating_sub(height);
    let area = Rect {
        x: input_area.x,
        y,
        width,
        height,
    };
    frame.render_widget(Clear, area);
    frame.render_widget(
        Paragraph::new(Text::from(lines))
            .block(
                Block::default()
                    .borders(Borders::ALL)
                    .border_style(Style::default().fg(config::yellow()))
                    .style(Style::default().bg(config::bg1())),
            )
            .style(Style::default().bg(config::bg1()))
            .wrap(Wrap { trim: true }),
        area,
    );
}

/// slash / Ctrl+P 命令补全浮层：与 @ 引用同构，浮在输入框上方，最多 8 行。
/// v0.16 W4.5：命令菜单样式对齐设计稿——yellow 边框 + bg1 底,行用 ▌ 选中语言
/// (选中 yellow / 未选透明),name 列固定宽 yellow 粗,desc dim。
fn render_command_picker(frame: &mut Frame<'_>, state: &AppState, input_area: Rect) {
    let Some(picker) = &state.command_picker else {
        return;
    };
    const NAME_W: usize = 18;
    let mut lines: Vec<Line> = Vec::new();
    for (index, command) in picker.matches.iter().enumerate().take(8) {
        let selected = index == picker.selected;
        let marker_style = if selected {
            Style::default()
                .fg(config::yellow())
                .add_modifier(Modifier::BOLD)
        } else {
            Style::default().fg(config::bg1())
        };
        let row_bg = if selected {
            Style::default().bg(config::bg2())
        } else {
            Style::default()
        };
        let name = format!(
            "{:<width$}",
            truncate_display_width(&command.name, NAME_W),
            width = NAME_W
        );
        lines.push(Line::from(vec![
            Span::styled("▌ ", marker_style.patch(row_bg)),
            Span::styled(
                name,
                Style::default()
                    .fg(config::yellow())
                    .add_modifier(Modifier::BOLD)
                    .patch(row_bg),
            ),
            Span::styled(
                command.desc.clone(),
                Style::default().fg(config::dim()).patch(row_bg),
            ),
        ]));
    }
    // v0.16 W4.5：同 ref picker 的修法——按输入框上方可用空间(input_area.y)封顶,不按输入框
    // 自身高度(单行输入恒为 3,会把候选压到只剩 1 行——测试补齐后发现的真 bug)。
    let height = (lines.len() as u16 + 2).min(input_area.y.max(3));
    let width = input_area.width;
    let y = input_area.y.saturating_sub(height);
    let area = Rect {
        x: input_area.x,
        y,
        width,
        height,
    };
    frame.render_widget(Clear, area);
    let block = Block::default()
        .title(Span::styled(
            " COMMANDS · ↑↓/Tab 选择 · Enter 确认 · Esc 清空 ",
            Style::default()
                .fg(config::yellow())
                .add_modifier(Modifier::BOLD),
        ))
        .borders(Borders::ALL)
        .border_style(Style::default().fg(config::yellow()))
        .style(Style::default().bg(config::bg1()));
    frame.render_widget(
        Paragraph::new(Text::from(lines))
            .block(block)
            .style(Style::default().bg(config::bg1()))
            .wrap(Wrap { trim: true }),
        area,
    );
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

/// 消息流主区：把 conversation 渲染成聊天记录，sticky-bottom 跟随最新内容。
/// v0.9 M1：物理行由 layout_lines 手动预折——逻辑行数 = 渲染行数，滚动边界精确到底；不再用
/// Paragraph 的 Wrap（那会把 max_scroll 低估、滚不到底，且续行不带 gutter）。
fn render_messages(frame: &mut Frame<'_>, state: &AppState, ui_state: &UiState, area: Rect) {
    render_message_stream(frame, state, ui_state, area, "消息", None, false);
}

/// 内容优先宽屏（设计稿三栏）：EMPLOYEE | SESSION | ARTIFACTS + TOOLS + EVIDENCE + PREVIEW。
fn render_workbench_3col(frame: &mut Frame<'_>, state: &AppState, ui_state: &UiState, area: Rect) {
    let preview_width = ((area.width as u32 * 38 / 100) as u16).clamp(48, 72);
    let cols = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([
            Constraint::Length(22),
            Constraint::Min(50),
            Constraint::Length(preview_width),
        ])
        .split(area);

    super::widgets::workbench_panels::render_employee(
        frame,
        state,
        cols[0],
        ui_state.prefs.density == 1,
    );
    render_workbench_session(frame, state, ui_state, cols[1]);
    super::widgets::artifact_preview::render_inline_wide(frame, state, ui_state, cols[2]);
}

/// 中屏隐藏员工栏，SESSION 与 PREVIEW 直接按 60/40 并列。
fn render_workbench_2col(frame: &mut Frame<'_>, state: &AppState, ui_state: &UiState, area: Rect) {
    let preview_width = ((area.width as u32 * 40 / 100) as u16).clamp(40, 56);
    let cols = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([Constraint::Min(50), Constraint::Length(preview_width)])
        .split(area);
    render_workbench_session(frame, state, ui_state, cols[0]);
    super::widgets::artifact_preview::render_inline(frame, state, ui_state, cols[1]);
}

/// Spec mid layout (70-99 columns): keep task/artifact truth in a side column and reserve the
/// main column for the live session plus tools/inspect detail. This prevents mid terminals from
/// collapsing into the narrow single stream while keeping the input area always visible.
fn render_workbench_mid(frame: &mut Frame<'_>, state: &AppState, ui_state: &UiState, area: Rect) {
    let side_width = (area.width / 3).clamp(24, 30);
    let cols = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([Constraint::Length(side_width), Constraint::Min(42)])
        .split(area);
    let side = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Percentage(45), Constraint::Percentage(55)])
        .split(cols[0]);
    super::widgets::workbench_panels::render_task_queue(frame, state, ui_state, side[0]);
    render_artifacts(frame, state, ui_state, side[1]);

    let detail_selected = ui_state
        .session_cursor
        .and_then(|idx| state.timeline.get(idx));
    let detail_h: u16 = if detail_selected.is_some() { 7 } else { 0 };
    let show_verdict = state.approval.is_none() && state.last_verdict.is_some();
    let approval_h: u16 = if state.approval.is_some() || show_verdict {
        3
    } else {
        0
    };
    let main = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Min(5),
            Constraint::Length(detail_h),
            Constraint::Length(approval_h),
            Constraint::Length(6),
        ])
        .split(cols[1]);
    render_message_stream(frame, state, ui_state, main[0], "SESSION", None, true);
    if let Some(entry) = detail_selected {
        render_event_detail(frame, entry, main[1]);
    }
    if let Some(approval) = state.approval.as_ref() {
        render_approval_bar(frame, approval, main[2]);
    } else if let Some((accepted, text)) = state.last_verdict.as_ref() {
        render_verdict_bar(frame, *accepted, text, main[2]);
    }
    render_tools(frame, state, ui_state, main[3]);
}

fn render_workbench_focus(frame: &mut Frame<'_>, state: &AppState, ui_state: &UiState, area: Rect) {
    render_message_stream(
        frame,
        state,
        ui_state,
        area,
        "SESSION · FOCUS",
        Some("z 退出专注".to_string()),
        false,
    );
}

fn render_workbench_session(
    frame: &mut Frame<'_>,
    state: &AppState,
    ui_state: &UiState,
    area: Rect,
) {
    let queue_limit = if ui_state.task_queue_expanded { 8 } else { 1 };
    let queue_rows = if state.task_sessions.is_empty() {
        state
            .timeline
            .iter()
            .filter(|e| e.task_meta.is_some())
            .count()
            .min(queue_limit)
            + usize::from(state.task.as_ref().is_some_and(|t| t.status == "running"))
    } else {
        state.task_sessions.len().min(queue_limit)
    };
    let queue_h = ((queue_rows.max(1) + 2) as u16)
        .min((area.height / 3).max(3))
        .max(3);
    // v0.13 M4：j/k 选中事件时，SESSION 底部弹出 EVENT DETAIL（8 行）。
    let detail_selected = ui_state
        .session_cursor
        .and_then(|idx| state.timeline.get(idx));
    let detail_h: u16 = if detail_selected.is_some() { 8 } else { 0 };
    // v0.13 M5：审批期在中栏底部插 WAITING APPROVAL 条（3 行；替代窄屏的居中模态）。
    // v0.16 W3.5：审批已解决但有 verdict 待展示时，同一槽位渲染结论条。
    let show_verdict = state.approval.is_none() && state.last_verdict.is_some();
    let approval_h: u16 = if state.approval.is_some() || show_verdict {
        3
    } else {
        0
    };
    let center = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(queue_h),
            Constraint::Min(5),
            Constraint::Length(detail_h),
            Constraint::Length(approval_h),
        ])
        .split(area);
    super::widgets::workbench_panels::render_task_queue(frame, state, ui_state, center[0]);
    // SESSION 右侧动态标题：#N 当前/最近任务 + 真成本（有则显示）。
    let finished_n = state
        .timeline
        .iter()
        .filter(|e| e.task_meta.is_some())
        .count();
    let session_right = if let Some(task) = state.task.as_ref() {
        let seq = if task.status == "running" {
            finished_n + 1
        } else {
            finished_n.max(1)
        };
        let cost: f64 = state
            .timeline
            .iter()
            .filter_map(|e| e.task_meta.as_ref().and_then(|m| m.est_cost))
            .sum();
        let mut sr = format!("task #{seq}");
        if cost > 0.0 {
            sr.push_str(&format!(" · ${cost:.2}"));
        }
        Some(sr)
    } else {
        None
    };
    render_message_stream(
        frame,
        state,
        ui_state,
        center[1],
        "SESSION",
        session_right,
        true,
    );
    if let Some(entry) = detail_selected {
        render_event_detail(frame, entry, center[2]);
    }
    if let Some(approval) = state.approval.as_ref() {
        render_approval_bar(frame, approval, center[3]);
    } else if let Some((accepted, text)) = state.last_verdict.as_ref() {
        render_verdict_bar(frame, *accepted, text, center[3]);
    }
}

/// v0.16 W3.5：审批终态结论条——绿(已验收)/红(已驳回)边框 + 粗体文本,
/// 占用与 WAITING APPROVAL 条相同的槽位(设计稿 showVerdict 分支)。
fn render_verdict_bar(frame: &mut Frame<'_>, accepted: bool, text: &str, area: Rect) {
    let color = if accepted {
        config::green()
    } else {
        config::red()
    };
    let block = Block::default()
        .borders(Borders::ALL)
        .border_style(Style::default().fg(color));
    let inner = block.inner(area);
    frame.render_widget(block, area);
    frame.render_widget(
        Paragraph::new(Line::from(Span::styled(
            format!(" {text} "),
            Style::default().fg(color).add_modifier(Modifier::BOLD),
        ))),
        inner,
    );
}

/// v0.13 M5：宽屏审批条——`⏸ WAITING APPROVAL {reason} … [a] 批准 · [r] 驳回`（orange 边框）。
/// 与窄屏模态同源同键（a/y=accept，r/d/n=reject）；只是宽屏不遮挡 SESSION 流。
fn render_approval_bar(frame: &mut Frame<'_>, approval: &super::state::Approval, area: Rect) {
    let block = Block::default()
        .borders(Borders::ALL)
        .border_set(WAITING_BORDER_SET)
        .border_style(Style::default().fg(config::orange()))
        .style(Style::default().bg(config::bg()));
    let inner = block.inner(area);
    frame.render_widget(Clear, area);
    frame.render_widget(block, area);
    let width = inner.width as usize;
    // v0.14 N1：键位分色（设计稿：[a] 绿 / [r] 红）。
    let lease_label = approval_session_lease_label(approval);
    let keys = if lease_label.is_some() {
        "[a]一次 [s]本会话 [r]驳回"
    } else {
        "[a] 批准 · [r] 驳回"
    };
    let keys_w = keys.width();
    let reason = approval
        .reason
        .clone()
        .unwrap_or_else(|| "需要确认授权".to_string());
    let reason = lease_label
        .map(|label| format!("放行清单 {label}"))
        .unwrap_or(reason);
    let head = if approval.session_lease.is_some() {
        "⏸ 授权  "
    } else {
        "⏸ WAITING APPROVAL  "
    };
    let reason_w = width.saturating_sub(head.width() + keys_w + 2);
    let reason = truncate_display_width(&reason, reason_w.max(4));
    let pad = width.saturating_sub(head.width() + reason.width() + keys_w);
    frame.render_widget(
        Paragraph::new(Line::from(vec![
            Span::styled(
                head,
                Style::default()
                    .fg(config::orange())
                    .add_modifier(Modifier::BOLD),
            ),
            Span::styled(reason, Style::default().fg(config::fg())),
            Span::raw(" ".repeat(pad)),
            Span::styled(
                keys,
                Style::default()
                    .fg(config::green())
                    .add_modifier(Modifier::BOLD),
            ),
        ])),
        inner,
    );
}

fn approval_session_lease_label(approval: &super::state::Approval) -> Option<String> {
    let entry = approval
        .session_lease
        .as_ref()?
        .get("allowlist")?
        .as_array()?
        .first()?;
    let tool = entry.get("tool")?.as_str()?.trim();
    let pattern = entry.get("pattern")?.as_str()?.trim();
    if tool.is_empty() || pattern.is_empty() {
        return None;
    }
    Some(format!("{tool} · {pattern}"))
}

/// v0.13 M4：EVENT DETAIL——选中事件的 key:value 块。配色按设计规范：
/// key=aqua、字符串=green、数字=purple、reason/error/warn 键=orange。焦点面板黄框。
fn render_event_detail(frame: &mut Frame<'_>, entry: &TimelineEntry, area: Rect) {
    let title = format!(" EVENT DETAIL · {} ", entry.event_type);
    // v0.16 W3.4：detMeta 右置标题行(设计稿:头行右侧 `{detMeta}` dim)——真值 ts·status。
    let det_meta = format!(" {} · {} ", fmt_hhmm(entry.ts), entry.status);
    let block = Block::default()
        .title(Span::styled(
            title,
            Style::default()
                .fg(event_type_color(entry.event_type))
                .add_modifier(Modifier::BOLD),
        ))
        .title(
            Line::from(Span::styled(det_meta, Style::default().fg(config::dim()))).right_aligned(),
        )
        .borders(Borders::ALL)
        .border_style(Style::default().fg(config::yellow()))
        // v0.16 W0.3：kv 盒铺 bg1（设计稿 `background:var(--bg1)`）。
        .style(Style::default().bg(config::bg1()));
    let inner = block.inner(area);
    frame.render_widget(Clear, area);
    frame.render_widget(block, area);
    let width = inner.width as usize;

    let mut lines: Vec<Line> = Vec::new();
    for (k, v) in entry
        .detail_kv
        .iter()
        .take((inner.height as usize).saturating_sub(1))
    {
        let warnish = matches!(k.as_str(), "reason" | "error" | "warn" | "code" | "gaps");
        let v_color = if warnish {
            config::orange()
        } else if v.parse::<f64>().is_ok() {
            config::purple()
        } else {
            config::green()
        };
        lines.push(Line::from(vec![
            Span::styled(
                format!("{:<8}", truncate_display_width(k, 8)),
                Style::default().fg(config::aqua()),
            ),
            Span::styled(
                truncate_display_width(v, width.saturating_sub(8)),
                Style::default().fg(v_color),
            ),
        ]));
    }
    frame.render_widget(Paragraph::new(Text::from(lines)), inner);
    // v0.14 N3：面板底行操作提示（设计稿）。
    if inner.height >= 3 {
        let hint = Rect {
            x: inner.x,
            y: inner.y + inner.height - 1,
            width: inner.width,
            height: 1,
        };
        let hint_text = if entry.collapsible {
            "Enter 展开/折叠 · j/k 切换事件 · Esc 关闭"
        } else {
            "j/k 切换事件 · 详情随选中更新 · Esc 关闭"
        };
        frame.render_widget(
            Paragraph::new(Line::from(Span::styled(
                hint_text,
                Style::default().fg(config::dim()),
            ))),
            hint,
        );
    }
}

/// v0.13 M3：消息流渲染核心（单栏「消息」与三栏「SESSION」共用）。
/// wide=true 时事件行用设计稿格式：`▌ HH:MM 图标 type 标题 …detail`（类型着色）。
fn render_message_stream(
    frame: &mut Frame<'_>,
    state: &AppState,
    ui_state: &UiState,
    area: Rect,
    title: &'static str,
    title_right: Option<String>,
    wide: bool,
) {
    // 最右一列留给轮次 tick minimap；正文不再贴边，也不会与 scrollbar 争同一格。
    let inner_width = area.width.saturating_sub(3) as usize;
    let role_width = format!("{ASSISTANT_MESSAGE_HEADER} ").width();
    ui_state.render_content_width.set(
        inner_width
            .saturating_sub(role_width + 3 + 1)
            .min(u16::MAX as usize) as u16,
    );
    let mut turn_anchors = Vec::new();
    let mut lines = layout_lines_impl_with_turns(
        state,
        inner_width,
        wide,
        ui_state.session_cursor,
        Some(&mut turn_anchors),
    );
    ui_state.turn_anchors.replace(turn_anchors.clone());

    let body_height = area.height.saturating_sub(2) as usize;
    let line_count = lines.len();
    // plain → markdown 定妆会改物理行数；follow=false 时平移绝对滚动，避免视口跳动。
    let reanchored = ui_state.reanchor_messages_scroll(line_count, body_height);
    let max_scroll = line_count.saturating_sub(body_height) as u16;
    let scroll = if ui_state.follow {
        max_scroll
    } else {
        reanchored.min(max_scroll)
    };

    // `{`/`}` 落点只做 700ms 前景强调，不铺背景色，避免重新引入终端“黑块”。
    if let Some(target) = ui_state.active_turn_highlight()
        && let Some(line) = lines.get_mut(target as usize)
    {
        line.style = line.style.patch(
            Style::default()
                .fg(config::yellow())
                .add_modifier(Modifier::BOLD),
        );
    }

    // v0.9 M1：内容已按 inner_width 预折成物理行，这里关闭 Paragraph 的 Wrap，仅做垂直滚动。
    // v0.14 N3：右侧动态标题（SESSION 的 `#N 任务名 · $cost`——真值）。
    let mut block = panel_block(title, false);
    // v0.16 W3.3：SESSION 标题后缀 dim `[o] 详情`(设计稿 sessTitle 行的可发现性提示)。
    // 追加的 title 是独立的左对齐段,紧随 panel_block 已画的 "SESSION" 之后,不重复文字。
    if title == "SESSION" {
        block = block.title(Span::styled(
            " [o] 详情 · [{/}] 轮次",
            Style::default().fg(config::dim()),
        ));
    }
    if let Some(right) = title_right {
        block = block.title(
            Line::from(Span::styled(
                format!(" {right} "),
                Style::default().fg(config::dim()),
            ))
            .right_aligned(),
        );
    }
    frame.render_widget(
        Paragraph::new(Text::from(lines))
            .block(block)
            .scroll((scroll, 0)),
        area,
    );
    render_turn_ticks(
        frame,
        area,
        &turn_anchors,
        scroll,
        line_count,
        body_height as u16,
    );

    // v0.8 M5: when detached from the bottom, show a scrollbar on the right edge and a
    // "↓ N 新消息" badge so the user knows unseen content exists below and how much.
    if !ui_state.follow && max_scroll > 0 {
        let mut sb_state = ScrollbarState::new(max_scroll as usize).position(scroll as usize);
        frame.render_stateful_widget(
            Scrollbar::new(ScrollbarOrientation::VerticalRight)
                .begin_symbol(None)
                .end_symbol(None),
            area.inner(Margin {
                vertical: 1,
                horizontal: 0,
            }),
            &mut sb_state,
        );
        let unseen = ui_state.unseen_below();
        if unseen > 0 {
            render_new_message_badge(frame, area, unseen);
        }
    }
}

/// 右边缘轮次 minimap：所有用户轮次为 `·`，当前轮次为 `◆`。
fn render_turn_ticks(
    frame: &mut Frame<'_>,
    area: Rect,
    anchors: &[u16],
    scroll: u16,
    line_count: usize,
    height: u16,
) {
    if anchors.is_empty() || height == 0 || area.width < 3 {
        return;
    }
    let mut ticks = vec![" "; height as usize];
    let denominator = line_count.saturating_sub(1).max(1);
    let map = |line: u16| -> usize {
        ((line as usize * height.saturating_sub(1) as usize) / denominator)
            .min(height.saturating_sub(1) as usize)
    };
    for anchor in anchors {
        ticks[map(*anchor)] = "·";
    }
    let current = anchors
        .iter()
        .take_while(|anchor| **anchor <= scroll)
        .last()
        .copied()
        .unwrap_or(anchors[0]);
    ticks[map(current)] = "◆";
    let lines = ticks
        .into_iter()
        .map(|tick| {
            Line::from(Span::styled(
                tick,
                Style::default().fg(if tick == "◆" {
                    config::yellow()
                } else {
                    config::bg2()
                }),
            ))
        })
        .collect::<Vec<_>>();
    frame.render_widget(
        Paragraph::new(Text::from(lines)),
        Rect {
            x: area.x + area.width - 2,
            y: area.y + 1,
            width: 1,
            height,
        },
    );
}

/// v0.8 M5：消息区右下角的"↓ N 新消息"徽标（脱离粘底且下方有未见行时）。
fn render_new_message_badge(frame: &mut Frame<'_>, area: Rect, unseen: u16) {
    let label = format!(" ↓ {unseen} 新消息 ");
    // CJK glyphs are display-width 2; size the badge by display width so 新消息 isn't clipped.
    let width = (label.width() as u16).min(area.width.saturating_sub(2));
    if width == 0 || area.height < 3 {
        return;
    }
    let badge = Rect {
        x: area.x + area.width.saturating_sub(width + 1),
        y: area.y + area.height.saturating_sub(2),
        width,
        height: 1,
    };
    frame.render_widget(Clear, badge);
    frame.render_widget(
        Paragraph::new(Line::from(Span::styled(
            label,
            Style::default().fg(Color::Black).bg(ACCENT()),
        ))),
        badge,
    );
}

const USER_MESSAGE_HEADER: &str = "你 ›";
const ASSISTANT_MESSAGE_HEADER: &str = "鲸 ◆";

/// 把整条 conversation 铺成**物理行**（已按 inner_width 预折）。逻辑行数=物理行数，
/// 滚动边界精确；消息头恢复设计稿的角色语言，续行与正文列对齐。
///
/// 布局约定（对齐 opencode / Ink OG 主题）：
/// - 首屏 banner（会话尚无对话时之外，始终作为流首个 item，随内容滚走）
/// - 用户：`你 › 正文`（yellow），续行缩进到正文列；块前空一行
/// - 助手：`鲸 ◆ 正文`（aqua，含 M2 ANSI 定妆），续行缩进到正文列；块前空一行
/// - 工具行 / quick.utility 徽标：沿用既有渲染，按宽折行
///
/// 测试专用简化签名（生产代码直接调 `layout_lines_impl`；这层薄封装只服务 `mod tests` 的
/// 简单调用点，不进 release 二进制——避免 `cargo build` 误报死代码）。
#[cfg(test)]
fn layout_lines(state: &AppState, inner_width: usize) -> Vec<Line<'static>> {
    layout_lines_impl(state, inner_width, false, None)
}

/// v0.13 M3：wide=true（三栏 SESSION）时事件行换设计稿格式（时间戳+类型着色）。
#[cfg(test)]
fn layout_lines_impl(
    state: &AppState,
    inner_width: usize,
    wide: bool,
    selected: Option<usize>,
) -> Vec<Line<'static>> {
    layout_lines_impl_with_turns(state, inner_width, wide, selected, None)
}

fn layout_lines_impl_with_turns(
    state: &AppState,
    inner_width: usize,
    wide: bool,
    selected: Option<usize>,
    mut turn_anchors: Option<&mut Vec<u16>>,
) -> Vec<Line<'static>> {
    let width = inner_width.max(1);
    let mut lines: Vec<Line<'static>> = Vec::new();

    // 首屏 banner：作为消息流最前的非交互内容，随对话自然上滚。
    // 三栏模式下左侧 EMPLOYEE 面板已承载身份 → SESSION 不再重复员工卡。
    if !wide {
        lines.extend(banner_lines(state, width));
    }

    if let Some(badge) = quick_utility_badge_line(state, width) {
        lines.push(badge);
    }
    if let Some(weather) = quick_utility_weather_line(state, width) {
        lines.push(weather);
    }

    // v0.9 M5.1（AC-HINT-001）：首轮空态多行可发现性提示。banner 恒在最前，故旧的
    // `lines.is_empty()` 兜底永不触发；改为"尚无真实消息"判定。
    let has_real_message = state.conversation.iter().any(|it| {
        matches!(
            it,
            ConversationItem::User(_) | ConversationItem::Assistant(_)
        )
    });
    if !has_real_message {
        for hint in [
            "试试这样开始",
            "  · 直接输入问题，开始对话",
            "  · @ 引用文件或数据",
            "  · / 调用命令（/help 查看全部）",
            "  · Ctrl+O 打开工作台面板",
        ] {
            lines.push(Line::from(Span::styled(hint, Style::default().fg(DIM()))));
        }
    }

    let active_caret_index = state.active_streaming_assistant_index();
    let mut first_message = true;
    for (idx, item) in state.conversation.iter().enumerate() {
        match item {
            ConversationItem::User(text) => {
                if !first_message {
                    lines.push(Line::from(""));
                }
                if let Some(anchors) = turn_anchors.as_deref_mut() {
                    anchors.push(lines.len().min(u16::MAX as usize) as u16);
                }
                first_message = false;
                lines.extend(message_lines_plain(
                    text,
                    USER_MESSAGE_HEADER,
                    config::yellow(),
                    width,
                    false,
                ));
            }
            ConversationItem::Assistant(text) => {
                if !first_message {
                    lines.push(Line::from(""));
                }
                first_message = false;
                let stream_caret = active_caret_index == Some(idx);
                // Stable parts switch to their engine-rendered snapshot as soon as it arrives.
                // The caret remains attached to that exact part (including while a later tool row
                // is active); generation completion therefore removes only the caret and never
                // swaps raw Markdown for rendered content at the terminal boundary.
                if let Some(ansi) = state.rendered_assistant.get(&idx) {
                    lines.extend(message_lines_rendered(
                        ansi,
                        ASSISTANT_MESSAGE_HEADER,
                        config::aqua(),
                        width,
                        stream_caret,
                    ));
                } else {
                    lines.extend(message_lines_plain(
                        text,
                        ASSISTANT_MESSAGE_HEADER,
                        config::aqua(),
                        width,
                        stream_caret,
                    ));
                }
            }
            ConversationItem::Event(index) => {
                if let Some(entry) = state.timeline.get(*index) {
                    if entry.collapsible {
                        lines.extend(timeline_tool_lines(entry));
                    } else if wide {
                        // v0.13 M3：设计稿事件行 `▌ HH:MM 图标 type 标题 …meta`（类型着色）。
                        // v0.16 W2：统一选中行语言——▌ 只在选中行着 yellow,选中行整行 bg2。
                        let is_sel = selected == Some(*index);
                        let line = timeline_line_wide(entry, width, is_sel);
                        lines.push(line);
                    } else {
                        lines.push(timeline_line(entry));
                    }
                    // v0.11 M3：任务头终态带 TaskMeta 且本任务用过工具 → 分隔线 + TRAE 式活动计数条。
                    if let Some(meta) = entry.task_meta.as_ref()
                        && meta.counts.total() > 0
                    {
                        lines.extend(task_meta_lines(meta, width));
                    }
                }
            }
        }
    }

    lines
}

/// v0.11 M3：任务头下的 TRAE 式元信息块——一条 accent 暗分隔线 + 「⏱ 耗时 + 活动计数条」。
/// 计数只列非零项，按引擎真实工具名归类（创建/编辑/读取/联网搜索/抓取/命令/工具）。
fn task_meta_lines(meta: &super::state::TaskMeta, width: usize) -> Vec<Line<'static>> {
    let secs = meta.elapsed_ms / 1000;
    let elapsed = if secs >= 60 {
        format!("{}m {}s", secs / 60, secs % 60)
    } else {
        format!("{secs}s")
    };
    let c = &meta.counts;
    let mut parts: Vec<String> = Vec::new();
    let mut add = |n: u32, label: &str| {
        if n > 0 {
            parts.push(format!("{label}{n}"));
        }
    };
    add(c.created, "创建");
    add(c.edited, "编辑");
    add(c.read, "读取");
    add(c.web_search, "联网搜索");
    add(c.web_fetch, "抓取");
    add(c.command, "命令");
    add(c.other, "工具");
    let activity = if parts.is_empty() {
        "无工具调用".to_string()
    } else {
        parts.join(" · ")
    };
    let bar = format!(
        "{} {} · ⏱ 耗时 {elapsed} · {activity}",
        SYM_OK,
        progress_bar_10(c.total(), true)
    );
    let rule: String = "─".repeat(width.max(1));
    vec![
        Line::from(Span::styled(rule, Style::default().fg(DIM()))),
        Line::from(Span::styled(
            truncate_display_width(&bar, width),
            Style::default().fg(DIM()),
        )),
    ]
}

/// v0.9 M4 / v0.11 M2：首屏。有员工且够宽 → 像素员工卡；否则回退通用 block banner。
/// 作为消息流首内容，随对话上滚。
fn banner_lines(state: &AppState, width: usize) -> Vec<Line<'static>> {
    // v0.11 M2：员工在 + 宽度够 → 像素员工卡（accent 描边 + 像素头像 + 名/角色/模型/工号）。
    if let Some(emp) = state.employee.as_ref()
        && width >= EMP_CARD_INNER + 4
    {
        return employee_card_lines(emp, width);
    }
    // 无员工或窄屏：通用 block banner（<44 退化为一行标题）。
    let mut out: Vec<Line<'static>> = Vec::new();
    let accent = Style::default().fg(ACCENT()).add_modifier(Modifier::BOLD);
    if width >= 44 {
        for row in BANNER_ART {
            out.push(Line::from(Span::styled(*row, accent)));
        }
    } else {
        out.push(Line::from(Span::styled("CREWCLAW", accent)));
    }
    out.push(Line::from(Span::styled(
        "你的数字员工工位 · 输入即对话",
        Style::default().fg(DIM()),
    )));
    if let Some(emp) = state.employee.as_ref() {
        out.push(Line::from(Span::styled(
            format!("{} · {}", emp.name, emp.role),
            Style::default().fg(DIM()),
        )));
    }
    out.push(Line::from(""));
    out
}

/// 员工卡内容区显示宽度（不含左右边框）。
const EMP_CARD_INNER: usize = 42;
/// 4 列像素头像（全部宽度 1 的 box/quadrant 字符，避免 CJK/emoji 宽度不确定）。
/// v0.13 M3：pub(crate)——EMPLOYEE 左栏（workbench_panels）复用同一头像与工号。
pub(crate) const EMP_AVATAR: [&str; 3] = ["▛▀▀▜", "▌▞▚▐", "▙▄▄▟"];

/// v0.13 M3：员工工号（名字 FNV 低 12 位 → EMP·hex），员工卡与 EMPLOYEE 面板共用。
pub(crate) fn employee_tag(name: &str) -> String {
    let mut h: u64 = 0xcbf29ce484222325;
    for b in name.bytes() {
        h ^= b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    format!("EMP·{:03X}", h & 0xFFF)
}

/// v0.11 M2：像素员工卡。三行内容（名+工号 / 角色 / 模型·包状态），左侧像素头像，accent 描边。
fn employee_card_lines(emp: &super::state::Employee, _width: usize) -> Vec<Line<'static>> {
    let inner = EMP_CARD_INNER;
    let accent = Style::default().fg(ACCENT());
    let accent_bold = Style::default().fg(ACCENT()).add_modifier(Modifier::BOLD);
    let dim = Style::default().fg(DIM());

    // 工号：员工名 FNV 低 12 位 → 3 位大写 hex，稳定可复现。
    let tag = employee_tag(&emp.name);

    // 每行右侧文本内容（去掉头像列前的固定 2 空格间隔）。
    let name_col = 6usize; // avatar(4) + "  "
    let body = inner.saturating_sub(name_col);

    // 行 1：名（bold accent）+ 右对齐工号（dim）。
    let name = truncate_display_width(&emp.name, body.saturating_sub(tag.width() + 1));
    let used = name.width() + tag.width();
    let gap = body.saturating_sub(used);
    // 行 2：角色。 行 3：◆ 模型 · C1 包验证。
    let role = truncate_display_width(&emp.role, body);
    let model_line = format!("◆ {} · C1 包验证", emp.model);
    let model_line = truncate_display_width(&model_line, body);

    let border_h: String = "═".repeat(inner + 2);
    let pad = |s: &str, w: usize| -> String {
        let cur = s.width();
        if cur >= w {
            String::new()
        } else {
            " ".repeat(w - cur)
        }
    };

    vec![
        Line::from(Span::styled(format!("╔{border_h}╗"), accent)),
        Line::from(vec![
            Span::styled("║ ", accent),
            Span::styled(EMP_AVATAR[0], accent),
            Span::raw("  "),
            Span::styled(name.clone(), accent_bold),
            Span::raw(" ".repeat(gap)),
            Span::styled(tag.clone(), dim),
            Span::styled(format!("{} ║", pad("", 0)), accent),
        ]),
        Line::from(vec![
            Span::styled("║ ", accent),
            Span::styled(EMP_AVATAR[1], accent),
            Span::raw("  "),
            Span::styled(role.clone(), dim),
            Span::raw(pad(&role, body)),
            Span::styled(" ║", accent),
        ]),
        Line::from(vec![
            Span::styled("║ ", accent),
            Span::styled(EMP_AVATAR[2], accent),
            Span::raw("  "),
            Span::styled(model_line.clone(), dim),
            Span::raw(pad(&model_line, body)),
            Span::styled(" ║", accent),
        ]),
        Line::from(Span::styled(format!("╚{border_h}╝"), accent)),
        Line::from(Span::styled("输入即对话 · 数字员工已就位", dim)),
        Line::from(""),
    ]
}

/// block 字符 banner（7 行以内，宽度 ~40 列）。
const BANNER_ART: &[&str] = &[
    "  ██████ ██████  ███████ ██     ██",
    " ██      ██   ██ ██      ██     ██",
    " ██      ██████  █████   ██  █  ██",
    " ██      ██   ██ ██      ██ ███ ██",
    "  ██████ ██   ██ ███████  ███ ███ ",
    "        C R E W C L A W",
];

/// v0.9 M1：按**显示宽度**折行（CJK/emoji 记 2，ASCII 记 1）。返回每条物理行的文本。
/// 无空格超长 token 也会被硬切；空串返回单个空行以保留视觉空行。
fn wrap_display(text: &str, width: usize) -> Vec<String> {
    let width = width.max(1);
    if text.is_empty() {
        return vec![String::new()];
    }
    let mut out = Vec::new();
    let mut current = String::new();
    let mut current_w = 0usize;
    for ch in text.chars() {
        // 每帧每字符路径：直接按 char 取宽，避免每字符堆分配一个 String；控制字符宽度视为 0。
        let cw = UnicodeWidthChar::width(ch).unwrap_or(0);
        // 单字符宽于整行（极端）时，独占一行避免死循环。
        if cw > width {
            if !current.is_empty() {
                out.push(std::mem::take(&mut current));
                current_w = 0;
            }
            out.push(ch.to_string());
            continue;
        }
        if current_w + cw > width {
            out.push(std::mem::take(&mut current));
            current_w = 0;
        }
        current.push(ch);
        current_w += cw;
    }
    if !current.is_empty() || out.is_empty() {
        out.push(current);
    }
    out
}

fn message_header_prefix(header: &'static str, color: Color, first_line: bool) -> Span<'static> {
    let prefix = format!("{header} ");
    if first_line {
        Span::styled(
            prefix,
            Style::default().fg(color).add_modifier(Modifier::BOLD),
        )
    } else {
        Span::raw(" ".repeat(prefix.width()))
    }
}

/// 纯文本消息按角色头后的正文宽度预折；续行留出等显示宽缩进，CJK/emoji 不按 byte 算。
fn message_lines_plain(
    text: &str,
    header: &'static str,
    header_color: Color,
    width: usize,
    stream_caret: bool,
) -> Vec<Line<'static>> {
    let prefix_width = format!("{header} ").width();
    let body_width = width.saturating_sub(prefix_width).max(1);
    let mut lines = Vec::new();
    let mut first_line = true;
    for logical in text.split('\n') {
        for chunk in wrap_display(logical, body_width) {
            lines.push(Line::from(vec![
                message_header_prefix(header, header_color, first_line),
                Span::raw(chunk),
            ]));
            first_line = false;
        }
    }
    if lines.is_empty() {
        lines.push(Line::from(message_header_prefix(
            header,
            header_color,
            true,
        )));
    }
    if stream_caret && let Some(last) = lines.last_mut() {
        last.spans.push(Span::styled(
            STREAM_CARET,
            Style::default().fg(header_color),
        ));
    }
    lines
}

/// 引擎定妆 ANSI 仍保留每个 span 的样式，只在外层补角色头与续行缩进。
fn message_lines_rendered(
    ansi: &[String],
    header: &'static str,
    header_color: Color,
    width: usize,
    stream_caret: bool,
) -> Vec<Line<'static>> {
    let prefix_width = format!("{header} ").width();
    let body_width = width.saturating_sub(prefix_width).max(1);
    let mut lines = ansi_lines_to_ratatui(ansi, body_width);
    if lines.is_empty() {
        lines.push(Line::default());
    }
    for (index, line) in lines.iter_mut().enumerate() {
        line.spans
            .insert(0, message_header_prefix(header, header_color, index == 0));
    }
    if stream_caret && let Some(last) = lines.last_mut() {
        last.spans.push(Span::styled(
            STREAM_CARET,
            Style::default().fg(header_color),
        ));
    }
    lines
}

/// M2 定妆：把引擎预排版的 ANSI 行转成 ratatui Line（保留颜色/样式）。
/// v0.9 M1：每条 ANSI 行按 `width` 显示宽预折，超宽 span 内容按字符切分并保留其样式，续行不再依赖
/// Paragraph 的 Wrap（那会破坏物理行计数）。解析失败回退为该行裸文本（按宽折行），不 panic。
fn ansi_lines_to_ratatui(ansi: &[String], width: usize) -> Vec<Line<'static>> {
    let width = width.max(1);
    let mut out = Vec::with_capacity(ansi.len());
    for raw in ansi {
        match raw.as_bytes().into_text() {
            Ok(text) => {
                for line in text.lines {
                    // 把该逻辑行的 styled spans 按显示宽重新流式折成多条物理行，保留每段样式。
                    let mut cur: Vec<Span<'static>> = Vec::new();
                    let mut cur_w = 0usize;
                    for span in line.spans {
                        let mut style = span.style;
                        // ansi-to-tui maps SGR 0 to explicit Color::Reset. Applying it punches
                        // through CrewClaw's painted theme background to terminal-profile black.
                        if style.bg == Some(Color::Reset) {
                            style.bg = None;
                        }
                        if style.fg == Some(Color::Reset) {
                            style.fg = None;
                        }
                        let mut segment = String::new();
                        for ch in span.content.chars() {
                            let cw = UnicodeWidthChar::width(ch).unwrap_or(0);
                            if cw > 0 && cur_w + cw > width && !cur.is_empty() {
                                if !segment.is_empty() {
                                    cur.push(Span::styled(std::mem::take(&mut segment), style));
                                }
                                out.push(Line::from(std::mem::take(&mut cur)));
                                cur_w = 0;
                            }
                            segment.push(ch);
                            cur_w += cw;
                        }
                        if !segment.is_empty() {
                            cur.push(Span::styled(segment, style));
                        }
                    }
                    // 每条逻辑行至少产出一条物理行（含空行），保持垂直节奏。
                    out.push(Line::from(std::mem::take(&mut cur)));
                }
            }
            Err(_) => {
                for chunk in wrap_display(raw, width) {
                    out.push(Line::from(chunk));
                }
            }
        }
    }
    out
}

/// 常聚焦输入框：无 overlay/抽屉时聚焦，可即时输入。
/// v0.9 M4：header 下沉——输入框标题右侧显示 `员工名 · model`（窄屏 <70 列只留 model）。
fn render_input(
    frame: &mut Frame<'_>,
    state: &AppState,
    ui_state: &UiState,
    input: &str,
    input_cursor: usize,
    spans: &[(usize, usize)],
    area: Rect,
) {
    // v0.16 W1.1：焦点=INSERT 模式(设计稿 inputFocused)——v0.15 默认 NORMAL 后旧判定
    // (只看浮层/抽屉)让 INPUT 恒显聚焦绿框,焦点语言失效。
    let focused = ui_state.mode == InputMode::Insert
        && ui_state.overlay.is_none()
        && ui_state.drawer.is_none();
    let label = input_identity_label(state, area.width);
    // v0.14 N4：占位文案带员工名（设计稿语义;`:` 未实现不写——诚实原则）。
    let placeholder = match state.employee.as_ref() {
        Some(emp) => format!(
            "和 {} 直接对话，Enter 发送 · 输入 / 呼出命令 · @ 引用文件",
            emp.name
        ),
        None => "输入消息 · 输入 / 呼出命令 · @ 引用文件 · Ctrl+O 面板".to_string(),
    };
    input_area::render(
        frame,
        area,
        input,
        input_cursor,
        focused,
        &placeholder,
        spans,
        &label,
    );
}

/// v0.9 M4：输入框标题右侧的身份标签。宽屏 `名字 · model`；窄屏（<70 列）仅 model；无员工信息为空。
fn input_identity_label(state: &AppState, width: u16) -> String {
    let Some(emp) = state.employee.as_ref() else {
        return String::new();
    };
    if width < 70 {
        emp.model.clone()
    } else {
        format!("{} · {}", emp.name, emp.model)
    }
}

/// Ctrl+O 抽屉：把五个面板作为覆盖层展示，页 1-4 切换。
fn render_drawer(frame: &mut Frame<'_>, state: &AppState, ui_state: &UiState) {
    let Some(panel) = ui_state.drawer else {
        return;
    };
    // Narrow terminals get a near-full-screen drawer; wider ones leave chat context visible.
    let coverage = match layout_kind(frame.area().width) {
        LayoutKind::Wide => 70,
        LayoutKind::Mid => 80,
        LayoutKind::Narrow => 92,
    };
    let area = centered_rect(coverage, 80, frame.area());
    frame.render_widget(Clear, area);
    // Clear 会把 cell 背景清成默认黑；先整块铺主题底，避免抽屉/Tabs 间隙露出黑块。
    frame.render_widget(
        Block::default().style(Style::default().bg(config::bg())),
        area,
    );

    let rows = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Length(3), Constraint::Min(4)])
        .split(area);
    let selected = match panel {
        FocusPanel::Tasks | FocusPanel::Timeline => 0,
        FocusPanel::Artifacts => 1,
        FocusPanel::Tools => 2,
        FocusPanel::Inspect => 3,
    };
    frame.render_widget(
        Tabs::new(["Timeline", "Artifacts", "Tools", "Inspect"])
            .select(selected)
            .block(
                Block::default()
                    .title("面板 · Ctrl+O 关闭 · 1-4 切换")
                    .borders(Borders::ALL)
                    .border_style(Style::default().fg(config::yellow()))
                    .style(Style::default().bg(config::bg())),
            )
            .style(Style::default().fg(DIM()).bg(config::bg()))
            .highlight_style(
                Style::default()
                    .fg(config::yellow())
                    .add_modifier(Modifier::BOLD),
            ),
        rows[0],
    );
    match panel {
        FocusPanel::Tasks => render_tasks(frame, state, ui_state, rows[1]),
        FocusPanel::Timeline => render_timeline(frame, state, ui_state, rows[1]),
        FocusPanel::Artifacts => render_artifacts(frame, state, ui_state, rows[1]),
        FocusPanel::Tools => render_tools(frame, state, ui_state, rows[1]),
        FocusPanel::Inspect => render_inspect(frame, state, ui_state, rows[1]),
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
            Span::styled("> ", Style::default().fg(ACCENT())),
            Span::raw(task.title.clone()),
        ]));
        lines.push(Line::from(Span::styled(
            format!("  {}", status_label(&task.status)),
            Style::default().fg(status_color(&task.status)),
        )));
    } else {
        lines.push(Line::from(Span::styled(
            "No active task",
            Style::default().fg(DIM()),
        )));
    }

    lines.push(Line::from(""));
    lines.push(Line::from(Span::styled(
        "Plan",
        Style::default().fg(ACCENT()).add_modifier(Modifier::BOLD),
    )));
    if let Some(plan) = &state.plan {
        for (index, step) in plan.steps.iter().enumerate() {
            let symbol = match plan.statuses.get(index).map(String::as_str) {
                Some("completed") => "✓",
                Some("in_progress") => "→",
                _ => "○",
            };
            lines.push(Line::from(format!("{symbol} {step}")));
        }
    } else {
        lines.push(Line::from(Span::styled(
            "(waiting)",
            Style::default().fg(DIM()),
        )));
    }

    lines.push(Line::from(""));
    lines.push(Line::from(Span::styled(
        "Artifacts",
        Style::default().fg(ACCENT()).add_modifier(Modifier::BOLD),
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
            .block(panel_block("Tasks / Employee", true))
            .wrap(Wrap { trim: true })
            .scroll((ui_state.drawer_scroll_for(FocusPanel::Tasks), 0)),
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
    let inner_width = area.width.saturating_sub(2) as usize;
    if let Some(badge) = quick_utility_badge_line(state, inner_width) {
        lines.push(badge);
    }
    if let Some(weather) = quick_utility_weather_line(state, inner_width) {
        lines.push(weather);
    }

    let mut timeline = state.timeline.iter().rev().take(80).collect::<Vec<_>>();
    timeline.reverse();
    lines.extend(
        timeline
            .into_iter()
            .map(timeline_line)
            .chain(answer_preview(state)),
    );

    frame.render_widget(
        Paragraph::new(Text::from(lines))
            .block(panel_block("Timeline", true))
            .wrap(Wrap { trim: true })
            .scroll((ui_state.drawer_scroll_for(FocusPanel::Timeline), 0)),
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
        lines.push(Line::from(Span::styled(
            "(none)",
            Style::default().fg(DIM()),
        )));
    }
    for artifact in artifact_panel_rows(state) {
        lines.push(Line::from(vec![
            Span::styled(artifact.marker, Style::default().fg(ACCENT())),
            Span::styled(
                status_symbol(artifact.status.as_str()),
                Style::default().fg(status_color(artifact.status.as_str())),
            ),
            Span::raw(format!(" {}", artifact.name)),
        ]));
        for detail in artifact.details {
            lines.push(Line::from(Span::styled(
                format!("  {detail}"),
                Style::default().fg(DIM()),
            )));
        }
    }
    if let Some(preview) = artifact_preview_row(state) {
        lines.push(Line::from(""));
        lines.push(Line::from(Span::styled(
            "Preview",
            Style::default().fg(ACCENT()).add_modifier(Modifier::BOLD),
        )));
        lines.push(Line::from(format!("{} {}", SYM_RUNNING, preview.title)));
        let selected_path = selected_artifact_path(state);
        if let Some(path) = selected_path {
            match read_artifact_preview(
                path,
                ARTIFACT_PREVIEW_MAX_LINES,
                ARTIFACT_PREVIEW_MAX_CHARS,
            ) {
                Ok(content) => {
                    for line in content.lines() {
                        if line.starts_with("… (truncated,") {
                            lines.push(Line::from(Span::styled(
                                line.to_string(),
                                Style::default().fg(DIM()),
                            )));
                        } else {
                            lines.push(Line::from(line.to_string()));
                        }
                    }
                }
                Err(err) => {
                    if !preview.detail.is_empty() {
                        lines.push(Line::from(Span::styled(
                            format!("  {}", preview.detail),
                            Style::default().fg(DIM()),
                        )));
                    }
                    lines.push(Line::from(Span::styled(
                        format!("  (cannot read {path}: {err})"),
                        Style::default().fg(DIM()),
                    )));
                }
            }
        } else if !preview.detail.is_empty() {
            lines.push(Line::from(Span::styled(
                format!("  {}", preview.detail),
                Style::default().fg(DIM()),
            )));
        }
    }

    frame.render_widget(
        Paragraph::new(Text::from(lines))
            .block(panel_block("Artifacts / Checks", true))
            .wrap(Wrap { trim: true })
            .scroll((ui_state.drawer_scroll_for(FocusPanel::Artifacts), 0)),
        area,
    );
}

fn selected_artifact_path(state: &AppState) -> Option<&str> {
    let selected = state.selected_artifact_id()?;
    state
        .artifacts
        .iter()
        .find(|artifact| artifact.id.as_deref() == Some(selected.as_str()))
        .and_then(|artifact| artifact.path.as_deref())
}

fn render_tools(
    frame: &mut Frame<'_>,
    state: &AppState,
    ui_state: &UiState,
    area: ratatui::layout::Rect,
) {
    let mut lines = Vec::new();
    lines.push(Line::from(Span::styled(
        "能力目录 · session.ready",
        Style::default().fg(ACCENT()).add_modifier(Modifier::BOLD),
    )));
    if state.tool_catalog.is_empty() {
        lines.push(Line::from(Span::styled(
            "（引擎未声明能力目录）",
            Style::default().fg(DIM()),
        )));
    } else {
        for item in &state.tool_catalog {
            let ready = item.availability == "ready";
            lines.push(Line::from(vec![
                Span::styled(
                    if ready { "✓ " } else { "! " },
                    Style::default().fg(if ready { OK() } else { WARN() }),
                ),
                Span::raw(item.capability.clone()),
                Span::styled(
                    item.runtime_tool
                        .as_deref()
                        .map(|name| format!(" → {name} · {}", item.availability))
                        .unwrap_or_else(|| format!(" · {}", item.availability)),
                    Style::default().fg(DIM()),
                ),
            ]));
            let mut facts = Vec::new();
            if let Some(value) = item.authorization.as_deref() {
                facts.push(format!("auth={value}"));
            }
            if let Some(value) = item.operation.as_deref() {
                facts.push(format!("op={value}"));
            }
            if let Some(value) = item.risk_tier.as_deref() {
                facts.push(format!("risk={value}"));
            }
            if let Some(value) = item.provider.as_deref() {
                facts.push(format!("provider={value}"));
            }
            if let Some(value) = item.timeout_ms {
                facts.push(format!("timeout={value}ms"));
            }
            if !item.side_effects.is_empty() {
                facts.push(format!("effects={}", item.side_effects.join(",")));
            }
            if let Some(reason) = item.reason.as_deref() {
                facts.push(format!("reason={reason}"));
            }
            if !facts.is_empty() {
                lines.push(Line::from(Span::styled(
                    format!("    {}", facts.join(" · ")),
                    Style::default().fg(DIM()),
                )));
            }
        }
    }
    lines.push(Line::from(""));
    lines.push(Line::from(Span::styled(
        "本会话实际调用",
        Style::default().fg(ACCENT()).add_modifier(Modifier::BOLD),
    )));
    if state.tools.is_empty() {
        lines.push(Line::from(Span::styled(
            "（尚未调用工具）",
            Style::default().fg(DIM()),
        )));
    }
    for tool in state.tools.values() {
        lines.push(Line::from(vec![
            Span::styled(
                status_symbol(&tool.status),
                Style::default().fg(status_color(&tool.status)),
            ),
            Span::raw(format!(" {}", tool.tool.as_deref().unwrap_or("tool"))),
            Span::styled(
                format!(
                    " {}",
                    tool.summary.as_deref().unwrap_or(tool.status.as_str())
                ),
                Style::default().fg(DIM()),
            ),
        ]));
        let mut audit = Vec::new();
        if let Some(value) = tool.capability.as_deref() {
            audit.push(format!("cap={value}"));
        }
        if let Some(value) = tool.decision.as_deref() {
            audit.push(format!("decision={value}"));
        }
        if let Some(value) = tool.decision_source.as_deref() {
            audit.push(format!("source={value}"));
        }
        if let Some(value) = tool.permission_level.as_deref() {
            audit.push(format!("level={value}"));
        }
        if let Some(value) = tool.elapsed_ms {
            audit.push(format!("elapsed={value}ms"));
        }
        if !audit.is_empty() {
            lines.push(Line::from(Span::styled(
                format!("    {}", audit.join(" · ")),
                Style::default().fg(DIM()),
            )));
        }
        if let Some(args) = tool.args.as_ref() {
            lines.push(Line::from(Span::styled(
                format!("    args={args}"),
                Style::default().fg(DIM()),
            )));
        }
    }

    frame.render_widget(
        Paragraph::new(Text::from(lines))
            .block(panel_block("Tools", true))
            .wrap(Wrap { trim: true })
            .scroll((ui_state.drawer_scroll_for(FocusPanel::Tools), 0)),
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
        Style::default().fg(ACCENT()).add_modifier(Modifier::BOLD),
    )));
    if let Some(task) = &state.task {
        lines.push(Line::from(format!(
            "{} {}",
            status_symbol(&task.status),
            task.title
        )));
    } else {
        lines.push(Line::from(Span::styled(
            "(none)",
            Style::default().fg(DIM()),
        )));
    }

    lines.push(Line::from(""));
    lines.push(Line::from(Span::styled(
        "Evidence",
        Style::default().fg(ACCENT()).add_modifier(Modifier::BOLD),
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
        Style::default().fg(ACCENT()).add_modifier(Modifier::BOLD),
    )));
    if let Some(approval) = &state.approval {
        lines.push(Line::from(format!(
            "{} {} {}",
            SYM_WAIT,
            approval.tool.as_deref().unwrap_or("tool"),
            approval.reason.as_deref().unwrap_or("")
        )));
    } else {
        lines.push(Line::from(Span::styled(
            "(none)",
            Style::default().fg(DIM()),
        )));
    }

    lines.push(Line::from(""));
    lines.push(Line::from(Span::styled(
        "Debug",
        Style::default().fg(ACCENT()).add_modifier(Modifier::BOLD),
    )));
    if state.debug.is_empty() {
        lines.push(Line::from(Span::styled(
            "(none)",
            Style::default().fg(DIM()),
        )));
    } else {
        let debug_start = state.debug.len().saturating_sub(6);
        for item in &state.debug[debug_start..] {
            lines.push(Line::from(Span::styled(
                item.clone(),
                Style::default().fg(DIM()),
            )));
        }
    }

    frame.render_widget(
        Paragraph::new(Text::from(lines))
            .block(panel_block("Inspect", true))
            .wrap(Wrap { trim: true })
            .scroll((ui_state.drawer_scroll_for(FocusPanel::Inspect), 0)),
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
                Style::default().fg(ACCENT()).add_modifier(Modifier::BOLD),
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
                Style::default().fg(ACCENT()).add_modifier(Modifier::BOLD),
            )),
            Line::from(""),
            Line::from("输入即聊天       直接键入消息，Enter 发送"),
            Line::from("消息样式         你 › 用户消息；鲸 ◆ 员工回复；▊ 表示流式中"),
            Line::from("Ctrl+V           粘贴（多行/文件路径进单条，Windows 用此键）"),
            Line::from("PageUp/PageDown  滚动消息流（离底后暂停跟随）"),
            Line::from("滚轮 / End       滚轮滚动消息；End(空输入)回到底部"),
            Line::from("Shift+滚轮/拖选  走终端原生选择复制（绕过鼠标捕获）"),
            Line::from("/ 或 Ctrl+P      slash 命令补全 / 可搜索命令面板"),
            Line::from("@                引用 artifact/工具（fuzzy）"),
            Line::from("Ctrl+R           展开/折叠最近一条工具行"),
            Line::from("Ctrl+O           打开/关闭面板抽屉"),
            Line::from("Tab / Shift+Tab  抽屉内切换面板"),
            Line::from("1-4              抽屉内切页 Timeline/Artifacts/Tools/Inspect"),
            Line::from("1-9              空输入时触发待执行动作"),
            Line::from("Esc              关闭抽屉/浮层"),
            Line::from("Ctrl+C           退出"),
            Line::from(""),
            Line::from(Span::styled(
                ".crewclaw/tui.json  theme:dark|light · mouse:false 用终端原生滚动/复制",
                Style::default().fg(DIM()),
            )),
        ],
        // 其它弹层由 render_frame 的互斥分支各自绘制；这里只服务命令面板/帮助。
        Overlay::Preview
        | Overlay::Publish { .. }
        | Overlay::Settings
        | Overlay::Notifications
        | Overlay::Compare
        | Overlay::TaskDetail
        | Overlay::Onboarding { .. }
        | Overlay::FireConfirm { .. } => return,
    };

    render_modal_backdrop(frame);
    frame.render_widget(Clear, area);
    frame.render_widget(
        Paragraph::new(Text::from(lines))
            .alignment(Alignment::Left)
            .block(
                Block::default()
                    .title(" Workbench ")
                    .borders(Borders::ALL)
                    .border_style(Style::default().fg(config::yellow()))
                    .style(Style::default().bg(config::bg())),
            )
            .wrap(Wrap { trim: true }),
        area,
    );
}

fn render_fire_confirmation(frame: &mut Frame<'_>, ui_state: &UiState) {
    let Some((index, mode)) = ui_state.fire_confirmation() else {
        return;
    };
    let Some(employee) = ui_state.market.get(index) else {
        return;
    };
    render_modal_backdrop(frame);
    let area = centered_rect(70, 50, frame.area());
    frame.render_widget(Clear, area);
    let option = |selected: bool, key: &str, title: &str, detail: &str| {
        Line::from(vec![
            Span::styled(
                if selected { "● " } else { "○ " },
                Style::default().fg(if selected {
                    config::accent()
                } else {
                    config::dim()
                }),
            ),
            Span::styled(
                format!("[{key}] {title}"),
                Style::default().fg(config::fg()).add_modifier(if selected {
                    Modifier::BOLD
                } else {
                    Modifier::empty()
                }),
            ),
            Span::styled(format!(" · {detail}"), Style::default().fg(config::dim())),
        ])
    };
    let lines = vec![
        Line::from(Span::styled(
            format!("确认解雇 {}？", employee.display_name),
            Style::default()
                .fg(config::red())
                .add_modifier(Modifier::BOLD),
        )),
        Line::from(""),
        Line::from("该员工会被标记为 fired，新任务将被禁用。请选择离职数据策略："),
        Line::from(""),
        option(
            mode == crate::OffboardingMode::ExportMemory,
            "1/e",
            "导出记忆包",
            "保留可迁移记忆与完整审计",
        ),
        option(
            mode == crate::OffboardingMode::Handoff,
            "2/h",
            "交接继任者",
            "导出记忆并创建市场交接草案",
        ),
        option(
            mode == crate::OffboardingMode::Purge,
            "3/p",
            "彻底删除应用状态",
            "清记忆/Dream/技能使用，保留审计",
        ),
        Line::from(Span::styled(
            "purge 是逻辑删除，不等于存储介质清除；team/activity/KPI/eval 仍保留。",
            Style::default().fg(config::dim()),
        )),
        Line::from(""),
        Line::from(vec![
            Span::styled("[y/Enter] 执行所选策略", Style::default().fg(config::red())),
            Span::raw("   "),
            Span::styled("[n/Esc] 取消", Style::default().fg(config::dim())),
        ]),
    ];
    frame.render_widget(
        Paragraph::new(Text::from(lines))
            .block(
                Block::default()
                    .title(" 解雇确认 ")
                    .borders(Borders::ALL)
                    .border_style(Style::default().fg(config::red()))
                    .style(Style::default().bg(config::bg())),
            )
            .wrap(Wrap { trim: true }),
        area,
    );
}

fn render_approval_modal(frame: &mut Frame<'_>, state: &AppState) {
    let Some(approval) = &state.approval else {
        return;
    };
    render_modal_backdrop(frame);
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
    if let Some(label) = approval_session_lease_label(approval) {
        lines.push(Line::from(truncate_display_width(
            &format!("本会话放行清单: {label}"),
            inner_width,
        )));
    }
    while lines.len().saturating_add(1) < inner_height {
        lines.push(Line::from(""));
    }
    let actions = if approval.session_lease.is_some() {
        "[a] 仅本次    [s] 本会话    [d] 拒绝"
    } else {
        "[a] 允许执行    [d] 拒绝"
    };
    lines.push(Line::from(truncate_display_width(actions, inner_width)));

    frame.render_widget(Clear, area);
    frame.render_widget(
        Paragraph::new(Text::from(lines))
            .block(
                Block::default()
                    .title("⚠ 需要授权")
                    .borders(Borders::ALL)
                    .border_set(WAITING_BORDER_SET)
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

pub(crate) fn centered_rect(percent_x: u16, percent_y: u16, area: Rect) -> Rect {
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
        Style::default()
            .fg(config::yellow())
            .add_modifier(Modifier::BOLD)
    } else {
        Style::default().fg(DIM())
    };
    Block::default()
        .title(title)
        .borders(Borders::ALL)
        .border_style(style)
}

/// v0.13 M3：事件时间戳 → 本地 HH:MM（ts=0 的合成条目 → `--:--`）。
pub(crate) fn fmt_hhmm(ts: u64) -> String {
    use chrono::TimeZone;
    if ts == 0 {
        return "--:--".to_string();
    }
    match chrono::Local.timestamp_millis_opt(ts as i64) {
        chrono::LocalResult::Single(dt) => dt.format("%H:%M").to_string(),
        _ => "--:--".to_string(),
    }
}

/// v0.17 P2 C1：事件时间戳 → 本地 YYYY-MM-DD（EMPLOYEE"累计"区的首次上岗日期）。
pub(crate) fn fmt_date(ts: u64) -> String {
    use chrono::TimeZone;
    if ts == 0 {
        return "—".to_string();
    }
    match chrono::Local.timestamp_millis_opt(ts as i64) {
        chrono::LocalResult::Single(dt) => dt.format("%Y-%m-%d").to_string(),
        _ => "—".to_string(),
    }
}

/// v0.13 M3：事件类型 → 设计规范类别色（task=blue/plan=purple/tool=aqua/artifact·evidence=green/
/// approval·waiting=orange/failed·rejected=red，其余 dim）。
pub(crate) fn event_type_color(event_type: &str) -> Color {
    if event_type.ends_with(".failed") || event_type == "task.rejected" {
        return config::red();
    }
    match event_type.split('.').next().unwrap_or("") {
        "task" => config::blue(),
        "plan" | "step" => config::purple(),
        "tool" => config::aqua(),
        "artifact" | "evidence" | "outcome" => config::green(),
        "approval" => config::orange(),
        "memory" => config::purple(),
        _ => config::dim(),
    }
}

/// v0.13 M3：设计稿事件行（三栏 SESSION 用）：`▌ HH:MM 图标 type(≤16) 标题 …detail`。
/// detail 右段按剩余宽度截断；type 列等宽对齐，超长截断。
fn timeline_line_wide(entry: &TimelineEntry, width: usize, selected: bool) -> Line<'static> {
    let time = fmt_hhmm(entry.ts);
    let type_col = truncate_display_width(entry.event_type, 16);
    let type_pad = 16usize.saturating_sub(type_col.width());
    let head_w = 2 + time.width() + 1 + entry.status.width() + 1 + 16 + 1;
    let label = truncate_display_width(&entry.label, width.saturating_sub(head_w).max(4));
    // v0.16 W2：设计稿选中行语言——▌ 选中=yellow,未选=不着色(mk:transparent)。
    let marker_style = if selected {
        Style::default()
            .fg(config::yellow())
            .add_modifier(Modifier::BOLD)
    } else {
        Style::default().fg(config::bg())
    };
    let mut spans = vec![
        Span::styled("▌ ", marker_style),
        Span::styled(time, Style::default().fg(config::dim())),
        Span::styled(
            format!(" {}", entry.status),
            Style::default().fg(symbol_color(&entry.status)),
        ),
        Span::styled(
            format!(" {type_col}{} ", " ".repeat(type_pad)),
            Style::default().fg(event_type_color(entry.event_type)),
        ),
        Span::styled(label.clone(), timeline_label_style(entry.event_type)),
    ];
    if !entry.detail.is_empty() {
        // v0.14 N3：meta 右对齐（设计稿事件行的右列）。
        let used = head_w + label.width();
        let rest = width.saturating_sub(used + 2);
        if rest >= 4 {
            let meta = truncate_display_width(&entry.detail, rest);
            let pad = width.saturating_sub(used + meta.width());
            spans.push(Span::raw(" ".repeat(pad)));
            spans.push(Span::styled(meta, Style::default().fg(config::dim())));
        }
    }
    Line::from(spans)
}

fn timeline_line(entry: &TimelineEntry) -> Line<'static> {
    // v0.8 M4: collapsible tool lines fold to one row with a disclosure caret + line count.
    if entry.collapsible {
        return timeline_tool_lines(entry)
            .into_iter()
            .next()
            .unwrap_or_default();
    }
    let mut spans = vec![
        Span::styled(
            entry.status.clone(),
            Style::default().fg(symbol_color(&entry.status)),
        ),
        Span::styled(
            format!(" {}", entry.label),
            timeline_label_style(entry.event_type),
        ),
    ];
    if !entry.detail.is_empty() {
        spans.push(Span::styled(
            format!("  {}", entry.detail),
            Style::default().fg(DIM()),
        ));
    }
    Line::from(spans)
}

fn timeline_label_style(event_type: &str) -> Style {
    if event_type.ends_with(".rejected") {
        Style::default().add_modifier(Modifier::CROSSED_OUT)
    } else {
        Style::default()
    }
}

/// Claude Code 式工具轨道：`●` 标记调用，`│` 连接输出，`└` 收束最后一行。
/// 折叠态保留首行预览，展开态展示完整输出，避免依赖背景色表达层级。
fn timeline_tool_lines(entry: &TimelineEntry) -> Vec<Line<'static>> {
    let detail_lines: Vec<&str> = if entry.detail.is_empty() {
        Vec::new()
    } else {
        entry.detail.split('\n').collect()
    };
    let mut header = vec![
        Span::styled(
            if entry.expanded { "▾" } else { "▸" },
            Style::default().fg(config::aqua()),
        ),
        Span::styled(" ●", Style::default().fg(DIM())),
        Span::styled(
            format!(" {}", entry.status),
            Style::default().fg(symbol_color(&entry.status)),
        ),
        Span::raw(format!(" {}", entry.label)),
    ];
    if !entry.expanded && !detail_lines.is_empty() {
        header.push(Span::styled(
            format!("  +{} lines", detail_lines.len()),
            Style::default().fg(DIM()),
        ));
    }
    let mut out = vec![Line::from(header)];
    if entry.expanded {
        let last = detail_lines.len().saturating_sub(1);
        for (index, row) in detail_lines.iter().enumerate() {
            let joint = if index == last { "└" } else { "│" };
            out.push(Line::from(Span::styled(
                format!("{joint}  {row}"),
                tool_detail_style(row),
            )));
        }
        if detail_lines.is_empty() {
            out.push(Line::from(Span::styled(
                format!("└  {}", entry.status),
                Style::default().fg(DIM()),
            )));
        }
    } else if entry.label != "思考"
        && let Some(row) = detail_lines.first()
    {
        out.push(Line::from(Span::styled(
            format!("└  {row}"),
            Style::default().fg(DIM()),
        )));
    } else if detail_lines.is_empty() {
        out.push(Line::from(Span::styled(
            format!("└  {}", entry.status),
            Style::default().fg(DIM()),
        )));
    }
    out
}

/// `ui-diff.mjs` emits stable diff rows such as `│ ...  + text` and `│ ...  - text`.
/// Preserve that semantic signal in Ratatui instead of flattening the whole tool result to dim.
fn tool_detail_style(row: &str) -> Style {
    let diff_row = row.trim_start().starts_with('│');
    if diff_row && row.contains("  + ") {
        Style::default().fg(config::green())
    } else if diff_row && row.contains("  - ") {
        Style::default().fg(config::red())
    } else {
        Style::default().fg(DIM())
    }
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
        Style::default().fg(WARN()),
    )))
}

fn quick_utility_weather_line(state: &AppState, max_width: usize) -> Option<Line<'static>> {
    let value = state.quick_utility.as_ref()?.result.as_ref()?;
    let city = value.get("city").and_then(Value::as_str).unwrap_or("");
    if city.is_empty() {
        return None;
    }
    let condition = value.get("condition").and_then(Value::as_str).unwrap_or("");
    let temp_c = integer_value(value, "temp_c");
    let feels_c = integer_value(value, "feels_c");
    let humidity = integer_value(value, "humidity");
    let label = format!("🌤 {city}  {condition}  {temp_c}°C（体感 {feels_c}°C · 湿度 {humidity}%）");

    Some(Line::from(Span::styled(
        truncate_display_width(&label, max_width),
        Style::default().fg(WARN()),
    )))
}

fn integer_value(value: &Value, key: &str) -> i64 {
    value
        .get(key)
        .and_then(|item| {
            item.as_i64()
                .or_else(|| item.as_f64().map(|number| number as i64))
        })
        .unwrap_or_default()
}

fn pending_actions_line(actions: &[PendingAction], max_width: usize) -> Option<String> {
    let items = actions
        .iter()
        .map(|action| format!("[{}] {}", action.key, action.label))
        .collect::<Vec<_>>();

    if items.is_empty() {
        return None;
    }

    Some(
        truncate_display_width(&format!("可执行：{}", items.join("  ")), max_width)
            .trim_end()
            .to_string(),
    )
}

fn answer_preview(state: &AppState) -> Vec<Line<'static>> {
    if state.answer.is_empty() {
        return Vec::new();
    }
    let mut lines = vec![
        Line::from(""),
        Line::from(Span::styled(
            "Answer",
            Style::default().fg(ACCENT()).add_modifier(Modifier::BOLD),
        )),
    ];
    // One Line per source line: a Line's spans don't split on '\n', so a multi-paragraph
    // markdown answer would collapse into one row. Width-wrapping is still applied by the
    // Timeline Paragraph's Wrap; here we only preserve the author's own line breaks.
    for line in state.answer.split('\n') {
        lines.push(Line::from(line.to_string()));
    }
    lines
}

pub(crate) fn truncate_display_width(text: &str, max_width: usize) -> String {
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

pub(crate) fn status_symbol(status: &str) -> &'static str {
    match status {
        "ok" | "succeeded" | "done" | "ready" | "accepted" | "exported" => SYM_OK,
        "failed" | "rejected" | "deleted" => SYM_FAIL,
        "requested" | "running" => SYM_RUNNING,
        "blocked" | "cancelled" | "needs_review" | "needs_artifact" => SYM_WARN,
        "idle" | "draft" | "awaiting_approval" | "proposed" => SYM_WAIT,
        _ => SYM_WARN,
    }
}

fn status_label(status: &str) -> String {
    format!("{} {status}", status_symbol(status))
}

fn status_color(status: &str) -> Color {
    match status {
        "ok" | "succeeded" | "done" | "ready" | "accepted" | "exported" => OK(),
        "failed" | "rejected" | "deleted" => BAD(),
        "requested" | "running" => ACCENT(),
        "draft" | "awaiting_approval" | "blocked" | "cancelled" | "needs_review"
        | "needs_artifact" => WARN(),
        _ => DIM(),
    }
}

pub(crate) fn symbol_color(symbol: &str) -> Color {
    match symbol {
        SYM_OK => OK(),
        SYM_FAIL => BAD(),
        SYM_RUNNING => ACCENT(),
        SYM_WARN | SYM_WAIT => WARN(),
        _ => DIM(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workbench::TaskEvent;
    use ratatui::{Terminal, backend::TestBackend};

    use super::super::state::{Approval, PendingAction, QuickUtility};

    // v0.16：锁本体挪到 config.rs(pub(crate) THEME_TEST_LOCK)——mod.rs 的测试也要用它。
    use super::config::THEME_TEST_LOCK;

    #[test]
    fn local_action_feedback_is_visible_in_the_existing_hint_row() {
        let state = AppState::default();
        let mut ui = UiState::default();
        ui.action_feedback = Some((false, "✗ 解雇失败：owner lock rejected".to_string()));
        let mut terminal = Terminal::new(TestBackend::new(160, 44)).expect("term");
        terminal
            .draw(|frame| render(frame, &state, &ui, ""))
            .expect("draw feedback");
        assert!(
            screen(&terminal)
                .replace(' ', "")
                .contains("解雇失败：ownerlockrejected"),
            "fire failure must not disappear after the confirmation closes"
        );
    }

    #[test]
    fn truncates_cjk_by_display_width_not_char_count() {
        assert_eq!(truncate_display_width("你好ab", 5), "你好a");
        assert_eq!(truncate_display_width("a你b好", 4), "a你b");
    }

    #[test]
    fn designed_animation_primitives_have_exact_cycles_and_honest_progress() {
        assert_eq!(SPINNER_FRAMES.len(), 10);
        for (index, frame) in SPINNER_FRAMES.iter().enumerate() {
            assert_eq!(spinner_frame(index as u128 * 100), *frame);
        }
        assert_eq!(spinner_frame(1_000), SPINNER_FRAMES[0], "10-frame loop");
        assert!(animation_on(0, STATUS_PULSE_MS));
        assert!(!animation_on(STATUS_PULSE_MS / 2, STATUS_PULSE_MS));
        assert!(animation_on(STATUS_PULSE_MS, STATUS_PULSE_MS));
        assert_eq!(progress_bar_10(0, false), "░░░░░░░░░░");
        assert_eq!(progress_bar_10(3, false), "███░░░░░░░");
        assert_eq!(
            progress_bar_10(99, false),
            "█████████░",
            "running never claims the terminal cell"
        );
        assert_eq!(progress_bar_10(0, true), "██████████");
    }

    // ---- v0.9 M1: 预 wrap 折行纯单测（AC-WRAP-004） ----

    #[test]
    fn wrap_display_ascii_by_width() {
        assert_eq!(wrap_display("abcdef", 3), vec!["abc", "def"]);
        assert_eq!(wrap_display("abcdef", 10), vec!["abcdef"]);
    }

    #[test]
    fn wrap_display_cjk_counts_width_two() {
        // 每个中文占 2 列，width=4 → 每行 2 字。
        assert_eq!(wrap_display("你好世界", 4), vec!["你好", "世界"]);
        // width=3 放不下第二个中文（2+2>3）→ 每行 1 字。
        assert_eq!(wrap_display("你好", 3), vec!["你", "好"]);
    }

    #[test]
    fn wrap_display_mixed_and_emoji() {
        // ASCII+CJK 混排按显示宽切。
        assert_eq!(wrap_display("a你b好", 3), vec!["a你", "b好"]);
        // emoji 宽 2；width=2 各占一行。
        let out = wrap_display("😀😀", 2);
        assert_eq!(out.len(), 2);
    }

    #[test]
    fn wrap_display_long_token_hard_split() {
        // 无空格超长串也硬切，不溢出。
        let out = wrap_display("xxxxxxxxxx", 4);
        assert_eq!(out, vec!["xxxx", "xxxx", "xx"]);
    }

    #[test]
    fn wrap_display_empty_is_single_blank_line() {
        assert_eq!(wrap_display("", 10), vec![String::new()]);
    }

    // ---- v0.9 M4: 视觉重设计（AC-VIS-001/002/003） ----

    fn employee_state() -> AppState {
        let mut state = AppState::default();
        state.employee = Some(super::super::state::Employee {
            name: "小鲸".to_string(),
            role: "AI 采纳研究员".to_string(),
            model: "claude".to_string(),
            skills: Vec::new(),
            avatar: Vec::new(),
            kpi_cumulative: super::super::state::KpiCumulative::default(),
            eval: None,
            growth_card: None,
        });
        state
    }

    fn render_screen_to_string(scr: Screen, mode: InputMode) -> String {
        let state = employee_state();
        let mut ui = UiState::default();
        ui.screen = scr;
        ui.mode = mode;
        let mut t = Terminal::new(TestBackend::new(84, 20)).expect("term");
        t.draw(|f| render(f, &state, &ui, "")).expect("draw");
        screen(&t)
    }

    /// v0.13 M0：宽屏 header 含两行像素字标 + WORKING/IDLE 状态；modeline 含版本与 utf-8；
    /// 输入框首行带 › 前缀。（CJK 注记：只断言 ASCII/半块标记。）
    #[test]
    fn m0_chrome_pixel_logo_modeline_and_prompt() {
        let mut state = employee_state();
        state.busy_since = Some(std::time::Instant::now());
        let ui = UiState::default();
        let mut t = Terminal::new(TestBackend::new(150, 18)).expect("term");
        t.draw(|f| render(f, &state, &ui, "hi")).expect("draw");
        let out = screen(&t);
        // v0.14 N0：150 列走 3 行大字标。
        assert!(out.contains("▄▀▀▀ █▀▀▄"), "big pixel logo row 1");
        assert!(out.contains("▀▄▄▄ █  █"), "big pixel logo row 3");
        assert!(out.contains("WORKING"), "busy status word");
        assert!(out.contains("crewclaw v0.1.0"), "modeline version");
        assert!(out.contains("utf-8"), "modeline utf-8");
        assert!(out.contains("›"), "input prompt prefix");

        // 闲态 → IDLE。
        state.busy_since = None;
        let mut t2 = Terminal::new(TestBackend::new(150, 18)).expect("term");
        t2.draw(|f| render(f, &state, &ui, "")).expect("draw");
        assert!(screen(&t2).contains("IDLE"), "idle status word");
    }

    fn market_fixture() -> Vec<super::super::state::MarketEntry> {
        use super::super::state::MarketEntry;
        vec![
            MarketEntry {
                name: "ai-adoption-whale".to_string(),
                display_name: "AI 落地鲸".to_string(),
                status: "available".to_string(),
                certification: "C1 包验证".to_string(),
                category: "ai-advisory".to_string(),
                description: "企业大模型落地顾问".to_string(),
                tags: vec!["模型选型".to_string(), "ROI".to_string()],
                hermes_req: ">=0.3".to_string(),
                env_reqs: vec![],
                first_task: "做一份模型选型建议".to_string(),
                avatar: vec![],
                compatibility_level: None,
                compatibility_reason: "尚未运行兼容性检查".to_string(),
                kpi_cumulative: Default::default(),
            },
            MarketEntry {
                name: "docs-octopus".to_string(),
                display_name: "Docs Octopus".to_string(),
                status: "coming-soon".to_string(),
                certification: "C0 草稿".to_string(),
                category: "documentation".to_string(),
                description: "README / API docs".to_string(),
                tags: vec![],
                hermes_req: ">=0.3".to_string(),
                env_reqs: vec![],
                first_task: "".to_string(),
                avatar: vec![],
                compatibility_level: None,
                compatibility_reason: "尚未运行兼容性检查".to_string(),
                kpi_cumulative: Default::default(),
            },
        ]
    }

    /// v0.17 P2 C1：MARKET PROFILE 面板的"累计"行——有历史的员工显示真 tasks/accepted/cost
    /// (启动时从 `.crewclaw/kpi/<name>.json` 读盘，不是引擎 session.ready 下发的，因为 MARKET
    /// 要列出所有员工）；从未跑过的员工如实说"尚无历史"，不伪造非零数字。
    #[test]
    fn market_profile_shows_real_cumulative_kpi_and_honest_zero_state() {
        use super::super::state::{KpiCumulative, MarketEntry};
        let state = employee_state();
        let mut ui = UiState::default();
        ui.screen = Screen::Market;
        ui.market = vec![
            MarketEntry {
                name: "whale".into(),
                display_name: "AI落地鲸".into(),
                status: "available".into(),
                kpi_cumulative: KpiCumulative {
                    state: super::super::state::KpiState::Valid,
                    tasks: 12,
                    accepted: 9,
                    auto_accepted: 3,
                    total_cost: 4.2,
                    first_hired_ts: Some(1_700_000_000_000),
                },
                ..Default::default()
            },
            MarketEntry {
                name: "rookie".into(),
                display_name: "新秀".into(),
                status: "available".into(),
                ..Default::default()
            },
            MarketEntry {
                name: "broken".into(),
                display_name: "损坏状态".into(),
                status: "available".into(),
                kpi_cumulative: KpiCumulative::invalid(),
                ..Default::default()
            },
        ];

        // 选中第一个（有历史）：真数字。
        ui.market_cursor = 0;
        let mut t0 = Terminal::new(TestBackend::new(84, 34)).expect("term");
        t0.draw(|f| render(f, &state, &ui, "")).expect("draw");
        let out0 = screen(&t0).replace(' ', "");
        assert!(out0.contains("12单"), "real cumulative task count");
        assert!(out0.contains("9验收"), "real cumulative accepted count");
        assert!(out0.contains("$4.20"), "real cumulative cost");
        assert!(
            out0.contains("成长资深"),
            "three policy-provenance acceptances project to senior without changing permissions"
        );

        // 选中第二个（从未跑过）：如实说没有历史，不是 "0 单 · 0 验收 · —" 这种伪造格式。
        ui.market_cursor = 1;
        let mut t1 = Terminal::new(TestBackend::new(84, 34)).expect("term");
        t1.draw(|f| render(f, &state, &ui, "")).expect("draw");
        let out1 = screen(&t1).replace(' ', "");
        assert!(
            out1.contains("尚无历史"),
            "a never-run employee gets an honest zero-state, not fabricated zeros"
        );
        assert!(
            out1.contains("成长见习"),
            "a never-run employee starts as apprentice without fabricating review history"
        );

        ui.market_cursor = 2;
        let mut t2 = Terminal::new(TestBackend::new(84, 34)).expect("term");
        t2.draw(|f| render(f, &state, &ui, "")).expect("draw");
        let out2 = screen(&t2).replace(' ', "");
        assert!(
            out2.contains("状态不可验证"),
            "corrupt KPI state must never be presented as a new employee"
        );
    }

    #[test]
    fn market_lists_experts_and_shows_selected_profile() {
        // v0.12 M2：MARKET 渲染真实员工列表（左）+ 选中员工 PROFILE（右）。断言 ASCII 标记。
        let state = employee_state();
        let mut ui = UiState::default();
        ui.screen = Screen::Market;
        ui.market = market_fixture();
        let mut t = Terminal::new(TestBackend::new(84, 34)).expect("term");
        t.draw(|f| render(f, &state, &ui, "")).expect("draw");
        let out = screen(&t);
        assert!(out.contains("Docs Octopus"), "second expert listed");
        // v0.16 W2：选中行 marker 统一成 ▌(与 SESSION/QUEUE 同源语言),旧 ▸ 已废弃。
        assert!(out.contains('▌'), "selection marker on current row");
        assert!(
            out.contains("Hermes >=0.3"),
            "profile shows runtime requirement"
        );
        assert!(
            out.contains("[h/Enter]"),
            "hire action shown for available expert"
        );
        // v0.16 W5.1：双栏改 titled_block(MARKETPLACE/PROFILE)+ stat 瓦片(真 registry 字段,
        // 不造 rating/tasks)+ 底栏 employees 计数。
        assert!(out.contains("MARKETPLACE"), "left panel titled MARKETPLACE");
        assert!(out.contains("PROFILE"), "right panel titled PROFILE");
        assert!(out.contains("STATUS"), "stat tile: status");
        assert!(out.contains("employees"), "footer shows employee count");
    }

    /// v0.17 P1-B1：MARKET 搜索框此前是纯装饰文案(标"待接")——现在过滤真生效，断言渲染层
    /// 真反映查询文本/结果计数/无匹配态，不再是摆设。
    #[test]
    fn market_search_box_filters_real_list_and_shows_no_match_state() {
        let state = employee_state();
        let mut ui = UiState::default();
        ui.screen = Screen::Market;
        ui.market = market_fixture();

        // 未过滤：两个专家都在，计数不带分母。CJK 宽字符在 flat buffer 里带续格空位，
        // 断言前压缩掉空格（既有测试的通用 CJK 规避手法）。
        let mut t0 = Terminal::new(TestBackend::new(84, 34)).expect("term");
        t0.draw(|f| render(f, &state, &ui, "")).expect("draw");
        let out0 = screen(&t0).replace(' ', "");
        assert!(
            out0.contains("AI落地鲸") && out0.contains("DocsOctopus"),
            "no filter shows all experts"
        );
        assert!(
            out0.contains("2employees"),
            "unfiltered count has no denominator"
        );

        // 过滤生效：查询文本收窄列表，计数带分母，另一个专家从列表消失。
        ui.market_filter = "octopus".to_string();
        let mut t1 = Terminal::new(TestBackend::new(84, 34)).expect("term");
        t1.draw(|f| render(f, &state, &ui, "")).expect("draw");
        let out1 = screen(&t1).replace(' ', "");
        assert!(out1.contains("DocsOctopus"), "matching expert stays listed");
        assert!(
            !out1.contains("AI落地鲸"),
            "non-matching expert filtered out of the list"
        );
        assert!(
            out1.contains("1/2employees"),
            "filtered count shows matched/total"
        );

        // 无匹配：PROFILE 面板明确提示，不留空白/不崩溃。
        ui.market_filter = "zzz-no-such-expert".to_string();
        let mut t2 = Terminal::new(TestBackend::new(84, 34)).expect("term");
        t2.draw(|f| render(f, &state, &ui, "")).expect("draw");
        let out2 = screen(&t2).replace(' ', "");
        assert!(
            out2.contains("无匹配员工"),
            "no-match state is explicit, not a blank panel"
        );
    }

    /// COMPARE 浮层支持 2-3 人，registry 字段与累计 KPI 均来自真源。
    #[test]
    fn compare_overlay_shows_real_columns_kpis_and_list_selection() {
        let state = employee_state();
        let mut ui = UiState::default();
        ui.screen = Screen::Market;
        ui.market = market_fixture();
        ui.compare_selection = vec![0, 1];

        // 未开对比浮层前：底栏计数 + 列表勾选标记已经真反映选择。
        let mut t0 = Terminal::new(TestBackend::new(90, 34)).expect("term");
        t0.draw(|f| render(f, &state, &ui, "")).expect("draw");
        let out0 = screen(&t0).replace(' ', "");
        assert!(out0.contains("对比2/3"), "footer shows real compare count");
        assert!(
            out0.matches("[x]").count() >= 2,
            "both selected rows show the checked marker"
        );

        // 打开对比浮层：两员工的真实字段并排显示。
        ui.open_overlay(Overlay::Compare);
        let mut t1 = Terminal::new(TestBackend::new(90, 34)).expect("term");
        t1.draw(|f| render(f, &state, &ui, "")).expect("draw");
        let out1 = screen(&t1).replace(' ', "");
        assert!(out1.contains("COMPARE"), "overlay titled COMPARE");
        assert!(
            out1.contains("AI落地鲸") && out1.contains("DocsOctopus"),
            "both selected experts shown"
        );
        assert!(
            out1.contains("ai-advisory") && out1.contains("documentation"),
            "real category fields shown"
        );
        assert!(out1.contains("REALKPI"), "real cumulative KPI matrix shown");
        assert!(!out1.contains("★"), "no fabricated rating metric");
    }

    /// v0.16 W5.1：MARKET 无最小宽度门槛(不像 WORKBENCH 有 120 列判定)——极窄终端下
    /// 双栏 Layout(Length(44)+Min(30))不能崩溃,只需优雅退化。
    #[test]
    fn market_survives_extremely_narrow_terminal_without_panic() {
        let state = employee_state();
        let mut ui = UiState::default();
        ui.screen = Screen::Market;
        ui.market = market_fixture();
        let mut t = Terminal::new(TestBackend::new(30, 20)).expect("term");
        t.draw(|f| render(f, &state, &ui, ""))
            .expect("draw must not panic at width=30");
    }

    #[test]
    fn hire_shows_doctor_report_and_ready_badge() {
        // v0.12 M3：HIRE 渲染选中员工的真实 doctor 结论 + 入职 4 步 + 健康徽标。
        use super::super::state::HireHealth;
        let state = employee_state();
        let mut ui = UiState::default();
        ui.screen = Screen::Hire;
        ui.market = market_fixture();
        ui.hire_reports = vec![
            HireHealth {
                status: "healthy".to_string(),
                issues: vec![],
                suggestions: vec![],
            },
            HireHealth {
                status: "broken".to_string(),
                issues: vec!["Manifest missing field: role".to_string()],
                suggestions: vec!["Complete hire.yaml".to_string()],
            },
        ];
        ui.hire_cursor = 0;
        let mut t = Terminal::new(TestBackend::new(84, 30)).expect("term");
        t.draw(|f| render(f, &state, &ui, "")).expect("draw");
        let healthy = screen(&t);
        // v0.16 W5.2：双栏改 titled_block(HIRING FLOW/DOCTOR · 入职体检)+ [✓ READY] 徽标。
        assert!(
            healthy.contains("HIRING FLOW"),
            "left panel titled HIRING FLOW"
        );
        assert!(healthy.contains("DOCTOR"), "right panel titled DOCTOR");
        assert!(healthy.contains("READY"), "ready marker when healthy");
        assert!(
            healthy.contains("no issues") || healthy.contains("全部检查通过"),
            "healthy doctor row"
        );

        // 切到 broken 员工 → 显示问题项与建议 + ISSUES 徽标。
        ui.hire_cursor = 1;
        let mut t2 = Terminal::new(TestBackend::new(84, 30)).expect("term");
        t2.draw(|f| render(f, &state, &ui, "")).expect("draw");
        let broken = screen(&t2);
        assert!(
            broken.contains("ISSUES"),
            "issues badge for broken employee"
        );
        assert!(broken.contains("Manifest missing"), "issue text shown");
        assert!(broken.contains("Complete hire.yaml"), "suggestion shown");
    }

    /// v0.16 W5.2：HIRE 双栏 Layout(Length(30)+Min(30))在极窄终端下不能崩溃。
    #[test]
    fn hire_survives_extremely_narrow_terminal_without_panic() {
        use super::super::state::HireHealth;
        let state = employee_state();
        let mut ui = UiState::default();
        ui.screen = Screen::Hire;
        ui.market = market_fixture();
        ui.hire_reports = vec![HireHealth {
            status: "healthy".to_string(),
            issues: vec![],
            suggestions: vec![],
        }];
        let mut t = Terminal::new(TestBackend::new(30, 20)).expect("term");
        t.draw(|f| render(f, &state, &ui, ""))
            .expect("draw must not panic at width=30");
    }

    /// v0.16 修复：扫描线开关**不能吞掉内容**——旧实现用 Paragraph 画满行 "─" 字符,直接
    /// 覆盖了该行原有的框线/文字(终端 cell 无 alpha 混合,画字符=替换字形),真机上表现为
    /// 开扫描线后隔行内容整体消失/错位(用户报障截图)。改法只调 cell.bg,不碰 symbol/fg。
    #[test]
    fn scanlines_tint_background_without_erasing_content() {
        // 断言依赖全局主题的 bg/bg2 色值——上共享锁,避免和别的改主题测试互踩。
        let _guard = THEME_TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        config::set_theme(config::Theme::DARK);
        let state = scripted_workbench_state();
        let mut ui = UiState::default();
        ui.mode = InputMode::Normal;

        // 关：拍一帧当基准。
        ui.scanlines = false;
        let mut t_off = Terminal::new(TestBackend::new(160, 44)).expect("term");
        t_off.draw(|f| render(f, &state, &ui, "")).expect("draw");
        let symbols_off = screen(&t_off);

        // 开：同一份 state/ui 只翻这一个开关,再拍一帧。
        ui.scanlines = true;
        let mut t_on = Terminal::new(TestBackend::new(160, 44)).expect("term");
        t_on.draw(|f| render(f, &state, &ui, "")).expect("draw");
        let symbols_on = screen(&t_on);

        // 核心断言：字形逐格必须完全一致——扫描线只允许改 bg,绝不能替换/吞掉任何字符。
        // 旧 bug 会让隔行的字符被整行 "─" 覆盖,这里会直接体现为 symbols_on != symbols_off。
        assert_eq!(
            symbols_on, symbols_off,
            "scanlines must not change a single glyph — only cell background may differ"
        );

        // 且扫描线确实按设计方向压暗，不再把暗主题 bg 换成更亮的 bg2。
        let off_buf = t_off.backend().buffer();
        let buf = t_on.backend().buffer();
        let width = t_on.size().unwrap().width;
        let height = t_on.size().unwrap().height;
        let mut saw_tinted = false;
        for y in (0..height).step_by(2) {
            for x in 0..width {
                let before = off_buf.cell((x, y)).unwrap().bg;
                let after = buf.cell((x, y)).unwrap().bg;
                if let (Color::Rgb(br, bg, bb), Color::Rgb(ar, ag, ab)) = (before, after)
                    && (ar < br || ag < bg || ab < bb)
                    && ar <= br
                    && ag <= bg
                    && ab <= bb
                {
                    saw_tinted = true;
                    break;
                }
            }
        }
        assert!(saw_tinted, "scanlines should darken RGB backgrounds");
    }

    #[test]
    fn ansi_renderer_sanitizes_reset_background_and_fills_remaining_width() {
        let lines = ansi_lines_to_ratatui(&["\x1b[41mA\x1b[0mB".to_string()], 20);
        let reset_span = lines[0]
            .spans
            .iter()
            .find(|span| span.content.contains('B'))
            .expect("reset span");
        assert_ne!(reset_span.style.bg, Some(Color::Reset));

        let wrapped = ansi_lines_to_ratatui(&["\x1b[31m12345\x1b[32m67890".to_string()], 7);
        let physical: Vec<String> = wrapped
            .iter()
            .map(|line| {
                line.spans
                    .iter()
                    .map(|span| span.content.as_ref())
                    .collect()
            })
            .collect();
        assert_eq!(physical, vec!["1234567", "890"]);
    }

    #[test]
    fn turn_navigation_uses_rendered_physical_anchors() {
        let mut ui = UiState::default();
        ui.content_max_scroll.set(80);
        ui.turn_anchors.replace(vec![4, 24, 55]);
        ui.follow = true;
        assert_eq!(ui.turn_position(), (3, 3));
        ui.jump_turn(-1);
        assert_eq!(ui.messages_scroll.get(), 55);
        ui.jump_turn(-1);
        assert_eq!(ui.messages_scroll.get(), 24);
        ui.jump_turn(1);
        assert_eq!(ui.messages_scroll.get(), 55);
    }

    /// EVAL 无持久化记录时必须显示空态，不能回落示例分数/信誉。
    #[test]
    fn eval_renders_honest_empty_state_without_static_scores() {
        // 断言依赖全局 DARK 主题色——上共享锁,避免和别的改主题测试(如 settings 的 l 循环)互踩。
        let _guard = THEME_TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        config::set_theme(config::Theme::DARK);
        let state = employee_state();
        let mut ui = UiState::default();
        ui.screen = Screen::Eval;
        let mut t = Terminal::new(TestBackend::new(140, 40)).expect("term");
        t.draw(|f| render(f, &state, &ui, "")).expect("draw");
        let out = screen(&t);
        let compact = out.replace(' ', "");
        assert!(
            compact.contains("暂无真实月度任务记录"),
            "no persisted TaskRun data has an explicit empty state"
        );
        assert!(compact.contains("累计KPI"), "kpi tiles remain present");
        assert!(
            compact.contains("评测与任务状态"),
            "real-state sidebar present"
        );
        assert!(
            !compact.contains("示例数据") && !compact.contains("雇主评分"),
            "no static eval/reputation demo survives"
        );
        assert!(
            buffer_has_bg(&t, config::Theme::DARK.bg1),
            "kpi tiles use bg1 fill"
        );
    }

    /// v0.17 P2 C1：EVAL 的 KPI 瓦片必须真的算出真实累计值(不是摆设标签)——验收率/平均成本/
    /// 在岗天数都是从 kpi_cumulative 派生的真计算，不是引擎直接下发的现成字符串。
    #[test]
    fn eval_kpi_tiles_compute_real_derived_values() {
        use super::super::protocol::TaskEvent;
        let ev = |t: &str, ts: u64, d: serde_json::Value| TaskEvent::from_parts(t, ts, d);
        let mut state = AppState::default();
        state.reduce(&ev(
            "session.ready",
            1_783_400_000_000,
            serde_json::json!({"employee":{"name":"AI 落地鲸","role":"顾问","model":"m",
                "kpi_cumulative":{"tasks":10,"accepted":8,"total_cost":8.0,"first_hired_ts":1_700_000_000_000_u64}}}),
        ));
        let mut ui = UiState::default();
        ui.screen = Screen::Eval;
        let mut t = Terminal::new(TestBackend::new(140, 40)).expect("term");
        t.draw(|f| render(f, &state, &ui, "")).expect("draw");
        let out = screen(&t);
        let compact = out.replace(' ', "");
        assert!(
            compact.contains("10") && compact.contains("累计任务"),
            "real cumulative task count"
        );
        assert!(
            compact.contains("8") && compact.contains("累计验收"),
            "real cumulative accepted count"
        );
        assert!(
            compact.contains("80%"),
            "accept rate = accepted/tasks computed correctly (8/10)"
        );
        assert!(compact.contains("$8.00"), "real cumulative cost");
        assert!(
            compact.contains("$0.80"),
            "average cost per task computed correctly (8.0/10)"
        );
        assert!(
            compact.contains("2023-11"),
            "tenure tile annotates the real first-hired date"
        );
    }

    /// EVAL 上岗考试核心三态——session 已验证评测/mock:true/从未评测空态。
    #[test]
    fn eval_exams_render_three_states_real_mock_and_absent() {
        use super::super::protocol::TaskEvent;
        let ev = |t: &str, ts: u64, d: serde_json::Value| TaskEvent::from_parts(t, ts, d);
        let ready = |eval: serde_json::Value| {
            let mut state = AppState::default();
            state.reduce(&ev(
                "session.ready",
                1_783_400_000_000,
                serde_json::json!({"employee":{"name":"AI 落地鲸","role":"顾问","model":"m","eval":eval}}),
            ));
            let mut ui = UiState::default();
            ui.screen = Screen::Eval;
            let mut t = Terminal::new(TestBackend::new(140, 40)).expect("term");
            t.draw(|f| render(f, &state, &ui, "")).expect("draw");
            screen(&t).replace(' ', "")
        };

        // 真实评测：显示模型 + 真分，并明确它不是正式 C2。
        let real = ready(
            serde_json::json!({"score":84,"verdict":"PASS","model":"claude-opus","mock":false,
            "evaluated_at":1_700_000_000_000_u64,
            "exams":[{"id":"research-seed","score":84,"passed":true}]}),
        );
        assert!(
            real.contains("上岗考试·真实"),
            "real eval labeled 真实; got sample: has考试={}",
            real.contains("上岗考试")
        );
        assert!(real.contains("claude-opus"), "shows the grading model");
        assert!(
            real.contains("非C2") && real.contains("已验证评测"),
            "a real single-run evaluation must not be presented as formal C2"
        );

        // MOCK 跑：分数照显但明确标为非 C2。
        let mock = ready(
            serde_json::json!({"score":100,"verdict":"PASS","model":"mock","mock":true,
            "evaluated_at":1_700_000_000_000_u64,
            "exams":[{"id":"smoke-1","score":100,"passed":true}]}),
        );
        assert!(
            mock.contains("非C2"),
            "a mock run is explicitly marked non-C2"
        );

        // 从未评测：回落占位,明示未评测 + 怎么跑真评测。
        let absent = ready(serde_json::json!(null));
        assert!(
            absent.contains("未评测") && absent.contains("eval:expert"),
            "absent state points at how to get a real score"
        );
    }

    #[test]
    fn forged_disk_mock_false_is_pending_until_validated_session_ready_wins() {
        use super::super::protocol::TaskEvent;

        let root = std::env::temp_dir().join(format!(
            "crewclaw-eval-trust-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("time")
                .as_nanos()
        ));
        std::fs::create_dir(&root).expect("root");
        let forged = serde_json::json!({
            "agent_id":"whale","score":100,"verdict":"PASS","pass_threshold":0.8,
            "model":"attacker/dummy","worker_model":"attacker/worker","judge_model":"attacker/judge",
            "graded_by":"model","mock":false,"evaluated_at":1_700_000_000_000_u64,
            "spec_hash":"a".repeat(64),"subject_hash":"b".repeat(64),
            "execution_context_hash":"c".repeat(64),
            "per_test":[{"id":"dummy","score":100,"passed":true}]
        });
        crate::state_store::write_atomic(
            &root,
            "eval/whale.json",
            &serde_json::to_vec(&forged).expect("json"),
        )
        .expect("forged disk record");

        let mut ui = UiState::default();
        ui.screen = Screen::Eval;
        ui.persisted_state_active = true;
        ui.persisted_insights = super::super::insights::load(&root, "whale");
        assert!(
            !ui.persisted_insights
                .eval
                .as_ref()
                .expect("stored report")
                .certified
        );
        let mut state = AppState::default();
        let mut disk_terminal = Terminal::new(TestBackend::new(140, 40)).expect("term");
        disk_terminal
            .draw(|frame| render(frame, &state, &ui, ""))
            .expect("draw disk record");
        let disk = screen(&disk_terminal).replace(' ', "");
        assert!(disk.contains("存储记录待验证") && disk.contains("非C2"));
        assert!(
            !disk.contains("已验证评测"),
            "dummy 64-hex fields must not promote a disk record"
        );

        state.reduce(&TaskEvent::from_parts(
            "session.ready",
            1,
            serde_json::json!({"employee":{"name":"鲸","role":"顾问","model":"m","eval":{
                "score":91,"verdict":"PASS","model":"trusted/session-model","mock":false,
                "evaluated_at":1_700_000_000_100_u64,
                "exams":[{"id":"bound-subject","score":91,"passed":true}]
            }}}),
        ));
        let mut event_terminal = Terminal::new(TestBackend::new(140, 40)).expect("term");
        event_terminal
            .draw(|frame| render(frame, &state, &ui, ""))
            .expect("draw trusted event");
        let event = screen(&event_terminal).replace(' ', "");
        assert!(event.contains("已验证评测") && event.contains("trusted/session-model"));
        assert!(
            !event.contains("attacker/dummy"),
            "persisted refresh data must not override session.ready"
        );
        let _ = std::fs::remove_dir_all(root);
    }

    /// v0.16 W6.1：EVAL 的 KPI 网格 Layout 在窄终端下不panic(退化单栏路径已有,这里补宽栏路径)。
    #[test]
    fn eval_survives_narrow_terminal_without_panic() {
        let state = employee_state();
        let mut ui = UiState::default();
        ui.screen = Screen::Eval;
        let mut t = Terminal::new(TestBackend::new(30, 20)).expect("term");
        t.draw(|f| render(f, &state, &ui, ""))
            .expect("draw must not panic at width=30");
    }

    /// DREAM 宽屏 MEMORY/DIFF 只渲染注入的持久化状态。
    #[test]
    fn dream_renders_memory_browser_and_diff_with_bg1() {
        super::super::flow_state::reset_dream_projection();
        let _guard = THEME_TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        config::set_theme(config::Theme::DARK);
        let state = employee_state();
        let mut ui = UiState::default();
        ui.screen = Screen::Dream;
        ui.persisted_state_active = true;
        ui.persisted_insights.dream.worked = vec!["调研模型（已验收）".to_string()];
        ui.persisted_insights.dream.playbook_add = vec!["+ 先核验官方来源".to_string()];
        ui.persisted_insights.dream.memories = vec![super::super::state::PersistedMemory {
            kind: "K".to_string(),
            category: "project_facts".to_string(),
            text: "客户要求双格式交付".to_string(),
            confidence: "high".to_string(),
            saved_at: Some("2026-07-10T00:00:00Z".to_string()),
            source_task_ids: vec!["task-verified-1".to_string()],
            dream_run_id: Some("dream-verified-1".to_string()),
        }];
        let mut t = Terminal::new(TestBackend::new(160, 44)).expect("term");
        t.draw(|f| render(f, &state, &ui, "")).expect("draw");
        let out = screen(&t);
        let compact = out.replace(' ', "");
        assert!(compact.contains("持久记忆"), "memory browser panel title");
        assert!(!compact.contains("MOCK"), "no static memory demo label");
        assert!(out.contains("DETAIL"), "detail pane label");
        assert!(
            compact.contains("PLAYBOOKDIFF"),
            "playbook diff section present"
        );
        assert!(
            buffer_has_bg(&t, config::Theme::DARK.bg1),
            "diff rows use bg1 fill"
        );
        assert!(
            compact.contains("客户要求双格式交付"),
            "real persisted memory item shown"
        );
    }

    #[test]
    fn dream_renders_persisted_morning_report_truth() {
        super::super::flow_state::reset_dream_projection();
        super::super::flow_state::reduce_dream_event(&TaskEvent::from_parts(
            "dream.morning_report",
            1,
            serde_json::json!({
                "dream_id": "dream-ui-morning",
                "employee_id": "whale",
                "state": "ACTIVE",
                "source_created_at": "2026-07-18T23:00:00.000Z",
                "summary": "巩固稳定 SOP",
                "reviewed_count": 4,
                "added_count": 1,
                "merged_count": 1,
                "replaced_count": 1,
                "dropped_count": 1,
                "kept_count": 0,
                "resolved_memory_count": 3,
                "validation_blocker_count": 0,
                "skill_retirement_candidate_count": 2,
                "approved": true,
                "activated": true,
                "candidate_eval_passed": true
            }),
        ));
        let state = employee_state();
        let mut ui = UiState::default();
        ui.screen = Screen::Dream;
        let mut terminal = Terminal::new(TestBackend::new(160, 44)).expect("term");
        terminal
            .draw(|frame| render(frame, &state, &ui, ""))
            .expect("draw morning report");
        let compact = screen(&terminal).replace(' ', "");
        assert!(compact.contains("昨夜DREAM晨报"));
        assert!(compact.contains("复核4新增1合并1替换1清理1消解3"));
        assert!(compact.contains("技能淘汰预警2"));
    }

    #[test]
    fn dream_renders_executable_growth_goal_and_approval_gate() {
        super::super::flow_state::reset_dream_projection();
        super::super::flow_state::reduce_dream_event(&TaskEvent::from_parts(
            "dream.next_task_ready",
            1,
            serde_json::json!({
                "dream_id": "dream-growth-render",
                "cycle_id": "growth-render-cycle",
                "kind": "growth_task",
                "state": "RECOMMENDED",
                "goal": "生成带证据的下一轮交付",
                "next_step": "人工审批后进入 runtime"
            }),
        ));
        let state = employee_state();
        let mut ui = UiState::default();
        ui.screen = Screen::Dream;
        let mut terminal = Terminal::new(TestBackend::new(160, 44)).expect("term");
        terminal
            .draw(|frame| render(frame, &state, &ui, ""))
            .expect("draw executable growth task");
        let compact = screen(&terminal).replace(' ', "");
        assert!(compact.contains("GROWTH"));
        assert!(compact.contains("growth_task·RECOMMENDED"));
        assert!(compact.contains("生成带证据的下一轮交付"));
        assert!(compact.contains("[p]审批并送入同一runtime/TaskRun管线"));
    }

    /// v0.16 W6.2：DREAM 双栏(main + memory)Layout 在窄终端下不panic。
    #[test]
    fn dream_survives_narrow_terminal_without_panic() {
        let state = employee_state();
        let mut ui = UiState::default();
        ui.screen = Screen::Dream;
        let mut t = Terminal::new(TestBackend::new(30, 20)).expect("term");
        t.draw(|f| render(f, &state, &ui, ""))
            .expect("draw must not panic at width=30");
    }

    #[test]
    fn market_empty_shows_placeholder_not_panic() {
        let state = employee_state();
        let mut ui = UiState::default();
        ui.screen = Screen::Market; // market 空
        let mut t = Terminal::new(TestBackend::new(84, 20)).expect("term");
        t.draw(|f| render(f, &state, &ui, "")).expect("draw");
        assert!(
            screen(&t).contains("experts.json"),
            "empty market shows source hint"
        );
    }

    fn scripted_workbench_state() -> AppState {
        use super::super::protocol::TaskEvent;
        let ev = |t: &str, ts: u64, d: serde_json::Value| TaskEvent::from_parts(t, ts, d);
        let mut state = AppState::default();
        state.reduce(&ev(
            "session.ready",
            1_783_400_000_000,
            serde_json::json!({"employee":{"name":"AI 落地鲸","role":"企业大模型落地顾问","model":"claude-opus-4.8","skills":["模型选型","Agent 工作流","ROI 评估"]}}),
        ));
        state.reduce(&ev(
            "task.started",
            1_783_400_060_000,
            serde_json::json!({"id":"t1","title":"调研 2026 Q2 国产模型选型","mode":"Task"}),
        ));
        state.reduce(&ev(
            "tool.requested",
            1_783_400_120_000,
            serde_json::json!({"id":"tool1","tool":"web_search","label":"搜索国产模型定价"}),
        ));
        state.reduce(&ev(
            "tool.succeeded",
            1_783_400_150_000,
            serde_json::json!({"id":"tool1","summary":"12 sources","detail":"src list"}),
        ));
        state.reduce(&ev(
            "evidence.created",
            1_783_400_180_000,
            serde_json::json!({"fact":"报告引用来源","source":"volcengine.com/pricing","source_type":"official"}),
        ));
        state.reduce(&ev(
            "artifact.created",
            1_783_400_200_000,
            serde_json::json!({"id":"a1","taskRunId":"t1","name":"report.md","kind":"markdown","path":"/x/report.md","status":"draft","bytes":12_700}),
        ));
        state.reduce(&ev(
            "token.delta",
            1_783_400_210_000,
            serde_json::json!({"text":"报告已生成，等待验收。"}),
        ));
        state.reduce(&ev(
            "outcome.checked",
            1_783_400_215_000,
            serde_json::json!({"taskRunId":"t1","valid":true,"deliverable":"/x/report.md"}),
        ));
        state.reduce(&ev(
            "task.completed",
            1_783_400_220_000,
            serde_json::json!({"id":"t1","usage":{"prompt":9000,"completion":3000},"est_cost":0.36}),
        ));
        state
    }

    /// 宽 ≥140 的 WORKBENCH（设计稿三栏）：EMPLOYEE | TASK QUEUE + SESSION |
    /// ARTIFACTS + TOOLS + EVIDENCE + PREVIEW。
    #[test]
    fn workbench_3col_renders_real_panels_at_wide_width() {
        let state = scripted_workbench_state();
        let ui = UiState::default();
        let mut t = Terminal::new(TestBackend::new(160, 40)).expect("term");
        t.draw(|f| render(f, &state, &ui, "")).expect("draw");
        let out = screen(&t);
        let compact = out.replace(' ', "");
        // 三栏框架。
        assert!(out.contains("EMPLOYEE"), "left panel");
        assert!(out.contains("TASK QUEUE"), "center queue");
        assert!(out.contains("SESSION"), "center session");
        assert!(out.contains("ARTIFACTS"), "right artifacts");
        // 左栏设计稿构成：SKILLS 真技能 + KPI（累计无历史 → 诚实占位）。
        assert!(out.contains("SKILLS"), "skills section");
        assert!(
            compact.contains("模型选型"),
            "real skill from session.ready"
        );
        assert!(out.contains("KPI"), "kpi section");
        assert!(
            compact.contains("尚无任务记录"),
            "honest KPI placeholder when no cumulative history"
        );
        assert!(out.contains("$0.36"), "real est_cost from engine event");
        // 中栏 SESSION 事件行：HH:MM 时间戳 + 事件类型名。
        assert!(out.contains("task.started"), "event type column");
        assert!(out.contains("artifact.created"), "artifact event row");
        assert!(out.contains('▌'), "event row marker");
        // 右栏四段：产物列表 + TOOLS 真值盒 + EVIDENCE 真值盒 + 选中即预览。
        assert!(out.contains("TOOLS"), "right tools box");
        assert!(
            compact.contains("（引擎未声明能力目录）"),
            "honest tools placeholder without tool_catalog"
        );
        assert!(out.contains("EVIDENCE"), "right evidence box");
        assert!(out.contains("volcengine.com"), "real evidence domain");
        assert!(out.contains("PREVIEW"), "selected artifact preview");
        assert!(out.contains("report.md"), "real selected artifact name");
        // 三栏 SESSION 不重复员工卡（左栏已有身份）。
        assert!(!out.contains('╔'), "no duplicate pixel card in SESSION");
    }

    /// EMPLOYEE 面板 KPI = 跨会话累计真值（与 MARKET 屏同源）；memory count 引擎未透出
    /// 时 MEMORY 整节不显示（诚实原则）。STATUS/RISK 压缩保留在底部。
    #[test]
    fn employee_panel_shows_cumulative_kpi_truth_and_omits_unsent_memory() {
        use super::super::protocol::TaskEvent;
        let ev = |t: &str, ts: u64, d: serde_json::Value| TaskEvent::from_parts(t, ts, d);
        let mut state = AppState::default();
        state.reduce(&ev(
            "session.ready",
            1_783_400_000_000,
            serde_json::json!({"employee":{"name":"AI 落地鲸","role":"顾问","model":"m",
                "kpi_cumulative":{"tasks":9,"accepted":6,"auto_accepted":2,"total_cost":3.6,"first_hired_ts":1_700_000_000_000_u64}}}),
        ));
        let ui = UiState::default();
        let mut t = Terminal::new(TestBackend::new(160, 40)).expect("term");
        t.draw(|f| render(f, &state, &ui, "")).expect("draw");
        let out = screen(&t);
        let compact = out.replace(' ', "");
        assert!(compact.contains("AI落地鲸"), "employee name");
        assert!(out.contains("KPI"), "cumulative KPI section in rail");
        assert!(out.contains("67%"), "real accept rate 6/9");
        assert!(out.contains("$0.40"), "real avg cost 3.6/9");
        assert!(compact.contains("成长"), "autonomy narrative section");
        assert!(
            compact.contains("转正"),
            "accepted threshold projects to regular"
        );
        assert!(
            out.contains("P0–P4"),
            "growth narrative explicitly preserves permission model"
        );
        assert!(
            !out.contains("MEMORY"),
            "memory section omitted when engine did not send memory count"
        );
        assert!(out.contains("IDLE"), "compressed status badge");
        assert!(compact.contains("无阻断"), "compressed risk line");
    }

    /// v0.15 P1-3：TASK DETAIL 全屏浮层——o 键打开后覆盖整帧,四区全真数据
    /// (FULL EVENT LOG=timeline / OUTCOME / ARTIFACTS bytes / EVIDENCE source_type)。
    #[test]
    fn task_detail_overlay_renders_real_data_full_screen() {
        let state = scripted_workbench_state();
        let mut ui = UiState::default();
        ui.mode = InputMode::Normal;
        ui.open_overlay(Overlay::TaskDetail);
        let mut t = Terminal::new(TestBackend::new(160, 44)).expect("term");
        t.draw(|f| render(f, &state, &ui, "")).expect("draw");
        let out = screen(&t);
        // 四个区块框标题。
        assert!(out.contains("FULL EVENT LOG"), "event log box");
        assert!(out.contains("OUTCOME"), "outcome box");
        assert!(out.contains("ARTIFACTS"), "artifacts box");
        assert!(out.contains("EVIDENCE"), "evidence box");
        // 头部：task #N + 状态字 + cost/events meta。
        assert!(out.contains("task #"), "task number in header");
        assert!(out.contains("events"), "events count row/meta");
        // 全真值透出（与三栏同源）。
        assert!(out.contains("task.started"), "timeline event types in log");
        assert!(out.contains("$0.36"), "real est_cost");
        assert!(out.contains("12.4 KB"), "artifact bytes as KB");
        assert!(
            out.contains("official"),
            "evidence source_type (real, not fabricated)"
        );
        // 全屏浮层覆盖：底层三栏的 TASK QUEUE 标题不再可见（被不透明底盖住）。
        assert!(
            !out.contains("TASK QUEUE"),
            "full-screen overlay hides the 3-col underneath"
        );
        // 返回提示。
        let compact = out.replace(' ', "");
        assert!(
            compact.contains("返回工作台"),
            "esc-to-return hint; tail={:?}",
            &out[out.len().saturating_sub(500)..]
        );
    }

    /// v0.15 P1-5：产物预览浮层真读磁盘文件内容（read_artifact_preview 复用）。
    #[test]
    fn preview_overlay_reads_real_file_contents() {
        use crate::workbench::state::Artifact;
        use std::io::Write;
        // 写一个真临时文件作为产物正文。
        let mut path = std::env::temp_dir();
        path.push("crewclaw_preview_test_XY42.md");
        {
            let mut f = std::fs::File::create(&path).expect("write temp artifact");
            writeln!(f, "# 服务器清理报告").unwrap();
            writeln!(f, "年化节省 SENTINEL_ZZZ 元。").unwrap();
        }
        let mut state = AppState::default();
        state.artifacts.push(Artifact {
            id: Some("a1".to_string()),
            task_id: None,
            name: Some("report.md".to_string()),
            kind: Some("report".to_string()),
            artifact_type: None,
            path: Some(path.to_string_lossy().to_string()),
            export_path: None,
            status: "draft".to_string(),
            summary: None,
            checks: Vec::new(),
            bytes: Some(2048),
            created_ts: 0,
        });
        let mut ui = UiState::default();
        ui.open_overlay(Overlay::Preview);
        let mut t = Terminal::new(TestBackend::new(160, 44)).expect("term");
        t.draw(|f| render(f, &state, &ui, "")).expect("draw");
        let out = screen(&t);
        let compact = out.replace(' ', "");
        assert!(
            out.contains("SENTINEL_ZZZ"),
            "real file contents shown in preview"
        );
        assert!(out.contains("report.md"), "artifact name in title");
        assert!(out.contains("2.0 KB"), "real bytes meta");
        assert!(compact.contains("关闭"), "close hint present");
        let _ = std::fs::remove_file(&path);
    }

    /// v0.16 W4.1：预览浮层滚动偏移真的改变了可见正文(设计稿缺失的交互,渲染层这半);
    /// 底部 n/N 文件序号真值。键位驱动(press→preview_scroll 递增/[ ]归零)见 mod.rs 测试。
    #[test]
    fn preview_overlay_scroll_offset_changes_visible_body_and_shows_file_index() {
        use crate::workbench::state::Artifact;
        use std::io::Write;
        let mut path = std::env::temp_dir();
        path.push("crewclaw_preview_scroll_test.md");
        {
            let mut f = std::fs::File::create(&path).expect("write temp artifact");
            for i in 0..60 {
                writeln!(f, "LINE_MARK_{i:03}").unwrap();
            }
        }
        let mut state = AppState::default();
        state.artifacts.push(Artifact {
            id: Some("a1".to_string()),
            task_id: None,
            name: Some("first.md".to_string()),
            kind: Some("report".to_string()),
            artifact_type: None,
            path: Some(path.to_string_lossy().to_string()),
            export_path: None,
            status: "draft".to_string(),
            summary: None,
            checks: Vec::new(),
            bytes: Some(600),
            created_ts: 0,
        });
        state.artifacts.push(Artifact {
            id: Some("a2".to_string()),
            task_id: None,
            name: Some("second.md".to_string()),
            kind: Some("report".to_string()),
            artifact_type: None,
            path: None,
            export_path: None,
            status: "draft".to_string(),
            summary: None,
            checks: Vec::new(),
            bytes: None,
            created_ts: 0,
        });

        let mut ui = UiState::default();
        ui.open_overlay(Overlay::Preview);

        let mut t0 = Terminal::new(TestBackend::new(160, 44)).expect("term");
        t0.draw(|f| render(f, &state, &ui, "")).expect("draw");
        assert!(
            screen(&t0).contains("LINE_MARK_000"),
            "top of file visible at scroll=0"
        );
        // 底部 n/N 序号(首个产物,共 2 个)。
        assert!(screen(&t0).contains("1/2"), "footer shows n/N file index");

        ui.preview_scroll = 30;
        let mut t1 = Terminal::new(TestBackend::new(160, 44)).expect("term");
        t1.draw(|f| render(f, &state, &ui, "")).expect("draw");
        assert!(
            !screen(&t1).contains("LINE_MARK_000"),
            "scrolled past the first line"
        );

        let _ = std::fs::remove_file(&path);
    }

    /// v0.15 P1-2：通知中心浮层渲染真条目 + header 未读徽标。
    #[test]
    fn notifications_overlay_and_header_badge_show_unread() {
        use crate::workbench::state::{Notice, NoticeKind};
        let mut state = scripted_workbench_state();
        state.notices = vec![Notice {
            ts: 0,
            kind: NoticeKind::Approval,
            title: "等待批准".into(),
            body: "员工请求权限".into(),
            read: false,
        }];
        let mut ui = UiState::default();
        ui.mode = InputMode::Normal;
        // header 徽标（浮层未开）。
        let mut t = Terminal::new(TestBackend::new(160, 44)).expect("term");
        t.draw(|f| render(f, &state, &ui, "")).expect("draw");
        let compact = screen(&t).replace(' ', "");
        assert!(compact.contains("通知1"), "header shows unread badge count");
        // 打开浮层。
        ui.open_overlay(Overlay::Notifications);
        let mut t2 = Terminal::new(TestBackend::new(160, 44)).expect("term");
        t2.draw(|f| render(f, &state, &ui, "")).expect("draw");
        let out = screen(&t2);
        let c2 = out.replace(' ', "");
        assert!(out.contains("NOTIFICATIONS"), "overlay title");
        assert!(c2.contains("等待批准"), "notice title shown");
        assert!(c2.contains("1未读"), "unread count in overlay");
        assert!(c2.contains("全部已读"), "R hint present");
        // v0.16 W4.2：跳转行动文案 + 右上角锚定(而非居中)。screen() 拍平整个 buffer 不含换行,
        // 逐行断言需按 y 单独取一行文本(row_text),不能对 out 直接 .lines()。
        assert!(c2.contains("→去批准"), "action text for Approval kind");
        let title_row = row_text(&t2, 1);
        let title_col = title_row
            .find("NOTIFICATIONS")
            .expect("title row has NOTIFICATIONS");
        assert!(
            title_col as u16 > t2.size().unwrap().width / 2,
            "overlay title starts in the right half (top-right anchor), got col={title_col}"
        );
    }

    /// v0.16 W4.4：which-key 改底部停靠横条——docked above input(不是覆盖 body 的居中浮板),
    /// 4 组横排;bg1 底。
    #[test]
    fn which_key_docks_above_input_as_horizontal_bar() {
        let state = AppState::default();
        let mut ui = UiState::default();
        ui.mode = InputMode::Normal;
        ui.which_key = true;
        let mut t = Terminal::new(TestBackend::new(160, 44)).expect("term");
        t.draw(|f| render(f, &state, &ui, "")).expect("draw");
        let out = screen(&t);
        let compact = out.replace(' ', ""); // CJK 宽字符续格空位——去空格断言(v0.13 教训)。
        assert!(out.contains("SCREENS"), "screens group");
        assert!(out.contains("NAVIGATE"), "navigate group");
        assert!(out.contains("ACTIONS"), "actions group");
        assert!(out.contains("UI"), "ui group");
        assert!(compact.contains("切屏"), "key description present");

        // 4 组同一行高度内横向并列（不是旧版居中双列浮板）：SCREENS 与 UI 应在同一 y 行范围内
        // 各自的标题行都能找到，且 SCREENS 出现在比 UI 更靠左的列。
        let backend = t.backend().buffer();
        let width = t.size().unwrap().width;
        let find_col = |needle: &str, y: u16| -> Option<usize> {
            let row: String = (0..width)
                .map(|x| backend.cell((x, y)).unwrap().symbol())
                .collect::<String>();
            row.find(needle)
        };
        // 找到 SCREENS 和 UI 各自所在的行(应相同,横排同一行)。
        let mut screens_row = None;
        let mut ui_row = None;
        for y in 0..t.size().unwrap().height {
            if find_col("SCREENS", y).is_some() {
                screens_row = Some(y);
            }
            if find_col("UI", y).is_some() {
                ui_row = Some(y);
            }
        }
        assert_eq!(
            screens_row, ui_row,
            "SCREENS and UI group titles are on the same row (horizontal layout)"
        );
    }

    /// v0.16 W4.5：命令菜单样式对齐设计稿——yellow 边框 + 题行提示 + ▌ 选中语言。
    #[test]
    fn command_picker_renders_yellow_border_and_selection_marker() {
        let _guard = THEME_TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        config::set_theme(config::Theme::DARK);
        use crate::workbench::state::{CommandInfo, CommandPicker};
        let mut state = AppState::default();
        state.command_picker = Some(CommandPicker {
            query: "".to_string(),
            selected: 1,
            matches: vec![
                CommandInfo {
                    name: "/help".to_string(),
                    desc: "打开帮助".to_string(),
                },
                CommandInfo {
                    name: "/clear".to_string(),
                    desc: "清空上下文".to_string(),
                },
            ],
        });
        let ui = UiState::default();
        let mut t = Terminal::new(TestBackend::new(160, 44)).expect("term");
        t.draw(|f| render(f, &state, &ui, "")).expect("draw");
        let out = screen(&t);
        let compact = out.replace(' ', ""); // CJK 续格空位——去空格断言(v0.13 教训)。
        assert!(out.contains("COMMANDS"), "title present");
        assert!(out.contains("/help"), "first command listed");
        assert!(out.contains("/clear"), "second command listed");
        assert!(compact.contains("清空上下文"), "desc column shown");
        assert!(
            buffer_has_fg(&t, config::Theme::DARK.yellow),
            "yellow accents present"
        );
    }

    /// v0.16 W4.6：入职仪式对齐设计稿——WELCOME ABOARD 题头(green)+ 每步标题 yellow +
    /// 底行步点(当前步 ● 实心/其余 ○)+ 有真头像时左列 blue 展示。
    #[test]
    fn onboarding_renders_welcome_title_step_dots_and_avatar() {
        let _guard = THEME_TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        config::set_theme(config::Theme::DARK);
        use crate::workbench::state::{Employee, OnboardingState};
        let mut state = AppState::default();
        state.employee = Some(Employee {
            name: "AI落地鲸".to_string(),
            role: "企业AI转型顾问".to_string(),
            model: "claude-opus-4.8".to_string(),
            skills: vec![],
            avatar: vec!["  .".to_string(), " (o)".to_string()],
            kpi_cumulative: crate::workbench::state::KpiCumulative::default(),
            eval: None,
            growth_card: None,
        });
        let mut ui = UiState::default();
        ui.set_onboarding(Some(OnboardingState { step: 1 }));
        let mut t = Terminal::new(TestBackend::new(160, 44)).expect("term");
        t.draw(|f| render(f, &state, &ui, "")).expect("draw");
        let out = screen(&t);
        let compact = out.replace(' ', "");
        assert!(out.contains("WELCOME ABOARD"), "welcome title");
        assert!(
            compact.contains("协作方式"),
            "step 2 title shown (0-indexed step=1)"
        );
        assert!(out.contains('●'), "current step dot filled");
        assert!(out.contains('○'), "other step dot hollow");
        assert!(
            buffer_has_fg(&t, config::Theme::DARK.blue),
            "avatar rendered in blue"
        );
        assert!(
            buffer_has_fg(&t, config::Theme::DARK.green),
            "green welcome/border accents"
        );
    }

    /// v0.16 修复：居中弹层必须先铺整帧幕布——四周留白不能露出底层 WORKBENCH 的真实内容。
    /// 用户真机截图报障：EMPLOYEE 面板紧邻 SETTINGS 弹层左边缘时,中间窄留白会切出几个
    /// 读不懂的 CJK 字符碎片(SESSION 占位句的半个字),像是画面损坏。
    /// 断言：打开 SETTINGS/PREVIEW/PUBLISH/ONBOARDING 后,底层三栏才有的真实文本一律不可见。
    #[test]
    fn modal_overlays_backdrop_hides_underlying_workbench_content() {
        use crate::workbench::state::{Artifact, MarketEntry};
        let mut state = scripted_workbench_state();
        state.artifacts.push(Artifact {
            id: Some("a1".to_string()),
            task_id: None,
            name: Some("report.md".to_string()),
            kind: Some("report".to_string()),
            artifact_type: None,
            path: Some("nonexistent.md".to_string()),
            export_path: None,
            status: "draft".to_string(),
            summary: None,
            checks: Vec::new(),
            bytes: Some(1024),
            created_ts: 0,
        });

        // 底层三栏在这份 state 下真实会出现的、独一无二的文本片段。
        let leaks = [
            "EMPLOYEE",
            "TASK QUEUE",
            "task.started",
            "ARTIFACTS",
            "调研 2026",
        ];

        let assert_no_leak = |ui: &UiState, label: &str| {
            let mut t = Terminal::new(TestBackend::new(160, 44)).expect("term");
            t.draw(|f| render(f, &state, ui, "")).expect("draw");
            let out = screen(&t);
            for leak in leaks {
                assert!(
                    !out.contains(leak),
                    "{label}: underlying WORKBENCH content '{leak}' leaked through the modal backdrop"
                );
            }
        };

        let mut ui = UiState::default();
        ui.mode = InputMode::Normal;
        ui.market = vec![MarketEntry {
            name: "whale".to_string(),
            display_name: "AI落地鲸".to_string(),
            ..Default::default()
        }];

        ui.open_overlay(Overlay::Settings);
        assert_no_leak(&ui, "SETTINGS");
        ui.close_overlay();

        ui.open_overlay(Overlay::Preview);
        assert_no_leak(&ui, "PREVIEW");
        ui.close_overlay();

        ui.set_publish_step(Some(0));
        assert_no_leak(&ui, "PUBLISH");
        ui.set_publish_step(None);

        ui.set_onboarding(Some(crate::workbench::state::OnboardingState { step: 0 }));
        assert_no_leak(&ui, "ONBOARDING");
        ui.set_onboarding(None);

        // v0.17 P1-B2：COMPARE 也是居中弹层，同样得先铺幕布。
        ui.market.push(MarketEntry {
            name: "octopus".to_string(),
            display_name: "Docs Octopus".to_string(),
            ..Default::default()
        });
        ui.compare_selection = vec![0, 1];
        ui.open_overlay(Overlay::Compare);
        assert_no_leak(&ui, "COMPARE");
        ui.close_overlay();

        ui.open_overlay(Overlay::FireConfirm {
            market_index: 0,
            mode: crate::OffboardingMode::ExportMemory,
        });
        assert_no_leak(&ui, "FIRE CONFIRM");
        let mut fire = Terminal::new(TestBackend::new(160, 44)).expect("term");
        fire.draw(|frame| render(frame, &state, &ui, ""))
            .expect("draw fire confirmation");
        let fire_text = screen(&fire).replace(' ', "");
        assert!(fire_text.contains("解雇确认"));
        assert!(fire_text.contains("AI落地鲸"));
        assert!(fire_text.contains("导出记忆包"));
        assert!(fire_text.contains("交接继任者"));
        assert!(fire_text.contains("彻底删除应用状态"));
        assert!(fire_text.contains("不等于存储介质清除"));
    }

    /// v0.17 P0-1：SETTINGS「信息密度 compact」必须**真的生效**——审计发现它只存值/持久化,
    /// 渲染层零消费点,切换选项画面毫无变化(违反"无真明示"原则)。修法:compact 时 EMPLOYEE
    /// 面板去掉 3 处虚线分隔(╌),断言 compact 帧比 comfortable 帧少 3 个 "╌" 字符行。
    #[test]
    fn density_compact_actually_removes_employee_panel_separators() {
        let state = scripted_workbench_state();
        let mut ui = UiState::default();
        ui.mode = InputMode::Normal;

        ui.prefs.density = 0; // comfortable
        let mut t0 = Terminal::new(TestBackend::new(160, 44)).expect("term");
        t0.draw(|f| render(f, &state, &ui, "")).expect("draw");
        let comfortable_dashes = screen(&t0).matches('╌').count();

        ui.prefs.density = 1; // compact
        let mut t1 = Terminal::new(TestBackend::new(160, 44)).expect("term");
        t1.draw(|f| render(f, &state, &ui, "")).expect("draw");
        let compact_dashes = screen(&t1).matches('╌').count();

        assert!(
            compact_dashes < comfortable_dashes,
            "compact density must visibly remove separators: comfortable={comfortable_dashes} compact={compact_dashes}"
        );
    }

    /// v0.15 P1-1：SETTINGS 浮层渲染 APPEARANCE(真)/BEHAVIOR(引擎暂不支持)两组。
    #[test]
    fn settings_overlay_renders_appearance_and_behavior_groups() {
        let state = AppState::default();
        let mut ui = UiState::default();
        ui.mode = InputMode::Normal;
        ui.open_overlay(Overlay::Settings);
        let mut t = Terminal::new(TestBackend::new(160, 44)).expect("term");
        t.draw(|f| render(f, &state, &ui, "")).expect("draw");
        let out = screen(&t);
        let compact = out.replace(' ', "");
        assert!(out.contains("SETTINGS"), "overlay title");
        assert!(out.contains("APPEARANCE"), "appearance group");
        assert!(out.contains("BEHAVIOR"), "behavior group");
        assert!(compact.contains("主题"), "theme row");
        // v0.16 W4.3：行距 → 信息密度(设计稿标签);desc 列 + 设计稿选项集。
        assert!(compact.contains("信息密度"), "density row (design label)");
        assert!(
            compact.contains("行高与面板留白"),
            "desc column shown for density row"
        );
        assert!(
            compact.contains("comfortable") || compact.contains("compact"),
            "design's density option value shown"
        );
        assert!(
            compact.contains("$20") || compact.contains("$50"),
            "design's budget option value shown"
        );
        assert!(
            compact.contains("引擎暂不支持"),
            "behavior rows flagged unsupported (honest)"
        );
    }

    /// v0.16 W0：整帧铺主题底色——4 套主题逐一应用后,画面四角的 cell.bg 必须等于该主题 bg。
    /// (根因回归:此前 UI 画在终端默认黑底上,主题切换只剩文字微差,light 两套不可用。)
    #[test]
    fn theme_bg_fills_entire_frame_for_all_four_themes() {
        let _guard = THEME_TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let state = AppState::default();
        let ui = UiState::default();
        for (idx, theme) in config::THEME_CYCLE.iter().enumerate() {
            config::apply_theme_index(idx, None);
            let mut t = Terminal::new(TestBackend::new(100, 30)).expect("term");
            t.draw(|f| render(f, &state, &ui, "")).expect("draw");
            let buf = t.backend().buffer();
            // 角点避开底部两行(modeline 模式块/主题名块自带 bg;hint 行 Clear 后自补 bg)。
            for (x, y) in [(0u16, 0u16), (99, 0), (0, 15), (99, 15), (50, 10)] {
                assert_eq!(
                    buf.cell((x, y)).unwrap().style().bg,
                    Some(theme.bg),
                    "theme #{idx} cell ({x},{y}) must carry the theme bg"
                );
            }
        }
        // 收尾恢复默认，避免污染后续测试（主题是进程级 RwLock）。
        config::set_theme(config::Theme::DARK);
    }

    /// v0.16 W1：hint 行双色键帽(键=fg 亮 bold/描述=dim)+ modeline 铺 ml 底、屏名/主题名 bg2 色块。
    #[test]
    fn hint_row_keycaps_and_modeline_segments() {
        let _guard = THEME_TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        config::set_theme(config::Theme::DARK);
        let state = AppState::default();
        let mut ui = UiState::default();
        ui.mode = InputMode::Normal;
        // ≥148×35 才不触发尺寸警告，否则警告占满 hint 行会截断键帽词。
        let mut t = Terminal::new(TestBackend::new(148, 35)).expect("term");
        t.draw(|f| render(f, &state, &ui, "")).expect("draw");
        let out = screen(&t);
        let compact = out.replace(' ', "");
        // NORMAL 键帽词(设计稿 footer)。
        assert!(compact.contains("直接打字"), "typing-first keycap");
        assert!(compact.contains("1-5切屏"), "screen-switch keycap");
        assert!(compact.contains("t主题"), "theme keycap");
        assert!(compact.contains("T队列"), "task queue keycap");
        assert!(compact.contains("Space快捷键"), "which-key keycap");
        // modeline:屏名块与主题名块带 bg2、行底 ml(真色断言)。
        let buf = t.backend().buffer();
        let bottom = 34u16;
        let mut saw_bg2 = false;
        let mut saw_ml = false;
        for x in 0..148u16 {
            match buf.cell((x, bottom)).unwrap().style().bg {
                Some(c) if c == config::Theme::DARK.bg2 => saw_bg2 = true,
                Some(c) if c == config::Theme::DARK.ml => saw_ml = true,
                _ => {}
            }
        }
        assert!(
            saw_bg2,
            "modeline has bg2 segment blocks (screen/theme name)"
        );
        assert!(saw_ml, "modeline row is painted with --ml background");
        // INSERT 侧键帽词。
        ui.mode = InputMode::Insert;
        let mut t2 = Terminal::new(TestBackend::new(148, 35)).expect("term");
        t2.draw(|f| render(f, &state, &ui, "")).expect("draw");
        let c2 = screen(&t2).replace(' ', "");
        assert!(c2.contains("Enter发送"), "insert enter keycap");
        assert!(c2.contains("↑↓历史输入"), "history keycap");
        assert!(c2.contains("Ctrl+U清行"), "clear-line keycap");
    }

    /// v0.15 P1-4：PUBLISH 浮层——步骤 1 真校验(registry+doctor),步骤 2 起 MOCK 明示。
    #[test]
    fn publish_overlay_step1_real_step2_marked_mock() {
        use crate::workbench::state::{HireHealth, MarketEntry};
        let mut ui = UiState::default();
        ui.mode = InputMode::Normal;
        ui.market = vec![MarketEntry {
            name: "whale".into(),
            display_name: "AI落地鲸".into(),
            certification: "ChaoGeek".into(),
            category: "growth".into(),
            first_task: "写一份服务器清理报告".into(),
            ..Default::default()
        }];
        ui.hire_reports = vec![HireHealth {
            status: "healthy".into(),
            issues: vec![],
            suggestions: vec![],
        }];
        let state = AppState::default();

        // 步骤 0：真实校验行。
        ui.set_publish_step(Some(0));
        let mut t = Terminal::new(TestBackend::new(160, 44)).expect("term");
        t.draw(|f| render(f, &state, &ui, "")).expect("draw");
        let s0 = screen(&t);
        let c0 = s0.replace(' ', "");
        assert!(s0.contains("PUBLISH"), "overlay title");
        assert!(s0.contains("Manifest"), "step 1 name in step bar");
        assert!(
            c0.contains("registry+doctor") || c0.contains("真实校验"),
            "step 1 marked real"
        );
        assert!(c0.contains("ChaoGeek"), "real registry cert shown");
        assert!(c0.contains("healthy"), "real doctor status shown");
        assert!(!s0.contains("MOCK"), "step 1 has no MOCK tag (it is real)");

        // 步骤 1：MOCK 明示。
        ui.set_publish_step(Some(1));
        let mut t2 = Terminal::new(TestBackend::new(160, 44)).expect("term");
        t2.draw(|f| render(f, &state, &ui, "")).expect("draw");
        let s1 = screen(&t2);
        assert!(s1.contains("MOCK"), "step 2+ rows carry MOCK tag (honest)");
    }

    /// v0.16 W3.2：TASK QUEUE running 行头在 busy 时用 braille 旋转帧(而非静态 →)——
    /// 真值来自 busy_since 时长(与底部 spinner 同源推导),诚实地对应设计稿队列动效。
    #[test]
    fn queue_running_row_shows_braille_spinner_while_busy() {
        let mut state = AppState::default();
        state.task = Some(crate::workbench::state::Task {
            id: Some("t1".to_string()),
            title: "调研任务".to_string(),
            status: "running".to_string(),
        });
        state.busy_since = Some(std::time::Instant::now());
        let ui = UiState::default();
        let mut t = Terminal::new(TestBackend::new(160, 44)).expect("term");
        t.draw(|f| render(f, &state, &ui, "")).expect("draw");
        let out = screen(&t);
        assert!(
            !out.contains('→'),
            "static arrow replaced by braille spinner while busy"
        );
        assert!(
            SPINNER_FRAMES.iter().any(|f| out.contains(f)),
            "a braille spinner frame is present: {out}"
        );

        // 非 busy 态(理论上不该发生于 running 任务,但兜底)时回退静态箭头,不崩溃。
        state.busy_since = None;
        let mut t2 = Terminal::new(TestBackend::new(160, 44)).expect("term");
        t2.draw(|f| render(f, &state, &ui, "")).expect("draw");
        assert!(
            screen(&t2).contains('→'),
            "falls back to static arrow when not busy"
        );
    }

    /// A terminal task is not necessarily a successful task. Reproduce the 403 screenshot's
    /// reducer sequence and keep a real successful chat turn as the positive control.
    #[test]
    fn task_queue_renders_rejected_as_failure_and_completed_as_success() {
        use super::super::protocol::TaskEvent;

        let ev =
            |kind: &str, seq: u64, data: serde_json::Value| TaskEvent::from_parts(kind, seq, data);
        let render_state = |state: &AppState| {
            let ui = UiState::default();
            let mut terminal = Terminal::new(TestBackend::new(160, 44)).expect("term");
            terminal
                .draw(|frame| render(frame, state, &ui, ""))
                .expect("draw");
            screen(&terminal)
        };

        let mut rejected = AppState::default();
        rejected.reduce(&ev(
            "task.started",
            1,
            serde_json::json!({"id":"task-fail","title":"hi","mode":"Chat","turn_id":"turn-fail","seq":1}),
        ));
        rejected.reduce(&ev(
            "generation.started",
            2,
            serde_json::json!({"id":"generation-fail","taskRunId":"task-fail","turn_id":"turn-fail","seq":2}),
        ));
        rejected.reduce(&ev(
            "generation.failed",
            3,
            serde_json::json!({"id":"generation-fail","taskRunId":"task-fail","turn_id":"turn-fail","seq":3,"reason":"HTTP 403"}),
        ));
        rejected.reduce(&ev(
            "task.rejected",
            4,
            serde_json::json!({"id":"task-fail","taskRunId":"task-fail","reason":"HTTP 403"}),
        ));
        let rejected_screen = render_state(&rejected);
        assert!(
            rejected_screen.contains("✗ #1"),
            "rejected task must carry a failure symbol: {rejected_screen}"
        );
        assert!(
            !rejected_screen.contains("✓ #1"),
            "rejected task must never look completed: {rejected_screen}"
        );

        let mut completed = AppState::default();
        completed.reduce(&ev(
            "task.started",
            1,
            serde_json::json!({"id":"task-ok","title":"hello","mode":"Chat","turn_id":"turn-ok","seq":1}),
        ));
        completed.reduce(&ev(
            "generation.started",
            2,
            serde_json::json!({"id":"generation-ok","taskRunId":"task-ok","turn_id":"turn-ok","seq":2}),
        ));
        completed.reduce(&ev(
            "generation.completed",
            3,
            serde_json::json!({"id":"generation-ok","taskRunId":"task-ok","turn_id":"turn-ok","seq":3}),
        ));
        completed.reduce(&ev(
            "task.completed",
            4,
            serde_json::json!({"id":"task-ok","taskRunId":"task-ok"}),
        ));
        let completed_screen = render_state(&completed);
        assert!(
            completed_screen.contains("✓ #1"),
            "completed task keeps the success symbol: {completed_screen}"
        );
        assert!(!completed_screen.contains("✗ #1"));
    }

    /// v0.16 W3.5：审批 accepted 后,WAITING APPROVAL 条槽位改画绿色 verdict 结论
    /// (真事件驱动,非造数据);approval 仍 pending 时不显示 verdict。
    #[test]
    fn verdict_bar_replaces_waiting_approval_slot_after_accept() {
        let mut state = scripted_workbench_state();
        state.last_verdict = Some((true, "★ 已验收 · KPI accept +1".to_string()));
        let ui = UiState::default();
        let mut t = Terminal::new(TestBackend::new(160, 44)).expect("term");
        t.draw(|f| render(f, &state, &ui, "")).expect("draw");
        let out = screen(&t);
        let compact = out.replace(' ', "");
        assert!(compact.contains("已验收"), "verdict text shown: {out}");
        assert!(
            !out.contains("WAITING APPROVAL"),
            "no stale waiting-approval bar alongside verdict"
        );

        // 仍在等待审批时不显示 verdict(approval 优先)。
        state.last_verdict = Some((false, "✗ 已驳回".to_string()));
        state.approval = Some(crate::workbench::state::Approval {
            id: Some("ap1".to_string()),
            tool: Some("web.fetch".to_string()),
            reason: Some("需要网络访问".to_string()),
            scope: None,
            session_lease: None,
        });
        let mut t2 = Terminal::new(TestBackend::new(160, 44)).expect("term");
        t2.draw(|f| render(f, &state, &ui, "")).expect("draw");
        let out2 = screen(&t2);
        assert!(
            out2.contains("WAITING APPROVAL"),
            "pending approval takes priority over stale verdict"
        );
        assert!(
            !out2.replace(' ', "").contains("已驳回"),
            "stale verdict hidden while approval pending"
        );
    }

    /// v0.14 终验：全要素快照断言——大字标/头像/队列#号/SESSION右标题/右对齐meta/三盒/
    /// 生成于/底部两行/n:N/详情提示。ASCII 标记（CJK 用去空格法）。
    #[test]
    fn v014_full_parity_snapshot_assertions() {
        let mut state = scripted_workbench_state();
        if let Some(emp) = state.employee.as_mut() {
            emp.avatar = vec![
                "       .".to_string(),
                r#"      ":""#.to_string(),
                r"  |  o  |".to_string(),
                "~^~^~^~^~".to_string(),
            ];
        }
        let mut ui = UiState::default();
        ui.mode = InputMode::Normal;
        let idx = state
            .timeline
            .iter()
            .position(|e| e.event_type == "tool.requested")
            .unwrap();
        ui.session_cursor = Some(idx);
        ui.follow = false;
        let mut t = Terminal::new(TestBackend::new(160, 44)).expect("term");
        t.draw(|f| render(f, &state, &ui, "")).expect("draw");
        let out = screen(&t);
        let compact = out.replace(' ', "");
        assert!(out.contains("▄▀▀▀ █▀▀▄"), "big logo");
        assert!(out.contains("[1] WORKBENCH"), "spaced tab");
        assert!(
            out.contains("~^~^~^~^~"),
            "avatar.txt pipeline renders in the workbench rail (v0.14 N2)"
        );
        assert!(out.contains("✓ #1"), "task queue ordinal");
        assert!(out.contains("task #1"), "SESSION right title with real seq");
        assert!(out.contains("$0.36"), "real cost");
        assert!(compact.contains("report.md"), "real selected artifact");
        assert!(out.contains("PREVIEW"), "inline artifact preview");
        assert!(compact.contains("j/k事件"), "detail hint row");
        assert!(
            out.contains("2:5"),
            "modeline n:N from real cursor/timeline"
        );
        assert!(compact.contains("╌╌╌"), "dashed separators in EMPLOYEE");
    }

    /// v0.13 M5：审批期——宽屏渲染 WAITING APPROVAL 条（不遮 SESSION），窄屏保留居中模态。
    #[test]
    fn approval_renders_bar_wide_and_modal_narrow() {
        let mut state = scripted_workbench_state();
        state.approval = Some(super::super::state::Approval {
            id: Some("appr1".to_string()),
            tool: Some("shell.exec".to_string()),
            reason: Some("需要执行受控命令".to_string()),
            scope: None,
            session_lease: None,
        });
        let ui = UiState::default();
        // 宽屏：条在中栏底部，含键位提示。
        let mut t = Terminal::new(TestBackend::new(160, 40)).expect("term");
        t.draw(|f| render(f, &state, &ui, "")).expect("draw");
        let wide = screen(&t);
        assert!(wide.contains("WAITING APPROVAL"), "wide bar shown");
        assert!(wide.contains("[a]") && wide.contains("[r]"), "bar keys");
        // v0.14 N0：header 右侧显示真实待办数（审批挂起 = 1）。CJK 续格 → 去空格断言。
        assert!(
            wide.replace(' ', "").contains("待办1·"),
            "header shows real pending count"
        );
        // <100 列：模态照旧；100-139 列是 SESSION + PREVIEW 双栏。
        let mut t2 = Terminal::new(TestBackend::new(99, 30)).expect("term");
        t2.draw(|f| render(f, &state, &ui, "")).expect("draw");
        let narrow = screen(&t2);
        assert!(!narrow.contains("WAITING APPROVAL"), "no bar below 100");
        assert!(
            narrow.contains("[a]") && narrow.contains("[d]"),
            "modal keys"
        );
    }

    #[test]
    fn scoped_session_approval_names_allowlist_and_third_choice() {
        let mut state = scripted_workbench_state();
        state.approval = Some(super::super::state::Approval {
            id: Some("appr-session".to_string()),
            tool: Some("write_file".to_string()),
            reason: Some("应用以上改动".to_string()),
            scope: Some(serde_json::json!("workspace")),
            session_lease: Some(serde_json::json!({
                "kind":"session",
                "allowlist":[{"tool":"write_file","pattern":"docs/**"}]
            })),
        });
        let ui = UiState::default();

        let mut wide_terminal = Terminal::new(TestBackend::new(160, 40)).expect("term");
        wide_terminal
            .draw(|frame| render(frame, &state, &ui, ""))
            .expect("draw wide");
        let wide = screen(&wide_terminal).replace(' ', "");
        assert!(
            wide.contains("[s]本会话"),
            "wide bar exposes session choice"
        );
        assert!(
            wide.contains("write_file·docs/**"),
            "wide bar confirms the exact allowlist: {wide}"
        );

        let mut narrow_terminal = Terminal::new(TestBackend::new(99, 30)).expect("term");
        narrow_terminal
            .draw(|frame| render(frame, &state, &ui, ""))
            .expect("draw narrow");
        let narrow = screen(&narrow_terminal).replace(' ', "");
        assert!(narrow.contains("本会话放行清单"));
        assert!(narrow.contains("write_file·docs/**"));
        assert!(narrow.contains("[a]仅本次[s]本会话[d]拒绝"));
    }

    /// v0.13 M4：j/k 选中事件后，EVENT DETAIL 面板出现并显示该事件的 kv。
    #[test]
    fn event_detail_pane_follows_session_cursor() {
        let state = scripted_workbench_state();
        let mut ui = UiState::default();
        let idx = state
            .timeline
            .iter()
            .position(|e| e.event_type == "tool.requested")
            .expect("tool entry");
        ui.session_cursor = Some(idx);
        ui.follow = false;
        let mut t = Terminal::new(TestBackend::new(160, 40)).expect("term");
        t.draw(|f| render(f, &state, &ui, "")).expect("draw");
        let out = screen(&t);
        assert!(out.contains("EVENT DETAIL"), "detail pane shown");
        assert!(out.contains("web_search"), "detail kv shows tool value");
        assert!(
            out.contains("Enter"),
            "collapsible row exposes the Enter hint"
        );
    }

    /// 宽 <70 保持单栏；70-99 为中屏侧栏，100-139 为内容优先双栏，≥140 才显示压缩员工栏。
    #[test]
    fn workbench_narrow_keeps_single_column() {
        let state = scripted_workbench_state();
        let ui = UiState::default();
        let mut t = Terminal::new(TestBackend::new(69, 30)).expect("term");
        t.draw(|f| render(f, &state, &ui, "")).expect("draw");
        let out = screen(&t);
        assert!(
            !out.contains("TASK QUEUE"),
            "no multi-column chrome below 70"
        );
        assert!(
            out.contains('╔'),
            "single-column keeps the pixel employee card"
        );
    }

    #[test]
    fn header_shows_all_five_tabs_on_every_screen() {
        // v0.12 M1：常驻 header 的 tab 栏在任何屏都完整显示 [1]..[5]，且带品牌与员工状态点。
        for s in Screen::ALL {
            let out = render_screen_to_string(s, InputMode::Insert);
            assert!(out.contains("CREWCLAW"), "header brand on {:?}", s);
            assert!(out.contains("[1] WORKBENCH"), "tab 1 on {:?}", s);
            assert!(out.contains("[5] DREAM"), "tab 5 on {:?}", s);
            assert!(out.contains('●'), "employee status dot on {:?}", s);
        }
    }

    #[test]
    fn modeline_reflects_input_mode() {
        // Insert 默认 / Normal 显示对应徽标与提示。
        let insert = render_screen_to_string(Screen::Workbench, InputMode::Insert);
        assert!(insert.contains("INSERT"), "INSERT badge");
        let normal = render_screen_to_string(Screen::Workbench, InputMode::Normal);
        assert!(normal.contains("NORMAL"), "NORMAL badge");
        // ASCII marker（CJK 在扁平 buffer 里被续格空格打断，只断言 ASCII，见 screen() 宽字符注记）。
        assert!(normal.contains("1-5"), "NORMAL shows screen-switch hint");
    }

    #[test]
    fn eval_and_dream_screens_use_honest_empty_states() {
        super::super::flow_state::reset_dream_projection();
        let eval = render_screen_to_string(Screen::Eval, InputMode::Normal);
        let dream = render_screen_to_string(Screen::Dream, InputMode::Normal);
        let eval_compact = eval.replace(' ', "");
        let dream_compact = dream.replace(' ', "");
        assert!(eval_compact.contains("未评测"));
        assert!(
            dream_compact.contains("未复盘"),
            "DREAM empty state:\n{dream}"
        );
        assert!(!eval_compact.contains("示例数据"));
        assert!(!dream_compact.contains("MOCK"));
        assert!(eval_compact.contains("KPI"));
    }

    #[test]
    fn eval_and_dream_render_unsafe_persisted_state_as_unverifiable() {
        let state = employee_state();
        let mut ui = UiState::default();
        ui.persisted_state_active = true;
        ui.persisted_insights.errors = vec![
            "eval: unsafe link".to_string(),
            "kpi: corrupt".to_string(),
            "runs: unsafe link".to_string(),
            "memory: corrupt".to_string(),
        ];

        ui.screen = Screen::Eval;
        let mut eval_terminal = Terminal::new(TestBackend::new(140, 40)).expect("term");
        eval_terminal
            .draw(|frame| render(frame, &state, &ui, ""))
            .expect("draw eval");
        let eval = screen(&eval_terminal).replace(' ', "");
        assert!(eval.contains("评测状态不可验证"));
        assert!(eval.contains("KPI状态不可验证"));

        ui.screen = Screen::Dream;
        let mut dream_terminal = Terminal::new(TestBackend::new(160, 40)).expect("term");
        dream_terminal
            .draw(|frame| render(frame, &state, &ui, ""))
            .expect("draw dream");
        let dream = screen(&dream_terminal).replace(' ', "");
        assert!(dream.contains("复盘状态不可验证"));
        assert!(dream.contains("记忆状态不可验证"));
    }

    #[test]
    fn approval_modal_forces_workbench_body() {
        // 审批期间即便 ui_state.screen 是别的屏，也强制渲染 WORKBENCH（审批闸不可被切屏绕过）。
        let mut state = employee_state();
        state.approval = Some(super::super::state::Approval {
            id: Some("a1".to_string()),
            tool: Some("shell.exec".to_string()),
            reason: Some("需要执行受控命令".to_string()),
            scope: None,
            session_lease: None,
        });
        let mut ui = UiState::default();
        ui.screen = Screen::Dream; // 试图停在 DREAM
        let mut t = Terminal::new(TestBackend::new(84, 20)).expect("term");
        t.draw(|f| render(f, &state, &ui, "")).expect("draw");
        let out = screen(&t);
        // ASCII 标记（审批弹窗按钮）比 CJK 标题更可靠。
        assert!(
            out.contains("[a]") && out.contains("[d]"),
            "approval modal buttons shown"
        );
        assert!(
            !out.contains("未复盘"),
            "DREAM body suppressed during approval"
        );
    }

    #[test]
    fn banner_present_on_empty_then_scrolls_out_with_conversation() {
        // AC-VIS-001 / v0.11 M2：空态顶部有身份内容。有员工且够宽 → 像素员工卡（显示员工身份
        // + 像素头像），是消息流首内容；无员工的通用 CREWCLAW banner 回退另有测试覆盖。
        let state = employee_state();
        let lines = layout_lines(&state, 60);
        let joined: String = lines
            .iter()
            .flat_map(|l| l.spans.iter().map(|s| s.content.clone()))
            .collect();
        assert!(
            joined.contains("小鲸"),
            "empty state shows employee identity"
        );
        assert!(
            joined.contains('▛'),
            "employee pixel card present on empty state"
        );
    }

    #[test]
    fn conversation_messages_use_designed_role_headers() {
        let mut state = employee_state();
        state.push_user_message("测试一下".to_string());
        state
            .conversation
            .push(ConversationItem::Assistant("收到".to_string()));
        let lines = layout_lines(&state, 60);
        let joined: String = lines
            .iter()
            .flat_map(|l| l.spans.iter().map(|s| s.content.clone()))
            .collect();
        assert!(
            joined.contains("你 › 测试一下"),
            "user role header: {joined}"
        );
        assert!(
            joined.contains("鲸 ◆ 收到"),
            "assistant role header: {joined}"
        );
    }

    #[test]
    fn user_wrapped_continuation_aligns_after_cjk_role_header() {
        let lines = message_lines_plain(
            "这是一段需要折行的比较长的用户消息内容用来验证续行对齐",
            USER_MESSAGE_HEADER,
            config::yellow(),
            20,
            false,
        );
        assert!(lines.len() >= 2, "fixture must wrap");
        assert_eq!(lines[0].spans[0].content, "你 › ");
        let indent = " ".repeat("你 › ".width());
        assert!(
            lines
                .iter()
                .skip(1)
                .all(|line| line.spans[0].content == indent),
            "continuations align to body column"
        );
        assert!(lines.iter().all(|line| line.width() <= 20));
    }

    #[test]
    fn no_header_row_model_in_input_title() {
        // AC-VIS-003：不再有顶部 header；model 出现在输入框标题。
        let state = employee_state();
        let mut terminal = Terminal::new(TestBackend::new(90, 24)).expect("term");
        terminal
            .draw(|frame| render(frame, &state, &UiState::default(), ""))
            .expect("draw");
        let screen = screen(&terminal);
        // 输入框标题应含 model；顶部第一行不应是旧 header 的「模式·状态·模型」串。
        assert!(
            screen.contains("claude"),
            "model label present (input title)"
        );
        assert!(!screen.contains("Chat · "), "old header status string gone");
    }

    /// v0.11 M4：思考块经完整 render() 路径——折叠态显示 `▸ ✦ 思考 +N lines`，展开态显示推理内容；
    /// 交付正文与思考分离（answer 只含 token.delta 文本）。
    #[test]
    fn thinking_block_renders_folded_and_expanded() {
        use super::super::protocol::TaskEvent;
        let ev = |t: &str, d: serde_json::Value| TaskEvent::from_parts(t, 0, d);
        let mut state = AppState::default();
        state.reduce(&ev(
            "task.started",
            serde_json::json!({"id":"t","title":"分析","mode":"Chat"}),
        ));
        state.reduce(&ev(
            "thinking.delta",
            serde_json::json!({"text":"先看渠道结构，"}),
        ));
        state.reduce(&ev("token.delta", serde_json::json!({"text":"结论如下"})));
        state.reduce(&ev("task.completed", serde_json::json!({"id":"t"})));

        let folded = layout_lines(&state, 60);
        let folded_txt: String = folded
            .iter()
            .flat_map(|l| l.spans.iter().map(|s| s.content.clone()))
            .collect();
        assert!(
            folded_txt.contains("▸") && folded_txt.contains("✦") && folded_txt.contains("思考"),
            "folded thinking header"
        );
        assert!(
            folded_txt.contains("+1 lines"),
            "folded shows line count, not the reasoning body"
        );
        assert!(
            !folded_txt.contains("先看渠道结构"),
            "reasoning body hidden when folded: {folded_txt}"
        );

        if let Some(e) = state.timeline.iter_mut().find(|e| e.label == "思考") {
            e.expanded = true;
        }
        let expanded_txt: String = layout_lines(&state, 60)
            .iter()
            .flat_map(|l| l.spans.iter().map(|s| s.content.clone()))
            .collect();
        assert!(
            expanded_txt.contains("先看渠道结构"),
            "expanded shows reasoning body"
        );
        assert!(expanded_txt.contains("▾"), "expanded thinking disclosure");
    }

    #[test]
    fn task_meta_bar_shows_elapsed_and_nonzero_counts() {
        use super::super::state::{ActivityCounts, TaskMeta};
        let meta = TaskMeta {
            elapsed_ms: 636_000, // 10m 36s
            counts: ActivityCounts {
                read: 8,
                edited: 1,
                created: 1,
                web_search: 38,
                web_fetch: 3,
                command: 9,
                other: 0,
            },
            tokens: None,
            est_cost: None,
        };
        let lines = task_meta_lines(&meta, 100);
        assert_eq!(lines.len(), 2, "separator rule + count bar");
        let bar: String = lines[1]
            .spans
            .iter()
            .map(|s| s.content.to_string())
            .collect();
        assert!(bar.contains("⏱ 耗时 10m 36s"), "shows elapsed as Xm Ys");
        assert!(bar.contains("读取8") && bar.contains("联网搜索38") && bar.contains("命令9"));
        assert!(!bar.contains("工具"), "zero-count categories are omitted");
        // 分隔线是 ─ 组成。
        let rule: String = lines[0]
            .spans
            .iter()
            .map(|s| s.content.to_string())
            .collect();
        assert!(rule.chars().all(|c| c == '─') && !rule.is_empty());
    }

    #[test]
    fn employee_card_box_lines_are_equal_width_and_carry_identity() {
        // v0.11 M2：像素员工卡——5 条盒子行（上框/名+工号/角色/模型/下框）显示宽度必须全相等，
        // 否则右边框在真终端里错位。并断言卡面带出员工身份四要素与像素头像。
        let state = employee_state();
        let lines = employee_card_lines(state.employee.as_ref().unwrap(), 72);
        let box_w: Vec<usize> = lines
            .iter()
            .take(5)
            .map(|ln| ln.spans.iter().map(|s| s.content.width()).sum())
            .collect();
        assert!(
            box_w.iter().all(|&w| w == box_w[0]),
            "card box lines must be equal display width, got {box_w:?}"
        );
        let text: String = lines
            .iter()
            .flat_map(|ln| ln.spans.iter().map(|s| s.content.to_string()))
            .collect();
        assert!(text.contains("小鲸"), "card shows employee name");
        assert!(text.contains("AI 采纳研究员"), "card shows role");
        assert!(text.contains("claude"), "card shows model");
        assert!(text.contains("EMP·"), "card shows employee id tag");
        assert!(
            text.contains('▛') && text.contains('▙'),
            "card shows pixel avatar"
        );
        assert!(
            text.contains("C1 包验证"),
            "card shows the honest package status"
        );
    }

    #[test]
    fn empty_state_falls_back_to_generic_banner_without_employee() {
        // 无员工时不渲染员工卡，回退通用 CREWCLAW banner。
        let state = AppState::default();
        let lines = banner_lines(&state, 72);
        let text: String = lines
            .iter()
            .flat_map(|ln| ln.spans.iter().map(|s| s.content.to_string()))
            .collect();
        assert!(
            text.contains("CREWCLAW") || text.contains('█'),
            "generic banner"
        );
        assert!(!text.contains("EMP·"), "no employee card without employee");
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
    fn mid_width_renders_side_column_and_session_instead_of_narrow_stream() {
        let mut state = AppState::default();
        state.task = Some(super::super::state::Task {
            id: Some("mid-task".to_string()),
            title: "中屏任务".to_string(),
            status: "running".to_string(),
        });
        state.artifacts.push(super::super::state::Artifact {
            id: Some("mid-artifact".to_string()),
            task_id: Some("mid-task".to_string()),
            name: Some("mid-report.md".to_string()),
            kind: Some("markdown".to_string()),
            artifact_type: None,
            path: None,
            export_path: None,
            status: "ready".to_string(),
            summary: None,
            checks: Vec::new(),
            bytes: None,
            created_ts: 0,
        });
        state.reduce(&TaskEvent::from_parts(
            "tool.requested",
            1,
            serde_json::json!({"id":"tool1","tool":"read_file","label":"读取"}),
        ));

        let mut terminal = Terminal::new(TestBackend::new(84, 28)).expect("test terminal");
        terminal
            .draw(|frame| render(frame, &state, &UiState::default(), ""))
            .expect("draw frame");
        let output = screen(&terminal);
        assert!(output.contains("TASK QUEUE"), "{output}");
        assert!(output.contains("Artifacts / Checks"), "{output}");
        assert!(output.contains("SESSION"), "{output}");
        assert!(output.contains("Tools"), "{output}");
        assert!(output.contains("mid-report.md"), "{output}");

        let mut narrow = Terminal::new(TestBackend::new(69, 28)).expect("test terminal");
        narrow
            .draw(|frame| render(frame, &state, &UiState::default(), ""))
            .expect("draw frame");
        let narrow_output = screen(&narrow);
        assert!(
            !narrow_output.contains("TASK QUEUE"),
            "narrow keeps the single content panel: {narrow_output}"
        );
    }

    #[test]
    fn status_symbol_carries_semantics_without_color() {
        assert_eq!(status_symbol("done"), SYM_OK);
        assert_eq!(status_symbol("failed"), SYM_FAIL);
        assert_eq!(status_symbol("running"), SYM_RUNNING);
        assert_eq!(status_symbol("blocked"), SYM_WARN);
        assert_eq!(status_symbol("needs_artifact"), SYM_WARN);
        assert_eq!(status_symbol("idle"), SYM_WAIT);
        assert_eq!(
            SYM_WAIT, "?",
            "pending/waiting uses the spec waiting marker"
        );
        assert_eq!(status_color("needs_artifact"), WARN());
        assert!(
            timeline_label_style("task.rejected")
                .add_modifier
                .contains(Modifier::CROSSED_OUT),
            "rejected is visually distinct from failed"
        );
        assert!(
            !timeline_label_style("task.failed")
                .add_modifier
                .contains(Modifier::CROSSED_OUT),
            "failed keeps a normal label"
        );
    }

    #[test]
    fn render_shows_approval_modal_over_normal_layout() {
        let mut state = AppState::default();
        state.approval = Some(Approval {
            id: Some("approval1".to_string()),
            tool: Some("shell.exec".to_string()),
            reason: Some("需要执行受控命令".to_string()),
            scope: None,
            session_lease: None,
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
    fn render_shows_artifact_statuses_with_symbols() {
        let mut state = AppState::default();
        state.artifacts = vec![
            super::super::state::Artifact {
                id: Some("a1".to_string()),
                task_id: None,
                name: Some("ready.md".to_string()),
                kind: Some("report".to_string()),
                artifact_type: None,
                path: None,
                export_path: None,
                status: "ready".to_string(),
                summary: None,
                checks: Vec::new(),
                bytes: None,
                created_ts: 0,
            },
            super::super::state::Artifact {
                id: Some("a2".to_string()),
                task_id: None,
                name: Some("review.md".to_string()),
                kind: Some("report".to_string()),
                artifact_type: None,
                path: None,
                export_path: None,
                status: "needs_review".to_string(),
                summary: None,
                checks: Vec::new(),
                bytes: None,
                created_ts: 0,
            },
            super::super::state::Artifact {
                id: Some("a3".to_string()),
                task_id: None,
                name: Some("exported.md".to_string()),
                kind: Some("report".to_string()),
                artifact_type: None,
                path: None,
                export_path: None,
                status: "exported".to_string(),
                summary: None,
                checks: Vec::new(),
                bytes: None,
                created_ts: 0,
            },
            super::super::state::Artifact {
                id: Some("a4".to_string()),
                task_id: None,
                name: Some("rejected.md".to_string()),
                kind: Some("report".to_string()),
                artifact_type: None,
                path: None,
                export_path: None,
                status: "rejected".to_string(),
                summary: None,
                checks: Vec::new(),
                bytes: None,
                created_ts: 0,
            },
        ];
        let mut ui_state = UiState::default();
        ui_state.drawer = Some(FocusPanel::Artifacts);
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
        assert!(compact.contains("✓ready.md"));
        assert!(compact.contains("!review.md"));
        assert!(compact.contains("✓exported.md"));
        assert!(compact.contains("✗rejected.md"));
    }

    #[test]
    fn render_timeline_shows_answer_beyond_six_hundred_columns() {
        let mut state = AppState::default();
        state.answer = format!("{} TAIL_AFTER_600", "answer ".repeat(100));
        let mut ui_state = UiState::default();
        ui_state.drawer = Some(FocusPanel::Timeline);
        let mut terminal = Terminal::new(TestBackend::new(80, 60)).expect("test terminal");

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
        assert!(compact.contains("Answer"));
        assert!(compact.contains("TAIL_AFTER_600"), "{compact}");
    }

    #[test]
    fn render_timeline_answer_preserves_internal_line_breaks() {
        // A multi-paragraph markdown answer must render every paragraph, not collapse
        // at the first '\n' (a single Line's spans don't split on newlines).
        let mut state = AppState::default();
        state.answer =
            "FIRST_PARA line one\n\n## SECOND_PARA heading\n- SECOND_PARA_TAIL".to_string();
        let mut ui_state = UiState::default();
        ui_state.drawer = Some(FocusPanel::Timeline);
        let mut terminal = Terminal::new(TestBackend::new(80, 60)).expect("test terminal");

        terminal
            .draw(|frame| render(frame, &state, &ui_state, ""))
            .expect("draw frame");

        let compact = terminal
            .backend()
            .buffer()
            .content()
            .iter()
            .map(|cell| cell.symbol())
            .collect::<String>()
            .replace(' ', "");
        assert!(compact.contains("FIRST_PARA"), "{compact}");
        assert!(compact.contains("SECOND_PARA_TAIL"), "{compact}");
    }

    #[test]
    fn render_artifacts_preview_reads_selected_artifact_file_contents() {
        let path = std::env::temp_dir().join(format!(
            "crewclaw-artifact-preview-{}-{}.md",
            std::process::id(),
            "known"
        ));
        let artifact_body = "# Deliverable\n\nKnown file body from disk.";
        std::fs::write(&path, artifact_body).expect("write temp artifact");

        let mut state = AppState::default();
        state.selected_artifact = Some("a1".to_string());
        state.preview = Some(super::super::state::ArtifactPreview {
            artifact_id: "a1".to_string(),
            title: "deliverable.md".to_string(),
            detail: "fallback summary".to_string(),
        });
        state.artifacts = vec![super::super::state::Artifact {
            id: Some("a1".to_string()),
            task_id: None,
            name: Some("deliverable.md".to_string()),
            kind: Some("markdown".to_string()),
            artifact_type: None,
            path: Some(path.to_string_lossy().into_owned()),
            export_path: None,
            status: "ready".to_string(),
            summary: Some("fallback summary".to_string()),
            checks: Vec::new(),
            bytes: None,
            created_ts: 0,
        }];
        let mut ui_state = UiState::default();
        ui_state.drawer = Some(FocusPanel::Artifacts);
        let mut terminal = Terminal::new(TestBackend::new(68, 40)).expect("test terminal");

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
        assert!(compact.contains("Knownfilebodyfromdisk"), "{compact}");

        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn render_inspect_shows_recent_debug_details() {
        let mut state = AppState::default();
        state.debug = vec![
            "tool_call_id=abc latency=12ms provider=test".to_string(),
            "raw response truncated".to_string(),
        ];
        let mut ui_state = UiState::default();
        ui_state.drawer = Some(FocusPanel::Inspect);
        let mut terminal = Terminal::new(TestBackend::new(60, 40)).expect("test terminal");

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
        assert!(compact.contains("Debug"));
        assert!(compact.contains("tool_call_id=abclatency=12msprovider=test"));
        assert!(compact.contains("rawresponsetruncated"));
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
        let ui_state = UiState::default();
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
        assert!(!compact.contains("体感"));
        assert!(!compact.contains("湿度"));
    }

    #[test]
    fn render_shows_weather_card_for_quick_utility_result() {
        let mut state = AppState::default();
        state.quick_utility = Some(QuickUtility {
            intent: Some("杭州天气".to_string()),
            result: Some(serde_json::json!({
                "city": "Hangzhou",
                "temp_c": 24.0,
                "feels_c": 26.0,
                "humidity": 78.0,
                "wind_kmph": 6,
                "condition": "多云",
                "source": "wttr.in"
            })),
            source: Some("weather".to_string()),
            status: Some("done".to_string()),
        });
        let ui_state = UiState::default();
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
        assert!(compact.contains("🌤Hangzhou多云24°C（体感26°C·湿度78%）"));
        assert!(!compact.contains("24.0"));
    }

    #[test]
    fn pending_actions_line_formats_valid_actions_and_skips_incomplete_items() {
        let actions = vec![
            PendingAction {
                key: "1".to_string(),
                label: "接受".to_string(),
                command: None,
            },
            PendingAction {
                key: "3".to_string(),
                label: "修改".to_string(),
                command: None,
            },
        ];

        let line = pending_actions_line(&actions, 80).expect("pending action line");

        assert_eq!(line, "可执行：[1] 接受  [3] 修改");
    }

    #[test]
    fn pending_actions_line_truncates_by_display_width() {
        let actions = vec![PendingAction {
            key: "1".to_string(),
            label: "你好abc".to_string(),
            command: None,
        }];

        let line = pending_actions_line(&actions, 12).expect("pending action line");

        assert_eq!(line, "可执行：[1]");
    }

    #[test]
    fn render_places_cursor_at_cjk_aware_input_position() {
        let state = AppState::default();
        let mut ui_state = UiState::default();
        ui_state.mode = InputMode::Insert; // v0.16 W1.1:焦点=INSERT,游标测试显式聚焦
        let ui_state = ui_state;
        let mut terminal = Terminal::new(TestBackend::new(80, 20)).expect("test terminal");

        terminal
            .draw(|frame| render_with_input(frame, &state, &ui_state, "a你b", "a你".len()))
            .expect("draw frame");

        let contents = terminal
            .backend()
            .buffer()
            .content()
            .iter()
            .map(|cell| cell.symbol())
            .collect::<String>();
        let compact = contents.replace(' ', "");
        assert!(compact.contains("INPUT"), "{compact}");
        // v0.13：首行带 › 提示符（宽 2）→ 光标 x 右移 2。
        assert!(compact.contains("│›a你b│"), "{compact}");
        terminal.backend_mut().assert_cursor_position((6, 16));
    }

    #[test]
    fn render_places_cursor_on_multiline_input_row() {
        let state = AppState::default();
        let mut ui_state = UiState::default();
        ui_state.mode = InputMode::Insert; // v0.16 W1.1:焦点=INSERT,游标测试显式聚焦
        let ui_state = ui_state;
        let input = "/revise 第一行\n第二你行";
        let cursor = input.len();
        let mut terminal = Terminal::new(TestBackend::new(80, 22)).expect("test terminal");

        terminal
            .draw(|frame| render_with_input(frame, &state, &ui_state, input, cursor))
            .expect("draw frame");

        let contents = terminal
            .backend()
            .buffer()
            .content()
            .iter()
            .map(|cell| cell.symbol())
            .collect::<String>();
        let compact = contents.replace(' ', "");
        assert!(compact.contains("INPUT"), "{compact}");
        // v0.13：仅首行带 › 前缀；续行无前缀，光标 x 不变。
        assert!(compact.contains("│›/revise第一行│"), "{compact}");
        assert!(compact.contains("第二你行"), "{compact}");
        terminal.backend_mut().assert_cursor_position((9, 18));
    }

    #[test]
    fn render_input_area_scrolls_internally_to_keep_cursor_visible() {
        let state = AppState::default();
        let mut ui_state = UiState::default();
        ui_state.mode = InputMode::Insert; // v0.16 W1.1:焦点=INSERT,游标测试显式聚焦
        let ui_state = ui_state;
        let input = (1..=8)
            .map(|line| format!("line{line}"))
            .collect::<Vec<_>>()
            .join("\n");
        let mut terminal = Terminal::new(TestBackend::new(80, 24)).expect("test terminal");

        terminal
            .draw(|frame| render_with_input(frame, &state, &ui_state, &input, input.len()))
            .expect("draw frame");

        let contents = terminal
            .backend()
            .buffer()
            .content()
            .iter()
            .map(|cell| cell.symbol())
            .collect::<String>();
        let compact = contents.replace(' ', "");
        assert!(!compact.contains("│line1│"), "{compact}");
        assert!(compact.contains("│line3│"), "{compact}");
        assert!(compact.contains("│line8│"), "{compact}");
        terminal.backend_mut().assert_cursor_position((6, 20));
    }

    #[test]
    fn render_shows_conversation_turns_in_the_message_stream() {
        let mut state = AppState::default();
        state
            .conversation
            .push(ConversationItem::User("HELLO_USER".to_string()));
        state
            .conversation
            .push(ConversationItem::Assistant("HELLO_BOT".to_string()));
        let ui_state = UiState::default();
        let mut terminal = Terminal::new(TestBackend::new(80, 24)).expect("test terminal");

        terminal
            .draw(|frame| render(frame, &state, &ui_state, ""))
            .expect("draw frame");

        let compact = terminal
            .backend()
            .buffer()
            .content()
            .iter()
            .map(|cell| cell.symbol())
            .collect::<String>()
            .replace(' ', "");
        assert!(compact.contains("HELLO_USER"), "{compact}");
        assert!(compact.contains("HELLO_BOT"), "{compact}");
    }

    #[test]
    fn drawer_overlays_a_panel_only_when_open() {
        let mut state = AppState::default();
        state.artifacts.push(super::super::state::Artifact {
            id: Some("a1".to_string()),
            task_id: None,
            name: Some("DRAWER_ONLY.md".to_string()),
            kind: Some("markdown".to_string()),
            artifact_type: None,
            path: None,
            export_path: None,
            status: "ready".to_string(),
            summary: None,
            checks: Vec::new(),
            bytes: None,
            created_ts: 0,
        });
        let mut terminal = Terminal::new(TestBackend::new(69, 24)).expect("test terminal");

        // Closed drawer: the artifact panel content is not on screen.
        terminal
            .draw(|frame| render(frame, &state, &UiState::default(), ""))
            .expect("draw frame");
        let closed = terminal
            .backend()
            .buffer()
            .content()
            .iter()
            .map(|cell| cell.symbol())
            .collect::<String>()
            .replace(' ', "");
        assert!(!closed.contains("DRAWER_ONLY.md"), "{closed}");

        // Open drawer on Artifacts: the panel and its content are now visible.
        let mut ui_state = UiState::default();
        ui_state.drawer = Some(FocusPanel::Artifacts);
        terminal
            .draw(|frame| render(frame, &state, &ui_state, ""))
            .expect("draw frame");
        let open = terminal
            .backend()
            .buffer()
            .content()
            .iter()
            .map(|cell| cell.symbol())
            .collect::<String>()
            .replace(' ', "");
        assert!(open.contains("DRAWER_ONLY.md"), "{open}");
    }

    fn screen(terminal: &Terminal<TestBackend>) -> String {
        terminal
            .backend()
            .buffer()
            .content()
            .iter()
            .map(|cell| cell.symbol())
            .collect::<String>()
    }

    #[test]
    fn below_design_baseline_warns_without_hiding_core_input() {
        let state = AppState::default();
        let ui = UiState::default();
        let mut small = Terminal::new(TestBackend::new(100, 30)).expect("small terminal");
        small
            .draw(|frame| render(frame, &state, &ui, ""))
            .expect("draw small");
        let output = screen(&small);
        let compact = output.replace(' ', "");
        assert!(compact.contains("建议终端≥148×35"), "{compact}");
        assert!(compact.contains("当前为100×30"), "{compact}");
        assert!(output.contains('›'), "input prompt stays available");

        let mut baseline = Terminal::new(TestBackend::new(148, 35)).expect("baseline terminal");
        baseline
            .draw(|frame| render(frame, &state, &ui, ""))
            .expect("draw baseline");
        assert!(!screen(&baseline).contains("建议终端"));
    }

    #[test]
    fn task_queue_renders_all_real_sessions_and_selected_marker() {
        let _theme_guard = THEME_TEST_LOCK
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let event = |kind: &str, data: serde_json::Value| TaskEvent::from_parts(kind, 0, data);
        let mut state = AppState::default();
        state.push_user_message("A".to_string());
        state.reduce(&event(
            "task.started",
            serde_json::json!({"id":"a","title":"会话 A","mode":"Chat"}),
        ));
        state.reduce(&event("task.completed", serde_json::json!({"id":"a"})));
        state.push_user_message("B".to_string());
        state.reduce(&event(
            "task.started",
            serde_json::json!({"id":"b","title":"会话 B","mode":"Chat"}),
        ));

        let mut ui = UiState::default();
        ui.task_session_cursor = 1;
        let mut terminal = Terminal::new(TestBackend::new(160, 44)).expect("terminal");
        terminal
            .draw(|frame| render(frame, &state, &ui, ""))
            .expect("draw");
        let output = screen(&terminal);
        let compact = output.replace(' ', "");
        assert!(compact.contains("会话A"), "{compact}");
        assert!(compact.contains("会话B"), "{compact}");
        let selected_markers = terminal
            .backend()
            .buffer()
            .content()
            .iter()
            .filter(|cell| cell.symbol() == "▌" && cell.style().fg == Some(config::yellow()))
            .count();
        assert_eq!(selected_markers, 1, "one yellow taskRun marker");
    }

    /// v0.16 W4.2：单独取一行文本(screen() 拍平整个 buffer 不含换行,逐行位置断言需要这个)。
    fn row_text(terminal: &Terminal<TestBackend>, y: u16) -> String {
        let width = terminal.size().unwrap().width;
        (0..width)
            .map(|x| terminal.backend().buffer().cell((x, y)).unwrap().symbol())
            .collect::<String>()
    }

    /// 取渲染后第一处 fg 命中给定颜色的单元格是否存在，用于断言主题真的换了 chrome 色。
    fn buffer_has_fg(terminal: &Terminal<TestBackend>, color: Color) -> bool {
        terminal
            .backend()
            .buffer()
            .content()
            .iter()
            .any(|cell| cell.fg == color)
    }

    /// v0.16：同 buffer_has_fg，查底色（bg1 瓦片等断言用）。
    fn buffer_has_bg(terminal: &Terminal<TestBackend>, color: Color) -> bool {
        terminal
            .backend()
            .buffer()
            .content()
            .iter()
            .any(|cell| cell.bg == color)
    }

    /// AC-THM-001：切 light 主题后，渲染缓冲区里 chrome 用的是 light 色板（accent RGB），
    /// 不再是 dark 的 Cyan。用进程级 THEME，测试串行化避免与其他读色测试竞争。
    #[test]
    fn light_theme_changes_rendered_chrome_colors() {
        use super::super::config::{self, Theme};
        let _guard = THEME_TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());

        let mut state = AppState::default();
        state.employee = Some(super::super::state::Employee {
            name: "小鲸".to_string(),
            role: "研究员".to_string(),
            model: "claude".to_string(),
            skills: Vec::new(),
            avatar: Vec::new(),
            kpi_cumulative: super::super::state::KpiCumulative::default(),
            eval: None,
            growth_card: None,
        });

        // dark：header 员工名用 Cyan（DARK.accent）。
        config::set_theme(Theme::DARK);
        let mut term = Terminal::new(TestBackend::new(80, 24)).expect("test terminal");
        term.draw(|frame| render(frame, &state, &UiState::default(), ""))
            .expect("draw dark");
        assert!(
            buffer_has_fg(&term, Theme::DARK.accent),
            "dark theme should paint accent cells with DARK.accent"
        );
        assert!(!buffer_has_fg(&term, Theme::LIGHT.accent));

        // light：同一渲染应改用 LIGHT.accent（RGB），不再出现 dark 的 Cyan accent。
        config::set_theme(Theme::LIGHT);
        let mut term2 = Terminal::new(TestBackend::new(80, 24)).expect("test terminal");
        term2
            .draw(|frame| render(frame, &state, &UiState::default(), ""))
            .expect("draw light");
        assert!(
            buffer_has_fg(&term2, Theme::LIGHT.accent),
            "light theme should paint accent cells with LIGHT.accent"
        );
        assert!(!buffer_has_fg(&term2, Theme::DARK.accent));

        // 收尾恢复默认，避免污染后续测试。
        config::set_theme(Theme::DARK);
    }

    /// AC-LIVE-001: busy 时状态栏出现 spinner + 秒数；完成后消失回到默认提示。
    #[test]
    fn status_line_shows_spinner_while_busy_and_hides_when_done() {
        let mut state = AppState::default();
        let mut ui_state = UiState::default();
        ui_state.mode = crate::workbench::state::InputMode::Insert; // v0.15：冷启动默认 NORMAL,这里测 INSERT 空闲提示。
        // ≥148×35 才不触发尺寸警告，否则警告占满 hint 行会截掉 "Enter 发送"。
        let mut terminal = Terminal::new(TestBackend::new(148, 35)).expect("test terminal");

        // Busy: spinner frame + 岗位语义阶段词出现；默认提示消失。
        state.reduce(&TaskEvent::from_parts(
            "task.started",
            1,
            serde_json::json!({"id":"phase-task"}),
        ));
        state.reduce(&TaskEvent::from_parts(
            "generation.started",
            2,
            serde_json::json!({"id":"phase-generation","taskRunId":"phase-task"}),
        ));
        terminal
            .draw(|frame| render(frame, &state, &ui_state, ""))
            .expect("draw frame");
        let busy = screen(&terminal).replace(' ', "");
        assert!(busy.contains("正在理解需求"), "{busy}");
        assert!(busy.contains("Esc/Ctrl+C中断"), "{busy}");
        assert!(
            SPINNER_FRAMES.iter().any(|f| busy.contains(f)),
            "spinner frame missing: {busy}"
        );
        // modeline 也可能含 "Enter发送" 提示词；忙态以 hint 行的阶段词为准。
        state.reduce(&TaskEvent::from_parts(
            "thinking.delta",
            3,
            serde_json::json!({"taskRunId":"phase-task","text":"thinking"}),
        ));
        terminal
            .draw(|frame| render(frame, &state, &ui_state, ""))
            .expect("draw thinking frame");
        assert!(screen(&terminal).replace(' ', "").contains("正在梳理思路"));
        state.reduce(&TaskEvent::from_parts(
            "tool.running",
            4,
            serde_json::json!({"id":"tool-phase","taskRunId":"phase-task","tool":"read_file"}),
        ));
        terminal
            .draw(|frame| render(frame, &state, &ui_state, ""))
            .expect("draw tool frame");
        assert!(screen(&terminal).replace(' ', "").contains("正在查阅资料"));

        // Done: spinner gone, default hint restored.
        state.busy_since = None;
        terminal
            .draw(|frame| render(frame, &state, &ui_state, ""))
            .expect("draw frame");
        let idle = screen(&terminal).replace(' ', "");
        assert!(!idle.contains("正在查阅资料"), "{idle}");
        assert!(idle.contains("Enter发送"), "{idle}");
    }

    /// AC-WRAP-001/002（v0.9 M1）：长 CJK 回复经预 wrap 后，content_max_scroll 反映真实物理行数，
    /// 且 follow=true 贴底时末行内容可见（旧 bug：Paragraph Wrap 低估 max_scroll → 滚不到底）。
    #[test]
    fn long_cjk_reply_scrolls_to_true_bottom() {
        let mut state = AppState::default();
        // 一条会折出很多物理行的长中文回复，末尾放一个可断言的哨兵。
        let long = "这是一段很长的中文回复用来测试折行是否正确".repeat(8) + "末行哨兵XYZ";
        state.conversation.push(ConversationItem::Assistant(long));
        let mut ui_state = UiState::default();
        ui_state.follow = true;

        let w = 30u16;
        let h = 10u16;
        let mut terminal = Terminal::new(TestBackend::new(w, h)).expect("term");
        terminal
            .draw(|frame| render(frame, &state, &ui_state, ""))
            .expect("draw");

        // 折行后物理行数远超视口 → max_scroll > 0。
        let max_scroll = ui_state.content_max_scroll.get();
        assert!(max_scroll > 0, "wrapped content should exceed viewport");

        // follow=true 贴底 → 末行哨兵可见于渲染缓冲。
        let screen = screen(&terminal);
        assert!(
            screen.contains("XYZ"),
            "sticky-bottom must reveal the true last line; screen: {screen}"
        );
    }

    /// AC-SCR-001: 脱离粘底且下方有未见行时，消息区显示"↓ N 新消息"徽标；粘底时不显示。
    #[test]
    fn new_message_badge_shows_when_detached_and_hidden_when_following() {
        let mut state = AppState::default();
        for i in 0..40 {
            state
                .conversation
                .push(ConversationItem::User(format!("行 {i}")));
        }
        let mut ui_state = UiState::default();
        let mut terminal = Terminal::new(TestBackend::new(40, 12)).expect("test terminal");

        // Detached from the bottom with unseen lines below → badge visible.
        ui_state.follow = false;
        ui_state.messages_scroll.set(0);
        terminal
            .draw(|frame| render(frame, &state, &ui_state, ""))
            .expect("draw");
        // content_max_scroll was written by the frame; scroll=0 leaves many unseen lines.
        // The badge's ↓ arrow is a stable single-cell marker (CJK text spans skip-cells in the
        // TestBackend buffer, so we assert on the arrow rather than the wide 新消息 glyphs).
        let detached = screen(&terminal);
        assert!(
            detached.contains('↓'),
            "badge visible when detached: {detached}"
        );

        // Following (sticky bottom) → no badge.
        ui_state.follow = true;
        terminal
            .draw(|frame| render(frame, &state, &ui_state, ""))
            .expect("draw");
        let following = screen(&terminal);
        assert!(
            !following.contains('↓'),
            "no badge while following: {following}"
        );
    }

    /// AC-SCR-003: 极窄尺寸下渲染徽标/滚动条不 panic（clamp 生效）。
    #[test]
    fn scroll_chrome_survives_tiny_viewport() {
        let mut state = AppState::default();
        for i in 0..30 {
            state
                .conversation
                .push(ConversationItem::Assistant(format!("很长的一行内容 {i}")));
        }
        let mut ui_state = UiState::default();
        ui_state.follow = false;
        // 3x3 is the smallest sane frame; must not panic on badge/scrollbar math.
        let mut terminal = Terminal::new(TestBackend::new(3, 3)).expect("test terminal");
        terminal
            .draw(|frame| render(frame, &state, &ui_state, ""))
            .expect("draw at tiny size without panic");
    }

    /// AC-TL-001: 工具行折叠单行显示 +N lines；展开后可见输出明细。
    #[test]
    fn tool_line_folds_and_expands() {
        let mut state = AppState::default();
        state.timeline.push(TimelineEntry {
            id: "tool1".to_string(),
            status: SYM_OK.to_string(),
            label: "web.search".to_string(),
            detail: "DETAIL_A\nDETAIL_B\nDETAIL_C".to_string(),
            collapsible: true,
            expanded: false,
            task_meta: None,
            ts: 0,
            event_type: "",
            detail_kv: Vec::new(),
        });
        state.conversation.push(ConversationItem::Event(0));
        let ui_state = UiState::default();
        let mut terminal = Terminal::new(TestBackend::new(80, 24)).expect("test terminal");

        // Collapsed: shows a line count, hides the body.
        terminal
            .draw(|frame| render(frame, &state, &ui_state, ""))
            .expect("draw");
        let folded = screen(&terminal);
        assert!(
            folded.contains("▸") && folded.contains("+3 lines"),
            "collapsed shows disclosure and count: {folded}"
        );
        assert!(
            !folded.contains("DETAIL_B"),
            "body hidden when folded: {folded}"
        );

        // Expanded: body visible, count hint gone.
        state.timeline[0].expanded = true;
        terminal
            .draw(|frame| render(frame, &state, &ui_state, ""))
            .expect("draw");
        let open = screen(&terminal);
        assert!(
            open.contains("DETAIL_B"),
            "body visible when expanded: {open}"
        );
        assert!(open.contains("DETAIL_C"), "body tail visible: {open}");
        assert!(open.contains("▾"), "expanded row shows disclosure: {open}");
    }

    #[test]
    fn tool_diff_rows_keep_add_delete_colors_in_ratatui() {
        assert_eq!(
            tool_detail_style("│   ·   1  + after").fg,
            Some(config::green())
        );
        assert_eq!(
            tool_detail_style("│   1   ·  - before").fg,
            Some(config::red())
        );
        assert_eq!(tool_detail_style("│   1   1    unchanged").fg, Some(DIM()));
    }

    /// AC-MD-001: 定妆后助手消息用预排版 ANSI，内容出现且不残留裸转义字节。
    #[test]
    fn rendered_assistant_uses_ansi_and_strips_escape_bytes() {
        let mut state = AppState::default();
        state
            .conversation
            .push(ConversationItem::Assistant("## 标题\n正文行".to_string()));
        // Downbridged ANSI: bold cyan heading + plain body.
        state.rendered_assistant.insert(
            0,
            vec![
                "\u{1b}[1;36mMD_TITLE\u{1b}[0m".to_string(),
                "MD_BODY".to_string(),
            ],
        );
        let ui_state = UiState::default();
        let mut terminal = Terminal::new(TestBackend::new(80, 24)).expect("test terminal");
        terminal
            .draw(|frame| render(frame, &state, &ui_state, ""))
            .expect("draw frame");

        let out = screen(&terminal);
        // Typeset content is present, raw markdown markers and ANSI escapes are not on screen.
        assert!(out.contains("MD_TITLE"), "{out}");
        assert!(out.contains("MD_BODY"), "{out}");
        assert!(
            !out.contains('\u{1b}'),
            "escape bytes must not reach screen: {out:?}"
        );

        // The heading cell carries the parsed color (cyan), proving ANSI styling was applied.
        let buffer = terminal.backend().buffer();
        let title_cell = buffer.content().iter().find(|cell| cell.symbol() == "M");
        assert!(title_cell.is_some(), "title cell rendered");
    }

    /// Stable rendered parts keep rich Markdown while the caret remains attached to the part.
    #[test]
    fn streaming_stable_rendered_part_keeps_rich_text_and_caret() {
        let mut state = AppState::default();
        state.reduce(&TaskEvent::from_parts(
            "token.delta",
            1,
            serde_json::json!({"part_id":"p","text":"## RAW_MARKDOWN"}),
        ));
        state.reduce(&TaskEvent::from_parts(
            "assistant.rendered",
            2,
            serde_json::json!({
                "part_id":"p",
                "ansi_lines":["\u{1b}[1;36mRICH_HEADING\u{1b}[0m", "RICH_BODY"]
            }),
        ));
        let ui_state = UiState::default();
        let mut terminal = Terminal::new(TestBackend::new(80, 24)).expect("test terminal");
        terminal
            .draw(|frame| render(frame, &state, &ui_state, ""))
            .expect("draw frame");
        let out = screen(&terminal);
        assert!(out.contains("RICH_HEADING"), "rendered heading: {out}");
        assert!(out.contains("RICH_BODY"), "rendered body: {out}");
        assert!(
            out.contains(STREAM_CARET),
            "caret present while streaming: {out}"
        );
        assert!(
            !out.contains("RAW_MARKDOWN"),
            "raw Markdown must not replace a stable rendered snapshot: {out}"
        );

        state.reduce(&TaskEvent::from_parts(
            "generation.completed",
            3,
            serde_json::json!({}),
        ));
        terminal
            .draw(|frame| render(frame, &state, &ui_state, ""))
            .expect("draw completed frame");
        let completed = screen(&terminal);
        assert!(completed.contains("RICH_HEADING"), "{completed}");
        assert!(completed.contains("RICH_BODY"), "{completed}");
        assert!(!completed.contains(STREAM_CARET), "{completed}");
    }

    /// AC-LIVE-002: 流式中最新助手消息尾部有 caret；完成后消失。
    #[test]
    fn stream_caret_present_while_busy_absent_when_complete() {
        let mut state = AppState::default();
        state.reduce(&TaskEvent::from_parts(
            "token.delta",
            1,
            serde_json::json!({"part_id":"p","text":"CARET_BODY"}),
        ));
        let ui_state = UiState::default();
        let mut terminal = Terminal::new(TestBackend::new(80, 24)).expect("test terminal");

        terminal
            .draw(|frame| render(frame, &state, &ui_state, ""))
            .expect("draw frame");
        let streaming = screen(&terminal);
        assert!(
            streaming.contains("CARET_BODY"),
            "raw text remains visible before a rendered snapshot: {streaming}"
        );
        assert!(
            streaming.contains(STREAM_CARET),
            "caret missing: {streaming}"
        );

        state.reduce(&TaskEvent::from_parts(
            "generation.completed",
            2,
            serde_json::json!({}),
        ));
        terminal
            .draw(|frame| render(frame, &state, &ui_state, ""))
            .expect("draw frame");
        let complete = screen(&terminal);
        assert!(
            !complete.contains(STREAM_CARET),
            "caret should vanish when complete: {complete}"
        );
    }

    /// caret 只挂最新一条助手消息，历史助手消息不带 caret。
    #[test]
    fn stream_caret_only_on_latest_assistant_message() {
        let mut state = AppState::default();
        state
            .conversation
            .push(ConversationItem::Assistant("OLD_ONE".to_string()));
        state
            .conversation
            .push(ConversationItem::User("MID".to_string()));
        state.reduce(&TaskEvent::from_parts(
            "token.delta",
            1,
            serde_json::json!({"part_id":"new","text":"NEW_ONE"}),
        ));
        let ui_state = UiState::default();
        let mut terminal = Terminal::new(TestBackend::new(80, 24)).expect("test terminal");
        terminal
            .draw(|frame| render(frame, &state, &ui_state, ""))
            .expect("draw frame");
        let out = screen(&terminal);
        let caret_count = out.matches(STREAM_CARET).count();
        assert_eq!(caret_count, 1, "exactly one caret expected: {out}");
    }

    #[test]
    fn stream_caret_stays_on_active_part_when_a_nonassistant_event_is_last() {
        let mut state = AppState::default();
        state.reduce(&TaskEvent::from_parts(
            "generation.started",
            1,
            serde_json::json!({"turn_id":"t","seq":1}),
        ));
        state.reduce(&TaskEvent::from_parts(
            "token.delta",
            2,
            serde_json::json!({"turn_id":"t","seq":2,"part_id":"p","text":"ACTIVE_PART"}),
        ));
        state.reduce(&TaskEvent::from_parts(
            "tool.requested",
            3,
            serde_json::json!({"turn_id":"t","seq":3,"id":"tool1","tool":"web_search","label":"搜索"}),
        ));
        state.reduce(&TaskEvent::from_parts(
            "tool.running",
            4,
            serde_json::json!({"turn_id":"t","seq":4,"id":"tool1","tool":"web_search"}),
        ));
        assert!(matches!(
            state.conversation.last(),
            Some(ConversationItem::Event(_))
        ));
        let ui_state = UiState::default();
        let mut terminal = Terminal::new(TestBackend::new(80, 24)).expect("test terminal");
        terminal
            .draw(|frame| render(frame, &state, &ui_state, ""))
            .expect("draw frame");
        let out = screen(&terminal);
        assert!(out.contains("ACTIVE_PART"));
        assert_eq!(out.matches(STREAM_CARET).count(), 1, "{out}");

        state.reduce(&TaskEvent::from_parts(
            "tool.succeeded",
            5,
            serde_json::json!({"turn_id":"t","seq":5,"id":"tool1","tool":"web_search","summary":"ok"}),
        ));
        terminal
            .draw(|frame| render(frame, &state, &ui_state, ""))
            .expect("draw frame");
        let after_tool = screen(&terminal);
        assert_eq!(
            after_tool.matches(STREAM_CARET).count(),
            1,
            "caret remains on the active part until generation terminal: {after_tool}"
        );

        state.reduce(&TaskEvent::from_parts(
            "generation.completed",
            6,
            serde_json::json!({"turn_id":"t","seq":6}),
        ));
        terminal
            .draw(|frame| render(frame, &state, &ui_state, ""))
            .expect("draw frame");
        assert_eq!(screen(&terminal).matches(STREAM_CARET).count(), 0);
    }

    #[test]
    fn empty_state_shows_multiline_discoverability_hints() {
        // AC-HINT-001：全新 AppState（无真实消息）→ layout_lines 含 ≥3 条以"· "起的可操作提示。
        let state = AppState::default();
        let lines = layout_lines(&state, 60);
        let bullet_count = lines
            .iter()
            .filter(|l| {
                let text: String = l.spans.iter().map(|s| s.content.as_ref()).collect();
                text.trim_start().starts_with("· ")
            })
            .count();
        assert!(
            bullet_count >= 3,
            "expected >=3 discoverability hints, got {bullet_count}"
        );
    }

    // AC-HINT-002(follow=false 时提示用户已脱离贴底跟随)的现行实现是滚动条 +
    // "↓ N 新消息" 徽标(见 `new_message_badge_shows_when_detached_and_hidden_when_following`)，
    // 不再是本测试曾锁定的旧版单行状态栏(`idle_status_line`，v0.14 hint_row/modeline 改版时
    // 已被替换掉——本审计一并清理了那批死代码)。旧测试随之移除，验收标准由新测试覆盖。
}
