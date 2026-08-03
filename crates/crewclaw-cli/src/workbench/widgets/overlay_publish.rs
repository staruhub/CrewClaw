//! v0.15 P1-4：PUBLISH 员工发布浮层（对齐 handoff 设计稿 PUBLISH EMPLOYEE）。
//!
//! 数据真值（用户标准:有真用真,无真明示 UNAVAILABLE）：
//!   - 步骤 1「Manifest 校验」= **真**：从选中 MarketEntry(registry 真值) + HireHealth(doctor 真体检)
//!     派生逐行校验结论。
//!   - 步骤 2-4（上岗考试/认证签名/发布上架）引擎无真源 → **每行 `UNAVAILABLE` 标注**，
//!     不生成分数、签名、费用或成功终态。
//!
//! 4 步:Manifest→考试→签名→上架;Enter 推进,末步 Enter 关;Esc/q 关。

use ratatui::{
    Frame,
    layout::{Constraint, Direction, Layout},
    style::{Modifier, Style},
    text::{Line, Span, Text},
    widgets::{Block, Borders, Clear, Paragraph},
};

use unicode_width::UnicodeWidthStr;

use crate::workbench::config;
use crate::workbench::state::{HireHealth, MarketEntry, UiState};
use crate::workbench::ui::{centered_rect, truncate_display_width};

pub(crate) const STEP_COUNT: usize = 4;
const STEP_NAMES: [&str; STEP_COUNT] = ["Manifest 校验", "上岗考试", "认证签名", "发布上架"];

/// 步骤 1 的**真实**校验行（registry + doctor 派生）。
fn manifest_rows(
    entry: Option<&MarketEntry>,
    health: Option<&HireHealth>,
) -> Vec<(String, String, bool)> {
    let mut rows = Vec::new();
    if let Some(e) = entry {
        rows.push((
            "identity".into(),
            format!(
                "{} · {}",
                e.name,
                if e.certification.is_empty() {
                    "未认证"
                } else {
                    &e.certification
                }
            ),
            true,
        ));
        if !e.category.is_empty() {
            rows.push(("category".into(), e.category.clone(), true));
        }
        let perms = if e.env_reqs.is_empty() {
            "无额外环境声明".to_string()
        } else {
            e.env_reqs.join(" · ")
        };
        rows.push(("environment".into(), perms, true));
        if !e.first_task.is_empty() {
            rows.push((
                "deliverables".into(),
                truncate_display_width(&e.first_task, 48),
                true,
            ));
        }
        if !e.tags.is_empty() {
            rows.push(("tags".into(), e.tags.join(" / "), true));
        }
    } else {
        rows.push((
            "manifest".into(),
            "未选中员工——回 MARKET 选一个再发布".into(),
            false,
        ));
    }
    if let Some(h) = health {
        let ok = h.status == "healthy";
        let detail = if h.issues.is_empty() {
            format!("doctor: {} · 无阻断项", h.status)
        } else {
            format!("doctor: {} · {} 项待办", h.status, h.issues.len())
        };
        rows.push(("health".into(), detail, ok));
    }
    rows
}

/// 步骤 2-4 的不可用边界（不生成任何演示数值或成功状态）。
fn unavailable_rows(step: usize) -> Vec<(&'static str, &'static str)> {
    match step {
        1 => vec![
            ("exam engine", "未配置真实考试执行器"),
            ("evaluation", "未生成分数或通过结论"),
            ("evidence", "等待 provider-verified 评测证据"),
        ],
        2 => vec![
            ("issuer", "未配置认证签发方"),
            ("signature", "未生成签名或证书"),
            ("validity", "无可验证有效期"),
        ],
        3 => vec![
            ("registry", "未配置 Marketplace 发布端点"),
            ("listing", "未创建公开条目"),
            ("status", "仅完成本地 manifest 校验"),
        ],
        _ => vec![],
    }
}

