use std::collections::{BTreeMap, BTreeSet};
use std::time::Instant;

use serde_json::Value;

use super::protocol::TaskEvent;

pub const SYM_RUNNING: &str = "→";
pub const SYM_OK: &str = "✓";
pub const SYM_FAIL: &str = "✗";
pub const SYM_WARN: &str = "!";
pub const SYM_WAIT: &str = "?";
/// v0.11 M4：思考块符号（未知符号在 symbol_color 里回退 DIM，正合思考的低调气质）。
pub const SYM_THINK: &str = "✦";

#[derive(Clone, Debug, PartialEq)]
pub enum ConversationItem {
    User(String),
    Assistant(String),
    Event(usize),
}

#[derive(Clone, Debug, PartialEq)]
pub struct AppState {
    pub employee: Option<Employee>,
    pub mode: String,
    pub task: Option<Task>,
    pub plan: Option<Plan>,
    pub timeline: Vec<TimelineEntry>,
    pub tools: BTreeMap<String, ToolState>,
    pub artifacts: Vec<Artifact>,
    pub evidence: Vec<Evidence>,
    pub approval: Option<Approval>,
    pub answer: String,
    pub conversation: Vec<ConversationItem>,
    pub usage: Usage,
    pub status: String,
    pub debug: Vec<String>,
    pub pending_actions: Vec<PendingAction>,
    pub focus: FocusPanel,
    pub inspect: InspectState,
    pub ref_picker: Option<RefPicker>,
    pub selected_artifact: Option<String>,
    pub preview: Option<ArtifactPreview>,
    pub memory: Memory,
    pub quick_utility: Option<QuickUtility>,
    /// 模型生成期间置位；任务/回复终态清除。驱动状态栏 spinner 与流式 caret，
    /// 不引入独立计时器（帧号与已用时长均由 elapsed() 推导）。
    pub busy_since: Option<Instant>,
    /// v0.8 M2：assistant.rendered 下发的预排版 ANSI 行，按 conversation 中该助手条目的
    /// 下标存储。渲染层有则用之（定妆富文本），无则回退裸文本。存原始 ANSI 字符串以让 state
    /// 保持与 ratatui 解耦；ANSI→Text 转换在 ui 层做。
    pub rendered_assistant: BTreeMap<usize, Vec<String>>,
    /// v0.8 M3：session.ready caps.commands 下发的 slash 命令目录（补全数据源）。
    pub commands: Vec<CommandInfo>,
    /// slash `/` 补全或 Ctrl+P 面板打开时的过滤态。
    pub command_picker: Option<CommandPicker>,
    /// v0.8 M6：引擎是否支持结构化 parts（session.ready caps.parts）。true 才发 parts，否则本地展开为文本。
    pub caps_parts: bool,
    task_artifact_start: usize,
    /// Current task's explicit completion verdict. None means no verdict event yet; Some(None)
    /// means the event was present but lacked the canonical `valid` boolean.
    current_task_outcome: Option<Option<bool>>,
    /// First explicit terminal event for the current task. Derived gate states such as
    /// `needs_artifact` remain recoverable; explicit terminal events are monotonic/idempotent.
    current_task_terminal: Option<&'static str>,
    /// Correlation metadata for the one active approval. Kept beside the legacy display model
    /// so existing renderers do not become a second protocol parser.
    approval_kind: Option<String>,
    approval_task_id: Option<String>,
    /// Settled approval ids make replay and duplicate delivery events KPI-idempotent.
    settled_approval_ids: BTreeSet<String>,
    /// 本轮起始时 conversation 的长度（TaskStarted 时记录）。assistant.rendered 下发整轮
    /// 排版文本时，用它界定"本轮的助手分片"，把被工具事件切开的前置分片标记为 superseded。
    turn_conversation_start: usize,
    /// 被整轮排版块取代的助手分片下标——渲染层跳过其裸文本，避免与富文本块重复显示。
    /// 场景：一轮里 "文字→工具事件→文字" 把助手拆成多段，整轮 rendered 只挂在最后一段，
    /// 前置段若照旧渲染会把同一句话显示两次。
    superseded_assistant: BTreeSet<usize>,
    /// v0.11 M3：本任务起始时刻（TaskStarted 记录），用于算耗时。
    task_started_at: Option<Instant>,
    /// v0.11 M3：本任务的活动计数（TaskStarted 重置，工具事件累加）。
    task_activity: ActivityCounts,
    /// v0.11 M3：本任务头在 timeline 中的下标——终态时把冻结的 TaskMeta 写回该条。
    task_header_line: Option<usize>,
    /// v0.11 M4：本轮「思考」可折叠块在 timeline 中的下标。首个 thinking.delta 建块，
    /// 后续增量追加进同一条的 detail；TaskStarted 重置（每轮独立一块）。
    thinking_line: Option<usize>,
    /// v0.13 M1：reduce 上下文——当前正在归纳的事件的 ts/类型/摊平 kv（push() 拷入新条目）。
    cur_ev_ts: u64,
    cur_ev_type: &'static str,
    cur_ev_kv: Vec<(String, String)>,
    /// v0.13 M1：任务起点的会话累计 usage 快照——终态求差得本任务 tokens（引擎数字优先）。
    usage_at_task_start: Usage,
    /// v0.13 M3：本会话已验收交付数（approval.accepted 计数）——EMPLOYEE 面板 KPI 真数据。
    pub accepted_count: u32,
    /// v0.15 P1-2：通知中心条目（**真事件源**:审批请求/交付/验收/拒绝由 reducer 追加）。
    /// 预算告警/Dream/年审无真源 → 不造(不出现)。未读态由 UiState 侧标记。
    pub notices: Vec<Notice>,
    /// v0.16 W3.5：审批终态结论条(真事件驱动)。(accepted, text) ——审批 resolve 后原位显示,
    /// 新任务开始(TaskStarted)时清空,不跨任务累留。
    pub last_verdict: Option<(bool, String)>,
}

/// v0.15 P1-2：一条通知（真事件派生）。
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Notice {
    pub ts: u64,
    pub kind: NoticeKind,
    pub title: String,
    pub body: String,
    pub read: bool,
}

/// 通知类别 → 图标/色 + 跳转屏。
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum NoticeKind {
    /// 等待批准（approval.requested/required）。
    Approval,
    /// 已交付（outcome.checked valid）。
    Delivered,
    /// 已验收（approval.accepted）。
    Accepted,
    /// 异常（task.rejected/blocked）。
    Rejected,
    /// v0.18 C3：月度预算告警（budget.warning，80% 提醒 / 100% 拒任务）。
    Budget,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum FocusPanel {
    Tasks,
    Timeline,
    Artifacts,
    Tools,
    Inspect,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Overlay {
    CommandPalette,
    Help,
}

/// v0.12：多屏「数字员工操作系统」的 5 个屏（对标设计稿 tab bar）。
/// WORKBENCH 是唯一接 live 事件流的屏；其余四屏读 Rust 侧数据（真/mock）。
#[derive(Clone, Copy, Debug, Eq, PartialEq, Default)]
pub enum Screen {
    #[default]
    Workbench,
    Market,
    Hire,
    Eval,
    Dream,
}

impl Screen {
    /// 数字键 1-5 → 屏（超出范围返回 None，交回原有 pending-action / 打字逻辑）。
    pub fn from_digit(ch: char) -> Option<Screen> {
        match ch {
            '1' => Some(Screen::Workbench),
            '2' => Some(Screen::Market),
            '3' => Some(Screen::Hire),
            '4' => Some(Screen::Eval),
            '5' => Some(Screen::Dream),
            _ => None,
        }
    }

    /// tab 栏顺序索引（0-4），Tab/Shift-Tab 循环用。
    pub fn index(self) -> usize {
        match self {
            Screen::Workbench => 0,
            Screen::Market => 1,
            Screen::Hire => 2,
            Screen::Eval => 3,
            Screen::Dream => 4,
        }
    }

    pub const ALL: [Screen; 5] = [
        Screen::Workbench,
        Screen::Market,
        Screen::Hire,
        Screen::Eval,
        Screen::Dream,
    ];

    /// tab 栏大写短名。
    pub fn label(self) -> &'static str {
        match self {
            Screen::Workbench => "WORKBENCH",
            Screen::Market => "MARKET",
            Screen::Hire => "HIRE",
            Screen::Eval => "EVAL",
            Screen::Dream => "DREAM",
        }
    }

    /// 底部 modeline 的一句话描述。
    pub fn description(self) -> &'static str {
        match self {
            Screen::Workbench => "员工工作台 · TaskEvent 时间线",
            Screen::Market => "数字员工市场",
            Screen::Hire => "雇佣流程 · Doctor 体检",
            Screen::Eval => "KPI · 考试 · 信誉",
            Screen::Dream => "任务复盘 · 员工成长",
        }
    }

    pub fn next(self) -> Screen {
        Screen::ALL[(self.index() + 1) % Screen::ALL.len()]
    }

    pub fn prev(self) -> Screen {
        Screen::ALL[(self.index() + Screen::ALL.len() - 1) % Screen::ALL.len()]
    }
}

/// v0.12：vim 式输入模式。Insert（默认）=打字进聊天框（保持既有行为）；
/// Normal=数字切屏 / j-k 导航 / t 换主题（不吞打字，Esc 空输入进入）。
#[derive(Clone, Copy, Debug, Eq, PartialEq, Default)]
pub enum InputMode {
    Insert,
    // v0.15 P0-1：冷启动即 NORMAL(对齐新版设计稿 inputFocused:false)——1-5/t/j/k 直接生效,
    // 打字自动落回 INSERT(见 handle_key_event 的 catch-all Char 臂)。
    #[default]
    Normal,
}

/// v0.12：入职仪式浮层的分步状态（0..=2 三步：认识员工 / 协作方式 / 试岗任务）。
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct OnboardingState {
    pub step: usize,
}

/// v0.12 MARKET：从 registry/experts.json 提炼的**真实**员工市场条目（可入 UiState）。
/// 只保留渲染需要的字段，避免把 main.rs 的 Expert（非 Eq）塞进 UiState。
// kpi_cumulative.total_cost:f64 → 只能 PartialEq（同 Employee/TaskMeta 的先例），MarketEntry
// 随之降级，UiState（内含 Vec<MarketEntry>）的 derive 也跟着摘掉 Eq。
#[derive(Clone, Debug, PartialEq, Default)]
pub struct MarketEntry {
    pub name: String,
    pub display_name: String,
    pub status: String,
    pub certification: String,
    pub category: String,
    pub description: String,
    pub tags: Vec<String>,
    pub hermes_req: String,
    pub env_reqs: Vec<String>,
    pub first_task: String,
    /// v0.17 P2 C1：跨会话真累计 KPI——启动时从 `.crewclaw/kpi/<name>.json` 直接读盘
    /// (与 doctor 体检同一"启动时算好"模式；不等引擎 session.ready，因为 MARKET 要列出
    /// **所有**员工，不只是当前上岗的那个)。文件不存在/解析失败 → 全零默认值。
    pub kpi_cumulative: KpiCumulative,
}

/// v0.12 HIRE：某员工的 doctor 体检结论（真实——启动时 doctor::build_report 计算）。
/// Eq 友好的摘要，与 market 列表平行按下标对应。
#[derive(Clone, Debug, Eq, PartialEq, Default)]
pub struct HireHealth {
    /// "healthy" / "warning" / "broken"。
    pub status: String,
    pub issues: Vec<String>,
    pub suggestions: Vec<String>,
}

// MarketEntry (内含 KpiCumulative.total_cost:f64) 只有 PartialEq，UiState 随之降级。
#[derive(Clone, Debug, PartialEq)]
pub struct UiState {
    pub overlay: Option<Overlay>,
    pub drawer: Option<FocusPanel>,
    pub follow: bool,
    pub messages_scroll: u16,
    pub drawer_scroll: ScrollOffsets,
    /// v0.12：当前屏。
    pub screen: Screen,
    /// v0.12：输入模式（Insert 默认）。
    pub mode: InputMode,
    /// v0.12：当前主题在 THEME_CYCLE 中的下标（t 键自增取模）。
    pub theme_index: usize,
    /// v0.12：MARKET 屏的员工列表游标。
    pub market_cursor: usize,
    /// v0.12：HIRE 屏候选员工（从 MARKET 带入）的列表下标。
    pub hire_cursor: usize,
    /// v0.16 W6.2：DREAM 屏 MEMORY 记忆浏览器的 tab 下标(0=全部/1=K/2=P/3=E)——`f` 键循环。
    /// 数据来自 `.crewclaw/memory/<employee>.json` 的安全只读快照。
    pub dream_mem_tab: usize,
    /// v0.16 W6.2：DREAM 屏 MEMORY 列表游标(j/k 移动)。
    pub dream_mem_cursor: usize,
    /// v0.12：CRT 扫描线装饰开关（默认关）。
    pub scanlines: bool,
    /// v0.12：which-key 快捷键面板开关（Normal 模式 Space 切换）。
    pub which_key: bool,
    /// v0.12：入职仪式浮层（None=未打开）。
    pub onboarding: Option<OnboardingState>,
    /// v0.15 P1-3：TASK DETAIL 全屏浮层（WORKBENCH `o` 开，Esc/q/o 关）。全真:timeline/outcome/
    /// artifacts/evidence 全读 AppState,不造数据。
    pub task_detail_open: bool,
    /// v0.15 P1-5：产物预览浮层（WORKBENCH `[`/`]` 选中产物后 `Enter` 开，Esc/q 关）。
    /// 内容 = read_artifact_preview 真读文件；无选中/无产物则 Enter 不开。
    pub preview_open: bool,
    /// v0.16 W4.1：预览正文滚动偏移(行)——preview_open 置 true 或 `[`/`]` 换产物时归零。
    pub preview_scroll: u16,
    /// v0.15 P1-2：通知中心浮层开关（`n` 开，Esc/q/n 关）。
    pub notif_open: bool,
    /// v0.15 P1-2：通知列表游标（j/k 移动）。
    pub notif_cursor: usize,
    /// v0.15 P1-1：SETTINGS 偏好浮层开关（`,` 开，Esc/q/, 关）。
    pub settings_open: bool,
    /// v0.15 P1-1：设置项游标（j/k 移动）。
    pub settings_cursor: usize,
    /// v0.15 P1-1：偏好（density + BEHAVIOR 组的选项下标;theme/scanlines 见同名字段）。
    pub prefs: crate::workbench::config::Prefs,
    /// v0.15 P1-1：偏好落盘根（live 循环注入;None=不持久化,如单测态）。
    pub prefs_root: Option<std::path::PathBuf>,
    /// v0.15 P1-4：PUBLISH 发布浮层（MARKET `p` 开）——None=关，Some(step) step∈0..=3。
    pub publish_step: Option<usize>,
    /// v0.12 MARKET：真实员工市场（启动时从 registry 读入，非 live 数据）。
    pub market: Vec<MarketEntry>,
    /// v0.12 HIRE：与 market 平行的 doctor 体检结论（启动时计算）。
    pub hire_reports: Vec<HireHealth>,
    /// Live workbench 对 `.crewclaw/{eval,kpi,runs,memory}` 的安全只读投影。离线路径保持
    /// `persisted_state_active=false`，不会把静态演示冒充成真实状态。
    pub persisted_state_active: bool,
    pub persisted_insights: PersistedInsights,
    /// EVAL/DREAM 的 `r` 手动刷新请求；live loop 消费后清零。另有低频自动刷新。
    pub persisted_refresh_requested: bool,
    /// v0.13 M1：SESSION 事件选择游标（timeline 下标）。None=跟随流；NORMAL j/k 移动，
    /// EVENT DETAIL 面板跟随（M4 接键位）。
    pub session_cursor: Option<usize>,
    /// v0.8 M5：上一帧消息区可滚动的最大偏移，供滚轮/翻页判定"是否已到底"以恢复 follow，
    /// 以及新消息徽标计算未见行数。渲染层每帧通过 Cell 回写（保持 render 取 &UiState）。
    pub content_max_scroll: std::cell::Cell<u16>,
    /// v0.8 M5：上一帧消息区正文可视高度（行），供滚轮/徽标计算。渲染层每帧回写。
    pub viewport_height: std::cell::Cell<u16>,
    /// v0.10：Enter 突发启发式开关（tui.json paste_enter_heuristic，默认开）。
    /// Windows Terminal 把粘贴注入为按键序列（应用收不到 Ctrl+V/Event::Paste），
    /// 粘贴流内按键间隔为微秒级 → 间隔 <10ms 的 Enter 视为粘贴换行而非提交。
    pub paste_enter_heuristic: bool,
    /// 上一次按键的时刻，供突发判定。每个 key press 都会刷新。
    pub last_key_at: Option<std::time::Instant>,
    /// v0.17 P1-B1：MARKET `/` 搜索的查询文本（复用 fuzzy.rs 排序,不新写一套匹配）。
    pub market_filter: String,
    /// v0.17 P1-B1：MARKET 搜索输入是否处于编辑态（true 时字符键写进 filter,而非切屏/聊天）。
    pub market_filter_active: bool,
    /// v0.17 P1-B2：MARKET `x` 勾选的对比候选——存的是 `self.market` 的**真实下标**(不是
    /// filtered 下标),最多 2 个,按勾选顺序排列。
    pub compare_selection: Vec<usize>,
    /// v0.17 P1-B2：COMPARE 对比浮层开关（选满 2 个后 `c` 开;Esc/q 关）。
    pub compare_open: bool,
}

impl UiState {
    /// v0.10：记录本次按键时刻，并返回它与上一次按键的间隔是否短到只可能是粘贴注入
    /// （<10ms；人手连击 ≥30ms，键盘自动重复 ~33ms）。
    pub fn record_key_burst(&mut self) -> bool {
        let now = std::time::Instant::now();
        let burst = self
            .last_key_at
            .map(|prev| now.duration_since(prev) < std::time::Duration::from_millis(10))
            .unwrap_or(false);
        self.last_key_at = Some(now);
        burst
    }

    /// v0.17 P1-B1：`market_filter` 按 fuzzy.rs 排序后的员工引用列表（空查询=原序全量）。
    pub fn market_filtered(&self) -> Vec<&MarketEntry> {
        crate::workbench::fuzzy::rank(
            self.market.iter().collect(),
            &self.market_filter,
            |e: &&MarketEntry| format!("{} {} {}", e.display_name, e.category, e.tags.join(" ")),
        )
    }

    /// v0.17 P1-B1：`self.market` 里某个条目引用对应的真实下标（按指针身份匹配,不靠 name
    /// 唯一性假设）。
    pub fn market_index_of(&self, entry: &MarketEntry) -> Option<usize> {
        self.market.iter().position(|e| std::ptr::eq(e, entry))
    }

    /// v0.17 P1-B1：把 `market_cursor`（filtered 列表下标）翻译回 `self.market` 的真实下标——
    /// 过滤生效时两者不再相等，凡是要用 market_cursor 去查 hire_reports/发布浮层等平行数组的
    /// 地方，都必须经这个函数转换，不能直接拿 market_cursor 当 market 下标用。
    pub fn market_selected_index(&self) -> Option<usize> {
        let filtered = self.market_filtered();
        if filtered.is_empty() {
            return None;
        }
        let sel = self.market_cursor.min(filtered.len() - 1);
        self.market_index_of(filtered[sel])
    }

