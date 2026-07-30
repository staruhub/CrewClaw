//! DREAM combines the persisted review projection with the live candidate transaction state.
//! Candidates remain isolated from recall until a verified approval + activation succeeds.

use ratatui::{
    Frame,
    layout::{Constraint, Direction, Layout, Rect},
    style::{Modifier, Style},
    text::{Line, Span, Text},
    widgets::{Block, Borders, Paragraph, Wrap},
};

use super::super::config;
use super::super::flow_state::{self, DreamMorningReport, DreamUiSnapshot};
use super::super::state::{DreamSnapshot, PersistedMemory, UiState};
use super::{pad_left, screen_block};

fn memory_tab_label(tab: usize) -> &'static str {
    match tab {
        1 => "知识",
        2 => "剧本",
        3 => "复盘",
        _ => "全部",
    }
}

fn memory_kind_symbol(kind: &str) -> (&'static str, ratatui::style::Color) {
    match kind {
        "K" => ("◆", config::yellow()),
        "P" => ("▣", config::aqua()),
        "E" => ("◈", config::purple()),
        _ => ("·", config::dim()),
    }
}

fn filtered_memory(dream: &DreamSnapshot, tab: usize) -> Vec<&PersistedMemory> {
    let wanted = match tab {
        1 => Some("K"),
        2 => Some("P"),
        3 => Some("E"),
        _ => None,
    };
    dream
        .memories
        .iter()
        .filter(|memory| wanted.is_none_or(|kind| memory.kind == kind))
        .collect()
}

pub fn render(frame: &mut Frame<'_>, ui_state: &UiState, area: Rect) {
    let block = screen_block("DREAM", "复盘 · 成长 · playbook");
    let inner = block.inner(area);
    frame.render_widget(block, area);

    let dream = &ui_state.persisted_insights.dream;
    let candidate = flow_state::dream_snapshot();
    let morning_report = flow_state::dream_morning_report();
    let dream_errors = ui_state
        .persisted_insights
        .errors
        .iter()
        .filter(|error| error.starts_with("runs:") || error.starts_with("memory:"))
        .count();

    let (main_area, memory_area) = if inner.width >= 140 {
        let cols = Layout::default()
            .direction(Direction::Horizontal)
            .constraints([Constraint::Min(60), Constraint::Length(42)])
            .split(inner);
        (cols[0], Some(cols[1]))
    } else {
        (inner, None)
    };
    if let Some(memory_area) = memory_area {
        render_memory_panel(frame, ui_state, dream, dream_errors > 0, memory_area);
    }

    let compact_height = main_area.height < 18;
    let diff_rows = candidate
        .as_ref()
        .map(|value| {
            let mut count = value.diff.len() + value.blockers.len() + 1;
            if !value.next_step.is_empty() {
                count += 1;
            }
            if !value.cycle_id.is_empty() {
                count += 2;
                if !value.growth_goal.is_empty() {
                    count += 1;
                }
                if !value.task_run_id.is_empty() {
                    count += 1;
                }
            }
            count
        })
        .unwrap_or_else(|| dream.playbook_add.len() + dream.playbook_remove.len());
    let diff_height = (diff_rows + 4).clamp(if compact_height { 3 } else { 5 }, 20) as u16;
    let rows = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(if compact_height { 1 } else { 2 }),
            Constraint::Length(if compact_height { 2 } else { 4 }),
            Constraint::Min(if compact_height { 3 } else { 6 }),
            Constraint::Length(diff_height),
        ])
        .split(main_area);

    let status = if let Some(candidate) = candidate.as_ref() {
        let color = match candidate.state.as_str() {
            "ACTIVE" => config::green(),
            "ROLLED_BACK" => config::orange(),
            "FAILED" | "BLOCKED" | "REJECTED" => config::red(),
            _ => config::yellow(),
        };
        let label = if candidate.state == "ACTIVE" {
            "COMMITTED TO MEMORY"
        } else {
            candidate.state.as_str()
        };
        Line::from(vec![
            Span::styled(
                format!(" {label} "),
                Style::default()
                    .fg(config::bg())
                    .bg(color)
                    .add_modifier(Modifier::BOLD),
            ),
            Span::styled(
                format!("  {}", candidate.dream_id),
                Style::default().fg(config::dim()),
            ),
        ])
    } else if dream_errors > 0 {
        Line::from(Span::styled(
            format!(" 复盘状态不可验证 · {dream_errors} 项持久化状态被安全拒绝"),
            Style::default()
                .fg(config::red())
                .add_modifier(Modifier::BOLD),
        ))
    } else if dream.has_review_data() {
        Line::from(Span::styled(
            format!(
                " 真实持久状态 · TaskRun {} · 复盘候选 {}",
                dream.run_count, dream.dream_candidates
            ),
            Style::default()
                .fg(config::green())
                .add_modifier(Modifier::BOLD),
        ))
    } else {
        Line::from(Span::styled(
            " 未复盘 · 暂无真实 TaskRun dream / committed memory 数据",
            Style::default().fg(config::dim()),
        ))
    };
    frame.render_widget(Paragraph::new(status), pad_left(rows[0]));
    render_morning_report(frame, morning_report.as_ref(), rows[1]);

    if main_area.width >= 90 {
        let cols = Layout::default()
            .direction(Direction::Horizontal)
            .constraints([
                Constraint::Percentage(33),
                Constraint::Percentage(33),
                Constraint::Percentage(34),
            ])
            .split(rows[2]);
        render_column(
            frame,
            cols[0],
            "WORKED ✓",
            config::green(),
            "✓",
            &dream.worked,
        );
        render_column(
            frame,
            cols[1],
            "FAILED ✗",
            config::red(),
            "✗",
            &dream.failed,
        );
        render_column(
            frame,
            cols[2],
            "KNOWLEDGE",
            config::yellow(),
            "◆",
            &dream.knowledge,
        );
    } else {
        let mut lines: Vec<Line> = Vec::new();
        for (title, symbol, color, items) in [
            ("WORKED", "✓", config::green(), &dream.worked),
            ("FAILED", "✗", config::red(), &dream.failed),
            ("KNOWLEDGE", "◆", config::yellow(), &dream.knowledge),
        ] {
            lines.push(Line::from(Span::styled(
                title,
                Style::default().fg(color).add_modifier(Modifier::BOLD),
            )));
            if items.is_empty() {
                lines.push(Line::from(Span::styled(
                    "  暂无",
                    Style::default().fg(config::dim()),
                )));
            } else {
                for item in items {
                    lines.push(Line::from(vec![
                        Span::styled(format!(" {symbol} "), Style::default().fg(color)),
                        Span::styled(item.clone(), Style::default().fg(config::fg())),
                    ]));
                }
            }
        }
        frame.render_widget(Paragraph::new(Text::from(lines)), pad_left(rows[2]));
    }

    render_playbook_diff(frame, dream, candidate.as_ref(), rows[3]);
}

