use std::sync::OnceLock;

use serde::{Deserialize, Serialize};
use serde_json::Value;

static UNKNOWN_DATA: OnceLock<Value> = OnceLock::new();

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(tag = "type")]
pub enum TaskEvent {
    #[serde(rename = "session.ready")]
    SessionReady {
        #[serde(default)]
        ts: u64,
        #[serde(default)]
        data: Value,
    },
    #[serde(rename = "task.started")]
    TaskStarted {
        #[serde(default)]
        ts: u64,
        #[serde(default)]
        data: Value,
    },
    #[serde(rename = "task.mode_changed")]
    TaskModeChanged {
        #[serde(default)]
        ts: u64,
        #[serde(default)]
        data: Value,
    },
    #[serde(rename = "plan.created")]
    PlanCreated {
        #[serde(default)]
        ts: u64,
        #[serde(default)]
        data: Value,
    },
    #[serde(rename = "plan.approved")]
    PlanApproved {
        #[serde(default)]
        ts: u64,
        #[serde(default)]
        data: Value,
    },
    #[serde(rename = "step.started")]
    StepStarted {
        #[serde(default)]
        ts: u64,
        #[serde(default)]
        data: Value,
    },
    #[serde(rename = "step.completed")]
    StepCompleted {
        #[serde(default)]
        ts: u64,
        #[serde(default)]
        data: Value,
    },
    #[serde(rename = "tool.requested")]
    ToolRequested {
        #[serde(default)]
        ts: u64,
        #[serde(default)]
        data: Value,
    },
    #[serde(rename = "tool.called")]
    ToolCalled {
        #[serde(default)]
        ts: u64,
        #[serde(default)]
        data: Value,
    },
    #[serde(rename = "tool.succeeded")]
    ToolSucceeded {
        #[serde(default)]
        ts: u64,
        #[serde(default)]
        data: Value,
    },
    #[serde(rename = "tool.failed")]
    ToolFailed {
        #[serde(default)]
        ts: u64,
        #[serde(default)]
        data: Value,
    },
    #[serde(rename = "tool.blocked")]
    ToolBlocked {
        #[serde(default)]
        ts: u64,
        #[serde(default)]
        data: Value,
    },
    #[serde(rename = "artifact.created")]
    ArtifactCreated {
        #[serde(default)]
        ts: u64,
        #[serde(default)]
        data: Value,
    },
    #[serde(rename = "artifact.updated")]
    ArtifactUpdated {
        #[serde(default)]
        ts: u64,
        #[serde(default)]
        data: Value,
    },
    #[serde(rename = "artifact.selected")]
    ArtifactSelected {
        #[serde(default)]
        ts: u64,
        #[serde(default)]
        data: Value,
    },
    #[serde(rename = "artifact.deleted")]
    ArtifactDeleted {
        #[serde(default)]
        ts: u64,
        #[serde(default)]
        data: Value,
    },
    #[serde(rename = "artifact.revealed")]
    ArtifactRevealed {
        #[serde(default)]
        ts: u64,
        #[serde(default)]
        data: Value,
    },
    #[serde(rename = "evidence.created")]
    EvidenceCreated {
        #[serde(default)]
        ts: u64,
        #[serde(default)]
        data: Value,
    },
    #[serde(rename = "approval.required")]
    ApprovalRequired {
        #[serde(default)]
        ts: u64,
        #[serde(default)]
        data: Value,
    },
    #[serde(rename = "approval.requested")]
    ApprovalRequested {
        #[serde(default)]
        ts: u64,
        #[serde(default)]
        data: Value,
    },
    #[serde(rename = "approval.resolved")]
    ApprovalResolved {
        #[serde(default)]
        ts: u64,
        #[serde(default)]
        data: Value,
    },
    #[serde(rename = "approval.accepted")]
    ApprovalAccepted {
        #[serde(default)]
        ts: u64,
        #[serde(default)]
        data: Value,
    },
    #[serde(rename = "approval.rejected")]
    ApprovalRejected {
        #[serde(default)]
        ts: u64,
        #[serde(default)]
        data: Value,
    },
    #[serde(rename = "assistant.message")]
    AssistantMessage {
        #[serde(default)]
        ts: u64,
        #[serde(default)]
        data: Value,
    },
    #[serde(rename = "assistant.rendered")]
    AssistantRendered {
        #[serde(default)]
        ts: u64,
        #[serde(default)]
        data: Value,
    },
    #[serde(rename = "command.output")]
    CommandOutput {
        #[serde(default)]
        ts: u64,
        #[serde(default)]
        data: Value,
    },
    #[serde(rename = "token.delta")]
    TokenDelta {
        #[serde(default)]
        ts: u64,
        #[serde(default)]
        data: Value,
    },
    /// v0.11 M4：模型推理增量（真·思考）。前端收进可折叠「思考」块，与交付正文分离。
    #[serde(rename = "thinking.delta")]
    ThinkingDelta {
        #[serde(default)]
        ts: u64,
        #[serde(default)]
        data: Value,
    },
    #[serde(rename = "token.usage")]
    TokenUsage {
        #[serde(default)]
        ts: u64,
        #[serde(default)]
        data: Value,
    },
    #[serde(rename = "task.completed")]
    TaskCompleted {
        #[serde(default)]
        ts: u64,
        #[serde(default)]
        data: Value,
    },
    #[serde(rename = "task.rejected")]
    TaskRejected {
        #[serde(default)]
        ts: u64,
        #[serde(default)]
        data: Value,
    },
    #[serde(rename = "task.blocked")]
    TaskBlocked {
        #[serde(default)]
        ts: u64,
        #[serde(default)]
        data: Value,
    },
    #[serde(rename = "task.upgraded_from_chat")]
    TaskUpgradedFromChat {
        #[serde(default)]
        ts: u64,
        #[serde(default)]
        data: Value,
    },
    #[serde(rename = "skill.launched")]
    SkillLaunched {
        #[serde(default)]
        ts: u64,
        #[serde(default)]
        data: Value,
    },
    #[serde(rename = "tool.preflight_checked")]
    ToolPreflightChecked {
        #[serde(default)]
        ts: u64,
        #[serde(default)]
        data: Value,
    },
    #[serde(rename = "source.checked")]
    SourceChecked {
        #[serde(default)]
        ts: u64,
        #[serde(default)]
        data: Value,
    },
    #[serde(rename = "pending.actions")]
    PendingActions {
        #[serde(default)]
        ts: u64,
        #[serde(default)]
        data: Value,
    },
    #[serde(rename = "quick.utility")]
    QuickUtility {
        #[serde(default)]
        ts: u64,
        #[serde(default)]
        data: Value,
    },
    #[serde(rename = "memory.state")]
    MemoryState {
        #[serde(default)]
        ts: u64,
        #[serde(default)]
        data: Value,
    },
    #[serde(rename = "memory.requested")]
    MemoryRequested {
        #[serde(default)]
        ts: u64,
        #[serde(default)]
        data: Value,
    },
    #[serde(rename = "memory.saved")]
    MemorySaved {
        #[serde(default)]
        ts: u64,
        #[serde(default)]
        data: Value,
    },
    #[serde(rename = "workspace.revealed")]
    WorkspaceRevealed {
        #[serde(default)]
        ts: u64,
        #[serde(default)]
        data: Value,
    },
    #[serde(rename = "outcome.checked")]
    OutcomeChecked {
        #[serde(default)]
        ts: u64,
        #[serde(default)]
        data: Value,
    },
    #[serde(rename = "debug.line")]
    DebugLine {
        #[serde(default)]
        ts: u64,
        #[serde(default)]
        data: Value,
    },
    #[serde(other)]
    Unknown,
}

