//! v0.13 M3：WORKBENCH 三栏的左（EMPLOYEE）与右（ARTIFACTS/TOOLS/EVIDENCE）面板。
//!
//! 数据真值（用户标准：有真用真，无真明示）：
//!   - EMPLOYEE：员工身份/技能（session.ready 真值）；KPI = **本会话真数据**（任务数=task_meta
//!     计数、已验收=approval.accepted 计数、成本=Σ引擎 est_cost）；MEMORY = 三态真值 + 真条目数。
//!   - ARTIFACTS：真实产物（bytes 真值 → KB）；TOOLS：本会话**实际调用过**的工具（不摆静态
//!     能力矩阵）；EVIDENCE：真实证据（source_type 分类真值；数字置信度条为 dormant 分支——
//!     引擎置信度是分类，等真验证器落地才点亮）。

use ratatui::{
    Frame,
    layout::{Constraint, Direction, Layout, Rect},
    style::{Modifier, Style},
    text::{Line, Span, Text},
    widgets::{Block, Borders, Paragraph},
};

use unicode_width::UnicodeWidthStr;

use crate::workbench::config;
use crate::workbench::state::{AppState, SYM_FAIL, SYM_OK, SYM_WARN};
use crate::workbench::ui::{
    EMP_AVATAR, employee_tag, status_symbol, symbol_color, truncate_display_width,
};

use super::artifact_panel::artifact_panel_rows;

/// v0.14 N1：彩色标题面板框（设计稿：面板标题彩色加粗字距）。
pub(crate) fn titled_block(title: &'static str, color: ratatui::style::Color) -> Block<'static> {
    Block::default()
        .title(Span::styled(
            format!(" {title} "),
            Style::default().fg(color).add_modifier(Modifier::BOLD),
        ))
        .borders(Borders::ALL)
        .border_style(Style::default().fg(config::border()))
}

/// v0.14 N1：小节间虚线分隔（设计稿 EMPLOYEE 面板的 dashed hr）。
fn dashed_sep(width: usize) -> Line<'static> {
    Line::from(Span::styled(
        "╌".repeat(width.max(1)),
        Style::default().fg(config::bg2()),
    ))
}

/// 面板小节标题（10px 大写字距风格的 TUI 对应：dim 大写）。
fn section(title: &'static str) -> Line<'static> {
    Line::from(Span::styled(
        title,
        Style::default()
            .fg(config::dim())
            .add_modifier(Modifier::BOLD),
    ))
}

fn kv_line(k: &str, v: String, v_color: ratatui::style::Color) -> Line<'static> {
    Line::from(vec![
        Span::styled(format!("{k:<8}"), Style::default().fg(config::dim())),
        Span::styled(v, Style::default().fg(v_color)),
    ])
}

/// 字节数 → 人类可读（KB 一位小数；<1KB 显示 B）。
fn human_bytes(bytes: u64) -> String {
    if bytes < 1024 {
        format!("{bytes} B")
    } else {
        format!("{:.1} KB", bytes as f64 / 1024.0)
    }
}