fn render_morning_report(frame: &mut Frame<'_>, report: Option<&DreamMorningReport>, area: Rect) {
    let mut lines = vec![Line::from(Span::styled(
        "昨夜 DREAM 晨报",
        Style::default()
            .fg(config::purple())
            .add_modifier(Modifier::BOLD),
    ))];
    if let Some(report) = report {
        let date = report.source_created_at.get(..10).unwrap_or("--");
        lines.push(Line::from(vec![
            Span::styled(
                format!(" {date} · {} · ", report.state),
                Style::default().fg(config::dim()),
            ),
            Span::styled(
                format!(
                    "复核 {}  新增 {}  合并 {}  替换 {}  清理 {}  消解 {}",
                    report.reviewed_count,
                    report.added_count,
                    report.merged_count,
                    report.replaced_count,
                    report.dropped_count,
                    report.resolved_memory_count,
                ),
                Style::default().fg(config::fg()),
            ),
        ]));
        lines.push(Line::from(vec![
            Span::styled(
                format!(
                    " Eval {} · 审批 {} · 激活 {}",
                    if report.candidate_eval_passed {
                        "✓"
                    } else {
                        "—"
                    },
                    if report.approved { "✓" } else { "—" },
                    if report.activated { "✓" } else { "—" },
                ),
                Style::default().fg(if report.activated {
                    config::green()
                } else {
                    config::yellow()
                }),
            ),
            Span::styled(
                format!(
                    " · 阻塞 {} · 技能淘汰预警 {}",
                    report.validation_blocker_count, report.skill_retirement_candidate_count,
                ),
                Style::default().fg(config::dim()),
            ),
        ]));
    } else {
        lines.push(Line::from(Span::styled(
            " 昨夜无已持久化 Dream 产物",
            Style::default().fg(config::dim()),
        )));
    }
    frame.render_widget(
        Paragraph::new(Text::from(lines)).wrap(Wrap { trim: true }),
        pad_left(area),
    );
}

