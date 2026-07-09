//! v0.13 M6 DREAM 屏：规范 §8 布局——上部三列 WORKED/FAILED/KNOWLEDGE，底部 PLAYBOOK DIFF
//! （+绿 −红）。引擎侧无复盘/成长数据源 → **明确标注 MOCK 的静态演示数据**。真值来源应是
//! proofpack + failure_paths 记忆的聚合，待引擎补齐后再接。

use ratatui::{
    Frame,
    layout::{Constraint, Direction, Layout, Rect},
    style::{Modifier, Style},
    text::{Line, Span, Text},
    widgets::{Block, Borders, Paragraph, Wrap},
};

use super::super::config;
use super::super::state::UiState;
use super::{mock_badge, pad_left, screen_block};

/// v0.16 W6.2：MEMORY 记忆浏览器一条记录(设计稿 memoriesData 的静态副本)。
/// `ty` ∈ {"K"=知识,"P"=playbook,"E"=证据} 供 tab 过滤；全部 MOCK,标题带 `· MOCK`。
struct MemoryItem {
    ty: &'static str,
    title: &'static str,
    date: &'static str,
    body: &'static str,
}

const MEMORY_ITEMS: [MemoryItem; 6] = [
    MemoryItem { ty: "K", title: "华东区营收口径", date: "07-07", body: "含港澳、不含海外仓。\n→ 涉及华东营收数字时先确认口径。" },
    MemoryItem { ty: "K", title: "客户偏好双交付格式", date: "07-06", body: "客户偏好 .md + .csv 双交付。\n→ 报告类任务默认两种格式都产出。" },
    MemoryItem { ty: "P", title: "playbook: model-research v3", date: "07-05", body: "调研五步：定范围 → 抓数据 → 交叉验证 → 出结论 → 附来源。\n抽检率 100%，来源必须官方页面。" },
    MemoryItem { ty: "E", title: "预算类任务默认三档方案", date: "07-04", body: "预算类任务默认给三档方案（省/稳/快）。\n→ 已在 3 次任务中验证有效，客户满意度提升。" },
    MemoryItem { ty: "K", title: "无搜索 key 环境预检", date: "07-03", body: "无搜索 key 的环境要提前预检工具可用性。\n→ 任务开始前先跑 tool.check。" },
    MemoryItem { ty: "P", title: "playbook: budget-triage v1", date: "07-02", body: "预算任务三步：识别约束 → 生成选项 → 排序推荐。" },
];

fn memory_tab_label(tab: usize) -> &'static str {
    match tab {
        1 => "K",
        2 => "P",
        3 => "E",
        _ => "全部",
    }
}

fn filtered_memory(tab: usize) -> Vec<&'static MemoryItem> {
    let want = match tab {
        1 => Some("K"),
        2 => Some("P"),
        3 => Some("E"),
        _ => None,
    };
    MEMORY_ITEMS
        .iter()
        .filter(|m| want.map_or(true, |w| m.ty == w))
        .collect()
}