#[derive(Clone, Debug, Deserialize, Serialize, Eq, PartialEq)]
pub struct ResolvedReference {
    pub kind: String,
    pub id: String,
    pub label: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub struct UserAction {
    #[serde(rename = "type")]
    pub action_type: String,
    #[serde(default)]
    pub data: Value,
}

impl UserAction {
    pub fn user_message(text: String, refs: Vec<ResolvedReference>) -> Self {
        Self {
            action_type: "user.message".to_string(),
            data: serde_json::json!({ "text": text, "refs": refs }),
        }
    }

    /// v0.8 M6：带结构化 parts 的 user.message（文件/图片附件）。parts 为空时等价于 user_message
    /// （不写 parts 字段，保持线上形状与老前端一致）。
    pub fn user_message_with_parts(
        text: String,
        refs: Vec<ResolvedReference>,
        parts: Vec<Value>,
    ) -> Self {
        let mut data = serde_json::json!({ "text": text, "refs": refs });
        if !parts.is_empty() {
            data["parts"] = Value::Array(parts);
        }
        Self {
            action_type: "user.message".to_string(),
            data,
        }
    }

    pub fn pending_run(key: String, command: Option<String>) -> Self {
        let mut data = serde_json::json!({ "key": key });
        if let Some(command) = command {
            data["command"] = Value::String(command);
        }
        Self {
            action_type: "pending.run".to_string(),
            data,
        }
    }

