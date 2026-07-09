//! v0.12 MARKET 屏：数字员工市场。读 registry/experts.json 的**真实**员工（ui_state.market，
//! 启动时由 mod.rs load_market 填充）。左列表 + 右 PROFILE 面板；h/Enter 带当前员工进 HIRE。
//! v0.16 W5.1：双栏改用彩色 titled_block(对齐设计稿 MARKETPLACE/PROFILE)+ stat 瓦片 + SKILLS chips。

use ratatui::{
    Frame,
    layout::{Constraint, Direction, Layout, Rect},
    style::{Modifier, Style},
    text::{Line, Span, Text},
    widgets::{Paragraph, Wrap},
};

use super::super::config;
use super::super::state::{AppState, MarketEntry, UiState};
use super::super::widgets::workbench_panels::titled_block;
use super::{pad_left, section};

pub fn render(frame: &mut Frame<'_>, _state: &AppState, ui_state: &UiState, area: Rect) {
    if ui_state.market.is_empty() {
        let block = titled_block("MARKETPLACE", config::yellow());
        let inner = block.inner(area);
        frame.render_widget(block, area);
        let msg = Paragraph::new(Text::from(vec![
            section("员工目录"),
            Line::from(""),
            Line::from(Span::styled(
                "  registry/experts.json 未找到或为空",
                Style::default().fg(config::dim()),
            )),
        ]));
        frame.render_widget(msg, pad_left(inner));
        return;
    }

    let cols = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([Constraint::Length(44), Constraint::Min(30)])
        .split(area);

    render_list(frame, ui_state, cols[0]);
    let sel = ui_state.market_cursor.min(ui_state.market.len() - 1);
    render_profile(frame, &ui_state.market[sel], cols[1]);
}

fn render_list(frame: &mut Frame<'_>, ui_state: &UiState, area: Rect) {
    let n = ui_state.market.len();
    // 短文案——44 列窄栏放不下设计稿原句(`[x] 对比 · [p] 发布员工 · N employees`),
    // 会被 ratatui 的 Block 标题截断；对比([x])未实现,不占用有限的底栏宽度硬凑。
    let block = titled_block("MARKETPLACE", config::yellow()).title_bottom(Line::from(vec![
        Span::styled(format!(" {n} employees"), Style::default().fg(config::dim())),
        Span::styled(" · [p] 发布 ", Style::default().fg(config::dim())),
    ]));
    let inner = block.inner(area);
    frame.render_widget(block, area);

    let rows = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Length(1), Constraint::Length(1), Constraint::Min(3)])
        .split(inner);
    // v0.16 W5.1：搜索框(设计稿装饰性入口——`/` 过滤功能单独排期,如实标注待接)。
    frame.render_widget(
        Paragraph::new(Line::from(Span::styled(
            " / 搜索数字员工…（待接）",
            Style::default().fg(config::dim()),
        ))),
        rows[0],
    );

    let sel = ui_state.market_cursor.min(ui_state.market.len().saturating_sub(1));
    let mut lines: Vec<Line> = Vec::with_capacity(n);
    for (i, e) in ui_state.market.iter().enumerate() {
        let selected = i == sel;
        // v0.16 W2：统一选中行语言(设计稿)——▌ 选中 yellow/未选不着色;选中行整行 bg2。
        let marker_style = if selected {
            Style::default().fg(config::yellow()).add_modifier(Modifier::BOLD)
        } else {
            Style::default().fg(config::bg())
        };
        let available = e.status.eq_ignore_ascii_case("available");
        let dot = if available { "●" } else { "○" };
        let dot_color = if available {
            config::green()
        } else {
            config::dim()
        };
        let name_style = if selected {
            Style::default()
                .fg(config::yellow())
                .add_modifier(Modifier::BOLD)
        } else {
            Style::default().fg(config::fg())
        };
        let mut line = Line::from(vec![
            Span::styled("▌ ", marker_style),
            Span::styled(format!("{dot} "), Style::default().fg(dot_color)),
            Span::styled(e.display_name.clone(), name_style),
            // v0.16 W5.1：分类真值挤右(registry 真字段；无 ★评分/tasks——无此真源,不造)。
            Span::styled(
                if e.category.is_empty() { String::new() } else { format!("   {}", e.category) },
                Style::default().fg(config::dim()),
            ),
        ]);
        if selected {
            line = line.style(Style::default().bg(config::bg2()));
        }
        lines.push(line);
    }
    frame.render_widget(Paragraph::new(Text::from(lines)), rows[2]);
}

