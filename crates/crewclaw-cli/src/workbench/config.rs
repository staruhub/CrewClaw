//! v0.8 M7：TUI 配置与主题。
//!
//! 颜色与鼠标捕获从硬编码变为可配置：读 `.crewclaw/tui.json`，缺省全默认，与内置默认**合并**
//! （只写想改的键）。主题只管 chrome（边框/状态栏/徽标/gutter），M2 的 ANSI 定妆行不受主题控制
//! （渲染器色板即真源）。配置缺失/损坏 → 静默回落默认，不 panic（AC-THM-002）。

use std::path::Path;
use std::sync::RwLock;

use ratatui::style::Color;
use serde::{Deserialize, Serialize};

/// v0.15 P1-1：偏好设置（SETTINGS 浮层）。持久化到 `.crewclaw/prefs.json`(独立于用户 tui.json,
/// 不覆写用户手写配置)。字段存**选项下标**——具体可选值由 overlay_settings 的静态表定义。
/// APPEARANCE(theme_index/scanlines/density) 全真生效；BEHAVIOR 组引擎暂不支持,仅存选择(为接入预留)。
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Prefs {
    #[serde(default)]
    pub theme_index: usize,
    #[serde(default)]
    pub scanlines: bool,
    #[serde(default)]
    pub density: usize, // 0=舒适 1=紧凑
    #[serde(default)]
    pub approval: usize,
    #[serde(default)]
    pub parallel: usize,
    #[serde(default)]
    pub budget: usize,
    #[serde(default)]
    pub perm_scope: usize,
    #[serde(default)]
    pub dream: usize,
}

impl Default for Prefs {
    fn default() -> Self {
        Self {
            theme_index: 0,
            scanlines: false,
            density: 0,
            approval: 0,
            parallel: 0,
            budget: 0,
            perm_scope: 0,
            dream: 0,
        }
    }
}

impl Prefs {
    /// 从 `root/.crewclaw/prefs.json` 读；不存在/损坏 → 默认（不 panic）。
    pub fn load(root: &Path) -> Self {
        let path = root.join(".crewclaw").join("prefs.json");
        match std::fs::read_to_string(&path) {
            Ok(s) => serde_json::from_str(&s).unwrap_or_default(),
            Err(_) => Self::default(),
        }
    }

    /// 写回 `root/.crewclaw/prefs.json`（best-effort;IO 失败静默——偏好丢失不该炸 UI）。
    pub fn save(&self, root: &Path) {
        let dir = root.join(".crewclaw");
        if std::fs::create_dir_all(&dir).is_err() {
            return;
        }
        if let Ok(json) = serde_json::to_string_pretty(self) {
            let _ = std::fs::write(dir.join("prefs.json"), json);
        }
    }
}

/// 完整 13 色 chrome 色板（v0.12：对标设计稿 CrewClaw TUI.dc.html 的 CSS 变量）。
/// 语义分层：`bg/bg1/bg2` 三级底色，`bd` 边框，`fg` 主文本，`dim` 次要文本，其余 7 个是命名强调色。
/// `accent` 是员工派生主色（进场时由 employee_accent 覆写），默认取 `blue`。
/// 兼容层：老代码通过 `ok()/bad()/warn()` 访问，映射到 `green/red/yellow`，故 ~70 个旧调用点无需改动。
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Theme {
    pub bg: Color,
    pub bg1: Color,
    pub bg2: Color,
    pub bd: Color,
    pub fg: Color,
    pub dim: Color,
    pub red: Color,
    pub green: Color,
    pub yellow: Color,
    pub blue: Color,
    pub purple: Color,
    pub aqua: Color,
    pub orange: Color,
    /// 员工派生主色；未派生时等于 `blue`。
    pub accent: Color,
    /// v0.16 W0：modeline 底色（设计稿 `--ml`）。gruvbox 两套比 bg2 明显偏亮——
    /// 这是设计稿底部 modeline 一眼可辨的原因;solarized 两套 ==bg2。
    pub ml: Color,
}

/// 十六进制字面量 → `Color::Rgb`（const 友好，供主题常量表书写）。
const fn rgb(hex: u32) -> Color {
    Color::Rgb(
        ((hex >> 16) & 0xff) as u8,
        ((hex >> 8) & 0xff) as u8,
        (hex & 0xff) as u8,
    )
}

