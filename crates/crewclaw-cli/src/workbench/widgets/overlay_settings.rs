//! v0.15 P1-1 / v0.16 W4.3：SETTINGS 偏好浮层（对齐 handoff 设计稿 SETTINGS）。
//!
//! 数据真值（用户标准）：
//!   - APPEARANCE 组**全真生效**：theme(与 `t` 同源,立即 apply)/scanlines(与 `s` 同源)/
//!     density(行距,影响真实渲染)。改动持久化到 `.crewclaw/prefs.json`。
//!   - BEHAVIOR 组（审批策略/并行上限/月度预算/权限范围/Dream 时间）**引擎暂不支持**——
//!     行内 dim 标注,可选可存(为引擎接入预留),但明示当前不生效,不谎称已连。
//!
//! v0.16：desc 列(设计稿每行的说明文字)+ 选项集/标签改用设计稿原值 + aqua 边框(原 purple)。

use ratatui::{
    Frame,
    style::{Modifier, Style},
    text::{Line, Span, Text},
    widgets::{Block, Borders, Clear, Paragraph},
};

use unicode_width::UnicodeWidthStr;

use crate::workbench::config::{self, THEME_NAMES};
use crate::workbench::state::UiState;
use crate::workbench::ui::{centered_rect, truncate_display_width};

/// 行标识（顺序即渲染/游标顺序）。前 3 行 APPEARANCE(真),后 5 行 BEHAVIOR(引擎暂不支持)。
pub(crate) const ROW_COUNT: usize = 8;

const SCANLINES_OPTS: [&str; 2] = ["off", "on"];
// v0.16 W4.3：选项集改设计稿原值(density 是设计稿原文的英文词)。
const DENSITY_OPTS: [&str; 2] = ["comfortable", "compact"];
const APPROVAL_OPTS: [&str; 3] = ["所有交付", "仅产出物", "信任后自动"];
const PARALLEL_OPTS: [&str; 4] = ["1", "2", "3", "4"];
const BUDGET_OPTS: [&str; 4] = ["$20", "$50", "$100", "$200"];
const PERM_OPTS: [&str; 3] = ["单次调用", "任务生命周期", "会话"];
const DREAM_OPTS: [&str; 4] = ["01:00", "02:00", "03:00", "关闭"];

fn wrap(idx: usize, delta: i32, len: usize) -> usize {
    if len == 0 {
        return 0;
    }
    let n = len as i32;
    (((idx as i32 + delta) % n + n) % n) as usize
}

/// 循环当前选中行的值（delta=+1 下一 / -1 上一）。APPEARANCE 行立即生效;全部落 prefs。
/// 返回 true 表示发生了改变（调用方据此持久化）。
pub(crate) fn cycle(ui_state: &mut UiState, delta: i32) -> bool {
    match ui_state.settings_cursor.min(ROW_COUNT - 1) {
        0 => {
            // theme：与 t 键同源——立即 apply，保留员工 accent。
            ui_state.theme_index = wrap(ui_state.theme_index, delta, THEME_NAMES.len());
            config::apply_theme_index(ui_state.theme_index, Some(config::accent()));
            ui_state.prefs.theme_index = ui_state.theme_index;
        }
        1 => {
            ui_state.scanlines = !ui_state.scanlines; // 二态,delta 方向无关
            ui_state.prefs.scanlines = ui_state.scanlines;
        }
        2 => ui_state.prefs.density = wrap(ui_state.prefs.density, delta, DENSITY_OPTS.len()),
        3 => ui_state.prefs.approval = wrap(ui_state.prefs.approval, delta, APPROVAL_OPTS.len()),
        4 => ui_state.prefs.parallel = wrap(ui_state.prefs.parallel, delta, PARALLEL_OPTS.len()),
        5 => ui_state.prefs.budget = wrap(ui_state.prefs.budget, delta, BUDGET_OPTS.len()),
        6 => ui_state.prefs.perm_scope = wrap(ui_state.prefs.perm_scope, delta, PERM_OPTS.len()),
        7 => ui_state.prefs.dream = wrap(ui_state.prefs.dream, delta, DREAM_OPTS.len()),
        _ => return false,
    }
    true
}

struct RowView {
    label: &'static str,
    desc: &'static str,
    value: String,
    /// true=引擎暂不支持（dim + 标注）。
    unsupported: bool,
    /// 分组标题（在此行之前插入）。
    group: Option<&'static str>,
}

