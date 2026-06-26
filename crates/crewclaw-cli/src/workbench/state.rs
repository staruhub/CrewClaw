use std::collections::BTreeMap;

use serde_json::Value;

use super::protocol::TaskEvent;

pub const SYM_RUNNING: &str = "→";
pub const SYM_OK: &str = "✓";
pub const SYM_FAIL: &str = "✗";
pub const SYM_WARN: &str = "!";
pub const SYM_WAIT: &str = "?";

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
    pub usage: Usage,
    pub status: String,
    pub debug: Vec<String>,
    pub pending_actions: Vec<Value>,
    pub memory: Memory,
    pub quick_utility: Option<QuickUtility>,
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
pub enum NarrowTab {
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

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct UiState {
    pub focus: FocusPanel,
    pub active_tab: NarrowTab,
    pub overlay: Option<Overlay>,
    pub input_focused: bool,
    pub scroll: ScrollOffsets,
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
            focus: FocusPanel::Tasks,
            active_tab: NarrowTab::Timeline,
            overlay: None,
            input_focused: false,
            scroll: ScrollOffsets::default(),
        }
    }
}

impl UiState {
    pub fn focus_next(&mut self) {
        self.focus = match self.focus {
            FocusPanel::Tasks => FocusPanel::Timeline,
            FocusPanel::Timeline => FocusPanel::Artifacts,
            FocusPanel::Artifacts => FocusPanel::Tools,
            FocusPanel::Tools => FocusPanel::Inspect,
            FocusPanel::Inspect => FocusPanel::Tasks,
        };
        self.sync_tab_to_focus();
    }

    pub fn focus_previous(&mut self) {
        self.focus = match self.focus {
            FocusPanel::Tasks => FocusPanel::Inspect,
            FocusPanel::Timeline => FocusPanel::Tasks,
            FocusPanel::Artifacts => FocusPanel::Timeline,
            FocusPanel::Tools => FocusPanel::Artifacts,
            FocusPanel::Inspect => FocusPanel::Tools,
        };
        self.sync_tab_to_focus();
    }

    pub fn next_tab(&mut self) {
        self.active_tab = match self.active_tab {
            NarrowTab::Timeline => NarrowTab::Artifacts,
            NarrowTab::Artifacts => NarrowTab::Tools,
            NarrowTab::Tools => NarrowTab::Inspect,
            NarrowTab::Inspect => NarrowTab::Timeline,
        };
        self.focus = self.active_tab.focus_panel();
    }

    pub fn previous_tab(&mut self) {
        self.active_tab = match self.active_tab {
            NarrowTab::Timeline => NarrowTab::Inspect,
            NarrowTab::Artifacts => NarrowTab::Timeline,
            NarrowTab::Tools => NarrowTab::Artifacts,
            NarrowTab::Inspect => NarrowTab::Tools,
        };
        self.focus = self.active_tab.focus_panel();
    }

    pub fn set_tab_by_number(&mut self, number: char) -> bool {
        let Some(tab) = NarrowTab::from_number(number) else {
            return false;
        };
        self.active_tab = tab;
        self.focus = tab.focus_panel();
        true
    }

    pub fn scroll_focused(&mut self, delta: i16) {
        let value = self.scroll_for_mut(self.focus);
        if delta.is_negative() {
            *value = value.saturating_sub(delta.unsigned_abs());
        } else {
            *value = value.saturating_add(delta as u16);
        }
    }

    pub fn scroll_for(&self, panel: FocusPanel) -> u16 {
        match panel {
            FocusPanel::Tasks => self.scroll.tasks,
            FocusPanel::Timeline => self.scroll.timeline,
            FocusPanel::Artifacts => self.scroll.artifacts,
            FocusPanel::Tools => self.scroll.tools,
            FocusPanel::Inspect => self.scroll.inspect,
        }
    }

    pub fn close_overlay_or_input(&mut self) -> bool {
        if self.overlay.take().is_some() {
            return true;
        }
        if self.input_focused {
            self.input_focused = false;
            return true;
        }
        false
    }

    fn scroll_for_mut(&mut self, panel: FocusPanel) -> &mut u16 {
        match panel {
            FocusPanel::Tasks => &mut self.scroll.tasks,
            FocusPanel::Timeline => &mut self.scroll.timeline,
            FocusPanel::Artifacts => &mut self.scroll.artifacts,
            FocusPanel::Tools => &mut self.scroll.tools,
            FocusPanel::Inspect => &mut self.scroll.inspect,
        }
    }

