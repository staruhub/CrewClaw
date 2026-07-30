//! v0.13 M3：WORKBENCH 三栏的左（EMPLOYEE）与右（ARTIFACTS/TOOLS/EVIDENCE）面板。
//!
//! 数据真值（用户标准：有真用真，无真明示）：
//!   - EMPLOYEE（设计稿构成）：头像/身份/技能（session.ready 真值）；KPI = 跨会话累计真值
//!     （engine kpi.mjs 写盘 → session.ready employee.kpi_cumulative，与 MARKET 屏同源）；
//!     MEMORY = 持久记忆真条数（memory.state.count，引擎未透出则整节不显示）；底部压缩保留
//!     STATUS 徽章 + RISK 两行。
//!   - TOOLS：session.ready tool_catalog.resolution（= 引擎 sessionCatalog 能力真值，
//!     tool-truth.mjs 符号语义：ready ✓ / not_granted·degraded △ / 其余 ✗）；
//!   - EVIDENCE：真实证据（source_type 分类真值；数字置信度条为 dormant 分支——
//!     引擎置信度是分类，等真验证器落地才点亮）。

use ratatui::{
    Frame,
    layout::Rect,
    style::{Modifier, Style},
    text::{Line, Span, Text},
    widgets::{Block, Borders, Paragraph},
};

use unicode_width::UnicodeWidthStr;

use crate::workbench::config;
use crate::workbench::state::{AppState, SYM_FAIL, SYM_OK, SYM_WARN, UiState, autonomy_projection};
use crate::workbench::ui::{
    EMP_AVATAR, employee_tag, progress_bar_10, status_symbol, symbol_color, truncate_display_width,
};

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