/// 左栏 EMPLOYEE：像素头像 + 身份 + SKILLS + KPI(本会话真值) + MEMORY(真值)。
/// v0.17 P0-1：`compact=true`(SETTINGS「信息密度」= compact)去掉小节间的虚线分隔行,
/// 让面板更紧凑——这是 density 设置**唯一的真实消费点**;此前它只存值/持久化,渲染层
/// 零消费,切换选项毫无变化(违反"无真明示"原则)。
pub(crate) fn render_employee(frame: &mut Frame<'_>, state: &AppState, area: Rect, compact: bool) {
    let block = titled_block("EMPLOYEE", config::aqua());
    let inner = block.inner(area);
    frame.render_widget(block, area);
    let width = inner.width as usize;

    let dim = Style::default().fg(config::dim());
    let fg = Style::default().fg(config::fg());
    let mut lines: Vec<Line> = Vec::new();
    let push_sep = |lines: &mut Vec<Line<'static>>| {
        if !compact {
            lines.push(dashed_sep(width));
        }
    };

    match state.employee.as_ref() {
        None => lines.push(Line::from(Span::styled("未上岗", dim))),
        Some(emp) => {
            // v0.14 N2：员工包 avatar.txt 真画（blue，设计稿 pre 色）优先；空回退内置像素块。
            if emp.avatar.is_empty() {
                for row in EMP_AVATAR {
                    lines.push(Line::from(Span::styled(
                        row,
                        Style::default().fg(config::accent()),
                    )));
                }
            } else {
                for row in &emp.avatar {
                    lines.push(Line::from(Span::styled(
                        truncate_display_width(row, width),
                        Style::default().fg(config::blue()),
                    )));
                }
            }
            lines.push(Line::from(vec![
                Span::styled(
                    truncate_display_width(&emp.name, width.saturating_sub(8)),
                    Style::default()
                        .fg(config::yellow())
                        .add_modifier(Modifier::BOLD),
                ),
                Span::styled(format!("  {}", employee_tag(&emp.name)), dim),
            ]));
            lines.push(Line::from(Span::styled(
                truncate_display_width(&format!("{} · {}", emp.role, emp.model), width),
                dim,
            )));
            lines.push(Line::from(Span::styled(
                "◆ ChaoGeek Certified",
                Style::default().fg(config::aqua()),
            )));
            push_sep(&mut lines);

            // SKILLS（session.ready 真值；空则如实说明）。
            lines.push(section("SKILLS"));
            if emp.skills.is_empty() {
                lines.push(Line::from(Span::styled("  （无技能清单）", dim)));
            } else {
                for skill in emp.skills.iter().take(8) {
                    lines.push(Line::from(vec![
                        // v0.16 W3.1：设计稿 SKILLS 圆点 green(原 blue)。
                        Span::styled("  ▪ ", Style::default().fg(config::green())),
                        Span::styled(truncate_display_width(skill, width.saturating_sub(4)), fg),
                    ]));
                }
            }
            push_sep(&mut lines);
        }
    }

    // KPI —— 本会话真数据（标注范围，不冒充历史累计）。
    lines.push(section("KPI · 本会话"));
    let tasks_done = state
        .timeline
        .iter()
        .filter(|e| e.task_meta.is_some())
        .count();
    let cost_sum: f64 = state
        .timeline
        .iter()
        .filter_map(|e| e.task_meta.as_ref().and_then(|m| m.est_cost))
        .sum();
    // v0.16 W3.1：设计稿 KPI 值分层——tasks=fg、accept=green、cost=yellow(原 green/green/orange)。
    lines.push(kv_line("tasks", tasks_done.to_string(), config::fg()));
    lines.push(kv_line(
        "accept",
        state.accepted_count.to_string(),
        config::green(),
    ));
    lines.push(kv_line(
        "cost",
        if cost_sum > 0.0 {
            format!("${cost_sum:.2}")
        } else {
            "—".to_string()
        },
        config::yellow(),
    ));
    push_sep(&mut lines);

    // v0.17 P2 C1：KPI —— 跨会话累计真数据（session.ready employee.kpi_cumulative，引擎从
    // `.crewclaw/kpi/<agentId>.json` 读入；旧引擎/无 agentId 时全零——不冒充历史）。
    lines.push(section("KPI · 累计"));
    let cum = state
        .employee
        .as_ref()
        .map(|e| e.kpi_cumulative)
        .unwrap_or_default();
    lines.push(kv_line("tasks", cum.tasks.to_string(), config::fg()));
    lines.push(kv_line("accept", cum.accepted.to_string(), config::green()));
    lines.push(kv_line(
        "cost",
        if cum.total_cost > 0.0 {
            format!("${:.2}", cum.total_cost)
        } else {
            "—".to_string()
        },
        config::yellow(),
    ));
    lines.push(kv_line(
        "首次上岗",
        cum.first_hired_ts
            .map(crate::workbench::ui::fmt_date)
            .unwrap_or_else(|| "—".to_string()),
        config::dim(),
    ));
    push_sep(&mut lines);

    // MEMORY —— 三态真值 + 真条目数。
    lines.push(section("MEMORY"));
    let scope_line = |label: &str, status: &str| -> Line<'static> {
        let (sym, color) = if status == "available" {
            ("●", config::green())
        } else {
            ("○", config::dim())
        };
        Line::from(vec![
            Span::styled(format!("  {sym} "), Style::default().fg(color)),
            Span::styled(
                format!("{label} {status}"),
                Style::default().fg(config::dim()),
            ),
        ])
    };
    lines.push(scope_line("session   ", &state.memory.session));
    lines.push(scope_line("persistent", &state.memory.persistent));
    lines.push(scope_line("workspace ", &state.memory.workspace));
    if let Some(count) = state.memory.count {
        lines.push(Line::from(vec![
            Span::styled("  条目 ", dim),
            Span::styled(count.to_string(), Style::default().fg(config::purple())),
        ]));
    }

    frame.render_widget(Paragraph::new(Text::from(lines)), inner);
}