    fn sync_tab_to_focus(&mut self) {
        if let Some(tab) = NarrowTab::from_focus(self.focus) {
            self.active_tab = tab;
        }
    }
}

impl NarrowTab {
    pub fn focus_panel(self) -> FocusPanel {
        match self {
            Self::Timeline => FocusPanel::Timeline,
            Self::Artifacts => FocusPanel::Artifacts,
            Self::Tools => FocusPanel::Tools,
            Self::Inspect => FocusPanel::Inspect,
        }
    }

    fn from_focus(focus: FocusPanel) -> Option<Self> {
        match focus {
            FocusPanel::Tasks => None,
            FocusPanel::Timeline => Some(Self::Timeline),
            FocusPanel::Artifacts => Some(Self::Artifacts),
            FocusPanel::Tools => Some(Self::Tools),
            FocusPanel::Inspect => Some(Self::Inspect),
        }
    }

    fn from_number(number: char) -> Option<Self> {
        match number {
            '1' => Some(Self::Timeline),
            '2' => Some(Self::Artifacts),
            '3' => Some(Self::Tools),
            '4' => Some(Self::Inspect),
            _ => None,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Employee {
    pub name: String,
    pub role: String,
    pub model: String,
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

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TimelineEntry {
    pub id: String,
    pub status: String,
    pub label: String,
    pub detail: String,
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
    pub name: Option<String>,
    pub kind: Option<String>,
    pub artifact_type: Option<String>,
    pub path: Option<String>,
    pub status: String,
    pub checks: Vec<String>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Evidence {
    pub id: Option<String>,
    pub fact: Option<String>,
    pub source: Option<String>,
    pub confidence: Option<f64>,
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
            usage: Usage::default(),
            status: "idle".to_string(),
            debug: Vec::new(),
            pending_actions: Vec::new(),
            memory: Memory {
                session: "available".to_string(),
                persistent: "unavailable".to_string(),
                workspace: "unavailable".to_string(),
            },
            quick_utility: None,
        }
    }
}

impl AppState {
    pub fn reduce(&mut self, ev: &TaskEvent) {
        let data = ev.data();
        self.debug.push(format!("{} {}", ev.event_type(), data));

        match ev {
            TaskEvent::SessionReady { .. } => self.reduce_session_ready(data),
            TaskEvent::TaskStarted { .. } => {
                let id = string_field(data, "id");
                let title = string_field(data, "title").unwrap_or_default();
                self.task = Some(Task {
                    id: id.clone(),
                    title: title.clone(),
                    status: "running".to_string(),
                });
                if let Some(mode) = string_field(data, "mode") {
                    self.mode = mode;
                }
                self.status = "running".to_string();
                self.answer.clear();
                let line_id = self.id_for(data);
                self.push(line_id, SYM_RUNNING, format!("任务：{title}"), String::new());
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
                self.mark(Some(&id), SYM_OK, summary);
            }
            TaskEvent::ToolFailed { .. } | TaskEvent::ToolBlocked { .. } => {
                let id = string_field(data, "id").unwrap_or_else(|| self.id_for(data));
                let detail = string_field(data, "code").or_else(|| string_field(data, "error"));
                self.set_tool(
                    &id,
                    ToolPatch {
                        status: Some("failed".to_string()),
                        summary: detail.clone(),
                        ..ToolPatch::default()
                    },
                );
                self.mark(Some(&id), SYM_FAIL, detail);
            }
            TaskEvent::ArtifactCreated { .. } => {
                let kind = string_field(data, "kind").or_else(|| string_field(data, "type"));
                let artifact_type = string_field(data, "type").or_else(|| string_field(data, "kind"));
                let artifact = Artifact {
                    id: string_field(data, "id"),
                    name: string_field(data, "name"),
                    kind,
                    artifact_type,
                    path: string_field(data, "path"),
                    status: string_field(data, "status").unwrap_or_else(|| "draft".to_string()),
                    checks: string_array_field(data, "checks"),
                };
                let label = format!("交付物：{}", artifact.name.clone().unwrap_or_default());
                let detail = artifact.path.clone().unwrap_or_default();
                self.artifacts.push(artifact);
                let line_id = self.id_for(data);
                self.push(line_id, SYM_OK, label, detail);
            }
            TaskEvent::ArtifactUpdated { .. } => {
                if let Some(id) = string_field(data, "id") {
                    if let Some(patch) = data.get("patch").and_then(Value::as_object) {
                        for artifact in &mut self.artifacts {
                            if artifact.id.as_deref() == Some(id.as_str()) {
                                if let Some(name) = patch.get("name").and_then(Value::as_str) {
                                    artifact.name = Some(name.to_string());
                                }
                                if let Some(kind) = patch.get("kind").and_then(Value::as_str) {
                                    artifact.kind = Some(kind.to_string());
                                }
                                if let Some(artifact_type) = patch.get("type").and_then(Value::as_str) {
                                    artifact.artifact_type = Some(artifact_type.to_string());
                                }
                                if let Some(path) = patch.get("path").and_then(Value::as_str) {
                                    artifact.path = Some(path.to_string());
                                }
                                if let Some(status) = patch.get("status").and_then(Value::as_str) {
                                    artifact.status = status.to_string();
                                }
                                if let Some(checks) = patch.get("checks") {
                                    artifact.checks = value_string_array(checks);
                                }
                            }
                        }
                    }
                }
            }
            TaskEvent::EvidenceCreated { .. } => {
                self.evidence.push(Evidence {
                    id: string_field(data, "id"),
                    fact: string_field(data, "fact"),
                    source: string_field(data, "source"),
                    confidence: data.get("confidence").and_then(Value::as_f64),
                });
            }
            TaskEvent::ApprovalRequired { .. } | TaskEvent::ApprovalRequested { .. } => {
                self.approval = Some(Approval {
                    id: string_field(data, "id"),
                    tool: string_field(data, "tool"),
                    reason: string_field(data, "reason"),
                    scope: data.get("scope").cloned(),
                });
                self.status = "awaiting_approval".to_string();
            }
            TaskEvent::ApprovalResolved { .. } => {
                self.approval = None;
                self.status = if self.task.is_some() {
                    "running".to_string()
                } else {
                    "idle".to_string()
                };
            }
            TaskEvent::TokenDelta { .. } => {
                self.answer
                    .push_str(&string_field(data, "text").unwrap_or_default());
                if self.status == "idle" {
                    self.status = "running".to_string();
                }
            }
            TaskEvent::TokenUsage { .. } => {
                self.usage.prompt_tok += u64_field(data, "prompt");
                self.usage.completion_tok += u64_field(data, "completion");
            }
            TaskEvent::TaskCompleted { .. } => {
                if let Some(task) = &mut self.task {
                    task.status = "done".to_string();
                }
                self.status = "done".to_string();
                let line_id = self.id_for(data);
                self.push(line_id, SYM_OK, "完成".to_string(), String::new());
            }
            TaskEvent::TaskRejected { .. } => {
                if let Some(task) = &mut self.task {
                    task.status = "rejected".to_string();
                }
                self.status = "rejected".to_string();
                let reason = string_field(data, "reason").unwrap_or_default();
                let line_id = self.id_for(data);
                self.push(line_id, SYM_FAIL, format!("打回：{reason}"), String::new());
            }
            TaskEvent::TaskUpgradedFromChat { .. } => {
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
                self.push(line_id, SYM_RUNNING, format!("启动技能：{skill}"), String::new());
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
                self.pending_actions = data
                    .get("actions")
                    .and_then(Value::as_array)
                    .cloned()
                    .unwrap_or_default();
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
                }
            }
            TaskEvent::MemoryRequested { .. } => {
                let summary = string_field(data, "summary").unwrap_or_default();
                let line_id = self.id_for(data);
                self.push(line_id, SYM_WAIT, format!("记忆请求：{summary}"), String::new());
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
                let status = if bool_field(data, "ok") == Some(false) {
                    SYM_WARN
                } else {
                    SYM_OK
                };
                let label = if bool_field(data, "ok") == Some(false) {
                    "无法打开,路径已给"
                } else {
                    "打开位置"
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
                let valid = bool_field(data, "valid") != Some(false);
                let status = if valid { SYM_OK } else { SYM_WARN };
                let label = if valid { "验收：可交付" } else { "验收：未达标" };
                let detail = string_field(data, "reason")
                    .or_else(|| string_field(data, "deliverable"))
                    .unwrap_or_default();
                let line_id = self.id_for(data);
                self.push(line_id, status, label.to_string(), detail);
            }
            TaskEvent::Unknown => {}
        }
    }

    fn reduce_session_ready(&mut self, data: &Value) {
        if let Some(employee) = data.get("employee") {
            self.employee = Some(Employee {
                name: string_field(employee, "name").unwrap_or_else(|| "AI 员工".to_string()),
                role: string_field(employee, "role").unwrap_or_else(|| "数字员工".to_string()),
                model: string_field(employee, "model").unwrap_or_else(|| "unknown".to_string()),
            });
            if let Some(mode) = string_field(employee, "mode") {
                self.mode = mode;
            }
        }
    }

    fn reduce_tool_requested(&mut self, data: &Value) {
        let id = string_field(data, "id").unwrap_or_else(|| self.id_for(data));
        let tool = string_field(data, "tool");
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
            self.status = "awaiting_approval".to_string();
        }
        let label = string_field(data, "label")
            .or(tool)
            .unwrap_or_default();
        self.push(
            id,
            if needs_approval { SYM_WAIT } else { SYM_RUNNING },
            label,
            string_field(data, "reason").unwrap_or_default(),
        );
    }

    fn id_for(&self, data: &Value) -> String {
        string_field(data, "id").unwrap_or_else(|| format!("ln{}", self.timeline.len()))
    }

    fn push(&mut self, id: String, status: &str, label: String, detail: String) {
        self.timeline.push(TimelineEntry {
            id,
            status: status.to_string(),
            label,
            detail,
        });
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
            if let Some(detail) = detail {
                if !detail.is_empty() {
                    self.timeline[index].detail = detail;
                }
            }
        }
    }

    fn set_tool(&mut self, id: &str, patch: ToolPatch) {
        let tool = self.tools.entry(id.to_string()).or_insert_with(|| ToolState {
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
    data.get(key).and_then(Value::as_str).map(ToString::to_string)
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
    fn research_turn_reduces_to_timeline_answer_and_tools() {
        let state = reduce_all(vec![
            ev("task.started", serde_json::json!({"id":"task1","title":"调研火山 Seed 2.1","mode":"Trial"})),
            ev("plan.created", serde_json::json!({"id":"plan1","steps":["官方源优先","抽字段","组装报告"]})),
            ev("tool.requested", serde_json::json!({"id":"tool1","tool":"browser.render","reason":"JS 空壳","needsApproval":true})),
            ev("approval.resolved", serde_json::json!({"id":"tool1","decision":"approve"})),
            ev("tool.succeeded", serde_json::json!({"id":"tool1","summary":"读到正文"})),
            ev("evidence.created", serde_json::json!({"id":"ev1","fact":"Seed 2.1 上下文 256k","source":"official","confidence":0.8})),
            ev("token.delta", serde_json::json!({"text":"根据官方文档，"})),
            ev("token.delta", serde_json::json!({"text":"Seed 2.1 适合接入。"})),
            ev("artifact.created", serde_json::json!({"id":"art1","name":"seed-2.1-research.md","type":"report","status":"draft","checks":["≥2 来源"]})),
            ev("token.usage", serde_json::json!({"prompt":1000,"completion":200})),
            ev("task.completed", serde_json::json!({"id":"task1"})),
        ]);

        assert_eq!(state.task.as_ref().unwrap().title, "调研火山 Seed 2.1");
        assert_eq!(state.task.as_ref().unwrap().status, "done");
        assert_eq!(state.mode, "Trial");
        assert_eq!(state.plan.as_ref().unwrap().steps.len(), 3);
        assert_eq!(state.tools.get("tool1").unwrap().status, "ok");
        assert_eq!(state.evidence[0].source.as_deref(), Some("official"));
        assert_eq!(state.artifacts[0].name.as_deref(), Some("seed-2.1-research.md"));
        assert_eq!(state.answer, "根据官方文档，Seed 2.1 适合接入。");
        assert_eq!(state.usage.prompt_tok, 1000);
        assert_eq!(state.usage.completion_tok, 200);
        assert_eq!(state.status, "done");
        assert_eq!(state.approval, None);
        assert!(state.timeline.iter().any(|line| line.label.contains("browser.render") && line.status == SYM_OK));
        assert!(state.timeline.iter().any(|line| line.status == SYM_OK && line.label.contains("完成")));
    }

    #[test]
    fn failed_tool_marks_failed_tool_and_timeline_code() {
        let state = reduce_all(vec![
            ev("task.started", serde_json::json!({"id":"t","title":"x"})),
            ev("tool.requested", serde_json::json!({"id":"srch","tool":"web.search"})),
            ev("tool.failed", serde_json::json!({"id":"srch","code":"missing_key"})),
        ]);

        assert_eq!(state.tools.get("srch").unwrap().status, "failed");
        let line = state.timeline.iter().find(|line| line.id == "srch").unwrap();
        assert_eq!(line.status, SYM_FAIL);
        assert_eq!(line.detail, "missing_key");
    }

    #[test]
    fn v06_events_capture_pending_memory_and_artifact_path() {
        let state = reduce_all(vec![
            ev("task.started", serde_json::json!({"id":"t","title":"ROI 示例"})),
            ev("task.upgraded_from_chat", serde_json::json!({"reason":"需生成报告"})),
            ev("pending.actions", serde_json::json!({"actions":[{"key":"1","label":"看示例"},{"key":"2","label":"改假设"}]})),
            ev("memory.state", serde_json::json!({"memory":{"persistent":"disabled"}})),
            ev("artifact.created", serde_json::json!({"id":"a","name":"roi_report.md","kind":"report","path":"/x/.crewclaw/artifacts/t/roi_report.md"})),
        ]);

        assert_eq!(state.mode, "chat-upgraded");
        assert_eq!(state.pending_actions.len(), 2);
        assert_eq!(state.memory.persistent, "disabled");
        assert_eq!(state.memory.session, "available");
        assert_eq!(state.artifacts[0].path.as_deref(), Some("/x/.crewclaw/artifacts/t/roi_report.md"));
        assert_eq!(state.artifacts[0].kind.as_deref(), Some("report"));
        assert!(state.timeline.iter().any(|line| line.label.contains("升级")));
    }

    #[test]
    fn outcome_checked_pushes_a_verdict_line() {
        let ok = reduce_all(vec![ev(
            "outcome.checked",
            serde_json::json!({"valid":true,"deliverable":"/x/roi.md"}),
        )]);
        assert!(ok.timeline.iter().any(|l| l.status == SYM_OK && l.label.contains("验收")));

        let bad = reduce_all(vec![ev(
            "outcome.checked",
            serde_json::json!({"valid":false,"reason":"无可交付文件"}),
        )]);
        let line = bad.timeline.iter().find(|l| l.label.contains("验收")).unwrap();
        assert_eq!(line.status, SYM_WARN);
        assert_eq!(line.detail, "无可交付文件");
    }

    #[test]
    fn task_event_deserializes_known_and_unknown_wire_shapes() {
        let event: TaskEvent = serde_json::from_str(
            r#"{"type":"token.delta","ts":1719,"data":{"text":"hello"}}"#,
        )
        .expect("known event");
        assert_eq!(event.event_type(), "token.delta");
        assert_eq!(string_field(event.data(), "text").as_deref(), Some("hello"));

        let unknown: TaskEvent = serde_json::from_str(
            r#"{"type":"new.future_event","ts":1719,"data":{"x":1}}"#,
        )
        .expect("unknown event");
        assert_eq!(unknown.event_type(), "unknown");
    }

    #[test]
    fn ui_state_cycles_focus_and_scrolls_active_panel() {
        let mut ui = UiState::default();
        assert_eq!(ui.focus, FocusPanel::Tasks);

        ui.focus_next();
        assert_eq!(ui.focus, FocusPanel::Timeline);
        ui.scroll_focused(3);
        assert_eq!(ui.scroll_for(FocusPanel::Timeline), 3);
        assert_eq!(ui.scroll_for(FocusPanel::Tasks), 0);

        ui.focus_previous();
        assert_eq!(ui.focus, FocusPanel::Tasks);
        ui.scroll_focused(-9);
        assert_eq!(ui.scroll_for(FocusPanel::Tasks), 0);
    }

    #[test]
    fn narrow_tabs_map_to_keyboard_numbers() {
        let mut ui = UiState::default();

        assert!(ui.set_tab_by_number('1'));
        assert_eq!(ui.active_tab, NarrowTab::Timeline);
        assert_eq!(ui.focus, FocusPanel::Timeline);

        assert!(ui.set_tab_by_number('4'));
        assert_eq!(ui.active_tab, NarrowTab::Inspect);
        assert_eq!(ui.focus, FocusPanel::Inspect);

        assert!(!ui.set_tab_by_number('9'));
    }
}