/// 左栏 EMPLOYEE（设计稿构成）：头像 → 名 → 职位·版本 → ◆ 认证 → SKILLS → KPI（跨会话
/// 累计真值）→ MEMORY（持久记忆真条数；引擎未透出则整节不显示——诚实原则）。
/// 底部压缩保留 STATUS 徽章 + RISK 各一行（sol 批的 IDENTITY/STATUS/RISK 信息不丢）。
/// `compact=true`（SETTINGS 信息密度）去掉小节间虚线分隔。
pub(crate) fn render_employee(frame: &mut Frame<'_>, state: &AppState, area: Rect, compact: bool) {
    let block = titled_block("EMPLOYEE", config::yellow());
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
            // v0.14 N2：员工包 avatar.txt 真画（experts/<slug>/avatar.txt，引擎经
            // session.ready 下发）优先；空回退内置像素块。
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
                lines.push(Line::from(Span::styled("（无技能清单）", dim)));
            } else {
                for skill in emp.skills.iter().take(4) {
                    lines.push(Line::from(vec![
                        Span::styled("▪ ", Style::default().fg(config::green())),
                        Span::styled(truncate_display_width(skill, width.saturating_sub(2)), fg),
                    ]));
                }
            }
            push_sep(&mut lines);

            // KPI —— 跨会话累计真值（engine kpi.mjs 写盘 → session.ready
            // employee.kpi_cumulative，与 MARKET 屏 read_kpi_cumulative 同源）。
            // 无历史 → 诚实占位，不冒充数据。
            lines.push(section("KPI"));
            let cum = emp.kpi_cumulative;
            if cum.tasks == 0 {
                lines.push(Line::from(Span::styled("尚无任务记录", dim)));
            } else {
                lines.push(kv_line("tasks", cum.tasks.to_string(), config::fg()));
                let rate = cum.accepted as f64 / cum.tasks as f64 * 100.0;
                lines.push(kv_line("accept", format!("{rate:.0}%"), config::green()));
                lines.push(kv_line(
                    "avg$",
                    if cum.total_cost > 0.0 {
                        format!("${:.2}", cum.total_cost / cum.tasks as f64)
                    } else {
                        "—".to_string()
                    },
                    config::yellow(),
                ));
            }
            let autonomy = autonomy_projection(cum);
            push_sep(&mut lines);
            lines.push(Line::from(vec![
                Span::styled(
                    "成长 ",
                    Style::default()
                        .fg(config::dim())
                        .add_modifier(Modifier::BOLD),
                ),
                Span::styled(
                    format!(" {} ", autonomy.label),
                    Style::default()
                        .fg(config::bg())
                        .bg(match autonomy.level {
                            crate::workbench::state::AutonomyLevel::Apprentice => config::dim(),
                            crate::workbench::state::AutonomyLevel::Regular => config::aqua(),
                            crate::workbench::state::AutonomyLevel::Senior => config::green(),
                        })
                        .add_modifier(Modifier::BOLD),
                ),
                Span::styled(
                    match autonomy.level {
                        crate::workbench::state::AutonomyLevel::Apprentice => {
                            format!(
                                " · 人工 {}/{}",
                                cum.accepted,
                                crate::workbench::state::TRUST_AUTO_THRESHOLD
                            )
                        }
                        crate::workbench::state::AutonomyLevel::Regular => format!(
                            " · 策略 {}/{}",
                            cum.auto_accepted,
                            crate::workbench::state::SENIOR_AUTO_ACCEPTED_THRESHOLD
                        ),
                        crate::workbench::state::AutonomyLevel::Senior => {
                            format!(" · 策略 {}", cum.auto_accepted)
                        }
                    },
                    dim,
                ),
            ]));
            lines.push(Line::from(Span::styled(
                truncate_display_width("权限 P0–P4 · 逐项授权", width),
                dim,
            )));

            // MEMORY —— 持久记忆真条数（memory.state.count）。引擎未透出（None）时
            // 整节不显示——不用假条数凑面板。
            if let Some(count) = state.memory.count {
                push_sep(&mut lines);
                lines.push(section("MEMORY"));
                let filled = (count as usize).min(5);
                lines.push(Line::from(vec![
                    Span::styled(
                        format!("{}{}", "█".repeat(filled), "░".repeat(5 - filled)),
                        Style::default().fg(config::purple()),
                    ),
                    Span::styled(format!(" {count} 条"), dim),
                ]));
            }
        }
    }
    push_sep(&mut lines);

    // 底部压缩两行：STATUS 徽章 + RISK（保留 sol 批的运行状态/风险信息，不再占三个小节）。
    let (status, color) = if state.approval.is_some() {
        ("WAITING APPROVAL", config::orange())
    } else if state.busy_since.is_some()
        || state
            .task
            .as_ref()
            .is_some_and(|task| task.status == "running")
    {
        ("RUNNING", config::accent())
    } else if let Some(task) = state.task.as_ref() {
        match task.status.as_str() {
            "failed" | "rejected" => ("FAILED", config::red()),
            "blocked" | "revision_needed" => ("BLOCKED", config::orange()),
            "completed" | "accepted" => ("DELIVERED", config::green()),
            _ => ("IDLE", config::dim()),
        }
    } else {
        ("IDLE", config::dim())
    };
    lines.push(Line::from(Span::styled(
        format!(" {status} "),
        Style::default()
            .fg(config::bg())
            .bg(color)
            .add_modifier(Modifier::BOLD),
    )));
    let failed_tools = state
        .tools
        .values()
        .filter(|tool| matches!(tool.status.as_str(), "failed" | "blocked"))
        .count();
    if let Some(approval) = state.approval.as_ref() {
        lines.push(Line::from(Span::styled(
            truncate_display_width(approval.reason.as_deref().unwrap_or("需要人工审批"), width),
            Style::default().fg(config::orange()),
        )));
    } else if failed_tools > 0 {
        lines.push(Line::from(Span::styled(
            truncate_display_width(&format!("{failed_tools} 个工具失败或被阻断"), width),
            Style::default().fg(config::red()),
        )));
    } else if state.task.as_ref().is_some_and(|task| {
        matches!(
            task.status.as_str(),
            "failed" | "blocked" | "revision_needed"
        )
    }) {
        lines.push(Line::from(Span::styled(
            truncate_display_width("当前任务需要处理", width),
            Style::default().fg(config::orange()),
        )));
    } else {
        lines.push(Line::from(Span::styled(
            "无阻断",
            Style::default().fg(config::green()),
        )));
    }
    frame.render_widget(Paragraph::new(Text::from(lines)), inner);
}