fn rows(ui_state: &UiState) -> Vec<RowView> {
    let p = &ui_state.prefs;
    vec![
        RowView {
            label: "主题 Theme",
            desc: "4 套 retro 配色，t 键也可循环",
            value: THEME_NAMES[ui_state.theme_index % THEME_NAMES.len()].to_string(),
            unsupported: false,
            group: Some("APPEARANCE"),
        },
        RowView {
            label: "扫描线 CRT",
            desc: "复古阴极射线管效果",
            value: SCANLINES_OPTS[usize::from(ui_state.scanlines)].to_string(),
            unsupported: false,
            group: None,
        },
        RowView {
            label: "信息密度",
            desc: "行高与面板留白",
            value: DENSITY_OPTS[p.density % DENSITY_OPTS.len()].to_string(),
            unsupported: false,
            group: None,
        },
        RowView {
            // v0.18 C4：审批策略已接线（route/bridge 读 prefs.approval）——"信任后自动"在员工累计
            // 验收达阈值后自动验收（仍走完整 approval.accepted 流水）。不再是"存而不用"。
            label: "审批策略",
            desc: "什么交付需要人工批准",
            value: APPROVAL_OPTS[p.approval % APPROVAL_OPTS.len()].to_string(),
            unsupported: false,
            group: Some("BEHAVIOR · 员工管理"),
        },
        RowView {
            label: "并行任务上限",
            desc: "同时运行的任务数",
            value: PARALLEL_OPTS[p.parallel % PARALLEL_OPTS.len()].to_string(),
            unsupported: true,
            group: None,
        },
        RowView {
            label: "月度预算上限",
            desc: "触达 80% 告警 · 100% 硬停",
            value: BUDGET_OPTS[p.budget % BUDGET_OPTS.len()].to_string(),
            unsupported: true,
            group: None,
        },
        RowView {
            label: "权限授予范围",
            desc: "批准一次权限的默认有效期",
            value: PERM_OPTS[p.perm_scope % PERM_OPTS.len()].to_string(),
            unsupported: true,
            group: None,
        },
        RowView {
            label: "Dream 时间",
            desc: "每日复盘与记忆写入时刻",
            value: DREAM_OPTS[p.dream % DREAM_OPTS.len()].to_string(),
            unsupported: true,
            group: None,
        },
    ]
}

pub(crate) fn render_settings(frame: &mut Frame<'_>, ui_state: &UiState) {
    // v0.16 修复：先铺整帧幕布，避免居中弹层四周留白露出底层 WORKBENCH 内容(见 render_modal_backdrop)。
    crate::workbench::ui::render_modal_backdrop(frame);
    let area = centered_rect(64, 74, frame.area());
    frame.render_widget(Clear, area);

    let block = Block::default()
        .title(Span::styled(
            " ⚙ SETTINGS · 偏好设置 ",
            Style::default()
                .fg(config::aqua())
                .add_modifier(Modifier::BOLD),
        ))
        .title_bottom(Line::from(vec![
            Span::styled(" j/k 选择 · h/l 或 Enter 切换值", Style::default().fg(config::dim())),
            Span::styled("  更改即时生效 · Esc 关闭 ", Style::default().fg(config::dim())),
        ]))
        .borders(Borders::ALL)
        // v0.16 W4.3：aqua 边框(原 purple,设计稿 SETTINGS 用 --aqua)。
        .border_style(Style::default().fg(config::aqua()))
        .style(Style::default().bg(config::bg()));
    let inner = block.inner(area);
    frame.render_widget(block, area);
    let width = inner.width as usize;
    let cursor = ui_state.settings_cursor.min(ROW_COUNT - 1);

    const LABEL_W: usize = 16;

    let mut lines: Vec<Line> = Vec::new();
    for (i, row) in rows(ui_state).into_iter().enumerate() {
        if let Some(g) = row.group {
            if i > 0 {
                lines.push(Line::from(""));
            }
            lines.push(Line::from(Span::styled(
                g,
                Style::default()
                    .fg(config::dim())
                    .add_modifier(Modifier::BOLD),
            )));
        }
        let selected = i == cursor;
        let marker = if selected { "▌ " } else { "  " };
        let label_style = if row.unsupported {
            Style::default().fg(config::dim())
        } else {
            Style::default().fg(config::fg())
        };
        let value_str = format!("‹ {} ›", row.value);
        let note = if row.unsupported { "  引擎暂不支持" } else { "" };
        let label_col = format!("{:<width$}", truncate_display_width(row.label, LABEL_W), width = LABEL_W);
        let left = format!("{marker}{label_col}");
        // v0.16 W4.3：desc 列(设计稿弹性截断说明文字),挤在 label 和右侧 value/note 之间。
        let fixed_w = left.width() + value_str.width() + note.width() + 2;
        let desc_w = width.saturating_sub(fixed_w).max(0);
        let desc_shown = truncate_display_width(row.desc, desc_w);
        let pad = width.saturating_sub(left.width() + desc_shown.width() + value_str.width() + note.width());
        let row_bg = if selected {
            Style::default().bg(config::bg2())
        } else {
            Style::default()
        };
        lines.push(Line::from(vec![
            Span::styled(
                left,
                label_style.patch(row_bg).add_modifier(if selected {
                    Modifier::BOLD
                } else {
                    Modifier::empty()
                }),
            ),
            Span::styled(desc_shown, row_bg.fg(config::dim())),
            Span::raw(" ".repeat(pad)),
            Span::styled(
                value_str,
                row_bg.fg(if row.unsupported {
                    config::dim()
                } else if selected {
                    config::yellow()
                } else {
                    config::aqua()
                }),
            ),
            Span::styled(note.to_string(), row_bg.fg(config::bg2())),
        ]));
    }
    frame.render_widget(Paragraph::new(Text::from(lines)), inner);
}