impl Theme {
    /// gruvbox-dark：设计稿默认主题（body 根变量）。
    pub const GRUVBOX_DARK: Theme = Theme {
        bg: rgb(0x282828),
        bg1: rgb(0x32302f),
        bg2: rgb(0x3c3836),
        bd: rgb(0x504945),
        fg: rgb(0xebdbb2),
        dim: rgb(0x928374),
        red: rgb(0xfb4934),
        green: rgb(0xb8bb26),
        yellow: rgb(0xfabd2f),
        blue: rgb(0x83a598),
        purple: rgb(0xd3869b),
        aqua: rgb(0x8ec07c),
        orange: rgb(0xfe8019),
        accent: rgb(0x83a598),
        ml: rgb(0x7c6f64),
    };

    /// gruvbox-light。
    pub const GRUVBOX_LIGHT: Theme = Theme {
        bg: rgb(0xfbf1c7),
        bg1: rgb(0xf4e8be),
        bg2: rgb(0xebdbb2),
        bd: rgb(0xbdae93),
        fg: rgb(0x3c3836),
        dim: rgb(0x928374),
        red: rgb(0x9d0006),
        green: rgb(0x79740e),
        yellow: rgb(0xb57614),
        blue: rgb(0x076678),
        purple: rgb(0x8f3f71),
        aqua: rgb(0x427b58),
        orange: rgb(0xaf3a03),
        accent: rgb(0x076678),
        ml: rgb(0xd5c4a1),
    };

    /// solarized-dark。
    pub const SOLARIZED_DARK: Theme = Theme {
        bg: rgb(0x002b36),
        bg1: rgb(0x03313d),
        bg2: rgb(0x073642),
        bd: rgb(0x586e75),
        fg: rgb(0x93a1a1),
        dim: rgb(0x586e75),
        red: rgb(0xdc322f),
        green: rgb(0x859900),
        yellow: rgb(0xb58900),
        blue: rgb(0x268bd2),
        purple: rgb(0xd33682),
        aqua: rgb(0x2aa198),
        orange: rgb(0xcb4b16),
        accent: rgb(0x268bd2),
        ml: rgb(0x073642),
    };

    /// solarized-light。
    pub const SOLARIZED_LIGHT: Theme = Theme {
        bg: rgb(0xfdf6e3),
        bg1: rgb(0xf7f0dc),
        bg2: rgb(0xeee8d5),
        bd: rgb(0x93a1a1),
        fg: rgb(0x586e75),
        dim: rgb(0x93a1a1),
        red: rgb(0xdc322f),
        green: rgb(0x859900),
        yellow: rgb(0xb58900),
        blue: rgb(0x268bd2),
        purple: rgb(0xd33682),
        aqua: rgb(0x2aa198),
        orange: rgb(0xcb4b16),
        accent: rgb(0x268bd2),
        ml: rgb(0xeee8d5),
    };

    /// 兼容别名：老配置/测试用 `Theme::DARK`/`Theme::LIGHT`，映射到 gruvbox 双主题。
    pub const DARK: Theme = Theme::GRUVBOX_DARK;
    pub const LIGHT: Theme = Theme::GRUVBOX_LIGHT;
}

/// `t` 键循环顺序：gruvbox-dark → gruvbox-light → solarized-dark → solarized-light。
pub const THEME_CYCLE: [Theme; 4] = [
    Theme::GRUVBOX_DARK,
    Theme::GRUVBOX_LIGHT,
    Theme::SOLARIZED_DARK,
    Theme::SOLARIZED_LIGHT,
];

/// `t` 键循环的可读名（与 THEME_CYCLE 一一对应），用于底部 modeline 展示。
pub const THEME_NAMES: [&str; 4] = [
    "gruvbox-dark",
    "gruvbox-light",
    "solarized-dark",
    "solarized-light",
];

#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ThemeName {
    #[default]
    Dark,
    Light,
}

impl ThemeName {
    pub fn theme(self) -> Theme {
        match self {
            ThemeName::Dark => Theme::DARK,
            ThemeName::Light => Theme::LIGHT,
        }
    }
}

fn default_true() -> bool {
    true
}