/// 右栏 TOOLS 盒：session.ready `tool_catalog.resolution`（= 引擎 sessionCatalog 能力
/// 真值快照）。每行 `能力名 …… 符号`；符号沿用 tool-truth.mjs 语义：
/// ready→✓ / not_granted·degraded→△（需授权或降级）/ 其余（missing_key、unavailable、
/// forbidden…）→✗。只列前 8 个；引擎未声明目录时诚实占位。
pub(crate) fn render_tools_box(frame: &mut Frame<'_>, state: &AppState, area: Rect) {
    let block = titled_block("TOOLS", config::aqua());
    let inner = block.inner(area);
    frame.render_widget(block, area);
    let width = inner.width as usize;
    let dim = Style::default().fg(config::dim());
    let fg = Style::default().fg(config::fg());
    let mut lines: Vec<Line> = Vec::new();

    if state.tool_catalog.is_empty() {
        lines.push(Line::from(Span::styled("（引擎未声明能力目录）", dim)));
    } else {
        for item in state.tool_catalog.iter().take(8) {
            let (sym, color) = match item.availability.as_str() {
                "ready" => (SYM_OK, config::green()),
                "not_granted" | "degraded" => ("△", config::orange()),
                _ => (SYM_FAIL, config::red()),
            };
            let name = truncate_display_width(&item.capability, width.saturating_sub(2));
            let pad = width.saturating_sub(name.width() + 1);
            lines.push(Line::from(vec![
                Span::styled(name, fg),
                Span::raw(" ".repeat(pad.max(1))),
                Span::styled(sym.to_string(), Style::default().fg(color)),
            ]));
        }
    }
    frame.render_widget(Paragraph::new(Text::from(lines)), inner);
}

/// 证据来源 → 域名（去 scheme、截到首个 `/`）；非 URL 的来源原样返回。
fn evidence_domain(source: &str) -> &str {
    let stripped = source
        .strip_prefix("https://")
        .or_else(|| source.strip_prefix("http://"))
        .unwrap_or(source);
    stripped.split('/').next().unwrap_or(stripped)
}