fn render_column(
    frame: &mut Frame<'_>,
    area: Rect,
    title: &'static str,
    color: ratatui::style::Color,
    symbol: &'static str,
    items: &[String],
) {
    let block = Block::default()
        .title(format!(" {title} "))
        .borders(Borders::LEFT)
        .border_style(Style::default().fg(config::border()));
    let inner = block.inner(area);
    frame.render_widget(block, area);
    let lines = if items.is_empty() {
        vec![Line::from(Span::styled(
            " 暂无真实记录",
            Style::default().fg(config::dim()),
        ))]
    } else {
        items
            .iter()
            .map(|item| {
                Line::from(vec![
                    Span::styled(format!(" {symbol} "), Style::default().fg(color)),
                    Span::styled(item.clone(), Style::default().fg(config::fg())),
                ])
            })
            .collect()
    };
    frame.render_widget(
        Paragraph::new(Text::from(lines)).wrap(Wrap { trim: true }),
        inner,
    );
}

fn render_playbook_diff(
    frame: &mut Frame<'_>,
    dream: &DreamSnapshot,
    candidate: Option<&DreamUiSnapshot>,
    area: Rect,
) {
    let title = candidate
        .map(|value| format!("CANDIDATE DIFF · {}", value.state))
        .unwrap_or_else(|| "PLAYBOOK DIFF · 已提交".to_string());
    let mut lines: Vec<Line> = vec![Line::from(Span::styled(
        title,
        Style::default()
            .fg(config::dim())
            .add_modifier(Modifier::BOLD),
    ))];
    if let Some(candidate) = candidate {
        for (index, entry) in candidate.diff.iter().enumerate() {
            let (symbol, color) = match entry.op.as_str() {
                "add" | "merge" => ("+", config::green()),
                "replace" => ("~", config::yellow()),
                "drop" => ("-", config::red()),
                _ => ("·", config::blue()),
            };
            lines.push(
                Line::from(vec![
                    Span::styled(
                        format!("{:>3} {symbol} ", index + 1),
                        Style::default().fg(color),
                    ),
                    Span::styled(entry.text.clone(), Style::default().fg(color)),
                    Span::styled(
                        format!("  {}", entry.reason),
                        Style::default().fg(config::dim()),
                    ),
                ])
                .style(Style::default().bg(config::bg1())),
            );
        }
        for blocker in &candidate.blockers {
            lines.push(Line::from(vec![
                Span::styled(" ! ", Style::default().fg(config::red())),
                Span::styled(blocker.clone(), Style::default().fg(config::red())),
            ]));
        }
        if !candidate.next_step.is_empty() {
            lines.push(Line::from(Span::styled(
                format!(" 下一步：{}", candidate.next_step),
                Style::default().fg(config::orange()),
            )));
        }
        if !candidate.cycle_id.is_empty() {
            lines.push(Line::from(vec![
                Span::styled(" GROWTH ", Style::default().fg(config::aqua())),
                Span::styled(
                    format!("{} · {}", candidate.growth_kind, candidate.state),
                    Style::default().fg(config::fg()),
                ),
            ]));
            if !candidate.growth_goal.is_empty() {
                lines.push(Line::from(Span::styled(
                    format!(" 目标：{}", candidate.growth_goal),
                    Style::default().fg(config::fg()),
                )));
            }
            if !candidate.task_run_id.is_empty() {
                lines.push(Line::from(Span::styled(
                    format!(" TaskRun：{}", candidate.task_run_id),
                    Style::default().fg(config::dim()),
                )));
            }
            lines.push(Line::from(Span::styled(
                " [p] 审批并送入同一 runtime/TaskRun 管线",
                Style::default().fg(config::aqua()),
            )));
        }
        lines.push(Line::from(Span::styled(
            " [Enter] 审批并尝试激活  [x] 拒绝  [u] 回滚  [v] 检查",
            Style::default().fg(config::dim()),
        )));
    } else {
        for (index, (item, color)) in dream
            .playbook_add
            .iter()
            .map(|item| (item, config::green()))
            .chain(
                dream
                    .playbook_remove
                    .iter()
                    .map(|item| (item, config::red())),
            )
            .enumerate()
        {
            lines.push(
                Line::from(vec![
                    Span::styled(
                        format!("{:>3} ", index + 1),
                        Style::default().fg(config::dim()),
                    ),
                    Span::styled(item.clone(), Style::default().fg(color)),
                ])
                .style(Style::default().bg(config::bg1())),
            );
        }
        if dream.playbook_add.is_empty() && dream.playbook_remove.is_empty() {
            lines.push(Line::from(Span::styled(
                " 暂无已提交 playbook 变更",
                Style::default().fg(config::dim()),
            )));
        }
        lines.push(Line::from(Span::styled(
            " 只读投影 · 仅展示已持久化且 committed=true 的变更",
            Style::default().fg(config::dim()),
        )));
    }
    let block = Block::default()
        .borders(Borders::TOP)
        .border_style(Style::default().fg(config::border()));
    let inner = block.inner(area);
    frame.render_widget(block, area);
    frame.render_widget(
        Paragraph::new(Text::from(lines)).wrap(Wrap { trim: true }),
        pad_left(inner),
    );
}