    pub fn artifact(action_type: &str, artifact_id: String) -> Self {
        Self {
            action_type: action_type.to_string(),
            data: serde_json::json!({ "artifact_id": artifact_id }),
        }
    }

    pub fn approval_resolve(id: String, decision: String) -> Self {
        Self {
            action_type: "approval.resolve".to_string(),
            data: serde_json::json!({ "id": id, "decision": decision }),
        }
    }
}

impl TaskEvent {
    pub fn from_parts(event_type: &str, ts: u64, data: Value) -> Self {
        match event_type {
            "session.ready" => Self::SessionReady { ts, data },
            "task.started" => Self::TaskStarted { ts, data },
            "task.mode_changed" => Self::TaskModeChanged { ts, data },
            "plan.created" => Self::PlanCreated { ts, data },
            "plan.approved" => Self::PlanApproved { ts, data },
            "step.started" => Self::StepStarted { ts, data },
            "step.completed" => Self::StepCompleted { ts, data },
            "tool.requested" => Self::ToolRequested { ts, data },
            "tool.called" => Self::ToolCalled { ts, data },
            "tool.succeeded" => Self::ToolSucceeded { ts, data },
            "tool.failed" => Self::ToolFailed { ts, data },
            "tool.blocked" => Self::ToolBlocked { ts, data },
            "artifact.created" => Self::ArtifactCreated { ts, data },
            "artifact.updated" => Self::ArtifactUpdated { ts, data },
            "artifact.selected" => Self::ArtifactSelected { ts, data },
            "artifact.deleted" => Self::ArtifactDeleted { ts, data },
            "artifact.revealed" => Self::ArtifactRevealed { ts, data },
            "evidence.created" => Self::EvidenceCreated { ts, data },
            "approval.required" => Self::ApprovalRequired { ts, data },
            "approval.requested" => Self::ApprovalRequested { ts, data },
            "approval.resolved" => Self::ApprovalResolved { ts, data },
            "approval.accepted" => Self::ApprovalAccepted { ts, data },
            "approval.rejected" => Self::ApprovalRejected { ts, data },
            "assistant.message" => Self::AssistantMessage { ts, data },
            "assistant.rendered" => Self::AssistantRendered { ts, data },
            "command.output" => Self::CommandOutput { ts, data },
            "token.delta" => Self::TokenDelta { ts, data },
            "thinking.delta" => Self::ThinkingDelta { ts, data },
            "token.usage" => Self::TokenUsage { ts, data },
            "task.completed" => Self::TaskCompleted { ts, data },
            "task.rejected" => Self::TaskRejected { ts, data },
            "task.blocked" => Self::TaskBlocked { ts, data },
            "task.upgraded_from_chat" => Self::TaskUpgradedFromChat { ts, data },
            "skill.launched" => Self::SkillLaunched { ts, data },
            "tool.preflight_checked" => Self::ToolPreflightChecked { ts, data },
            "source.checked" => Self::SourceChecked { ts, data },
            "pending.actions" => Self::PendingActions { ts, data },
            "quick.utility" => Self::QuickUtility { ts, data },
            "memory.state" => Self::MemoryState { ts, data },
            "memory.requested" => Self::MemoryRequested { ts, data },
            "memory.saved" => Self::MemorySaved { ts, data },
            "workspace.revealed" => Self::WorkspaceRevealed { ts, data },
            "outcome.checked" => Self::OutcomeChecked { ts, data },
            "debug.line" => Self::DebugLine { ts, data },
            _ => Self::Unknown,
        }
    }