/// v0.14 N1+N5：右栏三个**独立盒**（设计稿）。ARTIFACTS 行内右对齐 meta + 真实"生成于"；
/// TOOLS 双列格；EVIDENCE 保持真值展示。
pub(crate) fn render_side(frame: &mut Frame<'_>, state: &AppState, area: Rect) {
    // 高度分配：ARTIFACTS 按产物数（每个 2 行）+2 框，TOOLS 按行数+2，EVIDENCE 吃剩余。
    let art_n = state
        .artifacts
        .iter()
        .filter(|a| a.status != "deleted")
        .count()
        .min(4);
    let art_h = (art_n.max(1) * 2 + 2) as u16;
    let tool_rows = (state.tools.len().min(8).div_ceil(2)).max(1) as u16;
    let tools_h = tool_rows + 2;
    let rows = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(art_h),
            Constraint::Length(tools_h),
            Constraint::Min(3),
        ])
        .split(area);
    render_artifacts_box(frame, state, rows[0]);
    render_tools_box(frame, state, rows[1]);
    render_evidence_box(frame, state, rows[2]);
}

fn render_artifacts_box(frame: &mut Frame<'_>, state: &AppState, area: Rect) {
    let block = titled_block("ARTIFACTS", config::yellow());
    let inner = block.inner(area);
    frame.render_widget(block, area);
    let width = inner.width as usize;
    let dim = Style::default().fg(config::dim());
    let mut lines: Vec<Line> = Vec::new();

    let rows = artifact_panel_rows(state);
    if rows.is_empty() {
        lines.push(Line::from(Span::styled("（本会话暂无产物）", dim)));
    } else {
        for row in rows.iter().take(4) {
            let sym = status_symbol(&row.status);
            let artifact = state
                .artifacts
                .iter()
                .find(|a| a.name.as_deref() == Some(row.name.as_str()));
            // 行 1：图标+名（左）… KB · status（右对齐）。
            let mut meta = String::new();
            if let Some(a) = artifact {
                let mut parts: Vec<String> = Vec::new();
                if let Some(b) = a.bytes {
                    parts.push(human_bytes(b));
                }
                parts.push(a.status.clone());
                meta = parts.join(" · ");
            }
            let head = format!("{}{} ", row.marker, sym);
            let name_w = width.saturating_sub(head.width() + meta.width() + 1);
            let name = truncate_display_width(&row.name, name_w.max(4));
            let pad = width.saturating_sub(head.width() + name.width() + meta.width());
            lines.push(Line::from(vec![
                Span::styled(head, Style::default().fg(symbol_color(sym))),
                Span::styled(name, Style::default().fg(config::yellow())),
                Span::raw(" ".repeat(pad)),
                Span::styled(meta, dim),
            ]));
            // 行 2：kind · 生成于 HH:MM（真：artifact.created 的事件时间戳）。
            if let Some(a) = artifact {
                let mut sub: Vec<String> = Vec::new();
                if let Some(kind) = &a.kind {
                    sub.push(kind.clone());
                }
                if a.created_ts > 0 {
                    sub.push(format!(
                        "生成于 {}",
                        crate::workbench::ui::fmt_hhmm(a.created_ts)
                    ));
                }
                if !sub.is_empty() {
                    lines.push(Line::from(Span::styled(
                        truncate_display_width(&format!("   {}", sub.join(" · ")), width),
                        dim,
                    )));
                }
            }
        }
        // v0.15 P1-5：底注（设计稿 ARTIFACTS「点击文件预览」的 TUI 对应）。
        if (lines.len() as u16) < inner.height {
            lines.push(Line::from(Span::styled(
                truncate_display_width("[ ] 选中 · Enter 预览 · Esc 关闭", width),
                Style::default().fg(config::bg2()),
            )));
        }
    }
    frame.render_widget(Paragraph::new(Text::from(lines)), inner);
}