/// `.crewclaw/tui.json` 的形状。未知键忽略，缺失键取默认（serde default）。
#[derive(Clone, Debug, Deserialize)]
pub struct TuiConfig {
    #[serde(default)]
    pub theme: ThemeName,
    /// 鼠标捕获（滚轮滚消息流）。`false` 时不 EnableMouseCapture，终端原生复制/滚动可用（AC-THM-003）。
    #[serde(default = "default_true")]
    pub mouse: bool,
    /// v0.10：Enter 突发启发式——与上一按键间隔 <10ms 的 Enter 视为粘贴流的换行（插 `\n` 不提交）。
    /// 这是 Windows 上唯一无须用户改习惯的多行粘贴修法：Windows Terminal 拦截 Ctrl+V 并把剪贴板
    /// 内容作为按键序列注入（应用收不到 Ctrl+V 本身），粘贴按键间隔为微秒级而人手打字 ≥30ms，
    /// 阈值 10ms 也远低于键盘重复率（~33ms），误判风险可忽略。默认开；tui.json 可关。
    #[serde(default = "default_true")]
    pub paste_enter_heuristic: bool,
}

impl Default for TuiConfig {
    fn default() -> Self {
        Self {
            theme: ThemeName::default(),
            mouse: true,
            paste_enter_heuristic: true,
        }
    }
}

impl TuiConfig {
    /// 从 `root/.crewclaw/tui.json` 读配置。文件不存在或 JSON 损坏 → 默认配置（不报错、不 panic）。
    pub fn load(root: &Path) -> Self {
        let path = root.join(".crewclaw").join("tui.json");
        let contents = match std::fs::read_to_string(&path) {
            Ok(contents) => contents,
            Err(_) => return Self::default(),
        };
        Self::from_json(&contents)
    }

    /// 解析 JSON 文本；损坏时回落默认（供单测直接喂字符串，不碰文件系统）。
    pub fn from_json(contents: &str) -> Self {
        serde_json::from_str(contents).unwrap_or_default()
    }
}

/// 进程级已解析主题。渲染层通过 accessor 读取，免去把 Theme 串进 70 个调用点。
static THEME: RwLock<Theme> = RwLock::new(Theme::DARK);

/// v0.16：主题是进程级 RwLock——所有会改/读全局主题的测试(跨 ui.rs/mod.rs 两个测试模块)
/// 共用这把锁,避免并发互踩(cargo test 默认多线程跑测试)。原先只在 ui.rs 的 tests 私有模块里,
/// mod.rs 的 SETTINGS 测试改主题却没上锁——被 W6.1 eval 的 bg1 断言测出的真串扰,提到这里共享。
#[cfg(test)]
pub(crate) static THEME_TEST_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// 启动时按配置装配主题（在进入 alternate screen 前调用一次）。
pub fn set_theme(theme: Theme) {
    if let Ok(mut guard) = THEME.write() {
        *guard = theme;
    }
}

fn current() -> Theme {
    THEME.read().map(|guard| *guard).unwrap_or(Theme::DARK)
}

pub fn accent() -> Color {
    current().accent
}

// 兼容层：老语义色映射到 13 色板中对应的命名色（ok→green / bad→red / warn→yellow），
// 使旧调用点（ACCENT/OK/BAD/WARN/DIM 别名，~70 处）无需改动即可跟随新主题。
pub fn ok() -> Color {
    current().green
}

pub fn bad() -> Color {
    current().red
}

pub fn warn() -> Color {
    current().yellow
}

pub fn dim() -> Color {
    current().dim
}

// v0.12：13 色板的新命名访问器（供多屏 chrome 直接取色）。
pub fn bg() -> Color {
    current().bg
}

pub fn bg1() -> Color {
    current().bg1
}

pub fn bg2() -> Color {
    current().bg2
}

/// v0.16 W0：modeline 底色（设计稿 `--ml`）。
pub fn ml() -> Color {
    current().ml
}

pub fn border() -> Color {
    current().bd
}

pub fn fg() -> Color {
    current().fg
}

pub fn red() -> Color {
    current().red
}

pub fn green() -> Color {
    current().green
}

pub fn yellow() -> Color {
    current().yellow
}

pub fn blue() -> Color {
    current().blue
}

pub fn purple() -> Color {
    current().purple
}