    pub fn event_type(&self) -> &'static str {
        match self {
            Self::SessionReady { .. } => "session.ready",
            Self::TaskStarted { .. } => "task.started",
            Self::TaskModeChanged { .. } => "task.mode_changed",
            Self::PlanCreated { .. } => "plan.created",
            Self::PlanApproved { .. } => "plan.approved",
            Self::StepStarted { .. } => "step.started",
            Self::StepCompleted { .. } => "step.completed",
            Self::ToolRequested { .. } => "tool.requested",
            Self::ToolCalled { .. } => "tool.called",
            Self::ToolSucceeded { .. } => "tool.succeeded",
            Self::ToolFailed { .. } => "tool.failed",
            Self::ToolBlocked { .. } => "tool.blocked",
            Self::ArtifactCreated { .. } => "artifact.created",
            Self::ArtifactUpdated { .. } => "artifact.updated",
            Self::ArtifactSelected { .. } => "artifact.selected",
            Self::ArtifactDeleted { .. } => "artifact.deleted",
            Self::ArtifactRevealed { .. } => "artifact.revealed",
            Self::EvidenceCreated { .. } => "evidence.created",
            Self::ApprovalRequired { .. } => "approval.required",
            Self::ApprovalRequested { .. } => "approval.requested",
            Self::ApprovalResolved { .. } => "approval.resolved",
            Self::ApprovalAccepted { .. } => "approval.accepted",
            Self::ApprovalRejected { .. } => "approval.rejected",
            Self::AssistantMessage { .. } => "assistant.message",
            Self::AssistantRendered { .. } => "assistant.rendered",
            Self::CommandOutput { .. } => "command.output",
            Self::TokenDelta { .. } => "token.delta",
            Self::ThinkingDelta { .. } => "thinking.delta",
            Self::TokenUsage { .. } => "token.usage",
            Self::TaskCompleted { .. } => "task.completed",
            Self::TaskRejected { .. } => "task.rejected",
            Self::TaskBlocked { .. } => "task.blocked",
            Self::TaskUpgradedFromChat { .. } => "task.upgraded_from_chat",
            Self::SkillLaunched { .. } => "skill.launched",
            Self::ToolPreflightChecked { .. } => "tool.preflight_checked",
            Self::SourceChecked { .. } => "source.checked",
            Self::PendingActions { .. } => "pending.actions",
            Self::QuickUtility { .. } => "quick.utility",
            Self::MemoryState { .. } => "memory.state",
            Self::MemoryRequested { .. } => "memory.requested",
            Self::MemorySaved { .. } => "memory.saved",
            Self::WorkspaceRevealed { .. } => "workspace.revealed",
            Self::OutcomeChecked { .. } => "outcome.checked",
            Self::DebugLine { .. } => "debug.line",
            Self::Unknown => "unknown",
        }
    }

    pub fn data(&self) -> &Value {
        match self {
            Self::SessionReady { data, .. }
            | Self::TaskStarted { data, .. }
            | Self::TaskModeChanged { data, .. }
            | Self::PlanCreated { data, .. }
            | Self::PlanApproved { data, .. }
            | Self::StepStarted { data, .. }
            | Self::StepCompleted { data, .. }
            | Self::ToolRequested { data, .. }
            | Self::ToolCalled { data, .. }
            | Self::ToolSucceeded { data, .. }
            | Self::ToolFailed { data, .. }
            | Self::ToolBlocked { data, .. }
            | Self::ArtifactCreated { data, .. }
            | Self::ArtifactUpdated { data, .. }
            | Self::ArtifactSelected { data, .. }
            | Self::ArtifactDeleted { data, .. }
            | Self::ArtifactRevealed { data, .. }
            | Self::EvidenceCreated { data, .. }
            | Self::ApprovalRequired { data, .. }
            | Self::ApprovalRequested { data, .. }
            | Self::ApprovalResolved { data, .. }
            | Self::ApprovalAccepted { data, .. }
            | Self::ApprovalRejected { data, .. }
            | Self::AssistantMessage { data, .. }
            | Self::AssistantRendered { data, .. }
            | Self::CommandOutput { data, .. }
            | Self::TokenDelta { data, .. }
            | Self::ThinkingDelta { data, .. }
            | Self::TokenUsage { data, .. }
            | Self::TaskCompleted { data, .. }
            | Self::TaskRejected { data, .. }
            | Self::TaskBlocked { data, .. }
            | Self::TaskUpgradedFromChat { data, .. }
            | Self::SkillLaunched { data, .. }
            | Self::ToolPreflightChecked { data, .. }
            | Self::SourceChecked { data, .. }
            | Self::PendingActions { data, .. }
            | Self::QuickUtility { data, .. }
            | Self::MemoryState { data, .. }
            | Self::MemoryRequested { data, .. }
            | Self::MemorySaved { data, .. }
            | Self::WorkspaceRevealed { data, .. }
            | Self::OutcomeChecked { data, .. }
            | Self::DebugLine { data, .. } => data,
            Self::Unknown => UNKNOWN_DATA.get_or_init(|| Value::Null),
        }
    }