fn render_tools_box(frame: &mut Frame<'_>, state: &AppState, area: Rect) {
    let block = titled_block("TOOLS", config::aqua());
    let inner = block.inner(area);
    frame.render_widget(block, area);
    let width = inner.width as usize;
    let dim = Style::default().fg(config::dim());
    let fg = Style::default().fg(config::fg());
    let mut lines: Vec<Line> = Vec::new();

    if state.tools.is_empty() {
        lines.push(Line::from(Span::styled("（本会话未调用工具）", dim)));
    } else {
        // 会话实测工具去重聚合（任一次失败记 ✗）→ 设计稿双列格。
        let mut seen: Vec<(String, bool)> = Vec::new();
        for tool in state.tools.values() {
            let name = tool.tool.clone().unwrap_or_else(|| "tool".to_string());
            let ok = tool.status != "failed";
            match seen.iter_mut().find(|(n, _)| *n == name) {
                Some(slot) => slot.1 = slot.1 && ok,
                None => seen.push((name, ok)),
            }
        }
        let col_w = width / 2;
        for pair in seen.chunks(2) {
            let mut spans: Vec<Span> = Vec::new();
            for (name, ok) in pair {
                let (sym, color) = if *ok {
                    ("✓", config::green())
                } else {
                    ("✗", config::red())
                };
                let name_t = truncate_display_width(name, col_w.saturating_sub(3));
                let pad = col_w.saturating_sub(name_t.width() + 2);
                spans.push(Span::styled(name_t, fg));
                spans.push(Span::raw(" ".repeat(pad.max(1))));
                spans.push(Span::styled(sym.to_string(), Style::default().fg(color)));
                spans.push(Span::raw(" "));
            }
            lines.push(Line::from(spans));
        }
    }
    frame.render_widget(Paragraph::new(Text::from(lines)), inner);
}

fn render_evidence_box(frame: &mut Frame<'_>, state: &AppState, area: Rect) {
    let block = titled_block("EVIDENCE", config::green());
    let inner = block.inner(area);
    frame.render_widget(block, area);
    let width = inner.width as usize;
    let dim = Style::default().fg(config::dim());
    let fg = Style::default().fg(config::fg());
    let mut lines: Vec<Line> = Vec::new();

    if state.evidence.is_empty() {
        lines.push(Line::from(Span::styled("（本轮无证据链）", dim)));
    } else {
        for ev in state.evidence.iter().rev().take(5) {
            let source = ev.source.clone().unwrap_or_default();
            lines.push(Line::from(vec![
                // v0.16 W3.6：设计稿 EVIDENCE 图标 ◈(与 EMPLOYEE 的 ◆ ChaoGeek 区分)。
                Span::styled("◈ ", Style::default().fg(config::aqua())),
                Span::styled(truncate_display_width(&source, width.saturating_sub(2)), fg),
            ]));
            match ev.confidence {
                // dormant：引擎当前只发分类 source_type；数字置信度到达才画条。
                Some(conf) => {
                    let filled = ((conf * 10.0).round() as usize).min(10);
                    lines.push(Line::from(vec![
                        Span::styled(
                            format!("  {}{}", "█".repeat(filled), "░".repeat(10 - filled)),
                            Style::default().fg(config::green()),
                        ),
                        Span::styled(format!(" {conf:.2}"), dim),
                    ]));
                }
                None => {
                    if let Some(st) = &ev.source_type {
                        lines.push(Line::from(Span::styled(format!("  [{st}]"), dim)));
                    }
                }
            }
        }
    }
    frame.render_widget(Paragraph::new(Text::from(lines)), inner);
}