struct DreamBoard {
    worked: [&'static str; 3],
    failed: [&'static str; 2],
    knowledge: [&'static str; 3],
    playbook_add: [&'static str; 2],
    playbook_remove: [&'static str; 1],
}

impl DreamBoard {
    fn mock() -> Self {
        DreamBoard {
            worked: [
                "先做需求澄清再动手，返工率下降",
                "交付前自查 checklist 拦住 2 处错误",
                "联网查证给出可核对来源",
            ],
            failed: [
                "一次性任务拆得过细，反而拖慢",
                "对无搜索 key 的环境没提前预检",
            ],
            knowledge: [
                "华东区营收口径：含港澳、不含海外仓",
                "客户偏好 .md + .csv 双交付",
                "预算类任务默认给三档方案",
            ],
            playbook_add: [
                "+ 任务开始前先跑工具可用性预检",
                "+ 交付物默认附带假设与口径说明",
            ],
            playbook_remove: ["- 无脑把任务拆成 6+ 子步"],
        }
    }
}

pub fn render(frame: &mut Frame<'_>, ui_state: &UiState, area: Rect) {
    let block = screen_block("DREAM", "复盘 · 成长 · playbook");
    let inner = block.inner(area);
    frame.render_widget(block, area);

    // v0.16 W6.2：宽屏加右栏 MEMORY 记忆浏览器(MOCK,42ch);窄屏省去(不挤压既有布局)。
    let (main_area, memory_area) = if inner.width >= 140 {
        let cols = Layout::default()
            .direction(Direction::Horizontal)
            .constraints([Constraint::Min(60), Constraint::Length(42)])
            .split(inner);
        (cols[0], Some(cols[1]))
    } else {
        (inner, None)
    };
    if let Some(mem_area) = memory_area {
        render_memory_panel(frame, ui_state, mem_area);
    }

    let d = DreamBoard::mock();
    let badge_h = 2u16;
    let diff_h = (d.playbook_add.len() + d.playbook_remove.len() + 3) as u16;
    let rows = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(badge_h),
            Constraint::Min(6),
            Constraint::Length(diff_h),
        ])
        .split(main_area);

    // MOCK 徽标行。
    frame.render_widget(
        Paragraph::new(Text::from(vec![mock_badge()])),
        pad_left(rows[0]),
    );

    // 规范 §8：三列 WORKED / FAILED / KNOWLEDGE（窄于 90 列退化为纵向堆叠）。
    if inner.width >= 90 {
        let cols = Layout::default()
            .direction(Direction::Horizontal)
            .constraints([
                Constraint::Percentage(33),
                Constraint::Percentage(33),
                Constraint::Percentage(34),
            ])
            .split(rows[1]);
        render_column(frame, cols[0], "WORKED ✓", config::green(), "✓", &d.worked);
        render_column(frame, cols[1], "FAILED ✗", config::red(), "✗", &d.failed);
        render_column(frame, cols[2], "KNOWLEDGE", config::blue(), "•", &d.knowledge);
    } else {
        let mut lines: Vec<Line> = Vec::new();
        for (title, sym, color, items) in [
            ("WORKED", "✓", config::green(), &d.worked[..]),
            ("FAILED", "✗", config::red(), &d.failed[..]),
            ("KNOWLEDGE", "•", config::blue(), &d.knowledge[..]),
        ] {
            lines.push(Line::from(Span::styled(
                title,
                Style::default().fg(color).add_modifier(Modifier::BOLD),
            )));
            for s in items {
                lines.push(Line::from(vec![
                    Span::styled(format!(" {sym} "), Style::default().fg(color)),
                    Span::styled(*s, Style::default().fg(config::fg())),
                ]));
            }
        }
        frame.render_widget(Paragraph::new(Text::from(lines)), pad_left(rows[1]));
    }

    // 底部 PLAYBOOK DIFF（+绿 −红,行号 dim + 改动行 bg1 底——设计稿 diff 行底色的 TUI 对应）。
    let mut diff: Vec<Line> = Vec::new();
    diff.push(Line::from(Span::styled(
        "PLAYBOOK DIFF",
        Style::default()
            .fg(config::dim())
            .add_modifier(Modifier::BOLD),
    )));
    let mut line_no = 1u32;
    for s in d.playbook_add {
        diff.push(
            Line::from(vec![
                Span::styled(format!("{line_no:>3} ", ), Style::default().fg(config::dim())),
                Span::styled(s.to_string(), Style::default().fg(config::green())),
            ])
            .style(Style::default().bg(config::bg1())),
        );
        line_no += 1;
    }
    for s in d.playbook_remove {
        diff.push(
            Line::from(vec![
                Span::styled(format!("{line_no:>3} ", ), Style::default().fg(config::dim())),
                Span::styled(s.to_string(), Style::default().fg(config::red())),
            ])
            .style(Style::default().bg(config::bg1())),
        );
        line_no += 1;
    }
    // v0.17 P0-2：去掉 `[Enter]` 按钮样式(orange 粗体,和真实可按键位同款视觉)——DREAM 屏
    // 目前**没有**任何 Enter 键处理,按了会落到聊天提交,和这行暗示的"按 Enter 写入"完全不符。
    // 记忆域(C2)接通前,用纯 dim 文案如实说明这只是设计预览，不是可操作的按钮。
    diff.push(Line::from(Span::styled(
        " 写入长期记忆 · 设计预览，记忆域接通前不可操作",
        Style::default().fg(config::dim()),
    )));
    let diff_block = Block::default()
        .borders(Borders::TOP)
        .border_style(Style::default().fg(config::border()));
    let diff_inner = diff_block.inner(rows[2]);
    frame.render_widget(diff_block, rows[2]);
    frame.render_widget(Paragraph::new(Text::from(diff)), pad_left(diff_inner));
}

/// 三列之一：标题 + 符号列表（Wrap 折行）。
fn render_column(
    frame: &mut Frame<'_>,
    area: Rect,
    title: &'static str,
    color: ratatui::style::Color,
    sym: &'static str,
    items: &[&'static str],
) {
    let block = Block::default()
        .title(format!(" {title} "))
        .borders(Borders::LEFT)
        .border_style(Style::default().fg(config::border()));
    let inner = block.inner(area);
    frame.render_widget(block, area);
    let mut lines: Vec<Line> = Vec::new();
    for s in items {
        lines.push(Line::from(vec![
            Span::styled(format!(" {sym} "), Style::default().fg(color)),
            Span::styled(*s, Style::default().fg(config::fg())),
        ]));
    }
    frame.render_widget(
        Paragraph::new(Text::from(lines)).wrap(Wrap { trim: true }),
        inner,
    );
}

/// v0.16 W6.2：右栏 MEMORY 记忆浏览器(MOCK——引擎侧无记忆浏览 API,标题标注)。
/// tabs(全部/K/P/E,`f` 循环)+ 列表(▌ 选中语言)+ 底部 DETAIL 正文。
fn render_memory_panel(frame: &mut Frame<'_>, ui_state: &UiState, area: Rect) {
    let block = Block::default()
        .title(Span::styled(
            " MEMORY · 记忆浏览器 · MOCK ",
            Style::default().fg(config::purple()).add_modifier(Modifier::BOLD),
        ))
        .borders(Borders::LEFT)
        .border_style(Style::default().fg(config::purple()));
    let inner = block.inner(area);
    frame.render_widget(block, area);

    let rows = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Length(1), Constraint::Min(3), Constraint::Length(1), Constraint::Min(4)])
        .split(inner);

    // tabs 行。
    let mut tab_spans = Vec::new();
    for tab in 0..4 {
        let selected = tab == ui_state.dream_mem_tab;
        let style = if selected {
            Style::default().fg(config::yellow()).bg(config::bg2()).add_modifier(Modifier::BOLD)
        } else {
            Style::default().fg(config::dim())
        };
        tab_spans.push(Span::styled(format!(" {} ", memory_tab_label(tab)), style));
    }
    tab_spans.push(Span::styled("  [f] 切换", Style::default().fg(config::dim())));
    frame.render_widget(Paragraph::new(Line::from(tab_spans)), rows[0]);

    // 列表(▌ 选中语言——与 SESSION/QUEUE/MARKET 同源)。
    let items = filtered_memory(ui_state.dream_mem_tab);
    let sel = ui_state.dream_mem_cursor.min(items.len().saturating_sub(1));
    let mut lines: Vec<Line> = Vec::new();
    if items.is_empty() {
        lines.push(Line::from(Span::styled("（此分类暂无记忆）", Style::default().fg(config::dim()))));
    }
    for (i, m) in items.iter().enumerate() {
        let selected = i == sel;
        let marker_style = if selected {
            Style::default().fg(config::yellow()).add_modifier(Modifier::BOLD)
        } else {
            Style::default().fg(config::bg())
        };
        let name_style = if selected {
            Style::default().fg(config::yellow()).add_modifier(Modifier::BOLD)
        } else {
            Style::default().fg(config::fg())
        };
        let mut line = Line::from(vec![
            Span::styled("▌ ", marker_style),
            Span::styled(format!("[{}] ", m.ty), Style::default().fg(config::aqua())),
            Span::styled(m.title.to_string(), name_style),
            Span::styled(format!("  {}", m.date), Style::default().fg(config::dim())),
        ]);
        if selected {
            line = line.style(Style::default().bg(config::bg2()));
        }
        lines.push(line);
    }
    frame.render_widget(Paragraph::new(Text::from(lines)).wrap(Wrap { trim: true }), rows[1]);

    // DETAIL 底部区。
    frame.render_widget(
        Paragraph::new(Line::from(Span::styled(
            "DETAIL",
            Style::default().fg(config::dim()).add_modifier(Modifier::BOLD),
        ))),
        rows[2],
    );
    let detail_body = items.get(sel).map(|m| m.body).unwrap_or("");
    let detail_lines: Vec<Line> = detail_body
        .split('\n')
        .map(|row| Line::from(Span::styled(row.to_string(), Style::default().fg(config::fg()))))
        .collect();
    frame.render_widget(Paragraph::new(Text::from(detail_lines)).wrap(Wrap { trim: true }), rows[3]);
}