    /// v0.17 P1-B2：MARKET `x` 键——把当前选中员工加入/移出对比候选(最多 2 个,已满且非
    /// 候选内成员时按下 x 不做任何事,逼用户先取消一个)。
    pub fn toggle_compare_selection(&mut self) {
        let Some(idx) = self.market_selected_index() else {
            return;
        };
        if let Some(pos) = self.compare_selection.iter().position(|&i| i == idx) {
            self.compare_selection.remove(pos);
        } else if self.compare_selection.len() < 2 {
            self.compare_selection.push(idx);
        }
    }
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct ScrollOffsets {
    pub tasks: u16,
    pub timeline: u16,
    pub artifacts: u16,
    pub tools: u16,
    pub inspect: u16,
}

impl Default for UiState {
    fn default() -> Self {
        Self {
            overlay: None,
            drawer: None,
            follow: true,
            messages_scroll: 0,
            drawer_scroll: ScrollOffsets::default(),
            content_max_scroll: std::cell::Cell::new(0),
            viewport_height: std::cell::Cell::new(0),
            screen: Screen::default(),
            mode: InputMode::default(),
            theme_index: 0,
            market_cursor: 0,
            hire_cursor: 0,
            dream_mem_tab: 0,
            dream_mem_cursor: 0,
            scanlines: false,
            which_key: false,
            onboarding: None,
            task_detail_open: false,
            preview_open: false,
            preview_scroll: 0,
            notif_open: false,
            notif_cursor: 0,
            settings_open: false,
            settings_cursor: 0,
            prefs: crate::workbench::config::Prefs::default(),
            prefs_root: None,
            publish_step: None,
            market: Vec::new(),
            hire_reports: Vec::new(),
            persisted_state_active: false,
            persisted_insights: PersistedInsights::default(),
            persisted_refresh_requested: false,
            session_cursor: None,
            // 默认关：单测以 μs 级间隔灌按键，若默认开会把测试里的 Enter 误判成粘贴。
            // live loop 启动时按 tui.json 显式置开（配置默认 true）。
            paste_enter_heuristic: false,
            last_key_at: None,
            market_filter: String::new(),
            market_filter_active: false,
            compare_selection: Vec::new(),
            compare_open: false,
        }
    }
}

impl UiState {
    pub fn toggle_drawer(&mut self) {
        self.drawer = if self.drawer.is_some() {
            None
        } else {
            Some(FocusPanel::Tasks)
        };
    }

    pub fn drawer_next(&mut self) {
        if let Some(p) = self.drawer {
            self.drawer = Some(match p {
                FocusPanel::Tasks => FocusPanel::Timeline,
                FocusPanel::Timeline => FocusPanel::Artifacts,
                FocusPanel::Artifacts => FocusPanel::Tools,
                FocusPanel::Tools => FocusPanel::Inspect,
                FocusPanel::Inspect => FocusPanel::Tasks,
            });
        }
    }

    pub fn drawer_prev(&mut self) {
        if let Some(p) = self.drawer {
            self.drawer = Some(match p {
                FocusPanel::Tasks => FocusPanel::Inspect,
                FocusPanel::Timeline => FocusPanel::Tasks,
                FocusPanel::Artifacts => FocusPanel::Timeline,
                FocusPanel::Tools => FocusPanel::Artifacts,
                FocusPanel::Inspect => FocusPanel::Tools,
            });
        }
    }

    /// 抽屉页 1-4 → Timeline/Artifacts/Tools/Inspect（保持与旧 set_tab_by_number 一致的映射）
    pub fn set_drawer_page_by_number(&mut self, number: char) -> bool {
        let page = match number {
            '1' => FocusPanel::Timeline,
            '2' => FocusPanel::Artifacts,
            '3' => FocusPanel::Tools,
            '4' => FocusPanel::Inspect,
            _ => return false,
        };
        if self.drawer.is_some() {
            self.drawer = Some(page);
            true
        } else {
            false
        }
    }

    /// 抽屉内当前页的滚动偏移（复用 ScrollOffsets 字段）
    pub fn drawer_scroll_for(&self, panel: FocusPanel) -> u16 {
        match panel {
            FocusPanel::Tasks => self.drawer_scroll.tasks,
            FocusPanel::Timeline => self.drawer_scroll.timeline,
            FocusPanel::Artifacts => self.drawer_scroll.artifacts,
            FocusPanel::Tools => self.drawer_scroll.tools,
            FocusPanel::Inspect => self.drawer_scroll.inspect,
        }
    }

    pub fn scroll_drawer(&mut self, delta: i16) {
        if let Some(panel) = self.drawer {
            let slot = match panel {
                FocusPanel::Tasks => &mut self.drawer_scroll.tasks,
                FocusPanel::Timeline => &mut self.drawer_scroll.timeline,
                FocusPanel::Artifacts => &mut self.drawer_scroll.artifacts,
                FocusPanel::Tools => &mut self.drawer_scroll.tools,
                FocusPanel::Inspect => &mut self.drawer_scroll.inspect,
            };
            if delta < 0 {
                *slot = slot.saturating_sub((-delta) as u16);
            } else {
                *slot = slot.saturating_add(delta as u16);
            }
        }
    }

    /// v0.8 M5：滚动消息流。负 delta 向上（脱离 follow），正 delta 向下；滚到底自动恢复 follow。
    /// 使用上一帧回写的 content_max_scroll 作为边界与"到底"判定。
    pub fn scroll_messages(&mut self, delta: i16) {
        let max = self.content_max_scroll.get();
        // Anchor from the currently displayed offset: follow means we're pinned at the bottom.
        let current = if self.follow {
            max
        } else {
            self.messages_scroll.min(max)
        };
        let next = if delta < 0 {
            current.saturating_sub(delta.unsigned_abs())
        } else {
            current.saturating_add(delta as u16).min(max)
        };
        if next >= max {
            // Reached the bottom → re-pin to newest content.
            self.follow = true;
            self.messages_scroll = max;
        } else {
            self.follow = false;
            self.messages_scroll = next;
        }
    }

    /// End：回到底部并恢复粘底跟随。
    pub fn scroll_to_bottom(&mut self) {
        self.follow = true;
        self.messages_scroll = self.content_max_scroll.get();
    }

    /// v0.8 M5：follow=false 时下方尚未看到的行数（新消息徽标计数）。
    pub fn unseen_below(&self) -> u16 {
        if self.follow {
            0
        } else {
            self.content_max_scroll
                .get()
                .saturating_sub(self.messages_scroll)
        }
    }

    /// Esc/取消：关 overlay 或抽屉，返回是否有关闭动作
    pub fn close_overlay_or_drawer(&mut self) -> bool {
        if self.overlay.take().is_some() {
            return true;
        }
        if self.drawer.take().is_some() {
            return true;
        }
        false
    }

    /// v0.12：切屏。切走时关掉浮层/抽屉/which-key，保证目标屏是干净的全屏。
    pub fn set_screen(&mut self, screen: Screen) {
        self.screen = screen;
        self.overlay = None;
        self.drawer = None;
        self.which_key = false;
    }