/// v0.14 N3：TASK QUEUE——真实任务历史。行 `{icon} #{N} {title} … {elapsed}s ${cost}`（右对齐）。
/// #N = 任务头在本会话中的序数（真序号）。设计稿的并行/进度%引擎没有 → 不造（诚实偏差）。
pub(crate) fn render_task_queue(frame: &mut Frame<'_>, state: &AppState, area: Rect) {
    let block = titled_block("TASK QUEUE", config::orange());
    let inner = block.inner(area);
    frame.render_widget(block, area);
    let width = inner.width as usize;

    let dim = Style::default().fg(config::dim());
    let mut lines: Vec<Line> = Vec::new();

    // 任务头（带 task_meta 的已完结 + 运行中的当前任务），带真序数。
    let finished: Vec<(usize, &crate::workbench::state::TimelineEntry)> = state
        .timeline
        .iter()
        .filter(|e| e.task_meta.is_some())
        .enumerate()
        .map(|(i, e)| (i + 1, e))
        .collect();
    let running_seq = finished.len() + 1;

    if let Some(task) = state.task.as_ref().filter(|t| t.status == "running") {
        let tail = "running".to_string();
        // v0.16 W3.2：running 行头改 braille 旋转帧(busy 时长推导,与 hint 行 spinner 同源)——
        // 设计稿队列有进度动效,我们无进度事件,用真·busy 时长驱动的旋转帧作诚实的对应。
        let icon = match state.busy_since {
            Some(since) => crate::workbench::ui::spinner_frame(since.elapsed().as_millis()),
            None => "→",
        };
        let head = format!("{icon} #{running_seq} ");
        // v0.16 W2.2：行首 ▌ marker(设计稿统一行语言;QUEUE 无游标 → 恒未选样式,fg=bg 占位)。
        let title_w = width.saturating_sub(2 + head.len() + tail.len() + 1);
        let title = truncate_display_width(&task.title, title_w.max(4));
        let pad = width.saturating_sub(2 + head.len() + title.width() + tail.len());
        lines.push(Line::from(vec![
            Span::styled("▌ ", Style::default().fg(config::bg())),
            Span::styled(head, Style::default().fg(config::accent())),
            Span::styled(
                title,
                Style::default()
                    .fg(config::fg())
                    .add_modifier(Modifier::BOLD),
            ),
            Span::raw(" ".repeat(pad)),
            Span::styled(tail, Style::default().fg(config::accent())),
        ]));
    }
    let remaining = (inner.height as usize).saturating_sub(lines.len());
    for (seq, entry) in finished.iter().rev().take(remaining.max(1)) {
        let meta = entry.task_meta.as_ref().expect("filtered");
        let secs = meta.elapsed_ms / 1000;
        let mut tail = format!("{secs}s");
        if let Some(cost) = meta.est_cost {
            tail.push_str(&format!("  ${cost:.2}"));
        }
        let icon = if entry.status == SYM_OK {
            SYM_OK
        } else if entry.status == SYM_FAIL {
            SYM_FAIL
        } else {
            SYM_WARN
        };
        let head = format!("{icon} #{seq} ");
        let title = entry.label.trim_start_matches("任务：");
        let title_w = width.saturating_sub(2 + head.len() + tail.len() + 1);
        let title = truncate_display_width(title, title_w.max(4));
        let pad = width.saturating_sub(2 + head.len() + title.width() + tail.len());
        lines.push(Line::from(vec![
            Span::styled("▌ ", Style::default().fg(config::bg())),
            Span::styled(head, Style::default().fg(symbol_color(icon))),
            Span::styled(title, Style::default().fg(config::fg())),
            Span::raw(" ".repeat(pad)),
            Span::styled(tail, dim),
        ]));
    }
    if lines.is_empty() {
        lines.push(Line::from(Span::styled("（暂无任务 · 输入即派活）", dim)));
    }

    frame.render_widget(Paragraph::new(Text::from(lines)), inner);
}