/// 右栏 EVIDENCE 盒：evidence 事件真值。行 1 `◈ 域名`；行 2 数字置信度条（confidence
/// 真到达才画——dormant 分支）或 `[source_type]` 分类真值。空则诚实占位。
pub(crate) fn render_evidence_box(frame: &mut Frame<'_>, state: &AppState, area: Rect) {
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
        for ev in state.evidence.iter().rev().take(3) {
            let source = ev.source.as_deref().unwrap_or_default();
            lines.push(Line::from(vec![
                // v0.16 W3.6：设计稿 EVIDENCE 图标 ◈（与 EMPLOYEE 的 ◆ ChaoGeek 区分）。
                Span::styled("◈ ", Style::default().fg(config::aqua())),
                Span::styled(
                    truncate_display_width(evidence_domain(source), width.saturating_sub(2)),
                    fg,
                ),
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

#[allow(dead_code)]
fn render_task_legacy(frame: &mut Frame<'_>, state: &AppState, area: Rect, compact: bool) {
    let block = titled_block("TASK", config::orange());
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

    // ── CURRENT TASK ──────────────────────────────────────────────
    lines.push(section("CURRENT"));
    match state.task.as_ref() {
        None => {
            lines.push(Line::from(Span::styled(
                truncate_display_width("（无进行中任务 · 输入即派活）", width),
                dim,
            )));
        }
        Some(task) => {
            let running = task.status == "running" || state.busy_since.is_some();
            let (status_label, status_color) = if running {
                ("RUNNING", config::accent())
            } else if state.approval.is_some() {
                ("WAITING", config::orange())
            } else {
                match task.status.as_str() {
                    "completed" | "accepted" => ("DONE", config::green()),
                    "failed" | "rejected" => ("FAILED", config::red()),
                    "blocked" | "revision_needed" => ("BLOCKED", config::orange()),
                    other => (other, config::dim()),
                }
            };
            let icon = if running {
                state
                    .busy_since
                    .map(|_since| progress_bar_10(state.active_task_event_ticks(), false))
                    .unwrap_or_else(|| "→".to_string())
            } else {
                status_symbol(&task.status).to_string()
            };
            lines.push(Line::from(vec![
                Span::styled(
                    format!(" {status_label} "),
                    Style::default()
                        .fg(config::bg())
                        .bg(status_color)
                        .add_modifier(Modifier::BOLD),
                ),
                Span::styled(format!(" {icon}"), Style::default().fg(status_color)),
            ]));
            lines.push(Line::from(Span::styled(
                truncate_display_width(&task.title, width),
                Style::default()
                    .fg(config::yellow())
                    .add_modifier(Modifier::BOLD),
            )));
            if let Some(id) = task.id.as_deref() {
                lines.push(Line::from(Span::styled(
                    truncate_display_width(id, width),
                    dim,
                )));
            }
            if let Some(meta) = state
                .timeline
                .iter()
                .rev()
                .find_map(|entry| entry.task_meta.as_ref())
            {
                let mut meta_bits = vec![format!("{}s", meta.elapsed_ms / 1000)];
                if let Some(cost) = meta.est_cost {
                    meta_bits.push(format!("${cost:.2}"));
                }
                if meta.counts.total() > 0 {
                    meta_bits.push(format!("{} tools", meta.counts.total()));
                }
                lines.push(Line::from(Span::styled(
                    truncate_display_width(&meta_bits.join(" · "), width),
                    dim,
                )));
            } else if running {
                let ticks = state.active_task_event_ticks();
                lines.push(Line::from(Span::styled(
                    truncate_display_width(
                        &format!("{} 事件 tick", progress_bar_10(ticks, false)),
                        width,
                    ),
                    dim,
                )));
            }
            if state.approval.is_some() {
                lines.push(Line::from(Span::styled(
                    truncate_display_width("[a] 批准 · [r] 驳回", width),
                    Style::default().fg(config::orange()),
                )));
            }
        }
    }
    push_sep(&mut lines);

    // ── QUEUE SNAPSHOT ────────────────────────────────────────────
    lines.push(section("QUEUE"));
    if state.task_sessions.is_empty() && state.task.is_none() {
        lines.push(Line::from(Span::styled(
            truncate_display_width("（队列空 · 派活后出现）", width),
            dim,
        )));
    } else if !state.task_sessions.is_empty() {
        for (cursor, task_id) in state.task_session_order.iter().rev().enumerate().take(4) {
            let Some(session) = state.task_sessions.get(task_id) else {
                continue;
            };
            let title = session
                .task
                .as_ref()
                .map(|t| t.title.as_str())
                .filter(|t| !t.trim().is_empty())
                .unwrap_or("未命名");
            let running = session.terminal.is_none()
                && session.task.as_ref().is_some_and(|t| t.status == "running");
            let icon = if running {
                "→"
            } else {
                match session.terminal {
                    Some("task.completed") => SYM_OK,
                    Some("task.blocked" | "task.revision_needed") => SYM_WARN,
                    Some(_) => SYM_FAIL,
                    None => "·",
                }
            };
            let color = if running {
                config::accent()
            } else {
                symbol_color(icon)
            };
            lines.push(Line::from(vec![
                Span::styled(format!(" {icon} "), Style::default().fg(color)),
                Span::styled(
                    truncate_display_width(title, width.saturating_sub(4)),
                    if cursor == 0 { fg } else { dim },
                ),
            ]));
        }
        lines.push(Line::from(Span::styled(
            truncate_display_width(
                &format!("共 {} · T 展开 · o 详情", state.task_sessions.len()),
                width,
            ),
            dim,
        )));
    } else {
        lines.push(Line::from(Span::styled(
            truncate_display_width("本会话任务进行中", width),
            dim,
        )));
    }
    push_sep(&mut lines);

    // ── AGENT (compact identity only) ─────────────────────────────
    lines.push(section("AGENT"));
    match state.employee.as_ref() {
        None => lines.push(Line::from(Span::styled("未上岗", dim))),
        Some(emp) => {
            lines.push(Line::from(vec![
                Span::styled(
                    truncate_display_width(&emp.name, width.saturating_sub(10)),
                    Style::default()
                        .fg(config::yellow())
                        .add_modifier(Modifier::BOLD),
                ),
                Span::styled(format!(" {}", employee_tag(&emp.name)), dim),
            ]));
            lines.push(Line::from(Span::styled(
                truncate_display_width(&format!("{} · {}", emp.role, emp.model), width),
                dim,
            )));
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
            lines.push(Line::from(Span::styled(
                truncate_display_width(
                    &format!(
                        "本会话 {} 任务 · {} 验收 · {}",
                        tasks_done,
                        state.accepted_count,
                        if cost_sum > 0.0 {
                            format!("${cost_sum:.2}")
                        } else {
                            "—".to_string()
                        }
                    ),
                    width,
                ),
                dim,
            )));
            let autonomy = autonomy_projection(emp.kpi_cumulative);
            lines.push(Line::from(Span::styled(
                truncate_display_width(
                    &format!("成长 {} · {}", autonomy.label, autonomy.progress),
                    width,
                ),
                Style::default().fg(config::aqua()),
            )));
            if !emp.skills.is_empty() {
                let skills = emp
                    .skills
                    .iter()
                    .take(3)
                    .cloned()
                    .collect::<Vec<_>>()
                    .join(" · ");
                lines.push(Line::from(Span::styled(
                    truncate_display_width(&format!("技能 {skills}"), width),
                    dim,
                )));
            }
        }
    }
    lines.push(Line::from(Span::styled(
        truncate_display_width("o 任务详情 · [ ] 产物 · p 预览", width),
        Style::default().fg(config::bg2()),
    )));

    frame.render_widget(Paragraph::new(Text::from(lines)), inner);
}

/// TASK QUEUE——运行中优先展示 todo.updated 的活清单；空闲时回到真实任务历史。
/// 历史行的 10 格条由已观察到的工具事件 tick 填充，终态才填满，不把 elapsed time
/// 伪装成业务百分比。
pub(crate) fn render_task_queue(
    frame: &mut Frame<'_>,
    state: &AppState,
    ui_state: &UiState,
    area: Rect,
) {
    let block = titled_block("TASK QUEUE", config::orange());
    let inner = block.inner(area);
    frame.render_widget(block, area);
    let width = inner.width as usize;

    let dim = Style::default().fg(config::dim());
    let mut lines: Vec<Line> = Vec::new();

    if state
        .task
        .as_ref()
        .is_some_and(|task| task.status == "running")
        && let Some(plan) = &state.plan
        && !plan.steps.is_empty()
    {
        let mut plan_spans = vec![
            Span::styled("执行计划 ", Style::default().fg(config::orange())),
            Span::styled(
                plan.status.clone(),
                Style::default().fg(if plan.status == "approved" {
                    config::green()
                } else {
                    config::yellow()
                }),
            ),
        ];
        // 计划待审批时就地提示键位，避免“proposed 卡死无提示”。
        if plan.status == "proposed" && state.approval.is_some() {
            plan_spans.push(Span::styled(
                "  [a]批准 · [r]驳回",
                Style::default().fg(config::dim()),
            ));
        }
        lines.push(Line::from(plan_spans));
        for (index, step) in plan.steps.iter().enumerate() {
            let status = plan
                .statuses
                .get(index)
                .map(String::as_str)
                .unwrap_or("pending");
            let (symbol, color) = match status {
                "completed" => (SYM_OK, config::green()),
                "in_progress" => ("→", config::aqua()),
                _ => ("○", config::dim()),
            };
            lines.push(Line::from(vec![
                Span::styled(format!("{symbol} "), Style::default().fg(color)),
                Span::styled(truncate_display_width(step, width.saturating_sub(2)), dim),
            ]));
        }
        frame.render_widget(Paragraph::new(Text::from(lines)), inner);
        return;
    }

    if !state.task_sessions.is_empty() {
        let visible = inner.height as usize;
        let selected_cursor = ui_state
            .task_session_cursor
            .min(state.task_sessions.len().saturating_sub(1));
        let start = selected_cursor.saturating_add(1).saturating_sub(visible);
        for (cursor, task_id) in state
            .task_session_order
            .iter()
            .rev()
            .enumerate()
            .skip(start)
            .take(visible)
        {
            let Some(session) = state.task_sessions.get(task_id) else {
                continue;
            };
            let selected = cursor == selected_cursor;
            let task = session.task.as_ref();
            let title = task
                .map(|task| task.title.as_str())
                .filter(|title| !title.trim().is_empty())
                .unwrap_or("未命名任务");
            let running =
                session.terminal.is_none() && task.is_some_and(|task| task.status == "running");
            let meta = session
                .timeline
                .iter()
                .find_map(|entry| entry.task_meta.as_ref());
            let (icon, icon_color, tail) = if running {
                let icon = session
                    .busy_since
                    .map(|since| crate::workbench::ui::spinner_frame(since.elapsed().as_millis()))
                    .unwrap_or("→");
                let tail = if width >= 44 {
                    format!(
                        "{} running",
                        progress_bar_10(session.activity.total(), false)
                    )
                } else {
                    "running".to_string()
                };
                (icon, config::accent(), tail)
            } else {
                let icon = match session.terminal {
                    Some("task.completed") => SYM_OK,
                    Some("task.blocked" | "task.revision_needed") => SYM_WARN,
                    Some(_) => SYM_FAIL,
                    None => SYM_WARN,
                };
                let mut tail = meta
                    .map(|meta| {
                        let mut value = format!("{}s", meta.elapsed_ms / 1000);
                        if let Some(cost) = meta.est_cost {
                            value.push_str(&format!("  ${cost:.2}"));
                        }
                        value
                    })
                    .unwrap_or_else(|| session.status.clone());
                if width >= 44 {
                    tail = format!(
                        "{} {tail}",
                        progress_bar_10(session.activity.total(), session.terminal.is_some())
                    );
                }
                (icon, symbol_color(icon), tail)
            };

            let seq = state.task_session_order.len().saturating_sub(cursor);
            let head = format!("{icon} #{seq} ");
            let title_w = width.saturating_sub(2 + head.width() + tail.width() + 1);
            let title = truncate_display_width(title, title_w.max(4));
            let pad = width.saturating_sub(2 + head.width() + title.width() + tail.width());
            let row_bg = selected.then(config::bg2);
            let with_bg = |style: Style| match row_bg {
                Some(bg) => style.bg(bg),
                None => style,
            };
            lines.push(Line::from(vec![
                Span::styled(
                    "▌ ",
                    with_bg(Style::default().fg(if selected {
                        config::yellow()
                    } else {
                        config::bg()
                    })),
                ),
                Span::styled(head, with_bg(Style::default().fg(icon_color))),
                Span::styled(
                    title,
                    with_bg(
                        Style::default()
                            .fg(config::fg())
                            .add_modifier(Modifier::BOLD)
                            .add_modifier(if session.terminal == Some("task.rejected") {
                                Modifier::CROSSED_OUT
                            } else {
                                Modifier::empty()
                            }),
                    ),
                ),
                Span::styled(" ".repeat(pad), with_bg(Style::default())),
                Span::styled(tail, with_bg(dim)),
            ]));
        }
        frame.render_widget(Paragraph::new(Text::from(lines)), inner);
        return;
    }

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
        let progress = progress_bar_10(state.active_task_event_ticks(), false);
        let tail = if width >= 44 {
            format!("{progress} running")
        } else {
            "running".to_string()
        };
        // v0.16 W3.2：running 行头改 braille 旋转帧(busy 时长推导,与 hint 行 spinner 同源)——
        // 设计稿队列有进度动效,我们无进度事件,用真·busy 时长驱动的旋转帧作诚实的对应。
        let icon = match state.busy_since {
            Some(since) => crate::workbench::ui::spinner_frame(since.elapsed().as_millis()),
            None => "→",
        };
        let head = format!("{icon} #{running_seq} ");
        // v0.16 W2.2：行首 ▌ marker(设计稿统一行语言;QUEUE 无游标 → 恒未选样式,fg=bg 占位)。
        let title_w = width.saturating_sub(2 + head.width() + tail.width() + 1);
        let title = truncate_display_width(&task.title, title_w.max(4));
        let pad = width.saturating_sub(2 + head.width() + title.width() + tail.width());
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
        if width >= 44 {
            tail = format!("{} {tail}", progress_bar_10(meta.counts.total(), true));
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
        let title_w = width.saturating_sub(2 + head.width() + tail.width() + 1);
        let title = truncate_display_width(title, title_w.max(4));
        let pad = width.saturating_sub(2 + head.width() + title.width() + tail.width());
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workbench::state::{
        Employee, Evidence, KpiCumulative, KpiState, Plan, Task, ToolCapabilityState,
    };
    use ratatui::{Terminal, backend::TestBackend};

    fn screen(terminal: &Terminal<TestBackend>) -> String {
        terminal
            .backend()
            .buffer()
            .content()
            .iter()
            .map(|cell| cell.symbol())
            .collect()
    }

    fn employee_with_history() -> Employee {
        Employee {
            name: "AI 落地鲸".to_string(),
            role: "企业大模型落地顾问".to_string(),
            model: "claude-opus-4.8".to_string(),
            skills: vec!["模型选型".to_string(), "Agent 工作流".to_string()],
            avatar: Vec::new(),
            kpi_cumulative: KpiCumulative {
                state: KpiState::Valid,
                tasks: 9,
                accepted: 6,
                auto_accepted: 2,
                total_cost: 3.6,
                first_hired_ts: Some(1_700_000_000_000),
            },
            eval: None,
            growth_card: None,
        }
    }

    /// 设计稿 EMPLOYEE 构成：头像回退块 + SKILLS 真值 + KPI 累计真值 + MEMORY 真条数。
    #[test]
    fn employee_panel_renders_skills_kpi_memory_sections_with_real_data() {
        let mut state = AppState::default();
        state.employee = Some(employee_with_history());
        state.memory.count = Some(3);

        let mut t = Terminal::new(TestBackend::new(24, 30)).expect("term");
        t.draw(|frame| render_employee(frame, &state, frame.area(), false))
            .expect("render employee");
        let out = screen(&t);
        let compact = out.replace(' ', "");
        assert!(out.contains("EMPLOYEE"), "panel title");
        // 头像管道：avatar 为空时回退内置像素块（experts avatar.txt 到达时替换）。
        assert!(out.contains("▛▀▀▜"), "builtin avatar fallback");
        assert!(compact.contains("AI落地鲸"), "employee name");
        assert!(out.contains("◆ ChaoGeek Certified"), "cert badge");
        assert!(out.contains("SKILLS"), "skills section");
        assert!(compact.contains("▪模型选型"), "skill row with bullet");
        assert!(out.contains("KPI"), "kpi section");
        assert!(out.contains("67%"), "accept rate 6/9");
        assert!(out.contains("$0.40"), "avg cost 3.6/9");
        assert!(compact.contains("成长"), "autonomy narrative section");
        assert!(
            compact.contains("转正"),
            "accepted threshold projects to regular"
        );
        assert!(
            out.contains("P0–P4"),
            "autonomy never overrides permission truth"
        );
        assert!(out.contains("MEMORY"), "memory section");
        assert!(compact.contains("███░░3条"), "memory bar + real count");
    }

    /// KPI 无历史 → 诚实占位；memory count 引擎未透出 → MEMORY 整节不显示。
    #[test]
    fn employee_panel_honest_placeholders_without_history() {
        let mut state = AppState::default();
        state.employee = Some(Employee {
            kpi_cumulative: KpiCumulative::default(),
            ..employee_with_history()
        });
        assert_eq!(state.memory.count, None, "engine did not send count");

        let mut t = Terminal::new(TestBackend::new(24, 30)).expect("term");
        t.draw(|frame| render_employee(frame, &state, frame.area(), false))
            .expect("render employee");
        let out = screen(&t);
        let compact = out.replace(' ', "");
        assert!(compact.contains("尚无任务记录"), "honest KPI placeholder");
        assert!(
            compact.contains("见习"),
            "new employee starts at apprentice level"
        );
        assert!(
            !out.contains("MEMORY"),
            "memory section omitted when unsent"
        );
        assert!(out.contains("IDLE"), "compressed status badge kept");
        assert!(compact.contains("无阻断"), "compressed risk line kept");
    }

    /// TOOLS/EVIDENCE 盒：有数据渲染真值（tool-truth 符号语义 + 域名/置信度条），
    /// 无数据显示诚实占位。
    #[test]
    fn tools_and_evidence_boxes_render_truth_and_honest_placeholders() {
        // 空数据 → 诚实占位。
        let empty = AppState::default();
        let mut t = Terminal::new(TestBackend::new(30, 6)).expect("term");
        t.draw(|frame| render_tools_box(frame, &empty, frame.area()))
            .expect("render tools empty");
        assert!(
            screen(&t)
                .replace(' ', "")
                .contains("（引擎未声明能力目录）"),
            "honest tools placeholder"
        );
        t.draw(|frame| render_evidence_box(frame, &empty, frame.area()))
            .expect("render evidence empty");
        assert!(
            screen(&t).replace(' ', "").contains("（本轮无证据链）"),
            "honest evidence placeholder"
        );

        // 有数据 → session.ready 能力真值 + evidence 事件真值。
        let mut state = AppState::default();
        let cap = |capability: &str, availability: &str| ToolCapabilityState {
            capability: capability.to_string(),
            runtime_tool: None,
            availability: availability.to_string(),
            reason: None,
            authorization: None,
            operation: None,
            risk_tier: None,
            provider: None,
            timeout_ms: None,
            side_effects: Vec::new(),
        };
        state.tool_catalog = vec![
            cap("web.search", "ready"),
            cap("shell.run", "not_granted"),
            cap("browser.render", "unavailable"),
        ];
        state.evidence = vec![Evidence {
            id: None,
            fact: Some("定价来源".to_string()),
            source: Some("https://volcengine.com/pricing".to_string()),
            confidence: Some(0.8),
            source_type: Some("official".to_string()),
        }];

        let mut t = Terminal::new(TestBackend::new(30, 6)).expect("term");
        t.draw(|frame| render_tools_box(frame, &state, frame.area()))
            .expect("render tools");
        let tools = screen(&t);
        assert!(tools.contains("TOOLS"), "tools box title");
        assert!(tools.contains("web.search"), "capability name");
        assert!(tools.contains(SYM_OK), "ready → ✓");
        assert!(tools.contains('△'), "not_granted → △");
        assert!(tools.contains(SYM_FAIL), "unavailable → ✗");

        let mut t = Terminal::new(TestBackend::new(30, 6)).expect("term");
        t.draw(|frame| render_evidence_box(frame, &state, frame.area()))
            .expect("render evidence");
        let evidence = screen(&t);
        assert!(evidence.contains("EVIDENCE"), "evidence box title");
        assert!(
            evidence.contains("◈ volcengine.com"),
            "domain only, scheme/path stripped"
        );
        assert!(
            evidence.contains("████████░░ 0.80"),
            "real confidence bar when engine sends a number"
        );
    }

    #[test]
    fn running_todo_plan_renders_in_task_queue_not_employee_panel() {
        let mut state = AppState::default();
        state.task = Some(Task {
            id: Some("task-v020".to_string()),
            title: "三步验收".to_string(),
            status: "running".to_string(),
        });
        state.plan = Some(Plan {
            steps: vec![
                "读取需求".to_string(),
                "执行验证".to_string(),
                "提交结果".to_string(),
            ],
            statuses: vec![
                "completed".to_string(),
                "in_progress".to_string(),
                "pending".to_string(),
            ],
            status: "approved".to_string(),
        });

        let mut queue = Terminal::new(TestBackend::new(60, 8)).expect("queue terminal");
        queue
            .draw(|frame| {
                render_task_queue(frame, &state, &UiState::default(), frame.area());
            })
            .expect("render queue");
        let queue_text = screen(&queue);
        assert!(queue_text.contains("TASK QUEUE"));
        let queue_compact = queue_text.replace(' ', "");
        assert!(queue_compact.contains("执行计划"));
        assert!(queue_compact.contains("读取需求"));
        assert!(queue_compact.contains("执行验证"));
        assert!(queue_compact.contains("提交结果"));
        assert!(queue_text.contains(SYM_OK));
        assert!(queue_text.contains('→'));
        assert!(queue_text.contains('○'));

        let mut employee = Terminal::new(TestBackend::new(60, 12)).expect("employee terminal");
        employee
            .draw(|frame| render_employee(frame, &state, frame.area(), false))
            .expect("render employee");
        let employee_text = screen(&employee);
        assert!(employee_text.contains("EMPLOYEE"));
        assert!(!employee_text.contains("读取需求"));
    }
}
