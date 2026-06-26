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
    #[serde(rename = "token.delta")]
    TokenDelta {
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
    #[serde(other)]
    Unknown,
}

impl TaskEvent {
    pub fn from_parts(event_type: &str, ts: u64, data: Value) -> Self {
        match event_type {
            "session.ready" => Self::SessionReady { ts, data },
            "task.started" => Self::TaskStarted { ts, data },
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
            "evidence.created" => Self::EvidenceCreated { ts, data },
            "approval.required" => Self::ApprovalRequired { ts, data },
            "approval.requested" => Self::ApprovalRequested { ts, data },
            "approval.resolved" => Self::ApprovalResolved { ts, data },
            "token.delta" => Self::TokenDelta { ts, data },
            "token.usage" => Self::TokenUsage { ts, data },
            "task.completed" => Self::TaskCompleted { ts, data },
            "task.rejected" => Self::TaskRejected { ts, data },
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
            _ => Self::Unknown,
        }
    }

    pub fn event_type(&self) -> &'static str {
        match self {
            Self::SessionReady { .. } => "session.ready",
            Self::TaskStarted { .. } => "task.started",
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
            Self::EvidenceCreated { .. } => "evidence.created",
            Self::ApprovalRequired { .. } => "approval.required",
            Self::ApprovalRequested { .. } => "approval.requested",
            Self::ApprovalResolved { .. } => "approval.resolved",
            Self::TokenDelta { .. } => "token.delta",
            Self::TokenUsage { .. } => "token.usage",
            Self::TaskCompleted { .. } => "task.completed",
            Self::TaskRejected { .. } => "task.rejected",
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
            Self::Unknown => "unknown",
        }
    }

    pub fn data(&self) -> &Value {
        match self {
            Self::SessionReady { data, .. }
            | Self::TaskStarted { data, .. }
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
            | Self::EvidenceCreated { data, .. }
            | Self::ApprovalRequired { data, .. }
            | Self::ApprovalRequested { data, .. }
            | Self::ApprovalResolved { data, .. }
            | Self::TokenDelta { data, .. }
            | Self::TokenUsage { data, .. }
            | Self::TaskCompleted { data, .. }
            | Self::TaskRejected { data, .. }
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
            | Self::OutcomeChecked { data, .. } => data,
            Self::Unknown => UNKNOWN_DATA.get_or_init(|| Value::Null),
        }
    }
}