    /// v0.13 M1：事件时间戳（epoch ms，引擎 makeEvent 恒盖 Date.now()）。Unknown → 0。
    /// SESSION 事件行的 HH:MM 与 EVENT DETAIL 由此取时。
    pub fn ts(&self) -> u64 {
        match self {
            Self::SessionReady { ts, .. }
            | Self::TaskStarted { ts, .. }
            | Self::TaskModeChanged { ts, .. }
            | Self::PlanCreated { ts, .. }
            | Self::PlanApproved { ts, .. }
            | Self::StepStarted { ts, .. }
            | Self::StepCompleted { ts, .. }
            | Self::ToolRequested { ts, .. }
            | Self::ToolCalled { ts, .. }
            | Self::ToolSucceeded { ts, .. }
            | Self::ToolFailed { ts, .. }
            | Self::ToolBlocked { ts, .. }
            | Self::ArtifactCreated { ts, .. }
            | Self::ArtifactUpdated { ts, .. }
            | Self::ArtifactSelected { ts, .. }
            | Self::ArtifactDeleted { ts, .. }
            | Self::ArtifactRevealed { ts, .. }
            | Self::EvidenceCreated { ts, .. }
            | Self::ApprovalRequired { ts, .. }
            | Self::ApprovalRequested { ts, .. }
            | Self::ApprovalResolved { ts, .. }
            | Self::ApprovalAccepted { ts, .. }
            | Self::ApprovalRejected { ts, .. }
            | Self::AssistantMessage { ts, .. }
            | Self::AssistantRendered { ts, .. }
            | Self::CommandOutput { ts, .. }
            | Self::TokenDelta { ts, .. }
            | Self::ThinkingDelta { ts, .. }
            | Self::TokenUsage { ts, .. }
            | Self::TaskCompleted { ts, .. }
            | Self::TaskRejected { ts, .. }
            | Self::TaskBlocked { ts, .. }
            | Self::TaskUpgradedFromChat { ts, .. }
            | Self::SkillLaunched { ts, .. }
            | Self::ToolPreflightChecked { ts, .. }
            | Self::SourceChecked { ts, .. }
            | Self::PendingActions { ts, .. }
            | Self::QuickUtility { ts, .. }
            | Self::MemoryState { ts, .. }
            | Self::MemoryRequested { ts, .. }
            | Self::MemorySaved { ts, .. }
            | Self::WorkspaceRevealed { ts, .. }
            | Self::OutcomeChecked { ts, .. }
            | Self::DebugLine { ts, .. } => *ts,
            Self::Unknown => 0,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn user_action_serializes_structured_workbench_commands() {
        let message = UserAction::user_message(
            "请基于 @artifact:a1 修改".to_string(),
            vec![ResolvedReference {
                kind: "artifact".to_string(),
                id: "a1".to_string(),
                label: "roi_report.md".to_string(),
            }],
        );

        assert_eq!(
            serde_json::to_value(&message).expect("message action"),
            json!({
                "type":"user.message",
                "data":{
                    "text":"请基于 @artifact:a1 修改",
                    "refs":[{"kind":"artifact","id":"a1","label":"roi_report.md"}]
                }
            })
        );

        let pending =
            UserAction::pending_run("1".to_string(), Some("create_roi_sheet".to_string()));
        assert_eq!(
            serde_json::to_value(&pending).expect("pending action"),
            json!({"type":"pending.run","data":{"key":"1","command":"create_roi_sheet"}})
        );

        let artifact = UserAction::artifact("artifact.delete", "a1".to_string());
        assert_eq!(
            serde_json::to_value(&artifact).expect("artifact action"),
            json!({"type":"artifact.delete","data":{"artifact_id":"a1"}})
        );

        let approval = UserAction::approval_resolve("ap1".to_string(), "accept".to_string());
        assert_eq!(
            serde_json::to_value(&approval).expect("approval action"),
            json!({"type":"approval.resolve","data":{"id":"ap1","decision":"accept"}})
        );
    }
}