pub(crate) fn render_publish(frame: &mut Frame<'_>, ui_state: &UiState) {
    let Some(step) = ui_state.publish_step() else {
        return;
    };
    let step = step.min(STEP_COUNT - 1);
    // v0.16 修复：先铺整帧幕布，避免居中弹层四周留白露出底层 WORKBENCH 内容(见 render_modal_backdrop)。
    crate::workbench::ui::render_modal_backdrop(frame);
    let area = centered_rect(70, 68, frame.area());
    frame.render_widget(Clear, area);

    // v0.17 P1-B1：market_cursor 是 filtered 列表下标，过滤生效时不等于 market 真实下标——
    // 经 market_selected_index() 翻译，否则搜索后发布会拿错员工的 manifest/doctor 结论。
    let selected_idx = ui_state.market_selected_index();
    let entry = selected_idx.and_then(|i| ui_state.market.get(i));
    let name = entry
        .map(|e| e.display_name.as_str())
        .unwrap_or("未选中员工");
    let block = Block::default()
        .title(Span::styled(
            format!(" ⬆ PUBLISH · 发布员工 · {name} "),
            Style::default()
                .fg(config::orange())
                .add_modifier(Modifier::BOLD),
        ))
        .title_bottom(Line::from(Span::styled(
            " Enter 下一步 / 完成 · Esc/q 取消 ",
            Style::default().fg(config::dim()),
        )))
        .borders(Borders::ALL)
        .border_style(Style::default().fg(config::orange()))
        .style(Style::default().bg(config::bg()));
    let inner = block.inner(area);
    frame.render_widget(block, area);

    let cols = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([Constraint::Length(20), Constraint::Min(20)])
        .spacing(2)
        .split(inner);

    // 左：步骤条。
    let mut steps: Vec<Line> = Vec::new();
    for (i, sn) in STEP_NAMES.iter().enumerate() {
        let (sym, color) = if i < step {
            ("✓", config::green())
        } else if i == step {
            ("▶", config::orange())
        } else {
            ("○", config::dim())
        };
        steps.push(Line::from(vec![
            Span::styled(format!("{sym} "), Style::default().fg(color)),
            Span::styled(
                (*sn).to_string(),
                Style::default()
                    .fg(if i == step {
                        config::fg()
                    } else {
                        config::dim()
                    })
                    .add_modifier(if i == step {
                        Modifier::BOLD
                    } else {
                        Modifier::empty()
                    }),
            ),
        ]));
        steps.push(Line::from(""));
    }
    frame.render_widget(Paragraph::new(Text::from(steps)), cols[0]);

    // 右：当前步骤检查行。
    let width = cols[1].width as usize;
    let mut rows: Vec<Line> = Vec::new();
    if step == 0 {
        let health = selected_idx.and_then(|i| ui_state.hire_reports.get(i));
        rows.push(section_line(
            "真实校验 · registry + doctor",
            config::green(),
        ));
        for (k, v, ok) in manifest_rows(entry, health) {
            rows.push(check_row(&k, &v, ok, None, width));
        }
    } else {
        rows.push(section_line(
            "UNAVAILABLE · 外部发布链路未配置",
            config::orange(),
        ));
        for (k, v) in unavailable_rows(step) {
            rows.push(check_row(k, v, false, Some("UNAVAILABLE"), width));
        }
    }
    // 末步完成 banner。
    if step == STEP_COUNT - 1 {
        rows.push(Line::from(""));
        rows.push(Line::from(Span::styled(
            "! 未发布 · Marketplace 端点未配置",
            Style::default()
                .fg(config::orange())
                .add_modifier(Modifier::BOLD),
        )));
        rows.push(Line::from(Span::styled(
            "当前只验证本地 manifest；未生成认证、签名或公开条目。",
            Style::default().fg(config::dim()),
        )));
    }
    frame.render_widget(Paragraph::new(Text::from(rows)), cols[1]);
}

fn section_line(text: &str, color: ratatui::style::Color) -> Line<'static> {
    Line::from(Span::styled(
        text.to_string(),
        Style::default().fg(color).add_modifier(Modifier::BOLD),
    ))
}

fn check_row(k: &str, v: &str, ok: bool, tag: Option<&str>, width: usize) -> Line<'static> {
    let sym = if ok { "✓" } else { "!" };
    let sym_c = if ok {
        config::green()
    } else {
        config::orange()
    };
    let head = format!("{sym} {k:<12} ");
    let tag_s = tag.map(|t| format!("  [{t}]")).unwrap_or_default();
    let val_w = width.saturating_sub(head.width() + tag_s.width()).max(4);
    let val = truncate_display_width(v, val_w);
    let mut spans = vec![
        Span::styled(format!("{sym} "), Style::default().fg(sym_c)),
        Span::styled(format!("{k:<12} "), Style::default().fg(config::dim())),
        Span::styled(val, Style::default().fg(config::fg())),
    ];
    if !tag_s.is_empty() {
        spans.push(Span::styled(tag_s, Style::default().fg(config::bg2())));
    }
    Line::from(spans)
}