    /// v0.12：t 键循环主题下标（对 4 取模）。返回新下标供调用方应用主题。
    pub fn cycle_theme(&mut self) -> usize {
        self.theme_index = (self.theme_index + 1) % 4;
        self.theme_index
    }
}

// kpi_cumulative.total_cost:f64 → 只能 PartialEq（f64 无 Eq），Employee 随之降级（同 TaskMeta 的先例）。
#[derive(Clone, Debug, PartialEq)]
pub struct Employee {
    pub name: String,
    pub role: String,
    pub model: String,
    /// v0.13 M1：技能名清单（session.ready employee.skills，M2 引擎透出；旧引擎为空）。
    pub skills: Vec<String>,
    /// v0.14 N2：员工包头像（experts/<slug>/avatar.txt 真文件，引擎下发；空回退内置像素块）。
    pub avatar: Vec<String>,
    /// v0.17 P2 C1：跨会话累计 KPI（session.ready employee.kpi_cumulative，engine 从
    /// `.crewclaw/kpi/<agentId>.json` 读入本次会话开始前的历史；旧引擎/无 agentId → 全零)。
    pub kpi_cumulative: KpiCumulative,
    /// v0.18 B2：由 Node `readEvalResult` 完整校验后通过 session.ready 下发的评测结果。
    /// None = 当前 subject contract 下没有可验证评测 → EVAL 屏不显示认证分。
    pub eval: Option<EvalReport>,
}

/// 员工评测报告。`mock=false` 不是认证的充分条件：只有经 Node `readEvalResult` 绑定当前
/// subject/spec/dependency/runtime/execution context 后从 session.ready 下发的记录才会设置
/// `certified=true`。Rust 直接读到的磁盘记录始终是待验证、不可认证。
#[derive(Clone, Debug, PartialEq)]
pub struct EvalReport {
    pub score: u32,
    /// "PASS" / "FAIL"。
    pub verdict: String,
    pub model: String,
    pub mock: bool,
    pub certified: bool,
    /// epoch ms；0 = 未知。
    pub evaluated_at: u64,
    pub exams: Vec<ExamEntry>,
}

/// v0.18 B2：单条 smoke test 的评测结果（EVAL 屏每行一条）。
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ExamEntry {
    pub id: String,
    pub score: u32,
    pub passed: bool,
}

/// v0.17 P2 C1：跨会话真累计——与 EMPLOYEE 面板"本会话"KPI 平行的历史区数据源。
#[derive(Clone, Copy, Debug, PartialEq, Default)]
pub struct KpiCumulative {
    pub tasks: u64,
    pub accepted: u64,
    pub total_cost: f64,
    /// epoch ms；None = 这个员工在本 root 下从未有过验收终态(真"新人")。
    pub first_hired_ts: Option<u64>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MonthlyMetric {
    pub month: String,
    pub tasks: u64,
    pub accepted: u64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PersistedMemory {
    /// K=knowledge, P=playbook, E=evidence/source.
    pub kind: String,
    pub category: String,
    pub text: String,
    pub confidence: String,
    pub saved_at: Option<String>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct DreamSnapshot {
    pub run_count: u64,
    pub accepted_count: u64,
    pub failed_count: u64,
    pub revision_count: u64,
    pub dream_candidates: u64,
    pub confidence: Option<String>,
    pub last_updated: Option<String>,
    pub worked: Vec<String>,
    pub failed: Vec<String>,
    pub knowledge: Vec<String>,
    pub playbook_add: Vec<String>,
    pub playbook_remove: Vec<String>,
    pub memories: Vec<PersistedMemory>,
}

impl DreamSnapshot {
    pub fn has_review_data(&self) -> bool {
        self.dream_candidates > 0
            || !self.worked.is_empty()
            || !self.failed.is_empty()
            || !self.knowledge.is_empty()
            || !self.playbook_add.is_empty()
            || !self.playbook_remove.is_empty()
            || !self.memories.is_empty()
    }
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct PersistedInsights {
    pub eval: Option<EvalReport>,
    pub kpi: KpiCumulative,
    pub monthly: Vec<MonthlyMetric>,
    pub dream: DreamSnapshot,
    pub errors: Vec<String>,
    pub refreshed_at: u64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Task {
    pub id: Option<String>,
    pub title: String,
    pub status: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Plan {
    pub steps: Vec<String>,
    pub status: String,
}

#[derive(Clone, Debug, PartialEq)]
pub struct TimelineEntry {
    pub id: String,
    pub status: String,
    pub label: String,
    pub detail: String,
    /// v0.8 M4：可折叠工具行。true 时消息流渲染为单行折叠态，可展开看完整输出。
    pub collapsible: bool,
    /// 折叠态开关：成功工具默认折叠(false)，失败工具默认展开(true)。
    pub expanded: bool,
    /// v0.11 M3：任务头专属。任务终态时冻结「耗时 + 活动计数」，渲染层据此在任务标题下画
    /// 分隔线 + TRAE 式活动计数条。非任务头恒为 None。
    pub task_meta: Option<TaskMeta>,
    /// v0.13 M1：产生本条的事件时间戳（epoch ms；合成/测试 push 为 0 → 渲染 `--:--`）。
    pub ts: u64,
    /// v0.13 M1：产生本条的事件类型名（"tool.requested" 等），SESSION 行的 type 列。
    pub event_type: &'static str,
    /// v0.13 M1：事件 data 的一层摊平 kv（超长值截断），EVENT DETAIL 面板渲染源。
    pub detail_kv: Vec<(String, String)>,
}

/// v0.11 M3：一次任务的活动计数（按引擎真实工具名归类：read_file/edit_file/write_file+
/// artifact.write/web_search/web_fetch/bash，其余入 other）。
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct ActivityCounts {
    pub read: u32,
    pub edited: u32,
    pub created: u32,
    pub web_search: u32,
    pub web_fetch: u32,
    pub command: u32,
    pub other: u32,
}

impl ActivityCounts {
    pub fn total(&self) -> u32 {
        self.read
            + self.edited
            + self.created
            + self.web_search
            + self.web_fetch
            + self.command
            + self.other
    }
    /// 按引擎工具名累加一次调用。
    pub fn record(&mut self, tool: &str) {
        match tool {
            "read_file" => self.read += 1,
            "edit_file" => self.edited += 1,
            "write_file" | "artifact.write" => self.created += 1,
            "web_search" => self.web_search += 1,
            "web_fetch" => self.web_fetch += 1,
            "bash" => self.command += 1,
            _ => self.other += 1,
        }
    }
}

/// v0.11 M3：任务终态冻结的元信息——总耗时（毫秒）+ 活动计数。
// est_cost:f64 → 只能 PartialEq（f64 无 Eq）；TimelineEntry 随之降级。
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct TaskMeta {
    pub elapsed_ms: u128,
    pub counts: ActivityCounts,
    /// v0.13 M1：本任务消耗的 (prompt, completion) tokens。主源=引擎 task.completed.usage；
    /// 引擎未发时用「任务起点快照差值」兜底（AppState.usage 是会话累计）。
    pub tokens: Option<(u64, u64)>,
    /// v0.13 M1：本任务估算成本（美元，引擎 estimateCost 透出）。快照兜底算不了费率 → None。
    pub est_cost: Option<f64>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct ToolState {
    pub tool: Option<String>,
    pub status: String,
    pub summary: Option<String>,
    pub args: Option<Value>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Artifact {
    pub id: Option<String>,
    pub task_id: Option<String>,
    pub name: Option<String>,
    pub kind: Option<String>,
    pub artifact_type: Option<String>,
    pub path: Option<String>,
    pub export_path: Option<String>,
    pub status: String,
    pub summary: Option<String>,
    pub checks: Vec<String>,
    /// v0.13 M1：文件字节数（引擎 artifact.created 一直在发，此前被丢弃）。右栏 meta 显示 KB。
    pub bytes: Option<u64>,
    /// v0.14 N5：产物创建事件时间戳（epoch ms；测试合成为 0 → 不显示"生成于"）。
    pub created_ts: u64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ArtifactPreview {
    pub artifact_id: String,
    pub title: String,
    pub detail: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PendingAction {
    pub key: String,
    pub label: String,
    pub command: Option<String>,
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct InspectState {
    pub task_status: Option<String>,
    pub selected_artifact: Option<String>,
    pub approval_status: Option<String>,
    pub recent_debug: Vec<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ReferenceCandidate {
    pub kind: String,
    pub id: String,
    pub label: String,
    pub token: String,
}

/// v0.8 M3：session.ready caps.commands 下发的一条 slash 命令，驱动补全浮层与 Ctrl+P 面板。
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CommandInfo {
    pub name: String,
    pub desc: String,
}

/// slash / Ctrl+P 命令补全浮层状态（与 RefPicker 同构，供共享 CompletionPopup 渲染）。
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CommandPicker {
    pub query: String,
    pub selected: usize,
    pub matches: Vec<CommandInfo>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RefPicker {
    pub query: String,
    pub selected: usize,
    pub candidates: Vec<ReferenceCandidate>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Evidence {
    pub id: Option<String>,
    pub fact: Option<String>,
    pub source: Option<String>,
    pub confidence: Option<f64>,
    /// v0.13 M1：来源类型（official/docs/news/community/search，引擎 verifySourceType）。
    /// 引擎的置信度是分类而非数字——数字置信度条只在 confidence 真到达时点亮（dormant）。
    pub source_type: Option<String>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Approval {
    pub id: Option<String>,
    pub tool: Option<String>,
    pub reason: Option<String>,
    pub scope: Option<Value>,
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct Usage {
    pub prompt_tok: u64,
    pub completion_tok: u64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Memory {
    pub session: String,
    pub persistent: String,
    pub workspace: String,
    /// v0.13 M2/M3：持久记忆真实条目数（memory.state.count；引擎读不到时不发 → None）。
    pub count: Option<u64>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct QuickUtility {
    pub intent: Option<String>,
    pub result: Option<Value>,
    pub source: Option<String>,
    pub status: Option<String>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            employee: None,
            mode: "Chat".to_string(),
            task: None,
            plan: None,
            timeline: Vec::new(),
            tools: BTreeMap::new(),
            artifacts: Vec::new(),
            evidence: Vec::new(),
            approval: None,
            answer: String::new(),
            conversation: Vec::new(),
            usage: Usage::default(),
            status: "idle".to_string(),
            debug: Vec::new(),
            pending_actions: Vec::new(),
            focus: FocusPanel::Tasks,
            inspect: InspectState::default(),
            ref_picker: None,
            selected_artifact: None,
            preview: None,
            memory: Memory {
                session: "available".to_string(),
                persistent: "unavailable".to_string(),
                workspace: "unavailable".to_string(),
                count: None,
            },
            quick_utility: None,
            busy_since: None,
            rendered_assistant: BTreeMap::new(),
            commands: Vec::new(),
            command_picker: None,
            caps_parts: false,
            task_artifact_start: 0,
            current_task_outcome: None,
            current_task_terminal: None,
            approval_kind: None,
            approval_task_id: None,
            settled_approval_ids: BTreeSet::new(),
            turn_conversation_start: 0,
            superseded_assistant: BTreeSet::new(),
            task_started_at: None,
            task_activity: ActivityCounts::default(),
            task_header_line: None,
            thinking_line: None,
            cur_ev_ts: 0,
            cur_ev_type: "",
            cur_ev_kv: Vec::new(),
            usage_at_task_start: Usage::default(),
            accepted_count: 0,
            notices: Vec::new(),
            last_verdict: None,
        }
    }
}

impl NoticeKind {
    /// 图标（设计稿:审批 ◔/交付 ★/验收 ✓/异常 ✗）。
    pub fn icon(self) -> &'static str {
        match self {
            NoticeKind::Approval => "◔",
            NoticeKind::Delivered => "★",
            NoticeKind::Accepted => "✓",
            NoticeKind::Rejected => "✗",
            NoticeKind::Budget => "$",
        }
    }
}

impl AppState {
    pub fn reduce(&mut self, ev: &TaskEvent) {
        let data = ev.data();
        self.debug.push(format!("{} {}", ev.event_type(), data));

        // v0.13 M1：reduce 上下文暂存——本事件的 ts/类型名/摊平 kv，push() 拷入 TimelineEntry。
        // 选此法而非改 push 签名：~25 个调用点不动；也非事后补挂：条件 push 的臂会误标。
        self.cur_ev_ts = ev.ts();
        self.cur_ev_type = ev.event_type();
        self.cur_ev_kv = flatten_event_kv(data);

        match ev {
            TaskEvent::SessionReady { .. } => {
                self.clear_busy();
                self.reduce_session_ready(data);
            }
            TaskEvent::TaskModeChanged { .. } => {
                if !self.task_correlation_matches(data, "taskRunId") {
                    self.debug.push(format!(
                        "ignored stale or uncorrelated task.mode_changed for {}",
                        string_field(data, "taskRunId").unwrap_or_else(|| "<missing>".to_string())
                    ));
                    return;
                }
                if let Some(mode) = string_field(data, "mode") {
                    self.mode = mode.clone();
                    let line_id = self.id_for(data);
                    self.push(line_id, SYM_OK, format!("模式：{mode}"), String::new());
                }
            }
            TaskEvent::TaskStarted { .. } => {
                let Some(id) = string_field(data, "id").filter(|id| !id.trim().is_empty()) else {
                    self.debug
                        .push("ignored task.started without canonical id".to_string());
                    return;
                };
                if self.task.as_ref().and_then(|task| task.id.as_deref()) == Some(id.as_str()) {
                    return;
                }
                let title = string_field(data, "title").unwrap_or_default();
                self.task = Some(Task {
                    id: Some(id),
                    title: title.clone(),
                    status: "running".to_string(),
                });
                self.mode = string_field(data, "mode").unwrap_or_else(|| "Task".to_string());
                self.status = "running".to_string();
                self.answer.clear();
                // v0.15 P0-1: a new task voids the previous deliverable's digit bindings, even if
                // the engine predates the empty-list emit — belt-and-suspenders so 1-5 switch again.
                self.pending_actions.clear();
                // v0.16 W3.5：新任务开始清空上一次审批的 verdict 条,不跨任务累留。
                self.last_verdict = None;
                self.task_artifact_start = self.artifacts.len();
                self.current_task_outcome = None;
                self.current_task_terminal = None;
                self.approval = None;
                self.approval_kind = None;
                self.approval_task_id = None;
                self.mark_busy();
                let line_id = self.id_for(data);
                self.push(
                    line_id,
                    SYM_RUNNING,
                    format!("任务：{title}"),
                    String::new(),
                );
                // v0.11 M3：本任务计时/计数起点；记住任务头下标供终态回填 TaskMeta。
                self.task_started_at = Some(Instant::now());
                self.task_activity = ActivityCounts::default();
                self.task_header_line = Some(self.timeline.len() - 1);
                // v0.13 M1：快照会话累计 usage，终态求差得本任务 tokens。
                self.usage_at_task_start = self.usage.clone();
                self.thinking_line = None; // 每轮独立一个「思考」块
                // 本轮助手分片从这里之后开始（push 已插入任务时间线事件）。
                self.turn_conversation_start = self.conversation.len();
            }
            TaskEvent::PlanCreated { .. } => {
                let steps = string_array_field(data, "steps");
                self.plan = Some(Plan {
                    steps: steps.clone(),
                    status: "proposed".to_string(),
                });
                let line_id = self.id_for(data);
                self.push(line_id, SYM_OK, "生成计划".to_string(), steps.join(" · "));
            }
            TaskEvent::PlanApproved { .. } => {
                if let Some(plan) = &mut self.plan {
                    plan.status = "approved".to_string();
                }
            }
            TaskEvent::StepStarted { .. } => {
                self.mark_busy();
                let label = string_field(data, "label").unwrap_or_default();
                let line_id = self.id_for(data);
                self.push(line_id, SYM_RUNNING, label, String::new());
            }
            TaskEvent::StepCompleted { .. } => {
                self.mark(
                    string_field(data, "id").as_deref(),
                    SYM_OK,
                    string_field(data, "summary"),
                );
            }
            TaskEvent::ToolRequested { .. } | TaskEvent::ToolCalled { .. } => {
                self.mark_busy();
                self.reduce_tool_requested(data);
            }
            TaskEvent::ToolSucceeded { .. } => {
                let id = string_field(data, "id").unwrap_or_else(|| self.id_for(data));
                let summary = string_field(data, "summary");
                self.set_tool(
                    &id,
                    ToolPatch {
                        status: Some("ok".to_string()),
                        summary: summary.clone(),
                        ..ToolPatch::default()
                    },
                );
                self.mark(Some(&id), SYM_OK, summary.clone());
                // v0.8 M4: fold the tool line; full output (engine `detail`) opens on Ctrl+R.
                let detail = string_field(data, "detail").or(summary);
                self.mark_tool(&id, detail, false);
            }
            TaskEvent::ToolFailed { .. } | TaskEvent::ToolBlocked { .. } => {
                let id = string_field(data, "id").unwrap_or_else(|| self.id_for(data));
                let code = string_field(data, "code").or_else(|| string_field(data, "error"));
                self.set_tool(
                    &id,
                    ToolPatch {
                        status: Some("failed".to_string()),
                        summary: code.clone(),
                        ..ToolPatch::default()
                    },
                );
                self.mark(Some(&id), SYM_FAIL, code.clone());
                // Failures default to expanded so the error/output is visible without a keystroke.
                let detail = string_field(data, "detail").or(code);
                self.mark_tool(&id, detail, true);
            }
            TaskEvent::ArtifactCreated { .. } => {
                if !self.task_correlation_matches(data, "taskRunId") {
                    self.debug.push(format!(
                        "ignored uncorrelated artifact.created {}",
                        string_field(data, "id").unwrap_or_else(|| "<missing>".to_string())
                    ));
                    return;
                }
                let Some(id) = string_field(data, "id").filter(|id| !id.trim().is_empty()) else {
                    self.debug
                        .push("ignored artifact.created without canonical id".to_string());
                    return;
                };
                if self
                    .artifacts
                    .iter()
                    .any(|artifact| artifact.id.as_deref() == Some(id.as_str()))
                {
                    return;
                }
                if !self.mode.eq_ignore_ascii_case("chat")
                    && string_field(data, "path").is_none_or(|path| path.is_empty())
                {
                    self.debug
                        .push("ignored formal artifact.created without path".to_string());
                    return;
                }
                let kind = string_field(data, "kind").or_else(|| string_field(data, "type"));
                let artifact_type =
                    string_field(data, "type").or_else(|| string_field(data, "kind"));
                let artifact = Artifact {
                    id: Some(id),
                    task_id: self.task.as_ref().and_then(|task| task.id.clone()),
                    name: string_field(data, "name"),
                    kind,
                    artifact_type,
                    path: string_field(data, "path"),
                    export_path: None,
                    status: string_field(data, "status").unwrap_or_else(|| "draft".to_string()),
                    summary: string_field(data, "summary"),
                    checks: string_array_field(data, "checks"),
                    bytes: data.get("bytes").and_then(Value::as_u64),
                    created_ts: self.cur_ev_ts,
                };
                let label = format!("交付物：{}", artifact.name.clone().unwrap_or_default());
                let detail = artifact.path.clone().unwrap_or_default();
                self.artifacts.push(artifact);
                let line_id = self.id_for(data);
                self.push(line_id, SYM_OK, label, detail);
            }
            TaskEvent::ArtifactUpdated { .. } => {
                if let Some(id) = string_field(data, "id") {
                    if !self.artifact_event_targets_current_task(data, &id) {
                        self.debug
                            .push(format!("ignored uncorrelated artifact.updated {id}"));
                        return;
                    }
                    if let Some(patch) = data.get("patch").and_then(Value::as_object) {
                        for artifact in &mut self.artifacts {
                            if artifact.id.as_deref() == Some(id.as_str()) {
                                if let Some(name) = patch.get("name").and_then(Value::as_str) {
                                    artifact.name = Some(name.to_string());
                                }
                                if let Some(kind) = patch.get("kind").and_then(Value::as_str) {
                                    artifact.kind = Some(kind.to_string());
                                }
                                if let Some(artifact_type) =
                                    patch.get("type").and_then(Value::as_str)
                                {
                                    artifact.artifact_type = Some(artifact_type.to_string());
                                }
                                if let Some(path) = patch.get("path").and_then(Value::as_str) {
                                    artifact.path = Some(path.to_string());
                                }
                                if let Some(status) = patch.get("status").and_then(Value::as_str) {
                                    artifact.status = status.to_string();
                                }
                                if let Some(summary) = patch.get("summary").and_then(Value::as_str)
                                {
                                    artifact.summary = Some(summary.to_string());
                                }
                                if let Some(checks) = patch.get("checks") {
                                    artifact.checks = value_string_array(checks);
                                }
                            }
                        }
                    }
                }
            }
            TaskEvent::ArtifactSelected { .. } => {
                if let Some(id) = artifact_id_field(data) {
                    if !self.artifact_event_targets_current_task(data, &id) {
                        self.debug
                            .push(format!("ignored uncorrelated artifact.selected {id}"));
                        return;
                    }
                    self.select_artifact(&id);
                    let line_id = self.id_for(data);
                    self.push(line_id, SYM_OK, "选择产物".to_string(), id);
                }
            }
            TaskEvent::ArtifactDeleted { .. } => {
                if let Some(id) = artifact_id_field(data) {
                    if !self.artifact_event_targets_current_task(data, &id) {
                        self.debug
                            .push(format!("ignored uncorrelated artifact.deleted {id}"));
                        return;
                    }
                    if bool_field(data, "ok") != Some(true) {
                        let line_id = self.id_for(data);
                        self.push(
                            line_id,
                            SYM_WARN,
                            "删除产物失败".to_string(),
                            string_field(data, "reason")
                                .or_else(|| string_field(data, "error"))
                                .or_else(|| string_field(data, "code"))
                                .unwrap_or_default(),
                        );
                        return;
                    }
                    self.patch_artifact_status(&id, "deleted");
                    let line_id = self.id_for(data);
                    self.push(line_id, SYM_WARN, "删除产物".to_string(), id);
                }
            }
            TaskEvent::ArtifactRevealed { .. } => {
                if let Some(id) = artifact_id_field(data) {
                    if !self.artifact_event_targets_current_task(data, &id) {
                        self.debug
                            .push(format!("ignored uncorrelated artifact.revealed {id}"));
                        return;
                    }
                    self.select_artifact(&id);
                    let opened = bool_field(data, "ok") == Some(true);
                    let status = if opened { SYM_OK } else { SYM_WARN };
                    let detail = string_field(data, "path").unwrap_or(id);
                    let line_id = self.id_for(data);
                    self.push(
                        line_id,
                        status,
                        if opened {
                            "打开位置".to_string()
                        } else {
                            "无法打开,路径已给".to_string()
                        },
                        detail,
                    );
                }
            }
            TaskEvent::ArtifactExported { .. } => {
                if let Some(id) = artifact_id_field(data) {
                    if !self.artifact_event_targets_current_task(data, &id) {
                        self.debug
                            .push(format!("ignored uncorrelated artifact.exported {id}"));
                        return;
                    }
                    if bool_field(data, "ok") != Some(true) {
                        let line_id = self.id_for(data);
                        self.push(
                            line_id,
                            SYM_WARN,
                            "导出产物失败".to_string(),
                            string_field(data, "reason")
                                .or_else(|| string_field(data, "error"))
                                .or_else(|| string_field(data, "code"))
                                .unwrap_or_default(),
                        );
                        return;
                    }
                    self.patch_artifact_status(&id, "exported");
                    let detail = string_field(data, "path").unwrap_or_else(|| id.clone());
                    if let Some(artifact) = self
                        .artifacts
                        .iter_mut()
                        .find(|artifact| artifact.id.as_deref() == Some(id.as_str()))
                    {
                        artifact.export_path = Some(detail.clone());
                    }
                    let line_id = self.id_for(data);
                    self.push(line_id, SYM_OK, "导出产物".to_string(), detail);
                }
            }
            TaskEvent::EvidenceCreated { .. } => {
                self.evidence.push(Evidence {
                    id: string_field(data, "id"),
                    fact: string_field(data, "fact"),
                    source: string_field(data, "source"),
                    confidence: data.get("confidence").and_then(Value::as_f64),
                    source_type: string_field(data, "source_type"),
                });
            }
            TaskEvent::BudgetWarning { .. } => {
                // v0.18 C3：月度预算 80% 提醒 / 100% 拒任务 → 通知中心真条目（第一个预算真源）。
                let level = string_field(data, "level").unwrap_or_default();
                let spent = data.get("spent").and_then(Value::as_f64).unwrap_or(0.0);
                let cap = data.get("cap").and_then(Value::as_f64).unwrap_or(0.0);
                let (title, body) = if level == "block" {
                    (
                        "预算已达上限".to_string(),
                        format!("本月 ${spent:.2}/${cap:.0}，新任务已暂停 · 去 SETTINGS 调上限"),
                    )
                } else {
                    (
                        "预算告警".to_string(),
                        format!("本月已用 ${spent:.2}/${cap:.0}（≥80%）· 注意成本"),
                    )
                };
                self.push_notice(NoticeKind::Budget, title, body);
            }
            TaskEvent::ApprovalRequired { .. } | TaskEvent::ApprovalRequested { .. } => {
                if self.current_task_terminal.is_some() {
                    self.debug
                        .push(format!("ignored {} after task terminal", ev.event_type()));
                    return;
                }
                let kind = if matches!(ev, TaskEvent::ApprovalRequired { .. }) {
                    "tool_authorization"
                } else {
                    "deliverable_acceptance"
                };
                if !self.approval_event_correlation_matches(data, kind) {
                    self.debug.push(format!(
                        "ignored uncorrelated {} {}",
                        ev.event_type(),
                        string_field(data, "id").unwrap_or_else(|| "<missing>".to_string())
                    ));
                    return;
                }
                let id = string_field(data, "id").expect("validated approval id");
                let task_id = string_field(data, "taskRunId")
                    .or_else(|| self.task.as_ref().and_then(|task| task.id.clone()));
                if let Some(pending) = &self.approval {
                    if pending.id.as_deref() == Some(id.as_str())
                        && self.approval_kind.as_deref() == Some(kind)
                        && self.approval_task_id == task_id
                    {
                        return;
                    }
                    self.debug.push(format!(
                        "ignored {}; approval {} is already pending",
                        ev.event_type(),
                        pending.id.as_deref().unwrap_or("<missing>")
                    ));
                    return;
                }
                self.approval = Some(Approval {
                    id: Some(id),
                    tool: string_field(data, "tool"),
                    reason: string_field(data, "reason"),
                    scope: data.get("scope").cloned(),
                });
                self.approval_kind = Some(kind.to_string());
                self.approval_task_id = task_id;
                self.status = "awaiting_approval".to_string();
                self.clear_busy();
                let tool = string_field(data, "tool").unwrap_or_default();
                self.push_notice(
                    NoticeKind::Approval,
                    "等待批准".to_string(),
                    if tool.is_empty() {
                        "员工请求权限,去处理".to_string()
                    } else {
                        format!("请求：{tool} · 去处理")
                    },
                );
            }
            TaskEvent::ApprovalResolved { .. } => {
                if self.current_task_terminal.is_some() {
                    self.debug
                        .push("ignored approval.resolved after task terminal".to_string());
                    return;
                }
                if !self.pending_approval_matches(data, "tool_authorization")
                    || !matches!(
                        string_field(data, "decision").as_deref(),
                        Some("allow" | "deny")
                    )
                {
                    self.debug.push(format!(
                        "ignored mismatched approval.resolved {}",
                        string_field(data, "id").unwrap_or_else(|| "<missing>".to_string())
                    ));
                    return;
                }
                let id = self
                    .approval
                    .as_ref()
                    .and_then(|approval| approval.id.clone())
                    .expect("pending approval id");
                if !self.settled_approval_ids.insert(id) {
                    return;
                }
                self.approval = None;
                self.approval_kind = None;
                self.approval_task_id = None;
                if self.current_task_terminal.is_none() && self.task.is_some() {
                    self.status = "running".to_string();
                    self.mark_busy();
                } else if self.task.is_none() {
                    self.status = "idle".to_string();
                }
            }
            TaskEvent::ApprovalAccepted { .. } | TaskEvent::ApprovalRejected { .. } => {
                if self.current_task_terminal.is_some() {
                    self.debug
                        .push(format!("ignored {} after task terminal", ev.event_type()));
                    return;
                }
                let accepted = matches!(ev, TaskEvent::ApprovalAccepted { .. });
                let pending_matches = self.pending_approval_matches(data, "deliverable_acceptance");
                let trusted_auto = accepted
                    && bool_field(data, "auto") == Some(true)
                    && self.approval.is_none()
                    && self.approval_event_correlation_matches(data, "deliverable_acceptance");
                if !pending_matches && !trusted_auto {
                    self.debug.push(format!(
                        "ignored mismatched {} {}",
                        ev.event_type(),
                        string_field(data, "id").unwrap_or_else(|| "<missing>".to_string())
                    ));
                    return;
                }
                let id = string_field(data, "id")
                    .or_else(|| {
                        self.approval
                            .as_ref()
                            .and_then(|approval| approval.id.clone())
                    })
                    .expect("matched approval id");
                if !self.settled_approval_ids.insert(id.clone()) {
                    return;
                }
                if accepted {
                    self.accepted_count += 1;
                    self.push_notice(
                        NoticeKind::Accepted,
                        "已验收".to_string(),
                        format!("交付物已接受 · 累计 {} 次", self.accepted_count),
                    );
                }
                self.approval = None;
                self.approval_kind = None;
                self.approval_task_id = None;
                if self.current_task_terminal.is_none() && self.task.is_some() {
                    self.status = "running".to_string();
                    self.mark_busy();
                } else if self.task.is_none() {
                    self.status = "idle".to_string();
                }
                let line_id = self.id_for(data);
                self.push(
                    line_id,
                    if accepted { SYM_OK } else { SYM_WARN },
                    if accepted {
                        "交付已验收".to_string()
                    } else {
                        "交付已拒绝".to_string()
                    },
                    id,
                );
                self.last_verdict = Some((
                    accepted,
                    if accepted {
                        format!("★ 已验收 · KPI accept +{}", self.accepted_count)
                    } else {
                        "✗ 已驳回 · 等待修订指示".to_string()
                    },
                ));
            }
            TaskEvent::AssistantMessage { .. } => {
                self.reduce_assistant_message(data);
                self.clear_busy();
            }
            TaskEvent::AssistantRendered { .. } => {
                self.reduce_assistant_rendered(data);
            }
            TaskEvent::CommandOutput { .. } => {
                self.reduce_command_output(data);
            }
            TaskEvent::TokenDelta { .. } => {
                let text = string_field(data, "text").unwrap_or_default();
                self.answer.push_str(&text);
                self.append_assistant(&text);
                self.mark_busy();
                if self.status == "idle" {
                    self.status = "running".to_string();
                }
            }
            TaskEvent::ThinkingDelta { .. } => {
                // v0.11 M4：真·思考增量 → 本轮一个可折叠「思考」块（默认折叠，展开看推理）。
                // 与 append_assistant 分离：思考不进交付正文，只进独立块。
                let text = string_field(data, "text").unwrap_or_default();
                if text.is_empty() {
                    return;
                }
                self.mark_busy();
                match self.thinking_line {
                    Some(idx) => {
                        if let Some(entry) = self.timeline.get_mut(idx) {
                            entry.detail.push_str(&text);
                        }
                    }
                    None => {
                        let id = format!("thinking-{}", self.timeline.len());
                        self.push(id, SYM_THINK, "思考".to_string(), text);
                        let idx = self.timeline.len() - 1;
                        if let Some(entry) = self.timeline.get_mut(idx) {
                            entry.collapsible = true; // 折叠块，复用 v0.8 M4 折叠渲染
                            entry.expanded = false; // 默认折叠（思考是过程，不抢正文）
                        }
                        self.thinking_line = Some(idx);
                    }
                }
            }
            TaskEvent::TokenUsage { .. } => {
                self.usage.prompt_tok += u64_field(data, "prompt");
                self.usage.completion_tok += u64_field(data, "completion");
            }
            TaskEvent::TaskCompleted { .. } => {
                if !self.terminal_transition_allowed(data, "task.completed") {
                    return;
                }
                self.clear_busy();
                self.finalize_task_meta(data);
                let line_id = self.id_for(data);
                // v0.9 M2：自由聊天轮（Chat 模式）不受 artifact 门禁约束——每轮 chat 天然无交付物，
                // 若照 formal-task 规则会每轮把状态刷成 needs_artifact 并 spam「缺少交付物」timeline 行。
                // 只有正式任务模式（Task/Workbench）才要求 Done 必须留下可打开的 artifact。
                let is_chat = self.mode.eq_ignore_ascii_case("chat");
                if !is_chat && !self.current_task_has_artifact() {
                    if let Some(task) = &mut self.task {
                        task.status = "needs_artifact".to_string();
                    }
                    self.status = "needs_artifact".to_string();
                    self.push(
                        line_id,
                        SYM_WARN,
                        "缺少交付物".to_string(),
                        "正式任务不能在没有 artifact 的情况下 Done".to_string(),
                    );
                } else if !is_chat {
                    match self.current_task_outcome {
                        Some(Some(false)) => {
                            if let Some(task) = &mut self.task {
                                task.status = "needs_revision".to_string();
                            }
                            self.status = "needs_revision".to_string();
                            self.push(
                                line_id,
                                SYM_WARN,
                                "验收未通过".to_string(),
                                "正式任务只有 outcome.checked valid=true 才能 Done".to_string(),
                            );
                        }
                        Some(None) | None => {
                            if let Some(task) = &mut self.task {
                                task.status = "outcome_unknown".to_string();
                            }
                            self.status = "outcome_unknown".to_string();
                            self.push(
                                line_id,
                                SYM_WARN,
                                "验收结果未知".to_string(),
                                "事件缺少 canonical valid 字段，不能 Done".to_string(),
                            );
                        }
                        Some(Some(true)) => {
                            self.current_task_terminal = Some("task.completed");
                            self.clear_current_approval();
                            if let Some(task) = &mut self.task {
                                task.status = "done".to_string();
                            }
                            self.status = "done".to_string();
                            self.push(line_id, SYM_OK, "完成".to_string(), String::new());
                        }
                    }
                } else {
                    // Chat 轮完成：状态回落 idle（不是任务态 done），不留 timeline 完成行——
                    // 聊天回复本身就是结果，不需要额外的「完成」噪音。
                    self.current_task_terminal = Some("task.completed");
                    self.clear_current_approval();
                    if let Some(task) = &mut self.task {
                        task.status = "done".to_string();
                    }
                    self.status = "idle".to_string();
                }
            }
            TaskEvent::TaskRejected { .. } => {
                if !self.terminal_transition_allowed(data, "task.rejected") {
                    return;
                }
                if self.is_formal_task()
                    && string_field(data, "reason").is_none_or(|reason| reason.trim().is_empty())
                {
                    self.debug
                        .push("ignored task.rejected without canonical reason".to_string());
                    return;
                }
                self.current_task_terminal = Some("task.rejected");
                self.clear_current_approval();
                self.clear_busy();
                self.finalize_task_meta(data);
                if let Some(task) = &mut self.task {
                    task.status = "rejected".to_string();
                }
                self.status = "rejected".to_string();
                let reason = string_field(data, "reason").unwrap_or_default();
                let line_id = self.id_for(data);
                self.push(line_id, SYM_FAIL, format!("打回：{reason}"), String::new());
                // v0.15 P1-2：真事件 → 通知「任务被打回」。
                self.push_notice(
                    NoticeKind::Rejected,
                    "任务被打回".to_string(),
                    if reason.is_empty() {
                        "已生成修订任务".to_string()
                    } else {
                        reason
                    },
                );
            }
            TaskEvent::TaskBlocked { .. } => {
                if !self.terminal_transition_allowed(data, "task.blocked") {
                    return;
                }
                if self.is_formal_task()
                    && string_field(data, "reason").is_none_or(|reason| reason.trim().is_empty())
                {
                    self.debug
                        .push("ignored task.blocked without canonical reason".to_string());
                    return;
                }
                self.current_task_terminal = Some("task.blocked");
                self.clear_current_approval();
                self.clear_busy();
                self.finalize_task_meta(data);
                if let Some(task) = &mut self.task {
                    task.status = "blocked".to_string();
                }
                self.status = "blocked".to_string();
                let line_id = self.id_for(data);
                self.push(
                    line_id,
                    SYM_WARN,
                    "任务阻塞".to_string(),
                    string_field(data, "reason").unwrap_or_default(),
                );
            }
            TaskEvent::TaskFailed { .. } => {
                if !self.terminal_transition_allowed(data, "task.failed") {
                    return;
                }
                if self.is_formal_task()
                    && string_field(data, "reason").is_none_or(|reason| reason.trim().is_empty())
                {
                    self.debug
                        .push("ignored task.failed without canonical reason".to_string());
                    return;
                }
                self.current_task_terminal = Some("task.failed");
                self.clear_current_approval();
                self.clear_busy();
                self.finalize_task_meta(data);
                if let Some(task) = &mut self.task {
                    task.status = "failed".to_string();
                }
                self.status = "failed".to_string();
                let reason = string_field(data, "reason").unwrap_or_default();
                let line_id = self.id_for(data);
                self.push(line_id, SYM_FAIL, "任务失败".to_string(), reason.clone());
                self.push_notice(NoticeKind::Rejected, "任务失败".to_string(), reason);
            }
            TaskEvent::TaskRevisionNeeded { .. } => {
                if !self.terminal_transition_allowed(data, "task.revision_needed") {
                    return;
                }
                if self.is_formal_task()
                    && string_field(data, "reason").is_none_or(|reason| reason.trim().is_empty())
                {
                    self.debug
                        .push("ignored task.revision_needed without canonical reason".to_string());
                    return;
                }
                self.current_task_terminal = Some("task.revision_needed");
                self.clear_current_approval();
                self.clear_busy();
                self.finalize_task_meta(data);
                if let Some(task) = &mut self.task {
                    task.status = "needs_revision".to_string();
                }
                self.status = "needs_revision".to_string();
                let reason = string_field(data, "reason").unwrap_or_default();
                let line_id = self.id_for(data);
                self.push(line_id, SYM_WARN, "需要修订".to_string(), reason);
            }
            TaskEvent::TaskUpgradedFromChat { .. } => {
                if !self.task_correlation_matches(data, "taskRunId") {
                    self.debug.push(format!(
                        "ignored stale or uncorrelated task.upgraded_from_chat for {}",
                        string_field(data, "taskRunId").unwrap_or_else(|| "<missing>".to_string())
                    ));
                    return;
                }
                self.mode = "chat-upgraded".to_string();
                let line_id = self.id_for(data);
                self.push(
                    line_id,
                    SYM_OK,
                    "↑ 从对话升级为 TaskRun".to_string(),
                    string_field(data, "reason").unwrap_or_default(),
                );
            }
            TaskEvent::SkillLaunched { .. } => {
                let skill = string_field(data, "skill")
                    .or_else(|| string_field(data, "name"))
                    .unwrap_or_default();
                let line_id = self.id_for(data);
                self.push(
                    line_id,
                    SYM_RUNNING,
                    format!("启动技能：{skill}"),
                    String::new(),
                );
            }
            TaskEvent::ToolPreflightChecked { .. } => {
                let label = string_field(data, "label").unwrap_or_default();
                let status = if bool_field(data, "ok") == Some(false) {
                    SYM_WARN
                } else {
                    SYM_OK
                };
                let line_id = self.id_for(data);
                self.push(
                    line_id,
                    status,
                    format!("预检：{label}"),
                    string_field(data, "detail").unwrap_or_default(),
                );
            }
            TaskEvent::SourceChecked { .. } => {
                let source = string_field(data, "source").unwrap_or_default();
                let status = if bool_field(data, "ok") == Some(false) {
                    SYM_WARN
                } else {
                    SYM_OK
                };
                let line_id = self.id_for(data);
                self.push(
                    line_id,
                    status,
                    format!("核对来源：{source}"),
                    string_field(data, "detail").unwrap_or_default(),
                );
            }
            TaskEvent::PendingActions { .. } => {
                self.pending_actions = pending_actions_from_data(data);
            }
            TaskEvent::QuickUtility { .. } => {
                self.quick_utility = Some(QuickUtility {
                    intent: string_field(data, "intent"),
                    result: data.get("result").cloned(),
                    source: string_field(data, "source"),
                    status: string_field(data, "status"),
                });
            }
            TaskEvent::MemoryState { .. } => {
                if let Some(memory) = data.get("memory") {
                    if let Some(session) = string_field(memory, "session") {
                        self.memory.session = session;
                    }
                    if let Some(persistent) = string_field(memory, "persistent") {
                        self.memory.persistent = persistent;
                    }
                    if let Some(workspace) = string_field(memory, "workspace") {
                        self.memory.workspace = workspace;
                    }
                    if let Some(count) = memory.get("count").and_then(Value::as_u64) {
                        self.memory.count = Some(count);
                    }
                }
            }
            TaskEvent::MemoryRequested { .. } => {
                let summary = string_field(data, "summary").unwrap_or_default();
                let line_id = self.id_for(data);
                self.push(
                    line_id,
                    SYM_WAIT,
                    format!("记忆请求：{summary}"),
                    String::new(),
                );
            }
            TaskEvent::MemorySaved { .. } => {
                let summary = string_field(data, "summary").unwrap_or_default();
                let line_id = self.id_for(data);
                self.push(
                    line_id,
                    SYM_OK,
                    format!("记忆已存：{summary}"),
                    string_field(data, "scope").unwrap_or_default(),
                );
            }
            TaskEvent::WorkspaceRevealed { .. } => {
                let opened = bool_field(data, "ok") == Some(true)
                    || (data.get("ok").is_none() && bool_field(data, "available") == Some(true));
                let status = if opened { SYM_OK } else { SYM_WARN };
                let label = if opened {
                    "打开位置"
                } else {
                    "无法打开,路径已给"
                };
                let line_id = self.id_for(data);
                self.push(
                    line_id,
                    status,
                    label.to_string(),
                    string_field(data, "path").unwrap_or_default(),
                );
            }
            TaskEvent::OutcomeChecked { .. } => {
                if !self.task_correlation_matches(data, "taskRunId") {
                    self.debug.push(format!(
                        "ignored uncorrelated outcome.checked for {}",
                        string_field(data, "taskRunId").unwrap_or_else(|| "<missing>".to_string())
                    ));
                    return;
                }
                if self.current_task_terminal.is_some() {
                    self.debug
                        .push("ignored outcome.checked after task terminal".to_string());
                    return;
                }
                // v0.18 P0-a：缺 valid 字段**不默认成功**——此前 `!= Some(false)` 让批处理路径发的
                // `{passed:false}`（无 valid 键）显示成"验收：可交付"，是假绿链。三态：
                // Some(true)=可交付 / Some(false)=未达标 / None=结果未知（旧协议或字段漂移,按存疑处理）。
                let valid_field = bool_field(data, "valid");
                if valid_field == Some(true) {
                    let deliverable = string_field(data, "deliverable");
                    let has_matching_artifact = self.artifacts.iter().any(|artifact| {
                        artifact.task_id.as_deref()
                            == self.task.as_ref().and_then(|task| task.id.as_deref())
                            && artifact.status != "deleted"
                            && artifact.path == deliverable
                    });
                    if !has_matching_artifact {
                        self.debug.push(
                            "ignored valid outcome.checked without matching current-task artifact"
                                .to_string(),
                        );
                        return;
                    }
                }
                self.current_task_outcome = Some(valid_field);
                let valid = valid_field == Some(true);
                let status = if valid { SYM_OK } else { SYM_WARN };
                let label = match valid_field {
                    Some(true) => "验收：可交付",
                    Some(false) => "验收：未达标",
                    None => "验收：结果未知（事件缺 valid 字段）",
                };
                let reason = string_field(data, "reason").unwrap_or_default();
                let deliverable = string_field(data, "deliverable");
                let detail = if reason.is_empty() {
                    deliverable.clone().unwrap_or_default()
                } else {
                    reason.clone()
                };
                let line_id = self.id_for(data);
                self.push(line_id, status, label.to_string(), detail);
                // v0.15 P1-2：真交付 → 通知「已交付」。仅当真产出了 deliverable 且不是
                // accept 回声（reason="用户已验收" 走 Accepted 分支,不在此重复）。
                if valid && deliverable.is_some() && !reason.contains("已验收") {
                    self.push_notice(
                        NoticeKind::Delivered,
                        "已交付".to_string(),
                        deliverable.unwrap_or_else(|| "查看交付物详情".to_string()),
                    );
                }
            }
            TaskEvent::DebugLine { .. } => {
                if let Some(line) =
                    string_field(data, "line").or_else(|| string_field(data, "message"))
                {
                    self.debug.push(line);
                }
            }
            TaskEvent::Unknown => {}
        }
        self.refresh_inspect();
    }

    pub fn push_user_message(&mut self, text: String) {
        self.conversation.push(ConversationItem::User(text));
    }

    /// 标记模型开始生成（仅在尚未置位时记录起点，保持已用时长连续）。
    fn mark_busy(&mut self) {
        if self.busy_since.is_none() {
            self.busy_since = Some(Instant::now());
        }
    }

    /// 清除生成态（任务/回复终态或等待用户输入时调用）。
    fn clear_busy(&mut self) {
        self.busy_since = None;
    }

    /// 当前是否处于模型生成态。
    pub fn is_busy(&self) -> bool {
        self.busy_since.is_some()
    }

    fn append_assistant(&mut self, text: &str) {
        if let Some(ConversationItem::Assistant(buf)) = self.conversation.last_mut() {
            buf.push_str(text);
        } else {
            self.conversation
                .push(ConversationItem::Assistant(text.to_string()));
        }
    }

    fn current_task_has_artifact(&self) -> bool {
        let current_task_id = self.task.as_ref().and_then(|task| task.id.as_deref());
        self.artifacts
            .iter()
            .skip(self.task_artifact_start)
            .any(|artifact| {
                artifact.status != "deleted"
                    && artifact.path.as_ref().is_some_and(|path| !path.is_empty())
                    && artifact.task_id.as_deref() == current_task_id
            })
    }

    fn task_correlation_matches(&self, data: &Value, field: &str) -> bool {
        let Some(current_id) = self.task.as_ref().and_then(|task| task.id.as_deref()) else {
            return false;
        };
        match string_field(data, field) {
            Some(event_id) => event_id == current_id,
            None => self.mode.eq_ignore_ascii_case("chat"),
        }
    }

    fn event_targets_current_task(&self, data: &Value) -> bool {
        let legacy_id = string_field(data, "id");
        let task_run_id = string_field(data, "taskRunId");
        if legacy_id.is_some() && task_run_id.is_some() && legacy_id != task_run_id {
            return false;
        }
        // taskRunId is canonical; id remains a legacy fallback for v1 producers.
        let event_id = task_run_id.or(legacy_id);
        let Some(current_id) = self.task.as_ref().and_then(|task| task.id.as_deref()) else {
            return false;
        };
        match event_id {
            Some(event_id) => event_id == current_id,
            None => self.mode.eq_ignore_ascii_case("chat"),
        }
    }

    fn artifact_event_targets_current_task(&self, data: &Value, artifact_id: &str) -> bool {
        let Some(artifact) = self
            .artifacts
            .iter()
            .find(|artifact| artifact.id.as_deref() == Some(artifact_id))
        else {
            return false;
        };
        if !self.mode.eq_ignore_ascii_case("chat")
            && !self.task_correlation_matches(data, "taskRunId")
        {
            return false;
        }
        match string_field(data, "taskRunId") {
            Some(event_task_id) => artifact.task_id.as_deref() == Some(event_task_id.as_str()),
            None => self.mode.eq_ignore_ascii_case("chat"),
        }
    }

    fn terminal_transition_allowed(&mut self, data: &Value, event_type: &'static str) -> bool {
        if !self.event_targets_current_task(data) {
            self.debug.push(format!(
                "ignored stale or uncorrelated {event_type} for {}",
                string_field(data, "taskRunId")
                    .or_else(|| string_field(data, "id"))
                    .unwrap_or_else(|| "<missing>".to_string())
            ));
            return false;
        }
        if let Some(current) = self.current_task_terminal {
            if current != event_type {
                self.debug.push(format!(
                    "ignored conflicting {event_type}; task is already terminal via {current}"
                ));
            }
            return false;
        }
        true
    }

    fn clear_current_approval(&mut self) {
        self.approval = None;
        self.approval_kind = None;
        self.approval_task_id = None;
    }

    fn is_formal_task(&self) -> bool {
        self.task.is_some() && !self.mode.eq_ignore_ascii_case("chat")
    }

    fn approval_event_correlation_matches(&self, data: &Value, expected_kind: &str) -> bool {
        if string_field(data, "id").is_none_or(|id| id.trim().is_empty()) {
            return false;
        }
        if self.is_formal_task() {
            return string_field(data, "kind").as_deref() == Some(expected_kind)
                && self.task_correlation_matches(data, "taskRunId");
        }
        if string_field(data, "kind").is_some_and(|kind| kind != expected_kind) {
            return false;
        }
        if data.get("taskRunId").is_some()
            && self.task.is_some()
            && !self.task_correlation_matches(data, "taskRunId")
        {
            return false;
        }
        true
    }

    fn pending_approval_matches(&self, data: &Value, expected_kind: &str) -> bool {
        let Some(approval) = self.approval.as_ref() else {
            return false;
        };
        if self.approval_kind.as_deref() != Some(expected_kind) {
            return false;
        }
        let event_id = string_field(data, "id").or_else(|| {
            (!self.is_formal_task())
                .then(|| approval.id.clone())
                .flatten()
        });
        let event_kind = string_field(data, "kind")
            .or_else(|| (!self.is_formal_task()).then(|| expected_kind.to_string()));
        let event_task_id = string_field(data, "taskRunId").or_else(|| {
            (!self.is_formal_task())
                .then(|| self.approval_task_id.clone())
                .flatten()
        });
        event_id == approval.id
            && event_kind.as_deref() == self.approval_kind.as_deref()
            && event_task_id == self.approval_task_id
    }

    pub fn pending_action_for_key(&self, ch: char) -> Option<&PendingAction> {
        let key = ch.to_string();
        self.pending_actions.iter().find(|action| action.key == key)
    }

    pub fn select_next_artifact(&mut self) {
        if self.artifacts.is_empty() {
            return;
        }
        let current = self.selected_artifact_index().unwrap_or(usize::MAX);
        let next = if current == usize::MAX {
            0
        } else {
            (current + 1).min(self.artifacts.len().saturating_sub(1))
        };
        self.select_artifact_at(next);
    }

    pub fn select_previous_artifact(&mut self) {
        if self.artifacts.is_empty() {
            return;
        }
        let current = self.selected_artifact_index().unwrap_or(0);
        self.select_artifact_at(current.saturating_sub(1));
    }

    pub fn selected_artifact_id(&self) -> Option<String> {
        self.selected_artifact.clone().or_else(|| {
            self.artifacts
                .iter()
                .find_map(|artifact| artifact.id.clone())
        })
    }

    /// v0.15 P1-5：当前选中的产物（无显式选中时回退首个）——预览浮层的内容源。
    pub fn selected_artifact(&self) -> Option<&Artifact> {
        let id = self.selected_artifact_id()?;
        self.artifacts
            .iter()
            .find(|a| a.id.as_deref() == Some(id.as_str()))
    }

    pub fn sync_focus(&mut self, ui: &UiState) {
        self.focus = ui.drawer.unwrap_or(FocusPanel::Tasks);
        self.refresh_inspect();
    }

    pub fn set_ref_picker(&mut self, picker: Option<RefPicker>) {
        self.ref_picker = picker;
        self.refresh_inspect();
    }

    pub fn move_ref_picker(&mut self, delta: i16) -> bool {
        let Some(picker) = &mut self.ref_picker else {
            return false;
        };
        if picker.candidates.is_empty() {
            return true;
        }
        if delta.is_negative() {
            picker.selected = picker
                .selected
                .saturating_sub(delta.unsigned_abs() as usize);
        } else {
            picker.selected = (picker.selected + delta as usize).min(picker.candidates.len() - 1);
        }
        self.refresh_inspect();
        true
    }

    pub fn selected_ref_candidate(&self) -> Option<&ReferenceCandidate> {
        let picker = self.ref_picker.as_ref()?;
        picker.candidates.get(picker.selected)
    }

    /// v0.8 M3：按 query fuzzy 过滤命令目录，构造/刷新命令补全浮层。空目录时不弹。
    pub fn refresh_command_picker(&mut self, query: &str) {
        if self.commands.is_empty() {
            self.command_picker = None;
            return;
        }
        let matches = super::fuzzy::rank(self.commands.clone(), query, |c| {
            format!("{} {}", c.name, c.desc)
        });
        if matches.is_empty() {
            self.command_picker = None;
            return;
        }
        // Preserve selection position where possible when the list shrinks.
        let selected = self
            .command_picker
            .as_ref()
            .map(|p| p.selected.min(matches.len() - 1))
            .unwrap_or(0);
        self.command_picker = Some(CommandPicker {
            query: query.to_string(),
            selected,
            matches,
        });
    }

    pub fn close_command_picker(&mut self) {
        self.command_picker = None;
    }

    pub fn move_command_picker(&mut self, delta: i16) -> bool {
        let Some(picker) = &mut self.command_picker else {
            return false;
        };
        if picker.matches.is_empty() {
            return true;
        }
        if delta.is_negative() {
            picker.selected = picker
                .selected
                .saturating_sub(delta.unsigned_abs() as usize);
        } else {
            picker.selected = (picker.selected + delta as usize).min(picker.matches.len() - 1);
        }
        true
    }

    pub fn selected_command(&self) -> Option<&CommandInfo> {
        let picker = self.command_picker.as_ref()?;
        picker.matches.get(picker.selected)
    }

    /// v0.16 W4.1：预览浮层底行 `n/N` 序号需要——公开只读下标查询。
    /// 与 `selected_artifact()`/`selected_artifact_id()` 同一套回退规则：无显式选中时回退首个产物,
    /// 否则预览浮层在"未按 [ ] 前"会显示 `0/N`（明明看的是第一个文件）。
    pub(crate) fn selected_artifact_index(&self) -> Option<usize> {
        let id = self.selected_artifact_id()?;
        self.artifacts
            .iter()
            .position(|artifact| artifact.id.as_deref() == Some(id.as_str()))
    }

    fn select_artifact_at(&mut self, index: usize) {
        let Some(id) = self
            .artifacts
            .get(index)
            .and_then(|artifact| artifact.id.clone())
        else {
            return;
        };
        self.select_artifact(&id);
    }

    fn select_artifact(&mut self, id: &str) {
        self.selected_artifact = Some(id.to_string());
        if let Some(artifact) = self
            .artifacts
            .iter()
            .find(|artifact| artifact.id.as_deref() == Some(id))
        {
            self.preview = Some(ArtifactPreview {
                artifact_id: id.to_string(),
                title: artifact.name.clone().unwrap_or_else(|| id.to_string()),
                detail: artifact
                    .summary
                    .clone()
                    .or_else(|| artifact.path.clone())
                    .unwrap_or_else(|| artifact.kind.clone().unwrap_or_default()),
            });
        }
        self.refresh_inspect();
    }

    fn patch_artifact_status(&mut self, id: &str, status: &str) {
        for artifact in &mut self.artifacts {
            if artifact.id.as_deref() == Some(id) {
                artifact.status = status.to_string();
            }
        }
        self.select_artifact(id);
    }

    fn reduce_assistant_message(&mut self, data: &Value) {
        let text = string_field(data, "text").unwrap_or_default();
        self.answer.push_str(&text);
        self.append_assistant(&text);
    }

    /// v0.8 M2: 存下这一轮完结后的预排版 ANSI 行，挂到 conversation 中最后一条助手条目的
    /// 下标上。渲染层遇到该助手条目时优先用这份富文本（定妆），否则回退裸文本。
    fn reduce_assistant_rendered(&mut self, data: &Value) {
        let ansi_lines = string_array_field(data, "ansi_lines");
        if ansi_lines.is_empty() {
            return;
        }
        if let Some(index) = self.last_assistant_index() {
            // 这条 rendered 是整轮排版文本。若工具事件把本轮助手拆成了多段，前置各段的
            // 裸文本会与这块富文本重复——把 [本轮起点, index) 内的助手分片标记 superseded，
            // 渲染层只显示这一块整轮排版。单段轮（无中途工具事件）此循环为空，行为不变。
            for i in self.turn_conversation_start..index {
                if matches!(
                    self.conversation.get(i),
                    Some(ConversationItem::Assistant(_))
                ) {
                    self.superseded_assistant.insert(i);
                }
            }
            self.rendered_assistant.insert(index, ansi_lines);
        }
    }

    /// 该助手分片是否已被整轮排版块取代（渲染层据此跳过其裸文本，避免重复显示）。
    pub fn is_superseded_assistant(&self, idx: usize) -> bool {
        self.superseded_assistant.contains(&idx)
    }

    /// conversation 中最后一条 Assistant 条目的下标（供预排版行定位）。
    fn last_assistant_index(&self) -> Option<usize> {
        self.conversation
            .iter()
            .rposition(|item| matches!(item, ConversationItem::Assistant(_)))
    }

    /// v0.8 M3：slash 命令的输出。clear=true 时先重置 transcript（引擎已清 history，前端镜像），
    /// 再把命令输出作为一条助手消息追加；有 ansi_lines 则挂预排版（定妆），无则回退裸文本。
    fn reduce_command_output(&mut self, data: &Value) {
        if bool_field(data, "clear") == Some(true) {
            self.clear_transcript();
        }
        let text = string_field(data, "text").unwrap_or_default();
        if text.is_empty() {
            return;
        }
        self.append_assistant(&text);
        let ansi_lines = string_array_field(data, "ansi_lines");
        if !ansi_lines.is_empty()
            && let Some(index) = self.last_assistant_index()
        {
            self.rendered_assistant.insert(index, ansi_lines);
        }
    }

    /// /clear 语义：清空对话流、时间线、当前答复与预排版缓存（不动员工/能力目录）。
    fn clear_transcript(&mut self) {
        self.conversation.clear();
        self.timeline.clear();
        self.answer.clear();
        self.rendered_assistant.clear();
        self.superseded_assistant.clear();
        self.turn_conversation_start = 0;
        self.thinking_line = None;
        self.pending_actions.clear();
        self.task = None;
        self.plan = None;
        self.clear_busy();
    }

    fn reduce_session_ready(&mut self, data: &Value) {
        if let Some(employee) = data.get("employee") {
            self.employee = Some(Employee {
                name: string_field(employee, "name").unwrap_or_else(|| "AI 员工".to_string()),
                role: string_field(employee, "role").unwrap_or_else(|| "数字员工".to_string()),
                model: string_field(employee, "model").unwrap_or_else(|| "unknown".to_string()),
                skills: string_array_field(employee, "skills"),
                avatar: string_array_field(employee, "avatar"),
                kpi_cumulative: kpi_cumulative_field(employee),
                eval: eval_report_field(employee),
            });
            if let Some(mode) = string_field(employee, "mode") {
                self.mode = mode;
            }
        }
        // v0.8 M6: does the engine accept structured parts[]? Gate attachment emission on it.
        self.caps_parts = data
            .get("caps")
            .and_then(|c| c.get("parts"))
            .and_then(Value::as_bool)
            .unwrap_or(false);
        // v0.8 M3: cache the engine's advertised slash-command catalog for local completion.
        if let Some(commands) = data
            .get("caps")
            .and_then(|c| c.get("commands"))
            .and_then(Value::as_array)
        {
            self.commands = commands
                .iter()
                .filter_map(|entry| {
                    let name = string_field(entry, "name")?;
                    Some(CommandInfo {
                        name,
                        desc: string_field(entry, "desc").unwrap_or_default(),
                    })
                })
                .collect();
        }
    }

    fn reduce_tool_requested(&mut self, data: &Value) {
        let id = string_field(data, "id").unwrap_or_else(|| self.id_for(data));
        let tool = string_field(data, "tool");
        // v0.11 M3：按引擎真实工具名累加本任务活动计数（供任务头下的 TRAE 式计数条）。
        if let Some(name) = tool.as_deref() {
            self.task_activity.record(name);
        }
        self.set_tool(
            &id,
            ToolPatch {
                tool: tool.clone(),
                status: Some("running".to_string()),
                args: data.get("args").cloned(),
                ..ToolPatch::default()
            },
        );
        let needs_approval = bool_field(data, "needsApproval").unwrap_or(false);
        if needs_approval {
            self.approval = Some(Approval {
                id: Some(id.clone()),
                tool: tool.clone(),
                reason: string_field(data, "reason"),
                scope: data.get("scope").cloned(),
            });
            self.approval_kind = Some("tool_authorization".to_string());
            self.approval_task_id = self.task.as_ref().and_then(|task| task.id.clone());
            self.status = "awaiting_approval".to_string();
        }
        let label = string_field(data, "label").or(tool).unwrap_or_default();
        self.push(
            id,
            if needs_approval {
                SYM_WAIT
            } else {
                SYM_RUNNING
            },
            label,
            string_field(data, "reason").unwrap_or_default(),
        );
    }

    fn id_for(&self, data: &Value) -> String {
        string_field(data, "id").unwrap_or_else(|| format!("ln{}", self.timeline.len()))
    }

    /// v0.15 P1-2：追加一条通知（真事件派生;ts 取 reduce 上下文的事件时间戳）。默认未读。
    /// 上限 50 条,防会话长跑无限增长。
    fn push_notice(&mut self, kind: NoticeKind, title: String, body: String) {
        self.notices.push(Notice {
            ts: self.cur_ev_ts,
            kind,
            title,
            body,
            read: false,
        });
        let overflow = self.notices.len().saturating_sub(50);
        if overflow > 0 {
            self.notices.drain(0..overflow);
        }
    }

    /// v0.15 P1-2：未读通知数（header 徽标 + 底栏）。
    pub fn unread_notices(&self) -> usize {
        self.notices.iter().filter(|n| !n.read).count()
    }

    fn push(&mut self, id: String, status: &str, label: String, detail: String) {
        self.timeline.push(TimelineEntry {
            id,
            status: status.to_string(),
            label,
            detail,
            collapsible: false,
            expanded: false,
            task_meta: None,
            // v0.13 M1：从 reduce 上下文拷入本事件的时间戳/类型/kv（合成 push 时为 0/""/空）。
            ts: self.cur_ev_ts,
            event_type: self.cur_ev_type,
            detail_kv: self.cur_ev_kv.clone(),
        });
        self.conversation
            .push(ConversationItem::Event(self.timeline.len() - 1));
    }

    /// v0.11 M3：任务终态——冻结耗时 + 活动计数写回任务头 timeline 条，供渲染层画计数条。
    fn finalize_task_meta(&mut self, data: &Value) {
        let elapsed_ms = self
            .task_started_at
            .map(|t| t.elapsed().as_millis())
            .unwrap_or(0);
        // v0.13 M1：本任务 tokens——引擎 task.completed.usage 优先（M2 透出）；缺则快照差值兜底。
        let engine_usage = data.get("usage").map(|u| {
            (
                u.get("prompt").and_then(Value::as_u64).unwrap_or(0),
                u.get("completion").and_then(Value::as_u64).unwrap_or(0),
            )
        });
        let delta = (
            self.usage
                .prompt_tok
                .saturating_sub(self.usage_at_task_start.prompt_tok),
            self.usage
                .completion_tok
                .saturating_sub(self.usage_at_task_start.completion_tok),
        );
        let tokens = engine_usage.or(if delta == (0, 0) { None } else { Some(delta) });
        // 成本只信引擎 estimateCost（费率在引擎侧）；不在 Rust 里复制费率表。
        let est_cost = data.get("est_cost").and_then(Value::as_f64);
        if let Some(hdr) = self.task_header_line
            && let Some(entry) = self.timeline.get_mut(hdr)
        {
            entry.task_meta = Some(TaskMeta {
                elapsed_ms,
                counts: self.task_activity,
                tokens,
                est_cost,
            });
        }
        self.task_started_at = None;
        self.task_header_line = None;
    }

    fn refresh_inspect(&mut self) {
        self.inspect.task_status = self.task.as_ref().map(|task| task.status.clone());
        self.inspect.selected_artifact = self.selected_artifact.clone();
        self.inspect.approval_status = self
            .approval
            .as_ref()
            .and_then(|approval| approval.id.clone())
            .map(|id| format!("awaiting:{id}"));
        let start = self.debug.len().saturating_sub(8);
        self.inspect.recent_debug = self.debug[start..].to_vec();
    }

    fn mark(&mut self, id: Option<&str>, status: &str, detail: Option<String>) {
        let index = self.timeline.iter().rposition(|line| {
            if let Some(id) = id {
                line.id == id
            } else {
                line.status == SYM_RUNNING || line.status == SYM_WAIT
            }
        });

        if let Some(index) = index {
            self.timeline[index].status = status.to_string();
            if let Some(detail) = detail
                && !detail.is_empty()
            {
                self.timeline[index].detail = detail;
            }
        }
    }

    /// v0.8 M4：把某 id 的时间线条目标记为可折叠工具行，写入完整输出并设默认折叠态。
    fn mark_tool(&mut self, id: &str, detail: Option<String>, expanded: bool) {
        if let Some(entry) = self.timeline.iter_mut().rev().find(|line| line.id == id) {
            entry.collapsible = true;
            entry.expanded = expanded;
            if let Some(detail) = detail
                && !detail.is_empty()
            {
                entry.detail = detail;
            }
        }
    }

    /// Ctrl+R：切换最后一条可折叠工具行的展开态。返回是否有可切换的工具行。
    pub fn toggle_last_tool(&mut self) -> bool {
        if let Some(entry) = self.timeline.iter_mut().rev().find(|line| line.collapsible) {
            entry.expanded = !entry.expanded;
            true
        } else {
            false
        }
    }

    fn set_tool(&mut self, id: &str, patch: ToolPatch) {
        let tool = self
            .tools
            .entry(id.to_string())
            .or_insert_with(|| ToolState {
                tool: None,
                status: String::new(),
                summary: None,
                args: None,
            });
        if let Some(name) = patch.tool {
            tool.tool = Some(name);
        }
        if let Some(status) = patch.status {
            tool.status = status;
        }
        if let Some(summary) = patch.summary {
            tool.summary = Some(summary);
        }
        if let Some(args) = patch.args {
            tool.args = Some(args);
        }
    }
}

#[derive(Default)]
struct ToolPatch {
    tool: Option<String>,
    status: Option<String>,
    summary: Option<String>,
    args: Option<Value>,
}

fn string_field(data: &Value, key: &str) -> Option<String> {
    data.get(key)
        .and_then(Value::as_str)
        .map(ToString::to_string)
}

/// v0.13 M1：事件 data 的一层摊平——对象顶层键 → 显示字符串（嵌套/数组紧凑序列化），
/// 值超 120 显示宽截断加 …。供 EVENT DETAIL 面板做 key:value 着色渲染（不存 Value，保 Eq）。
fn flatten_event_kv(data: &Value) -> Vec<(String, String)> {
    const MAX_VAL: usize = 120;
    let Some(map) = data.as_object() else {
        return Vec::new();
    };
    map.iter()
        .map(|(k, v)| {
            let raw = match v {
                Value::String(s) => s.clone(),
                other => other.to_string(),
            };
            let mut shown: String = raw.chars().take(MAX_VAL).collect();
            if raw.chars().count() > MAX_VAL {
                shown.push('…');
            }
            (k.clone(), shown)
        })
        .collect()
}

fn bool_field(data: &Value, key: &str) -> Option<bool> {
    data.get(key).and_then(Value::as_bool)
}

fn u64_field(data: &Value, key: &str) -> u64 {
    data.get(key).and_then(Value::as_u64).unwrap_or_default()
}

fn string_array_field(data: &Value, key: &str) -> Vec<String> {
    data.get(key).map(value_string_array).unwrap_or_default()
}

/// v0.17 P2 C1：解析 session.ready 的 `employee.kpi_cumulative`（引擎 kpi.mjs 下发）。
/// 缺字段/旧引擎无此键 → 全零默认值，不是 panic 也不是伪造非零历史。
fn kpi_cumulative_field(employee: &Value) -> KpiCumulative {
    let Some(kpi) = employee.get("kpi_cumulative") else {
        return KpiCumulative::default();
    };
    KpiCumulative {
        tasks: kpi.get("tasks").and_then(Value::as_u64).unwrap_or(0),
        accepted: kpi.get("accepted").and_then(Value::as_u64).unwrap_or(0),
        total_cost: kpi.get("total_cost").and_then(Value::as_f64).unwrap_or(0.0),
        first_hired_ts: kpi.get("first_hired_ts").and_then(Value::as_u64),
    }
}

/// v0.18 B2：解析 session.ready 的 `employee.eval`（eval-runner 落盘、bridge readEvalResult 下发）。
/// 缺键/null（从未评测）→ None，EVAL 屏据此显示空态，不伪造分数。
fn eval_report_field(employee: &Value) -> Option<EvalReport> {
    let eval = employee.get("eval")?;
    if eval.is_null() {
        return None;
    }
    let score = eval.get("score").and_then(Value::as_u64)? as u32;
    let exams = eval
        .get("exams")
        .and_then(Value::as_array)
        .map(|arr| {
            arr.iter()
                .filter_map(|e| {
                    Some(ExamEntry {
                        id: string_field(e, "id")?,
                        score: e.get("score").and_then(Value::as_u64).unwrap_or(0) as u32,
                        passed: e.get("passed").and_then(Value::as_bool).unwrap_or(false),
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    Some(EvalReport {
        score,
        verdict: string_field(eval, "verdict").unwrap_or_else(|| "FAIL".to_string()),
        model: string_field(eval, "model").unwrap_or_else(|| "unknown".to_string()),
        mock: eval.get("mock").and_then(Value::as_bool).unwrap_or(true),
        // Runtime session.ready is the trust handoff: Node's readEvalResult has already rebound the
        // stored result to the current subject contract. Never accept a wire-supplied certification
        // bit; derive it solely from the validated result's mock provenance.
        certified: eval.get("mock").and_then(Value::as_bool) == Some(false),
        evaluated_at: eval
            .get("evaluated_at")
            .and_then(Value::as_u64)
            .unwrap_or(0),
        exams,
    })
}

fn artifact_id_field(data: &Value) -> Option<String> {
    string_field(data, "artifact_id")
        .or_else(|| string_field(data, "artifactId"))
        .or_else(|| string_field(data, "id"))
}

fn pending_actions_from_data(data: &Value) -> Vec<PendingAction> {
    data.get("actions")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    let key = string_field(item, "key")?;
                    if key.len() != 1 || !key.chars().all(|ch| ('1'..='9').contains(&ch)) {
                        return None;
                    }
                    let label = string_field(item, "label")?;
                    Some(PendingAction {
                        key,
                        label,
                        command: string_field(item, "command"),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

fn value_string_array(value: &Value) -> Vec<String> {
    value
        .as_array()
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(ToString::to_string)
                .collect()
        })
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ev(event_type: &str, data: Value) -> TaskEvent {
        TaskEvent::from_parts(event_type, 0, data)
    }

    fn reduce_all(events: Vec<TaskEvent>) -> AppState {
        let mut state = AppState::default();
        for event in events {
            state.reduce(&event);
        }
        state
    }

    #[test]
    fn shared_golden_jsonl_matches_node_reducer_semantics() {
        let fixture =
            include_str!("../../../../packages/runtime/__tests__/fixtures/task-events-v1.jsonl");
        let expected: Value = serde_json::from_str(include_str!(
            "../../../../packages/runtime/__tests__/fixtures/task-events-v1.expected.json"
        ))
        .expect("shared expected snapshot");
        let mut state = AppState::default();
        for line in fixture.lines().filter(|line| !line.trim().is_empty()) {
            let event: TaskEvent = serde_json::from_str(line).expect("shared TaskEvent JSONL");
            state.reduce(&event);
        }
        let artifact = state
            .artifacts
            .iter()
            .find(|artifact| artifact.id.as_deref() == Some("artifact-golden"))
            .expect("golden artifact");
        let snapshot = serde_json::json!({
            "mode": state.mode.clone(),
            "task": {
                "id": state.task.as_ref().and_then(|task| task.id.clone()),
                "status": state.task.as_ref().map(|task| task.status.clone()),
            },
            "status": state.status.clone(),
            "artifact": {
                "id": artifact.id.clone(),
                "task_id": artifact.task_id.clone(),
                "status": artifact.status.clone(),
                "path": artifact.path.clone(),
            },
            "proof": {
                "valid": state.current_task_outcome == Some(Some(true)),
                "deliverable": artifact.path.clone(),
            },
            "approval": state.approval.as_ref().map(|approval| approval.id.clone()),
            "accepted_count": state.accepted_count,
        });
        assert_eq!(snapshot, expected);
    }

    /// v0.16 W3.5：审批 accepted/rejected 后 last_verdict 承载真结论;新任务开始后清空,
    /// 不跨任务累留(设计稿 showVerdict 分支的数据源)。
    #[test]
    fn approval_accepted_sets_verdict_then_task_started_clears_it() {
        let state = reduce_all(vec![
            ev("task.started", serde_json::json!({"id":"t1","mode":"Task"})),
            ev(
                "approval.requested",
                serde_json::json!({"id":"ap1","taskRunId":"t1","kind":"deliverable_acceptance"}),
            ),
            ev(
                "approval.accepted",
                serde_json::json!({"id":"ap1","taskRunId":"t1","kind":"deliverable_acceptance"}),
            ),
        ]);
        let (accepted, text) = state
            .last_verdict
            .clone()
            .expect("verdict set after accept");
        assert!(accepted, "accepted verdict");
        assert!(text.contains("已验收"), "verdict text: {text}");

        let mut state = state;
        state.reduce(&ev(
            "task.started",
            serde_json::json!({"id":"t2","title":"新任务"}),
        ));
        assert!(
            state.last_verdict.is_none(),
            "new task clears the stale verdict"
        );
    }

    #[test]
    fn approval_rejected_sets_red_verdict() {
        let state = reduce_all(vec![
            ev("task.started", serde_json::json!({"id":"t1","mode":"Task"})),
            ev(
                "approval.requested",
                serde_json::json!({"id":"ap1","taskRunId":"t1","kind":"deliverable_acceptance"}),
            ),
            ev(
                "approval.rejected",
                serde_json::json!({"id":"ap1","taskRunId":"t1","kind":"deliverable_acceptance","decision":"reject"}),
            ),
        ]);
        let (accepted, text) = state.last_verdict.expect("verdict set after reject");
        assert!(!accepted, "rejected verdict");
        assert!(text.contains("已驳回"), "verdict text: {text}");
    }

    /// v0.15 P0-1：新任务开始时 reducer 兜底清空上一次交付物遗留的 pending_actions
    /// (即使引擎不发空列表)——保证一次交付后数字键不会被幽灵待办永久拦截。
    #[test]
    fn task_started_clears_stale_pending_actions() {
        let mut state = AppState::default();
        state.pending_actions = vec![PendingAction {
            key: "2".to_string(),
            label: "要求修订".to_string(),
            command: None,
        }];
        state.reduce(&ev(
            "task.started",
            serde_json::json!({"id":"t2","title":"新任务"}),
        ));
        assert!(
            state.pending_actions.is_empty(),
            "a new task voids the previous deliverable's digit bindings"
        );
    }

    /// v0.15 P1-2：通知中心条目由**真事件**派生——审批请求/交付/验收/打回各产生一条,
    /// 且默认未读。无真源的预算/Dream 通知不造。
    #[test]
    fn notices_are_derived_from_real_events() {
        let state = reduce_all(vec![
            ev("task.started", serde_json::json!({"id":"t1","mode":"Task"})),
            ev(
                "approval.requested",
                serde_json::json!({"id":"ap1","taskRunId":"t1","kind":"deliverable_acceptance"}),
            ),
            ev(
                "approval.accepted",
                serde_json::json!({"id":"ap1","taskRunId":"t1","kind":"deliverable_acceptance"}),
            ),
            ev(
                "artifact.created",
                serde_json::json!({"id":"a1","taskRunId":"t1","path":"report.md"}),
            ),
            ev(
                "outcome.checked",
                serde_json::json!({"taskRunId":"t1","valid":true,"deliverable":"report.md"}),
            ),
            ev(
                "task.rejected",
                serde_json::json!({"id":"t1","reason":"数据不足"}),
            ),
        ]);
        assert_eq!(state.notices.len(), 4, "one notice per real event");
        assert_eq!(state.unread_notices(), 4, "all start unread");
        assert_eq!(state.notices[0].kind, NoticeKind::Approval);
        assert_eq!(state.notices[1].kind, NoticeKind::Accepted);
        assert_eq!(state.notices[2].kind, NoticeKind::Delivered);
        assert_eq!(state.notices[3].kind, NoticeKind::Rejected);
    }

    /// v0.18 P0-a：outcome.checked 缺 valid 字段**不得默认成功**——批处理路径旧协议发
    /// `{passed:false}`（无 valid 键）时，旧逻辑显示"验收：可交付"（假绿）。缺字段=结果未知(WARN)，
    /// 也不产生"已交付"通知。
    #[test]
    fn outcome_checked_without_valid_is_unknown_not_success() {
        // 无 valid 键（模拟旧批处理协议 {passed:false}）→ 未知态,非可交付,无 Delivered 通知。
        let missing = reduce_all(vec![
            ev(
                "task.started",
                serde_json::json!({"id":"missing","mode":"Task"}),
            ),
            ev(
                "outcome.checked",
                serde_json::json!({"taskRunId":"missing","passed": false, "deliverable": "report.md"}),
            ),
        ]);
        let line = missing.timeline.last().expect("timeline line");
        assert!(
            line.label.contains("结果未知"),
            "missing valid → unknown, got {:?}",
            line.label
        );
        assert!(
            !missing
                .notices
                .iter()
                .any(|n| n.kind == NoticeKind::Delivered),
            "missing valid must NOT produce a 已交付 notice"
        );

        // 显式 false → 未达标。
        let invalid = reduce_all(vec![
            ev(
                "task.started",
                serde_json::json!({"id":"invalid","mode":"Task"}),
            ),
            ev(
                "outcome.checked",
                serde_json::json!({"taskRunId":"invalid","valid": false, "reason": "缺来源"}),
            ),
        ]);
        assert!(invalid.timeline.last().unwrap().label.contains("未达标"));

        // 显式 true → 可交付（原行为不变）。
        let valid = reduce_all(vec![
            ev(
                "task.started",
                serde_json::json!({"id":"valid","mode":"Task"}),
            ),
            ev(
                "artifact.created",
                serde_json::json!({"id":"a1","taskRunId":"valid","path":"report.md"}),
            ),
            ev(
                "outcome.checked",
                serde_json::json!({"taskRunId":"valid","valid": true, "deliverable": "report.md"}),
            ),
        ]);
        assert!(valid.timeline.last().unwrap().label.contains("可交付"));
    }

    /// v0.18 C3：budget.warning（引擎月度预算 80%/100%）→ 通知中心真条目（第一个预算真源）。
    #[test]
    fn budget_warning_becomes_a_notice() {
        let warn = reduce_all(vec![ev(
            "budget.warning",
            serde_json::json!({"level":"warn","month":"2026-07","spent":16.5,"cap":20}),
        )]);
        assert_eq!(warn.notices.len(), 1);
        assert_eq!(warn.notices[0].kind, NoticeKind::Budget);
        assert!(
            warn.notices[0].body.contains("16.5"),
            "warn body carries the real spend"
        );

        let block = reduce_all(vec![ev(
            "budget.warning",
            serde_json::json!({"level":"block","month":"2026-07","spent":25.0,"cap":20}),
        )]);
        assert_eq!(block.notices[0].kind, NoticeKind::Budget);
        assert!(
            block.notices[0].title.contains("上限"),
            "block title signals the hard stop"
        );
    }

    /// accept 回声的 outcome.checked(reason=用户已验收) 不重复产出「已交付」通知。
    #[test]
    fn accept_echo_outcome_does_not_double_notify_delivered() {
        let state = reduce_all(vec![ev(
            "outcome.checked",
            serde_json::json!({"valid":true,"deliverable":"report.md","reason":"用户已验收"}),
        )]);
        assert!(
            !state
                .notices
                .iter()
                .any(|n| n.kind == NoticeKind::Delivered),
            "accept echo must not create a Delivered notice"
        );
    }

    #[test]
    fn tool_success_folds_and_ctrl_r_toggles() {
        let state = reduce_all(vec![
            ev("task.started", serde_json::json!({"id":"t","title":"x"})),
            ev(
                "tool.requested",
                serde_json::json!({"id":"tool1","tool":"web","label":"web.search"}),
            ),
            ev(
                "tool.succeeded",
                serde_json::json!({"id":"tool1","summary":"ok","detail":"line1\nline2\nline3"}),
            ),
        ]);
        let tool = state
            .timeline
            .iter()
            .find(|e| e.collapsible)
            .expect("collapsible tool line");
        assert!(!tool.expanded, "success folds by default");
        assert!(tool.detail.contains("line2"));

        let mut state = state;
        assert!(state.toggle_last_tool(), "toggle finds the tool line");
        assert!(
            state
                .timeline
                .iter()
                .find(|e| e.collapsible)
                .unwrap()
                .expanded,
            "ctrl+r expands"
        );
        state.toggle_last_tool();
        assert!(
            !state
                .timeline
                .iter()
                .find(|e| e.collapsible)
                .unwrap()
                .expanded,
            "ctrl+r folds again"
        );
    }

    #[test]
    fn tool_failure_defaults_expanded() {
        let state = reduce_all(vec![
            ev("task.started", serde_json::json!({"id":"t","title":"x"})),
            ev(
                "tool.requested",
                serde_json::json!({"id":"tool1","tool":"web","label":"web.search"}),
            ),
            ev(
                "tool.failed",
                serde_json::json!({"id":"tool1","code":"boom","detail":"stack trace here"}),
            ),
        ]);
        let tool = state
            .timeline
            .iter()
            .find(|e| e.collapsible)
            .expect("collapsible tool line");
        assert!(tool.expanded, "failure defaults to expanded");
    }

    #[test]
    fn session_ready_caps_populates_command_catalog() {
        let mut state = AppState::default();
        state.reduce(&ev(
            "session.ready",
            serde_json::json!({
                "employee": {"name":"鲸","role":"顾问","model":"opus"},
                "caps": {"ansi": true, "commands": [
                    {"name":"/help","desc":"Show commands."},
                    {"name":"/model","desc":"Show model."}
                ]}
            }),
        ));
        assert_eq!(state.commands.len(), 2);
        assert_eq!(state.commands[1].name, "/model");
    }

    #[test]
    fn command_output_appends_assistant_and_clear_resets_transcript() {
        let mut state = AppState::default();
        state.push_user_message("hi".to_string());
        state.reduce(&ev("token.delta", serde_json::json!({"text":"答复"})));
        state.reduce(&ev(
            "task.started",
            serde_json::json!({"id":"t","title":"x"}),
        ));
        assert!(!state.conversation.is_empty());

        // A non-clear command output appends an assistant message with rendered ANSI.
        state.reduce(&ev(
            "command.output",
            serde_json::json!({"command":"/model","text":"Model opus","ansi_lines":["\u{1b}[1mModel opus\u{1b}[0m"]}),
        ));
        assert!(matches!(
            state.conversation.last(),
            Some(ConversationItem::Assistant(t)) if t.contains("Model opus")
        ));

        // /clear resets the transcript entirely.
        state.reduce(&ev(
            "command.output",
            serde_json::json!({"command":"/clear","clear":true,"text":"（上下文已清空）"}),
        ));
        assert!(state.timeline.is_empty(), "timeline cleared");
        assert!(state.task.is_none(), "task cleared");
        // Only the clear notice remains.
        assert_eq!(state.conversation.len(), 1);
    }

    #[test]
    fn assistant_rendered_stores_ansi_lines_at_last_assistant_index() {
        let mut state = AppState::default();
        state.push_user_message("画个报告".to_string());
        // A streamed assistant turn produces an Assistant item at index 1.
        state.reduce(&ev(
            "token.delta",
            serde_json::json!({"text":"## 标题\n正文"}),
        ));
        let idx = state
            .last_assistant_index()
            .expect("assistant item present");

        state.reduce(&ev(
            "assistant.rendered",
            serde_json::json!({"turn_id":"turn1","ansi_lines":["\u{1b}[1m## 标题\u{1b}[0m","正文"]}),
        ));

        let stored = state.rendered_assistant.get(&idx).expect("rendered stored");
        assert_eq!(stored.len(), 2);
        assert!(stored[0].contains("标题"));
    }

    #[test]
    fn mid_stream_tool_event_supersedes_earlier_assistant_fragment() {
        // 一轮里 "文字→工具事件→文字" 把助手拆成两段。整轮 rendered 只挂最后一段；
        // 前置段必须被标记 superseded，否则渲染层会把 "我先搜索一下" 显示两次（回归 bug）。
        let mut state = AppState::default();
        state.reduce(&ev(
            "task.started",
            serde_json::json!({"id":"turn1","title":"报告"}),
        ));
        state.reduce(&ev(
            "token.delta",
            serde_json::json!({"text":"我先搜索一下"}),
        ));
        state.reduce(&ev(
            "tool.requested",
            serde_json::json!({"id":"tool1","tool":"web.search","label":"搜索"}),
        ));
        state.reduce(&ev("token.delta", serde_json::json!({"text":"结果如下"})));
        state.reduce(&ev(
            "assistant.rendered",
            serde_json::json!({"turn_id":"turn1","ansi_lines":["我先搜索一下结果如下"]}),
        ));

        let last = state.last_assistant_index().expect("assistant present");
        let first_assistant = state
            .conversation
            .iter()
            .position(|it| matches!(it, ConversationItem::Assistant(_)))
            .expect("first assistant fragment");
        assert_ne!(first_assistant, last, "turn split into two fragments");
        assert!(
            state.rendered_assistant.contains_key(&last),
            "rendered stored on last fragment"
        );
        assert!(
            state.is_superseded_assistant(first_assistant),
            "earlier fragment superseded (no double render)"
        );
        assert!(
            !state.is_superseded_assistant(last),
            "rendered fragment not superseded"
        );
    }

    #[test]
    fn assistant_rendered_with_empty_lines_is_ignored() {
        let mut state = AppState::default();
        state.reduce(&ev("token.delta", serde_json::json!({"text":"hi"})));
        state.reduce(&ev(
            "assistant.rendered",
            serde_json::json!({"turn_id":"t","ansi_lines":[]}),
        ));
        assert!(
            state.rendered_assistant.is_empty(),
            "empty rendered ignored"
        );
    }

    #[test]
    fn busy_tracks_generation_lifecycle() {
        let mut state = AppState::default();
        assert!(!state.is_busy(), "idle at start");

        // Streaming tokens marks busy.
        state.reduce(&ev("token.delta", serde_json::json!({"text":"hel"})));
        assert!(state.is_busy(), "token.delta marks busy");
        state.reduce(&ev("token.delta", serde_json::json!({"text":"lo"})));
        assert!(state.is_busy(), "still busy mid-stream");

        // Final assistant message clears busy.
        state.reduce(&ev("assistant.message", serde_json::json!({"text":"done"})));
        assert!(!state.is_busy(), "assistant.message clears busy");
    }

    #[test]
    fn busy_set_by_task_started_and_cleared_by_terminal_states() {
        // Completed task with artifact clears busy.
        let state = reduce_all(vec![
            ev("task.started", serde_json::json!({"id":"t","title":"x"})),
            ev(
                "artifact.created",
                serde_json::json!({"id":"a","taskRunId":"t","name":"a.md","path":"/tmp/a.md"}),
            ),
            ev("task.completed", serde_json::json!({"id":"t"})),
        ]);
        assert!(!state.is_busy(), "task.completed clears busy");

        // Rejected task clears busy.
        let rejected = reduce_all(vec![
            ev("task.started", serde_json::json!({"id":"t","title":"x"})),
            ev("task.rejected", serde_json::json!({"id":"t","reason":"no"})),
        ]);
        assert!(!rejected.is_busy(), "task.rejected clears busy");

        // Approval request pauses busy (waiting on user).
        let awaiting = reduce_all(vec![
            ev("task.started", serde_json::json!({"id":"t","title":"x"})),
            ev(
                "approval.required",
                serde_json::json!({"id":"ap","taskRunId":"t","kind":"tool_authorization","tool":"web"}),
            ),
        ]);
        assert!(!awaiting.is_busy(), "approval.required pauses busy");
    }

    #[test]
    fn research_turn_reduces_to_timeline_answer_and_tools() {
        let state = reduce_all(vec![
            ev(
                "task.started",
                serde_json::json!({"id":"task1","title":"调研火山 Seed 2.1","mode":"Trial"}),
            ),
            ev(
                "plan.created",
                serde_json::json!({"id":"plan1","steps":["官方源优先","抽字段","组装报告"]}),
            ),
            ev(
                "tool.requested",
                serde_json::json!({"id":"tool1","tool":"browser.render","reason":"JS 空壳","needsApproval":true}),
            ),
            ev(
                "approval.resolved",
                serde_json::json!({"id":"tool1","taskRunId":"task1","kind":"tool_authorization","decision":"allow"}),
            ),
            ev(
                "tool.succeeded",
                serde_json::json!({"id":"tool1","summary":"读到正文"}),
            ),
            ev(
                "evidence.created",
                serde_json::json!({"id":"ev1","fact":"Seed 2.1 上下文 256k","source":"official","confidence":0.8}),
            ),
            ev("token.delta", serde_json::json!({"text":"根据官方文档，"})),
            ev(
                "token.delta",
                serde_json::json!({"text":"Seed 2.1 适合接入。"}),
            ),
            ev(
                "artifact.created",
                serde_json::json!({"id":"art1","taskRunId":"task1","name":"seed-2.1-research.md","type":"report","path":"/tmp/seed-2.1-research.md","status":"draft","checks":["≥2 来源"]}),
            ),
            ev(
                "token.usage",
                serde_json::json!({"prompt":1000,"completion":200}),
            ),
            ev(
                "outcome.checked",
                serde_json::json!({"taskRunId":"task1","valid":true,"deliverable":"/tmp/seed-2.1-research.md"}),
            ),
            ev("task.completed", serde_json::json!({"id":"task1"})),
        ]);

        assert_eq!(state.task.as_ref().unwrap().title, "调研火山 Seed 2.1");
        assert_eq!(state.task.as_ref().unwrap().status, "done");
        assert_eq!(state.mode, "Trial");
        assert_eq!(state.plan.as_ref().unwrap().steps.len(), 3);
        assert_eq!(state.tools.get("tool1").unwrap().status, "ok");
        assert_eq!(state.evidence[0].source.as_deref(), Some("official"));
        assert_eq!(
            state.artifacts[0].name.as_deref(),
            Some("seed-2.1-research.md")
        );
        assert_eq!(state.answer, "根据官方文档，Seed 2.1 适合接入。");
        assert_eq!(state.usage.prompt_tok, 1000);
        assert_eq!(state.usage.completion_tok, 200);
        assert_eq!(state.status, "done");
        assert_eq!(state.approval, None);
        assert!(
            state
                .timeline
                .iter()
                .any(|line| line.label.contains("browser.render") && line.status == SYM_OK)
        );
        assert!(
            state
                .timeline
                .iter()
                .any(|line| line.status == SYM_OK && line.label.contains("完成"))
        );
    }

    #[test]
    fn failed_tool_marks_failed_tool_and_timeline_code() {
        let state = reduce_all(vec![
            ev("task.started", serde_json::json!({"id":"t","title":"x"})),
            ev(
                "tool.requested",
                serde_json::json!({"id":"srch","tool":"web.search"}),
            ),
            ev(
                "tool.failed",
                serde_json::json!({"id":"srch","code":"missing_key"}),
            ),
        ]);

        assert_eq!(state.tools.get("srch").unwrap().status, "failed");
        let line = state
            .timeline
            .iter()
            .find(|line| line.id == "srch")
            .unwrap();
        assert_eq!(line.status, SYM_FAIL);
        assert_eq!(line.detail, "missing_key");
    }

    #[test]
    fn v06_events_capture_pending_memory_and_artifact_path() {
        let state = reduce_all(vec![
            ev(
                "task.started",
                serde_json::json!({"id":"t","title":"ROI 示例"}),
            ),
            ev(
                "task.upgraded_from_chat",
                serde_json::json!({"taskRunId":"t","reason":"需生成报告"}),
            ),
            ev(
                "pending.actions",
                serde_json::json!({"actions":[{"key":"1","label":"看示例"},{"key":"2","label":"改假设"}]}),
            ),
            ev(
                "memory.state",
                serde_json::json!({"memory":{"persistent":"disabled"}}),
            ),
            ev(
                "artifact.created",
                serde_json::json!({"id":"a","taskRunId":"t","name":"roi_report.md","kind":"report","path":"/x/.crewclaw/artifacts/t/roi_report.md"}),
            ),
        ]);

        assert_eq!(state.mode, "chat-upgraded");
        assert_eq!(state.pending_actions.len(), 2);
        assert_eq!(state.memory.persistent, "disabled");
        assert_eq!(state.memory.session, "available");
        assert_eq!(
            state.artifacts[0].path.as_deref(),
            Some("/x/.crewclaw/artifacts/t/roi_report.md")
        );
        assert_eq!(state.artifacts[0].kind.as_deref(), Some("report"));
        assert!(
            state
                .timeline
                .iter()
                .any(|line| line.label.contains("升级"))
        );
    }

    #[test]
    fn pending_actions_reduce_to_typed_actions_and_skip_invalid_items() {
        let state = reduce_all(vec![ev(
            "pending.actions",
            serde_json::json!({
                "actions":[
                    {"key":"1","label":"生成 ROI 示例","command":"run_roi_demo"},
                    {"key":"2","label":"生成可编辑表格"},
                    {"key":"x","label":"不是数字"},
                    {"key":"3"}
                ]
            }),
        )]);

        assert_eq!(state.pending_actions.len(), 2);
        assert_eq!(state.pending_actions[0].key, "1");
        assert_eq!(state.pending_actions[0].label, "生成 ROI 示例");
        assert_eq!(
            state.pending_actions[0].command.as_deref(),
            Some("run_roi_demo")
        );
        assert_eq!(state.pending_actions[1].key, "2");
        assert_eq!(
            state.pending_action_for_key('1').unwrap().label,
            "生成 ROI 示例"
        );
        assert!(state.pending_action_for_key('3').is_none());
        assert!(state.pending_action_for_key('x').is_none());
    }

    #[test]
    fn artifact_events_select_soft_delete_and_reveal_artifacts() {
        let state = reduce_all(vec![
            ev("task.started", serde_json::json!({"id":"t","mode":"Task"})),
            ev(
                "artifact.created",
                serde_json::json!({
                    "id":"a1",
                    "taskRunId":"t",
                    "name":"roi_report.md",
                    "kind":"markdown",
                    "path":"/tmp/roi_report.md",
                    "status":"ready",
                    "summary":"ROI 报告"
                }),
            ),
            ev(
                "artifact.selected",
                serde_json::json!({"artifact_id":"a1","taskRunId":"t"}),
            ),
            ev(
                "artifact.revealed",
                serde_json::json!({"artifact_id":"a1","taskRunId":"t","path":"/tmp/roi_report.md","ok":true}),
            ),
            ev(
                "artifact.deleted",
                serde_json::json!({"artifact_id":"a1","taskRunId":"t","ok":true}),
            ),
        ]);

        assert_eq!(state.selected_artifact.as_deref(), Some("a1"));
        assert_eq!(state.artifacts[0].status, "deleted");
        assert_eq!(state.artifacts[0].summary.as_deref(), Some("ROI 报告"));
        assert_eq!(state.preview.as_ref().unwrap().artifact_id, "a1");
        assert!(
            state
                .timeline
                .iter()
                .any(|line| line.label.contains("选择产物"))
        );
        assert!(
            state
                .timeline
                .iter()
                .any(|line| line.label.contains("打开位置"))
        );
        assert!(
            state
                .timeline
                .iter()
                .any(|line| line.label.contains("删除产物"))
        );
    }

    #[test]
    fn artifact_exported_marks_the_artifact_and_records_the_event() {
        let state = reduce_all(vec![
            ev("task.started", serde_json::json!({"id":"t","mode":"Task"})),
            ev(
                "artifact.created",
                serde_json::json!({
                    "id":"a1",
                    "taskRunId":"t",
                    "name":"roi_report.md",
                    "kind":"markdown",
                    "path":"/tmp/roi_report.md",
                    "status":"ready"
                }),
            ),
            ev(
                "artifact.exported",
                serde_json::json!({"artifact_id":"a1","taskRunId":"t","path":"/tmp/export/roi_report.md","ok":true}),
            ),
        ]);

        assert_eq!(state.artifacts[0].status, "exported");
        assert_eq!(
            state.artifacts[0].path.as_deref(),
            Some("/tmp/roi_report.md"),
            "export keeps the source path"
        );
        assert_eq!(
            state.artifacts[0].export_path.as_deref(),
            Some("/tmp/export/roi_report.md")
        );
        assert!(state.timeline.iter().any(|line| {
            line.label == "导出产物" && line.detail == "/tmp/export/roi_report.md"
        }));
    }

    #[test]
    fn failed_artifact_actions_do_not_claim_filesystem_mutation() {
        let state = reduce_all(vec![
            ev("task.started", serde_json::json!({"id":"t","mode":"Task"})),
            ev(
                "artifact.created",
                serde_json::json!({"id":"a1","taskRunId":"t","path":"/tmp/source.md"}),
            ),
            ev(
                "artifact.deleted",
                serde_json::json!({"artifact_id":"a1","taskRunId":"t","ok":false,"code":"delete_failed"}),
            ),
            ev(
                "artifact.exported",
                serde_json::json!({"artifact_id":"a1","taskRunId":"t","ok":false,"code":"export_failed"}),
            ),
        ]);

        assert_eq!(state.artifacts[0].status, "draft");
        assert_eq!(state.artifacts[0].export_path, None);
        assert!(
            state
                .timeline
                .iter()
                .any(|line| line.label == "删除产物失败")
        );
        assert!(
            state
                .timeline
                .iter()
                .any(|line| line.label == "导出产物失败")
        );
    }

    #[test]
    fn long_assistant_markdown_appends_to_answer() {
        let long_markdown = format!("# ROI\n\n{}", "很长的段落。".repeat(140));
        let state = reduce_all(vec![
            ev(
                "task.started",
                serde_json::json!({"id":"t","title":"生成 ROI 报告","mode":"Task"}),
            ),
            ev(
                "assistant.message",
                serde_json::json!({"text":long_markdown}),
            ),
        ]);

        assert_eq!(state.answer, long_markdown);
        assert_eq!(state.status, "running");
        assert!(state.artifacts.is_empty());
        assert!(state.selected_artifact.is_none());
        assert!(!state.timeline.iter().any(|line| line.status == SYM_WARN));
    }

    #[test]
    fn approval_accept_reject_events_are_visible_in_timeline() {
        let state = reduce_all(vec![
            ev("task.started", serde_json::json!({"id":"t","mode":"Task"})),
            ev(
                "approval.requested",
                serde_json::json!({"id":"ap1","taskRunId":"t","kind":"deliverable_acceptance"}),
            ),
            ev(
                "approval.accepted",
                serde_json::json!({"id":"ap1","taskRunId":"t","kind":"deliverable_acceptance"}),
            ),
            ev(
                "approval.requested",
                serde_json::json!({"id":"ap2","taskRunId":"t","kind":"deliverable_acceptance"}),
            ),
            ev(
                "approval.rejected",
                serde_json::json!({"id":"ap2","taskRunId":"t","kind":"deliverable_acceptance","decision":"reject"}),
            ),
        ]);

        assert_eq!(state.approval, None);
        assert!(state.timeline.iter().any(|line| line.label == "交付已验收"));
        assert!(state.timeline.iter().any(|line| line.label == "交付已拒绝"));
        assert!(
            state
                .inspect
                .recent_debug
                .iter()
                .any(|line| line.contains("approval.rejected"))
        );
    }

    #[test]
    fn app_state_tracks_focus_and_inspect_as_first_class_state() {
        let mut state = AppState::default();
        let mut ui = UiState::default();
        ui.drawer = Some(FocusPanel::Inspect);
        state.sync_focus(&ui);

        assert_eq!(state.focus, FocusPanel::Inspect);
        assert_eq!(state.inspect.task_status, None);
    }

    #[test]
    fn outcome_checked_pushes_a_verdict_line() {
        let ok = reduce_all(vec![
            ev("task.started", serde_json::json!({"id":"ok","mode":"Task"})),
            ev(
                "artifact.created",
                serde_json::json!({"id":"a1","taskRunId":"ok","path":"/x/roi.md"}),
            ),
            ev(
                "outcome.checked",
                serde_json::json!({"taskRunId":"ok","valid":true,"deliverable":"/x/roi.md"}),
            ),
        ]);
        assert!(
            ok.timeline
                .iter()
                .any(|l| l.status == SYM_OK && l.label.contains("验收"))
        );

        let bad = reduce_all(vec![
            ev(
                "task.started",
                serde_json::json!({"id":"bad","mode":"Task"}),
            ),
            ev(
                "outcome.checked",
                serde_json::json!({"taskRunId":"bad","valid":false,"reason":"无可交付文件"}),
            ),
        ]);
        let line = bad
            .timeline
            .iter()
            .find(|l| l.label.contains("验收"))
            .unwrap();
        assert_eq!(line.status, SYM_WARN);
        assert_eq!(line.detail, "无可交付文件");
    }

    /// AC-TASK-001（v0.9 M2）：连续 Chat 轮完成 → 零条「缺少交付物」，每轮结束回 idle（不进 needs_artifact）。
    #[test]
    fn chat_turns_are_exempt_from_artifact_gate() {
        let state = reduce_all(vec![
            ev(
                "task.started",
                serde_json::json!({"id":"t1","title":"hi","mode":"Chat"}),
            ),
            ev("task.completed", serde_json::json!({"id":"t1"})),
            ev(
                "task.started",
                serde_json::json!({"id":"t2","title":"在吗","mode":"Chat"}),
            ),
            ev("task.completed", serde_json::json!({"id":"t2"})),
            ev(
                "task.started",
                serde_json::json!({"id":"t3","title":"谢谢","mode":"Chat"}),
            ),
            ev("task.completed", serde_json::json!({"id":"t3"})),
        ]);

        assert_eq!(
            state.status, "idle",
            "chat turn should settle to idle, not needs_artifact"
        );
        assert!(
            !state
                .timeline
                .iter()
                .any(|line| line.label.contains("缺少交付物")),
            "chat turns must not spam the missing-artifact warning"
        );
    }

    /// v0.13 M1：timeline 条目携带事件的 ts / 类型名 / 摊平 kv（SESSION 行与 EVENT DETAIL 数据源）。
    #[test]
    fn timeline_entries_carry_ts_event_type_and_flattened_kv() {
        let mut state = AppState::default();
        state.reduce(&TaskEvent::from_parts(
            "task.started",
            1_783_400_000_123,
            serde_json::json!({"id":"t1","title":"研究","mode":"Task"}),
        ));
        state.reduce(&TaskEvent::from_parts(
            "tool.requested",
            1_783_400_005_456,
            serde_json::json!({"id":"tool1","tool":"web_search","label":"搜索"}),
        ));

        let task_hdr = state
            .timeline
            .iter()
            .find(|e| e.event_type == "task.started")
            .expect("task header carries event_type");
        assert_eq!(task_hdr.ts, 1_783_400_000_123, "event ts preserved");
        let tool = state
            .timeline
            .iter()
            .find(|e| e.event_type == "tool.requested")
            .expect("tool entry carries event_type");
        assert_eq!(tool.ts, 1_783_400_005_456);
        assert!(
            tool.detail_kv
                .iter()
                .any(|(k, v)| k == "tool" && v == "web_search"),
            "flattened kv holds tool name: {:?}",
            tool.detail_kv
        );
    }

    /// v0.13 M1：artifact.created 的 bytes 入库（右栏 meta 的 KB 显示源）。
    #[test]
    fn artifact_created_stores_bytes() {
        let state = reduce_all(vec![
            ev("task.started", serde_json::json!({"id":"t","mode":"Task"})),
            ev(
                "artifact.created",
                serde_json::json!({"id":"a1","taskRunId":"t","name":"report.md","kind":"report","path":"/x/report.md","status":"ready","bytes":12_700}),
            ),
        ]);
        assert_eq!(state.artifacts[0].bytes, Some(12_700));
        assert_eq!(state.artifacts[0].task_id.as_deref(), Some("t"));
    }

    /// v0.13 M1：本任务 tokens——引擎 task.completed.usage 优先；缺则会话累计快照差值；
    /// 差值以任务起点为界，不把上一任务的 tokens 记到下一任务头上。
    #[test]
    fn task_meta_tokens_prefer_engine_usage_and_snapshot_delta_scopes_per_task() {
        // 任务 1：无引擎 usage → 快照差值 (100, 50)。
        let mut state = reduce_all(vec![
            ev(
                "task.started",
                serde_json::json!({"id":"t1","title":"一","mode":"Task"}),
            ),
            ev(
                "token.usage",
                serde_json::json!({"prompt":100,"completion":50}),
            ),
            ev("task.completed", serde_json::json!({"id":"t1"})),
        ]);
        let meta1 = state
            .timeline
            .iter()
            .find_map(|e| e.task_meta)
            .expect("task1 meta");
        assert_eq!(meta1.tokens, Some((100, 50)), "snapshot delta fallback");
        assert_eq!(
            meta1.est_cost, None,
            "no engine cost → None (never fabricated)"
        );

        // 任务 2：引擎在 task.completed 里带 usage+est_cost → 覆盖差值（且不含任务 1 的量）。
        state.reduce(&ev(
            "task.started",
            serde_json::json!({"id":"t2","title":"二","mode":"Task"}),
        ));
        state.reduce(&ev(
            "token.usage",
            serde_json::json!({"prompt":7,"completion":3}),
        ));
        state.reduce(&ev(
            "task.completed",
            serde_json::json!({"id":"t2","usage":{"prompt":7,"completion":3},"est_cost":0.042}),
        ));
        let meta2 = state
            .timeline
            .iter()
            .filter_map(|e| e.task_meta)
            .nth(1)
            .expect("task2 meta");
        assert_eq!(
            meta2.tokens,
            Some((7, 3)),
            "engine usage wins and is task-scoped"
        );
        assert_eq!(meta2.est_cost, Some(0.042), "engine est_cost stored");
    }

    /// v0.13 M1：session.ready 带 skills 时入库（M2 引擎透出；旧引擎缺省为空）。
    #[test]
    fn session_ready_stores_employee_skills() {
        let state = reduce_all(vec![ev(
            "session.ready",
            serde_json::json!({"employee":{"name":"鲸","role":"顾问","model":"m","skills":["模型选型","ROI 评估"]}}),
        )]);
        let emp = state.employee.expect("employee");
        assert_eq!(
            emp.skills,
            vec!["模型选型".to_string(), "ROI 评估".to_string()]
        );
    }

    /// v0.17 P2 C1：session.ready 的 `employee.kpi_cumulative`（引擎 kpi.mjs 下发的跨会话真累计）
    /// 必须原样落进 Employee.kpi_cumulative；旧引擎/无此键时全零，不是 panic 也不是伪造非零历史。
    #[test]
    fn session_ready_stores_kpi_cumulative_when_present() {
        let state = reduce_all(vec![ev(
            "session.ready",
            serde_json::json!({"employee":{"name":"鲸","role":"顾问","model":"m",
                "kpi_cumulative":{"tasks":7,"accepted":5,"total_cost":12.5,"first_hired_ts":1700000000000_u64}}}),
        )]);
        let emp = state.employee.expect("employee");
        assert_eq!(emp.kpi_cumulative.tasks, 7);
        assert_eq!(emp.kpi_cumulative.accepted, 5);
        assert_eq!(emp.kpi_cumulative.total_cost, 12.5);
        assert_eq!(emp.kpi_cumulative.first_hired_ts, Some(1700000000000));
    }

    #[test]
    fn session_ready_defaults_kpi_cumulative_to_honest_zeros_when_absent() {
        let state = reduce_all(vec![ev(
            "session.ready",
            serde_json::json!({"employee":{"name":"鲸","role":"顾问","model":"m"}}),
        )]);
        let emp = state.employee.expect("employee");
        assert_eq!(emp.kpi_cumulative, KpiCumulative::default());
    }

    /// v0.18 B2：session.ready 的 employee.eval（eval-runner 落盘、bridge 下发）落进 Employee.eval；
    /// 缺键/null（从未评测）→ None，EVAL 屏据此显示空态，不伪造分数。
    #[test]
    fn session_ready_parses_eval_report_and_defaults_none_when_absent() {
        let with = reduce_all(vec![ev(
            "session.ready",
            serde_json::json!({"employee":{"name":"鲸","role":"顾问","model":"m",
                "eval":{"score":84,"verdict":"PASS","model":"anthropic/claude-opus-4.8","mock":false,
                    "evaluated_at":1_700_000_000_000_u64,
                    "exams":[{"id":"research-seed-2.1","score":84,"passed":true}]}}}),
        )]);
        let rep = with.employee.expect("employee").eval.expect("eval report");
        assert_eq!(rep.score, 84);
        assert_eq!(rep.verdict, "PASS");
        assert!(!rep.mock);
        assert!(
            rep.certified,
            "validated session.ready is the trust handoff"
        );
        assert_eq!(rep.exams.len(), 1);
        assert_eq!(rep.exams[0].id, "research-seed-2.1");
        assert!(rep.exams[0].passed);

        let without = reduce_all(vec![ev(
            "session.ready",
            serde_json::json!({"employee":{"name":"鲸","role":"顾问","model":"m"}}),
        )]);
        assert!(
            without.employee.expect("employee").eval.is_none(),
            "no eval key → None, not fabricated"
        );

        let nulled = reduce_all(vec![ev(
            "session.ready",
            serde_json::json!({"employee":{"name":"鲸","role":"顾问","model":"m","eval":null}}),
        )]);
        assert!(
            nulled.employee.expect("employee").eval.is_none(),
            "explicit null → None"
        );
    }

    /// v0.11 M3：一次带工具的任务完结 → 任务头 timeline 条挂上 TaskMeta（按引擎真实工具名归类），
    /// 记录耗时与活动计数；纯 chat 轮不产生计数。
    #[test]
    fn task_meta_records_activity_counts_by_real_tool_names() {
        let state = reduce_all(vec![
            ev(
                "task.started",
                serde_json::json!({"id":"t","title":"研究","mode":"Task"}),
            ),
            ev(
                "tool.requested",
                serde_json::json!({"id":"a","tool":"read_file","label":"读取"}),
            ),
            ev(
                "tool.requested",
                serde_json::json!({"id":"b","tool":"read_file","label":"读取"}),
            ),
            ev(
                "tool.requested",
                serde_json::json!({"id":"c","tool":"web_search","label":"搜索"}),
            ),
            ev(
                "tool.requested",
                serde_json::json!({"id":"d","tool":"web_fetch","label":"抓取"}),
            ),
            ev(
                "tool.requested",
                serde_json::json!({"id":"e","tool":"bash","label":"命令"}),
            ),
            ev(
                "tool.requested",
                serde_json::json!({"id":"f","tool":"write_file","label":"写"}),
            ),
            ev(
                "tool.requested",
                serde_json::json!({"id":"g","tool":"artifact.write","label":"交付"}),
            ),
            ev("task.completed", serde_json::json!({"id":"t"})),
        ]);

        let meta = state
            .timeline
            .iter()
            .find_map(|e| e.task_meta.as_ref())
            .expect("task header carries frozen TaskMeta on completion");
        assert_eq!(meta.counts.read, 2, "two read_file");
        assert_eq!(meta.counts.web_search, 1);
        assert_eq!(meta.counts.web_fetch, 1);
        assert_eq!(meta.counts.command, 1, "bash → command");
        assert_eq!(
            meta.counts.created, 2,
            "write_file + artifact.write → created"
        );
        assert_eq!(meta.counts.total(), 7);
    }

    /// v0.11 M4：多条 thinking.delta 累加成本轮一个可折叠「思考」块（默认折叠），与交付正文分离。
    #[test]
    fn thinking_deltas_accumulate_into_one_collapsible_block() {
        let state = reduce_all(vec![
            ev(
                "task.started",
                serde_json::json!({"id":"t","title":"分析","mode":"Chat"}),
            ),
            ev("thinking.delta", serde_json::json!({"text":"先拆解需求，"})),
            ev("thinking.delta", serde_json::json!({"text":"再决定检索。"})),
            ev("token.delta", serde_json::json!({"text":"这是回答。"})),
            ev("task.completed", serde_json::json!({"id":"t"})),
        ]);
        let think: Vec<&TimelineEntry> = state
            .timeline
            .iter()
            .filter(|e| e.label == "思考")
            .collect();
        assert_eq!(think.len(), 1, "one thinking block per turn");
        assert!(think[0].collapsible, "thinking block is foldable");
        assert!(!think[0].expanded, "folded by default");
        assert_eq!(
            think[0].detail, "先拆解需求，再决定检索。",
            "deltas accumulate"
        );
        // 思考不进交付正文（answer 只含 token.delta）。
        assert_eq!(
            state.answer, "这是回答。",
            "thinking is separate from deliverable prose"
        );
    }

    #[test]
    fn chat_turn_produces_no_activity_counts() {
        // 纯 chat（无工具）→ task_meta 计数为 0，渲染层据此不画计数条。
        let state = reduce_all(vec![
            ev(
                "task.started",
                serde_json::json!({"id":"c","title":"你好","mode":"Chat"}),
            ),
            ev("token.delta", serde_json::json!({"text":"你好呀"})),
            ev("task.completed", serde_json::json!({"id":"c"})),
        ]);
        let total: u32 = state
            .timeline
            .iter()
            .filter_map(|e| e.task_meta.as_ref())
            .map(|m| m.counts.total())
            .sum();
        assert_eq!(total, 0, "chat turn has no tool activity");
    }

    #[test]
    fn completed_task_without_artifact_is_not_done() {
        // v0.9 M2：正式任务态（非 Chat）才受 artifact 门禁约束。真实流程里 task.started 后会
        // task.upgraded_from_chat 把 mode 切出 Chat；这里用 mode:"Task" 显式模拟同一前提。
        let state = reduce_all(vec![
            ev(
                "task.started",
                serde_json::json!({"id":"t","title":"ROI 示例","mode":"Task"}),
            ),
            ev("task.completed", serde_json::json!({"id":"t"})),
        ]);

        assert_eq!(state.status, "needs_artifact");
        assert_eq!(state.task.as_ref().unwrap().status, "needs_artifact");
        assert!(
            state
                .timeline
                .iter()
                .any(|line| { line.status == SYM_WARN && line.label.contains("缺少交付物") })
        );
    }

    #[test]
    fn prior_task_artifact_does_not_complete_current_task() {
        let state = reduce_all(vec![
            ev(
                "task.started",
                serde_json::json!({"id":"old","title":"上一轮","mode":"Task"}),
            ),
            ev(
                "artifact.created",
                serde_json::json!({"id":"old-art","taskRunId":"old","name":"old.md","path":"/tmp/old.md"}),
            ),
            ev("task.completed", serde_json::json!({"id":"old"})),
            ev(
                "task.started",
                serde_json::json!({"id":"new","title":"新任务","mode":"Task"}),
            ),
            ev("task.completed", serde_json::json!({"id":"new"})),
        ]);

        assert_eq!(state.status, "needs_artifact");
        assert_eq!(state.task.as_ref().unwrap().id.as_deref(), Some("new"));
        assert_eq!(state.task.as_ref().unwrap().status, "needs_artifact");
        assert_eq!(
            state
                .timeline
                .iter()
                .filter(|line| line.status == SYM_WARN && line.label.contains("缺少交付物"))
                .count(),
            1
        );
    }

    #[test]
    fn formal_critical_events_require_current_task_correlation() {
        let state = reduce_all(vec![
            ev(
                "task.started",
                serde_json::json!({"id":"current","mode":"Task"}),
            ),
            ev(
                "task.mode_changed",
                serde_json::json!({"taskRunId":"old","mode":"Chat"}),
            ),
            ev(
                "task.upgraded_from_chat",
                serde_json::json!({"reason":"missing id"}),
            ),
            ev(
                "artifact.created",
                serde_json::json!({"id":"missing","path":"/tmp/missing.md"}),
            ),
            ev(
                "outcome.checked",
                serde_json::json!({"valid":true,"deliverable":"/tmp/missing.md"}),
            ),
            ev("task.completed", serde_json::json!({})),
            ev(
                "task.blocked",
                serde_json::json!({"id":"old","reason":"stale"}),
            ),
        ]);

        assert_eq!(state.task.as_ref().unwrap().status, "running");
        assert_eq!(state.mode, "Task");
        assert!(state.artifacts.is_empty());
        assert_eq!(state.current_task_outcome, None);
        assert!(
            state
                .debug
                .iter()
                .filter(|line| line.contains("ignored"))
                .count()
                >= 6
        );
    }

    #[test]
    fn explicit_terminal_events_are_monotonic_and_idempotent() {
        let state = reduce_all(vec![
            ev("task.started", serde_json::json!({"id":"t","mode":"Task"})),
            ev(
                "task.blocked",
                serde_json::json!({"id":"t","reason":"缺权限"}),
            ),
            ev(
                "task.blocked",
                serde_json::json!({"id":"t","reason":"重复"}),
            ),
            ev(
                "task.failed",
                serde_json::json!({"id":"t","reason":"冲突失败"}),
            ),
            ev("task.completed", serde_json::json!({"id":"t"})),
        ]);

        assert_eq!(state.status, "blocked");
        assert_eq!(state.current_task_terminal, Some("task.blocked"));
        assert_eq!(
            state
                .timeline
                .iter()
                .filter(|line| line.label == "任务阻塞")
                .count(),
            1
        );
        assert!(
            state
                .debug
                .iter()
                .any(|line| line.contains("conflicting task.failed"))
        );
    }

    #[test]
    fn approval_settlement_matches_id_kind_task_and_deduplicates_kpi() {
        let state = reduce_all(vec![
            ev("task.started", serde_json::json!({"id":"t","mode":"Task"})),
            ev(
                "approval.requested",
                serde_json::json!({"id":"ap1","taskRunId":"t","kind":"deliverable_acceptance"}),
            ),
            ev(
                "approval.accepted",
                serde_json::json!({"id":"wrong","taskRunId":"t","kind":"deliverable_acceptance"}),
            ),
            ev(
                "approval.accepted",
                serde_json::json!({"id":"ap1","taskRunId":"t","kind":"deliverable_acceptance"}),
            ),
            ev(
                "approval.accepted",
                serde_json::json!({"id":"ap1","taskRunId":"t","kind":"deliverable_acceptance"}),
            ),
        ]);

        assert_eq!(state.accepted_count, 1);
        assert_eq!(state.approval, None);
        assert_eq!(
            state
                .timeline
                .iter()
                .filter(|line| line.label == "交付已验收")
                .count(),
            1
        );
        assert!(state.debug.iter().any(|line| line.contains("wrong")));
    }

    #[test]
    fn terminal_correlation_and_late_approval_fail_closed() {
        let state = reduce_all(vec![
            ev("task.started", serde_json::json!({"id":"t","mode":"Task"})),
            ev(
                "task.failed",
                serde_json::json!({"id":"t","taskRunId":"other","reason":"wrong task"}),
            ),
            ev(
                "approval.requested",
                serde_json::json!({"id":"ap1","taskRunId":"t","kind":"deliverable_acceptance"}),
            ),
            ev(
                "task.failed",
                serde_json::json!({"id":"t","taskRunId":"t","reason":"runtime crashed"}),
            ),
            ev(
                "approval.accepted",
                serde_json::json!({"id":"ap1","taskRunId":"t","kind":"deliverable_acceptance"}),
            ),
        ]);

        assert_eq!(state.status, "failed");
        assert_eq!(state.current_task_terminal, Some("task.failed"));
        assert_eq!(state.accepted_count, 0);
        assert_eq!(state.approval, None);
        assert!(
            state
                .debug
                .iter()
                .any(|line| line.contains("ignored stale or uncorrelated task.failed"))
        );
        assert!(
            state
                .debug
                .iter()
                .any(|line| line.contains("approval.accepted after task terminal"))
        );
    }

    #[test]
    fn failed_and_revision_needed_remain_distinct_terminal_states() {
        let failed = reduce_all(vec![
            ev(
                "task.started",
                serde_json::json!({"id":"failed","mode":"Task"}),
            ),
            ev(
                "task.failed",
                serde_json::json!({"taskRunId":"failed","reason":"runtime crashed"}),
            ),
        ]);
        assert_eq!(failed.status, "failed");
        assert_eq!(failed.current_task_terminal, Some("task.failed"));

        let revision = reduce_all(vec![
            ev(
                "task.started",
                serde_json::json!({"id":"revision","mode":"Task"}),
            ),
            ev(
                "task.revision_needed",
                serde_json::json!({"id":"revision","reason":"补充来源"}),
            ),
        ]);
        assert_eq!(revision.status, "needs_revision");
        assert_eq!(revision.current_task_terminal, Some("task.revision_needed"));
    }

    #[test]
    fn workspace_reveal_available_false_is_not_rendered_as_success() {
        let state = reduce_all(vec![ev(
            "workspace.revealed",
            serde_json::json!({"path":"/tmp/report.md","available":false}),
        )]);
        let line = state.timeline.last().expect("workspace reveal line");
        assert_eq!(line.status, SYM_WARN);
        assert!(line.label.contains("无法打开"));
    }

    #[test]
    fn quick_utility_reduces_without_task_run_state() {
        let state = reduce_all(vec![ev(
            "quick.utility",
            serde_json::json!({
                "intent":"北京天气",
                "result":{"temperature":"21C"},
                "source":"weather",
                "status":"done"
            }),
        )]);

        let utility = state.quick_utility.as_ref().unwrap();
        assert_eq!(utility.intent.as_deref(), Some("北京天气"));
        assert_eq!(utility.source.as_deref(), Some("weather"));
        assert_eq!(utility.status.as_deref(), Some("done"));
        assert_eq!(utility.result.as_ref().unwrap()["temperature"], "21C");
        assert_eq!(state.task, None);
        assert!(state.timeline.is_empty());
    }

    #[test]
    fn task_event_deserializes_known_and_unknown_wire_shapes() {
        let event: TaskEvent =
            serde_json::from_str(r#"{"type":"token.delta","ts":1719,"data":{"text":"hello"}}"#)
                .expect("known event");
        assert_eq!(event.event_type(), "token.delta");
        assert_eq!(string_field(event.data(), "text").as_deref(), Some("hello"));

        let unknown: TaskEvent =
            serde_json::from_str(r#"{"type":"new.future_event","ts":1719,"data":{"x":1}}"#)
                .expect("unknown event");
        assert_eq!(unknown.event_type(), "unknown");
    }

    #[test]
    fn ui_state_cycles_drawer_pages_and_scrolls() {
        let mut ui = UiState::default();
        assert_eq!(ui.drawer, None);

        ui.toggle_drawer();
        assert_eq!(ui.drawer, Some(FocusPanel::Tasks));

        ui.drawer_next();
        assert_eq!(ui.drawer, Some(FocusPanel::Timeline));
        ui.drawer_next();
        assert_eq!(ui.drawer, Some(FocusPanel::Artifacts));
        ui.drawer_next();
        assert_eq!(ui.drawer, Some(FocusPanel::Tools));
        ui.drawer_next();
        assert_eq!(ui.drawer, Some(FocusPanel::Inspect));
        ui.drawer_next();
        assert_eq!(ui.drawer, Some(FocusPanel::Tasks));

        ui.drawer_prev();
        assert_eq!(ui.drawer, Some(FocusPanel::Inspect));

        ui.scroll_drawer(1);
        assert_eq!(ui.drawer_scroll_for(FocusPanel::Inspect), 1);
        ui.scroll_drawer(-9);
        assert_eq!(ui.drawer_scroll_for(FocusPanel::Inspect), 0);
    }

    #[test]
    fn drawer_pages_map_to_keyboard_numbers() {
        let mut ui = UiState::default();

        assert!(!ui.set_drawer_page_by_number('1'));

        ui.toggle_drawer();
        assert!(ui.set_drawer_page_by_number('1'));
        assert_eq!(ui.drawer, Some(FocusPanel::Timeline));

        assert!(ui.set_drawer_page_by_number('4'));
        assert_eq!(ui.drawer, Some(FocusPanel::Inspect));

        assert!(!ui.set_drawer_page_by_number('9'));
    }

    #[test]
    fn records_user_and_assistant_in_order() {
        let mut state = AppState::default();
        state.push_user_message("hi".to_string());
        state.reduce(&ev("token.delta", serde_json::json!({"text":"答"})));

        assert_eq!(
            state.conversation,
            vec![
                ConversationItem::User("hi".to_string()),
                ConversationItem::Assistant("答".to_string()),
            ]
        );
    }

    #[test]
    fn token_delta_appends_to_last_assistant() {
        let mut state = AppState::default();
        state.reduce(&ev("token.delta", serde_json::json!({"text":"你"})));
        state.reduce(&ev("token.delta", serde_json::json!({"text":"好"})));

        assert_eq!(
            state.conversation,
            vec![ConversationItem::Assistant("你好".to_string())]
        );
    }

    #[test]
    fn timeline_event_references_index() {
        let mut state = AppState::default();
        state.reduce(&ev(
            "task.started",
            serde_json::json!({"id":"t","title":"x"}),
        ));

        let idx = state.timeline.len() - 1;
        assert!(state.conversation.contains(&ConversationItem::Event(idx)));
    }
}
