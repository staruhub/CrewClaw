//! v0.12：多屏「数字员工操作系统」的非-WORKBENCH 四屏（对标设计稿 CrewClaw TUI.dc.html）。
//!
//! 完成标准分层（用户确认「有真用真，无真明示 mock」）：
//!   - MARKET / HIRE 读 Rust 侧**真实数据**（registry experts.json / doctor::build_report）。
//!   - EVAL / DREAM 引擎侧无 KPI/考试/复盘数据源 → 渲染**明确标注 `示例数据 · MOCK` 的静态数据**。
//!
//! WORKBENCH 仍由 ui.rs 直接渲染（接 live TaskEvent 流），不在本模块。

pub mod dream;
pub mod eval;
pub mod hire;
pub mod market;

use ratatui::{
    layout::Rect,
    style::{Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders},
};

use super::config;

/// 全屏标题面板：accent 描边 + 标题 + 右上副标题。返回 inner 区供正文渲染。
pub(crate) fn screen_block(title: &str, subtitle: &str) -> Block<'static> {
    let t = if subtitle.is_empty() {
        format!(" {title} ")
    } else {
        format!(" {title} · {subtitle} ")
    };
    Block::default()
        .title(t)
        .borders(Borders::ALL)
        .border_style(Style::default().fg(config::border()))
}

/// `示例数据 · MOCK` 徽标行——EVAL/DREAM 顶部明示无真实数据源。
pub(crate) fn mock_badge() -> Line<'static> {
    Line::from(vec![
        Span::styled(
            " 示例数据 · MOCK ",
            Style::default()
                .fg(config::bg())
                .bg(config::orange())
                .add_modifier(Modifier::BOLD),
        ),
        Span::styled(
            "  引擎侧暂无该数据源，以下为演示占位",
            Style::default().fg(config::dim()),
        ),
    ])
}

/// 小节标题行。
pub(crate) fn section(title: &str) -> Line<'static> {
    Line::from(Span::styled(
        format!("▏{title}"),
        Style::default()
            .fg(config::accent())
            .add_modifier(Modifier::BOLD),
    ))
}

/// 横向条形（bar chart 单元）：`value/max` 映射到 `width` 个 block 字符。
pub(crate) fn bar(value: u32, max: u32, width: usize) -> String {
    if max == 0 || width == 0 {
        return String::new();
    }
    let filled = ((value as f64 / max as f64) * width as f64).round() as usize;
    let filled = filled.min(width);
    format!("{}{}", "█".repeat(filled), "░".repeat(width - filled))
}

/// 内缩一格的正文区（给 inner 再留 1 列左内边距，视觉更透气）。
pub(crate) fn pad_left(area: Rect) -> Rect {
    Rect {
        x: area.x + 1,
        y: area.y,
        width: area.width.saturating_sub(2),
        height: area.height,
    }
}