pub fn aqua() -> Color {
    current().aqua
}

pub fn orange() -> Color {
    current().orange
}

/// v0.11 M1：每个数字员工一套主题——从员工标识（slug/名）稳定哈希出一个 accent 色。
/// 极客调色板：8 个在深底上高辨识度的 RGB。同一员工每次进来颜色恒定，不同员工尽量分散。
const EMPLOYEE_PALETTE: [Color; 8] = [
    Color::Rgb(0x00, 0xD7, 0xAF), // teal
    Color::Rgb(0xFF, 0x5F, 0xAF), // pink
    Color::Rgb(0x5F, 0xAF, 0xFF), // blue
    Color::Rgb(0xFF, 0xAF, 0x00), // amber
    Color::Rgb(0xAF, 0x87, 0xFF), // purple
    Color::Rgb(0x5F, 0xFF, 0x87), // green
    Color::Rgb(0xFF, 0x87, 0x5F), // coral
    Color::Rgb(0x00, 0xD7, 0xFF), // cyan
];

/// 员工标识 → accent 色。FNV-1a 稳定哈希取模选色（与运行环境无关，可单测）。
pub fn employee_accent(key: &str) -> Color {
    let mut hash: u64 = 0xcbf29ce484222325;
    for b in key.trim().to_lowercase().bytes() {
        hash ^= b as u64;
        hash = hash.wrapping_mul(0x100000001b3);
    }
    EMPLOYEE_PALETTE[(hash % EMPLOYEE_PALETTE.len() as u64) as usize]
}

