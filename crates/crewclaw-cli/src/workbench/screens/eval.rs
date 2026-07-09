//! v0.13 M6 EVAL 屏：规范 §8 布局——左：6 格 KPI 网格 + 月度条形 + 上岗考试；右：35ch REPUTATION
//! 侧栏（verdict 绿 PASS）。引擎侧无 KPI/考试/信誉数据源 → **明确标注 MOCK 的静态演示数据**。

use ratatui::{
    Frame,
    layout::{Constraint, Direction, Layout, Rect},
    style::{Modifier, Style},
    text::{Line, Span, Text},
    widgets::{Block, Borders, Paragraph},
};

use super::super::config;
use super::super::state::UiState;
use super::{bar, mock_badge, pad_left, screen_block, section};

/// 静态演示看板。deterministic——不随机、不读时钟，测试可断言。
struct EvalBoard {
    /// (label, value, trend)。v0.16 W6.1：trend 行随 kpi 瓦片一起画(设计稿字段,整块已是
    /// MOCK 徽标标注的演示数据)。
    kpis: [(&'static str, &'static str, &'static str); 6],
    months: [(&'static str, u32); 6],
    exams: [(&'static str, u32); 3],
    reputation: u32,
    hires: u32,
    reviews: [(&'static str, &'static str); 3],
}

impl EvalBoard {
    fn mock() -> Self {
        EvalBoard {
            kpis: [
                ("交付达成", "92%", "+3% MoM"),
                ("一次通过", "78%", "+5% MoM"),
                ("返工率", "11%", "-2% MoM"),
                ("平均耗时", "7m10s", "-40s MoM"),
                ("平均成本", "$0.82", "+$0.03 MoM"),
                ("在岗天数", "126", "累计"),
            ],
            months: [
                ("2月", 8),
                ("3月", 12),
                ("4月", 15),
                ("5月", 19),
                ("6月", 23),
                ("7月", 27),
            ],
            exams: [("模型选型", 88), ("Agent 工作流", 82), ("ROI 评估", 90)],
            reputation: 86,
            hires: 34,
            reviews: [
                ("阿超", "交付快，口径清楚"),
                ("P 总", "ROI 测算靠谱"),
                ("小满", "驳回后修订到位"),
            ],
        }
    }
}

pub fn render(frame: &mut Frame<'_>, _ui_state: &UiState, area: Rect) {
    let block = screen_block("EVAL", "绩效 · KPI · 考试 · 信誉");
    let inner = block.inner(area);
    frame.render_widget(block, area);

    let b = EvalBoard::mock();
    // 规范 §8：左主区 | 右 REPUTATION 侧栏（280px ≈ 35ch）。窄于 90 列时退化为单栏（不挤压）。
    if inner.width >= 90 {
        let cols = Layout::default()
            .direction(Direction::Horizontal)
            .constraints([Constraint::Min(40), Constraint::Length(35)])
            .split(inner);
        render_main(frame, &b, pad_left(cols[0]));
        render_reputation(frame, &b, cols[1]);
    } else {
        render_main(frame, &b, pad_left(inner));
    }
}

fn render_main(frame: &mut Frame<'_>, b: &EvalBoard, area: Rect) {
    let dim = Style::default().fg(config::dim());
    let fg = Style::default().fg(config::fg());

    // v0.16 W6.1：顶部固定 4 行给 mock 徽标 + KPI 瓦片(bg1 底+bd 框,2 行×3 列);
    // 其余(月度条形/上岗考试/verdict)仍是一个滚动 Paragraph,用 Layout 纵向分两段。
    let rows = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Length(1), Constraint::Length(1), Constraint::Length(6), Constraint::Min(3)])
        .split(area);
    frame.render_widget(Paragraph::new(mock_badge()), rows[0]);
    render_kpi_tiles(frame, b, rows[2]);

    let mut lines: Vec<Line> = Vec::new();

    // 月度完成任务条形图。
    lines.push(section("每月完成任务"));
    let max = b.months.iter().map(|(_, v)| *v).max().unwrap_or(1);
    for (m, v) in b.months {
        lines.push(Line::from(vec![
            Span::styled(format!("  {m:<4}"), dim),
            Span::styled(bar(v, max, 24), Style::default().fg(config::blue())),
            Span::styled(format!(" {v}"), fg),
        ]));
    }
    lines.push(Line::from(""));

    // 上岗考试成绩。
    lines.push(section("上岗考试"));
    for (name, score) in b.exams {
        let color = if score >= 85 {
            config::green()
        } else {
            config::yellow()
        };
        lines.push(Line::from(vec![
            Span::styled(format!("  {name:<14}"), dim),
            Span::styled(bar(score, 100, 18), Style::default().fg(color)),
            Span::styled(format!(" {score}"), Style::default().fg(color)),
        ]));
    }
    // verdict 行（规范：绿色 PASS）。
    lines.push(Line::from(vec![
        Span::styled("  verdict ", dim),
        Span::styled(
            " PASS ",
            Style::default()
                .fg(config::bg())
                .bg(config::green())
                .add_modifier(Modifier::BOLD),
        ),
        Span::styled("  全部科目达标", dim),
    ]));

    frame.render_widget(Paragraph::new(Text::from(lines)), rows[3]);
}

/// v0.16 W6.1：KPI 6 瓦片(bg1 底+bd 框,2 行×3 列;值大字彩色+trend 行 dim)。
fn render_kpi_tiles(frame: &mut Frame<'_>, b: &EvalBoard, area: Rect) {
    let tile_rows = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Length(3); 2])
        .split(area);
    for (row_area, chunk) in tile_rows.iter().zip(b.kpis.chunks(3)) {
        let cols = Layout::default()
            .direction(Direction::Horizontal)
            .constraints([Constraint::Ratio(1, 3); 3])
            .spacing(1)
            .split(*row_area);
        for (col, (label, value, trend)) in cols.iter().zip(chunk.iter()) {
            frame.render_widget(
                Block::default()
                    .borders(Borders::ALL)
                    .border_style(Style::default().fg(config::border()))
                    .style(Style::default().bg(config::bg1())),
                *col,
            );
            let value_area = Rect { x: col.x + 1, y: col.y + 1, width: col.width.saturating_sub(2), height: 1.min(col.height) };
            frame.render_widget(
                Paragraph::new(Line::from(Span::styled(
                    format!("{value}  {label}"),
                    Style::default().fg(config::green()).add_modifier(Modifier::BOLD),
                ))),
                value_area,
            );
            if col.height > 2 {
                let trend_area = Rect { x: col.x + 1, y: col.y + 2, width: col.width.saturating_sub(2), height: 1 };
                frame.render_widget(
                    Paragraph::new(Line::from(Span::styled(*trend, Style::default().fg(config::dim())))),
                    trend_area,
                );
            }
        }
    }
}

/// 右侧 REPUTATION 侧栏（规范 §8：280px 列）——评分/雇佣数/雇主评价。
fn render_reputation(frame: &mut Frame<'_>, b: &EvalBoard, area: Rect) {
    let block = Block::default()
        .title(" REPUTATION ")
        .borders(Borders::LEFT)
        .border_style(Style::default().fg(config::border()));
    let inner = block.inner(area);
    frame.render_widget(block, area);

    let dim = Style::default().fg(config::dim());
    let mut lines: Vec<Line> = Vec::new();
    lines.push(Line::from(vec![
        Span::styled(" 雇主评分 ", dim),
        Span::styled(
            format!("{}/100", b.reputation),
            Style::default()
                .fg(config::orange())
                .add_modifier(Modifier::BOLD),
        ),
    ]));
    lines.push(Line::from(vec![
        Span::styled(" ", dim),
        Span::styled(
            bar(b.reputation, 100, 20),
            Style::default().fg(config::orange()),
        ),
    ]));
    lines.push(Line::from(Span::styled(
        format!(" 累计被雇佣 {} 次", b.hires),
        dim,
    )));
    lines.push(Line::from(""));
    lines.push(Line::from(Span::styled(
        " 雇主评价",
        Style::default()
            .fg(config::dim())
            .add_modifier(Modifier::BOLD),
    )));
    for (who, comment) in b.reviews {
        lines.push(Line::from(vec![
            Span::styled(format!(" ◆ {who} "), Style::default().fg(config::aqua())),
            Span::styled(comment, Style::default().fg(config::fg())),
        ]));
    }

    frame.render_widget(Paragraph::new(Text::from(lines)), inner);
}