fn render_memory_panel(
    frame: &mut Frame<'_>,
    ui_state: &UiState,
    dream: &DreamSnapshot,
    unverified: bool,
    area: Rect,
) {
    let title = if unverified && dream.memories.is_empty() {
        " MEMORY · 状态不可验证 "
    } else {
        " MEMORY · 持久记忆 "
    };
    let block = Block::default()
        .title(Span::styled(
            title,
            Style::default()
                .fg(if unverified {
                    config::red()
                } else {
                    config::purple()
                })
                .add_modifier(Modifier::BOLD),
        ))
        .borders(Borders::LEFT)
        .border_style(Style::default().fg(if unverified {
            config::red()
        } else {
            config::purple()
        }));
    let inner = block.inner(area);
    frame.render_widget(block, area);

    let rows = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(1),
            Constraint::Min(3),
            Constraint::Length(1),
            Constraint::Min(4),
        ])
        .split(inner);
    let mut tabs = Vec::new();
    for tab in 0..4 {
        let selected = tab == ui_state.dream_mem_tab;
        tabs.push(Span::styled(
            format!(" {} ", memory_tab_label(tab)),
            if selected {
                Style::default()
                    .fg(config::yellow())
                    .bg(config::bg2())
                    .add_modifier(Modifier::BOLD)
            } else {
                Style::default().fg(config::dim())
            },
        ));
    }
    tabs.push(Span::styled(
        "  [f] 切换",
        Style::default().fg(config::dim()),
    ));
    frame.render_widget(Paragraph::new(Line::from(tabs)), rows[0]);

    let items = filtered_memory(dream, ui_state.dream_mem_tab);
    let selected_index = ui_state.dream_mem_cursor.min(items.len().saturating_sub(1));
    let mut list = Vec::new();
    if items.is_empty() {
        list.push(Line::from(Span::styled(
            if unverified {
                "（记忆状态不可验证）"
            } else {
                "（此分类暂无持久记忆）"
            },
            Style::default().fg(if unverified {
                config::red()
            } else {
                config::dim()
            }),
        )));
    }
    for (index, memory) in items.iter().enumerate() {
        let selected = index == selected_index;
        let (kind_symbol, kind_color) = memory_kind_symbol(&memory.kind);
        let date = memory
            .saved_at
            .as_deref()
            .and_then(|timestamp| timestamp.get(..10))
            .unwrap_or("--");
        let mut line = Line::from(vec![
            Span::styled(
                "▌ ",
                Style::default().fg(if selected {
                    config::yellow()
                } else {
                    config::bg()
                }),
            ),
            Span::styled(format!("{kind_symbol} "), Style::default().fg(kind_color)),
            Span::styled(
                crate::workbench::ui::truncate_display_width(&memory.text, 22),
                Style::default().fg(if selected {
                    config::yellow()
                } else {
                    config::fg()
                }),
            ),
            Span::styled(format!("  {date}"), Style::default().fg(config::dim())),
        ]);
        if selected {
            line = line.style(Style::default().bg(config::bg2()));
        }
        list.push(line);
    }
    frame.render_widget(
        Paragraph::new(Text::from(list)).wrap(Wrap { trim: true }),
        rows[1],
    );
    frame.render_widget(
        Paragraph::new(Line::from(Span::styled(
            "DETAIL",
            Style::default()
                .fg(config::dim())
                .add_modifier(Modifier::BOLD),
        ))),
        rows[2],
    );
    let detail = items.get(selected_index).map(|memory| {
        let mut lines = vec![
            Line::from(Span::styled(
                memory.text.clone(),
                Style::default().fg(config::fg()),
            )),
            Line::from(Span::styled(
                format!("{} · confidence {}", memory.category, memory.confidence),
                Style::default().fg(config::dim()),
            )),
        ];
        if !memory.source_task_ids.is_empty() {
            lines.push(Line::from(Span::styled(
                format!("来源任务 · {}", memory.source_task_ids.join(", ")),
                Style::default().fg(config::aqua()),
            )));
        }
        if let Some(dream_run_id) = memory.dream_run_id.as_deref() {
            lines.push(Line::from(Span::styled(
                format!("Dream run · {dream_run_id}"),
                Style::default().fg(config::purple()),
            )));
        }
        lines
    });
    frame.render_widget(
        Paragraph::new(Text::from(detail.unwrap_or_default())).wrap(Wrap { trim: true }),
        rows[3],
    );
}