/// v0.12：应用 THEME_CYCLE 中第 `index` 套主题，并保留员工派生 accent。
/// `t` 键每次自增 index（调用方对 4 取模），换底色/命名色但员工主色恒定。
/// `accent` 为 None（demo/离线无员工）时用主题自带 accent。
pub fn apply_theme_index(index: usize, employee_accent_color: Option<Color>) {
    let mut theme = THEME_CYCLE[index % THEME_CYCLE.len()];
    if let Some(accent_color) = employee_accent_color {
        theme.accent = accent_color;
    }
    set_theme(theme);
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    /// 主题是进程级全局（RwLock<Theme>），并发跑的 set_theme 测试会互相踩；串行化它们。
    static THEME_TEST_LOCK: Mutex<()> = Mutex::new(());

    #[test]
    fn employee_accent_is_stable_and_distinguishes_employees() {
        // 同一员工恒定。
        assert_eq!(
            employee_accent("ai-adoption-whale"),
            employee_accent("ai-adoption-whale")
        );
        // 大小写/空白无关（同一员工）。
        assert_eq!(employee_accent("Code-Review-Shrimp"), employee_accent(" code-review-shrimp "));
        // 调色板内取值。
        assert!(EMPLOYEE_PALETTE.contains(&employee_accent("macao-networking-agent")));
        // 一组真实 slug 至少落到 2 种以上颜色（不是全撞一个）。
        let slugs = [
            "ai-adoption-whale",
            "code-review-shrimp",
            "product-prd-crab",
            "community-mermaid-zeneth",
            "macao-networking-agent",
        ];
        let distinct: std::collections::BTreeSet<_> =
            slugs.iter().map(|s| format!("{:?}", employee_accent(s))).collect();
        assert!(distinct.len() >= 2, "palette should spread employees across colors");
    }

    #[test]
    fn missing_config_falls_back_to_defaults() {
        let dir = std::env::temp_dir().join(format!("crewclaw-cfg-missing-{}", std::process::id()));
        let cfg = TuiConfig::load(&dir);
        assert_eq!(cfg.theme, ThemeName::Dark);
        assert!(cfg.mouse);
        // v0.10：启发式默认开（Windows Terminal 拦截 Ctrl+V，突发 Enter 判定是唯一无感修法）。
        assert!(cfg.paste_enter_heuristic);
    }

    #[test]
    fn corrupt_json_falls_back_to_defaults() {
        let cfg = TuiConfig::from_json("{ this is not json ]");
        assert_eq!(cfg.theme, ThemeName::Dark);
        assert!(cfg.mouse);
    }

    #[test]
    fn partial_config_merges_with_defaults() {
        // 只写 theme，mouse 应保持默认 true。
        let cfg = TuiConfig::from_json(r#"{"theme":"light"}"#);
        assert_eq!(cfg.theme, ThemeName::Light);
        assert!(cfg.mouse, "unspecified mouse must default to true");
    }

    #[test]
    fn mouse_false_parses() {
        let cfg = TuiConfig::from_json(r#"{"mouse":false}"#);
        assert!(!cfg.mouse);
        assert_eq!(cfg.theme, ThemeName::Dark);
    }

    #[test]
    fn light_theme_differs_from_dark_on_chrome() {
        assert_ne!(Theme::LIGHT.accent, Theme::DARK.accent);
        assert_ne!(Theme::LIGHT.bg, Theme::DARK.bg);
        assert_ne!(Theme::LIGHT.fg, Theme::DARK.fg);
        assert_ne!(Theme::LIGHT.yellow, Theme::DARK.yellow);
    }

    #[test]
    fn thirteen_color_palette_is_populated_and_distinct_per_theme() {
        // 每套主题的 13 个色位在结构上都存在（编译期保证），运行期验证 4 套底色互不相同。
        let bgs: std::collections::BTreeSet<_> = THEME_CYCLE
            .iter()
            .map(|t| format!("{:?}", t.bg))
            .collect();
        assert_eq!(bgs.len(), 4, "四套主题应有四种不同底色");
        // gruvbox-dark 命名色与设计稿一致（抽查三个语义色）。
        assert_eq!(Theme::GRUVBOX_DARK.orange, super::rgb(0xfe8019));
        assert_eq!(Theme::GRUVBOX_DARK.green, super::rgb(0xb8bb26));
        assert_eq!(Theme::GRUVBOX_DARK.purple, super::rgb(0xd3869b));
    }

    #[test]
    fn legacy_accessors_remap_to_named_palette() {
        // 老语义访问器映射到新命名色：ok→green / bad→red / warn→yellow。
        let _guard = THEME_TEST_LOCK.lock().unwrap();
        set_theme(Theme::GRUVBOX_DARK);
        assert_eq!(ok(), Theme::GRUVBOX_DARK.green);
        assert_eq!(bad(), Theme::GRUVBOX_DARK.red);
        assert_eq!(warn(), Theme::GRUVBOX_DARK.yellow);
        assert_eq!(dim(), Theme::GRUVBOX_DARK.dim);
        set_theme(Theme::DARK);
    }

    #[test]
    fn apply_theme_index_preserves_employee_accent() {
        let _guard = THEME_TEST_LOCK.lock().unwrap();
        let emp = employee_accent("ai-adoption-whale");
        // 切到 solarized-dark（index 2），accent 仍是员工派生色，而底色跟随新主题。
        apply_theme_index(2, Some(emp));
        assert_eq!(accent(), emp, "员工 accent 应跨主题保留");
        assert_eq!(bg(), Theme::SOLARIZED_DARK.bg, "底色应跟随新主题");
        // 无员工时用主题自带 accent。
        apply_theme_index(0, None);
        assert_eq!(accent(), Theme::GRUVBOX_DARK.accent);
        set_theme(Theme::DARK);
    }

    #[test]
    fn unknown_keys_ignored() {
        let cfg = TuiConfig::from_json(r#"{"theme":"light","future_key":42,"mouse":false}"#);
        assert_eq!(cfg.theme, ThemeName::Light);
        assert!(!cfg.mouse);
    }

    /// 端到端：真的从 `root/.crewclaw/tui.json` 读盘（验证路径解析，不只是 from_json）。
    #[test]
    fn loads_from_crewclaw_dir_on_disk() {
        let root = std::env::temp_dir().join(format!("crewclaw-cfg-disk-{}", std::process::id()));
        let dir = root.join(".crewclaw");
        std::fs::create_dir_all(&dir).expect("mk .crewclaw");
        std::fs::write(dir.join("tui.json"), r#"{"theme":"light","mouse":false}"#)
            .expect("write tui.json");

        let cfg = TuiConfig::load(&root);
        assert_eq!(cfg.theme, ThemeName::Light);
        assert!(!cfg.mouse);
        assert_eq!(cfg.theme.theme(), Theme::LIGHT);

        let _ = std::fs::remove_dir_all(&root);
    }
}