fn render_profile(frame: &mut Frame<'_>, e: &MarketEntry, area: Rect) {
    let dim = Style::default().fg(config::dim());
    let fg = Style::default().fg(config::fg());
    let block = titled_block("PROFILE", config::aqua());
    let inner = block.inner(area);
    frame.render_widget(block, area);
    // 左右各留 1 列内边距。
    let padded = Rect {
        x: inner.x + 1,
        y: inner.y,
        width: inner.width.saturating_sub(2),
        height: inner.height,
    };
    let available = e.status.eq_ignore_ascii_case("available");
    let has_tags = !e.tags.is_empty();

    // v0.16 W5.1：顶部信息 + stat 瓦片 + (可选)SKILLS + 运行要求 + 行动条,用 Layout 纵向分段
    // (而非手拼 Rect 坐标——之前那版手算 y 容易越界/重叠,改用 ratatui 的布局引擎更稳)。
    let desc_lines = 3 + e.description.split('\n').count() as u16;
    let mut constraints = vec![
        Constraint::Length(desc_lines), // 名/认证/状态/简介
        Constraint::Length(3),          // stat 瓦片
    ];
    if has_tags {
        constraints.push(Constraint::Length(3)); // SKILLS 标题+chips
    }
    constraints.push(Constraint::Length(3)); // 运行要求
    constraints.push(Constraint::Min(1)); // 行动条(吃剩余)
    let rows = Layout::default().direction(Direction::Vertical).constraints(constraints).split(padded);

    let mut lines: Vec<Line> = Vec::new();
    lines.push(Line::from(Span::styled(
        e.display_name.clone(),
        Style::default().fg(config::yellow()).add_modifier(Modifier::BOLD),
    )));
    if !e.certification.is_empty() {
        lines.push(Line::from(Span::styled(
            format!("◆ {}", e.certification),
            Style::default().fg(config::aqua()),
        )));
    }
    lines.push(Line::from(Span::styled(
        format!(" {} ", if available { "在岗可雇" } else { "即将上线" }),
        Style::default()
            .fg(config::bg())
            .bg(if available { config::green() } else { config::yellow() })
            .add_modifier(Modifier::BOLD),
    )));
    for row in e.description.split('\n') {
        lines.push(Line::from(Span::styled(row.to_string(), fg)));
    }
    frame.render_widget(Paragraph::new(Text::from(lines)).wrap(Wrap { trim: true }), rows[0]);

    render_stat_tiles(frame, e, rows[1]);

    let mut next = 2;
    if has_tags {
        let chip_rows = Layout::default()
            .direction(Direction::Vertical)
            .constraints([Constraint::Length(1), Constraint::Min(1)])
            .split(rows[next]);
        frame.render_widget(
            Paragraph::new(Line::from(Span::styled(
                "SKILLS",
                Style::default().fg(config::dim()).add_modifier(Modifier::BOLD),
            ))),
            chip_rows[0],
        );
        render_skill_chips(frame, &e.tags, chip_rows[1]);
        next += 1;
    }

    let env = if e.env_reqs.is_empty() { "无需额外环境变量".to_string() } else { e.env_reqs.join(" · ") };
    let env_lines = vec![
        Line::from(Span::styled("运行要求", Style::default().fg(config::dim()).add_modifier(Modifier::BOLD))),
        Line::from(vec![Span::styled("Hermes ", dim), Span::styled(e.hermes_req.clone(), fg)]),
        Line::from(vec![Span::styled("Env    ", dim), Span::styled(env, fg)]),
    ];
    frame.render_widget(Paragraph::new(Text::from(env_lines)), rows[next]);
    next += 1;

    // 行动条：可雇员工提示 h/Enter 进体检(设计稿 `[H] HIRE` 绿虚线征募条的对应)。
    let action_line = if available {
        Line::from(Span::styled(
            "[h/Enter] 体检并雇佣 →",
            Style::default().fg(config::green()).add_modifier(Modifier::BOLD),
        ))
    } else {
        Line::from(Span::styled("即将上线，敬请期待", dim))
    };
    frame.render_widget(Paragraph::new(action_line), rows[next]);
}

fn render_stat_tiles(frame: &mut Frame<'_>, e: &MarketEntry, area: Rect) {
    let available = e.status.eq_ignore_ascii_case("available");
    let tiles: [(&str, String, ratatui::style::Color); 4] = [
        ("STATUS", if available { "available".to_string() } else { e.status.clone() }, if available { config::green() } else { config::dim() }),
        ("CATEGORY", if e.category.is_empty() { "—".to_string() } else { e.category.clone() }, config::fg()),
        ("TAGS", e.tags.len().to_string(), config::yellow()),
        ("HERMES", if e.hermes_req.is_empty() { "—".to_string() } else { e.hermes_req.clone() }, config::aqua()),
    ];
    let cols = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([Constraint::Ratio(1, 4); 4])
        .spacing(1)
        .split(area);
    for (col, (label, value, color)) in cols.iter().zip(tiles.iter()) {
        frame.render_widget(
            ratatui::widgets::Block::default()
                .borders(ratatui::widgets::Borders::ALL)
                .border_style(Style::default().fg(config::border()))
                .style(Style::default().bg(config::bg1())),
            *col,
        );
        let tinner = Rect { x: col.x + 1, y: col.y + 1, width: col.width.saturating_sub(2), height: 1.min(col.height) };
        frame.render_widget(
            Paragraph::new(Line::from(vec![
                Span::styled(value.clone(), Style::default().fg(*color).add_modifier(Modifier::BOLD)),
            ])),
            tinner,
        );
        if col.height > 2 {
            let label_area = Rect { x: col.x + 1, y: col.y + 2, width: col.width.saturating_sub(2), height: 1 };
            frame.render_widget(
                Paragraph::new(Line::from(Span::styled(*label, Style::default().fg(config::dim())))),
                label_area,
            );
        }
    }
}

fn render_skill_chips(frame: &mut Frame<'_>, tags: &[String], area: Rect) {
    let mut spans = Vec::new();
    for tag in tags.iter().take(8) {
        spans.push(Span::styled(
            format!("[{tag}]"),
            Style::default().fg(config::aqua()),
        ));
        spans.push(Span::raw(" "));
    }
    frame.render_widget(Paragraph::new(Line::from(spans)).wrap(Wrap { trim: true }), area);
}
