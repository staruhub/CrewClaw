//! Session-scoped HIRE lifecycle used by the supervision cockpit.
//!
//! The renderer only reads snapshots from this module. All checks are computed from the local
//! registry/manifests/runtime and every durable hire goes through the same owner-locked team store
//! as `crew hire`. No step is marked complete merely because it exists in the design mock.

use std::cell::RefCell;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{OnceLock, RwLock};

use semver::{Version, VersionReq};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CheckStatus {
    Passed,
    Warning,
    Failed,
}

impl CheckStatus {
    pub fn symbol(self) -> &'static str {
        match self {
            Self::Passed => "✓",
            Self::Warning => "△",
            Self::Failed => "✗",
        }
    }

    pub fn blocks_trial(self) -> bool {
        matches!(self, Self::Failed)
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct HireCheck {
    pub name: &'static str,
    pub status: CheckStatus,
    pub detail: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum HireStage {
    Blocked,
    TrialReady,
    Onboarding(usize),
    Active,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct HireFlowSnapshot {
    pub employee_id: String,
    pub checks: Vec<HireCheck>,
    pub stage: HireStage,
    pub workspace_employee_id: Option<String>,
    pub pending_permissions: Vec<String>,
    pub last_error: Option<String>,
}

impl HireFlowSnapshot {
    pub fn trial_ready(&self) -> bool {
        matches!(
            self.stage,
            HireStage::TrialReady | HireStage::Onboarding(_) | HireStage::Active
        ) && self.checks.iter().all(|check| !check.status.blocks_trial())
    }
}

#[derive(Default)]
struct HireFlowStore {
    root: Option<PathBuf>,
    flows: BTreeMap<String, HireFlowSnapshot>,
}

static HIRE_FLOW: OnceLock<RwLock<HireFlowStore>> = OnceLock::new();

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct DreamDiffRow {
    pub op: String,
    pub text: String,
    pub reason: String,
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct DreamUiSnapshot {
    pub dream_id: String,
    pub cycle_id: String,
    pub growth_kind: String,
    pub growth_goal: String,
    pub task_run_id: String,
    pub outcome: String,
    pub state: String,
    pub summary: String,
    pub base_memory_hash: String,
    pub candidate_memory_hash: String,
    pub diff: Vec<DreamDiffRow>,
    pub blockers: Vec<String>,
    pub next_step: String,
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct DreamMorningReport {
    pub dream_id: String,
    pub state: String,
    pub source_created_at: String,
    pub summary: String,
    pub reviewed_count: usize,
    pub added_count: usize,
    pub merged_count: usize,
    pub replaced_count: usize,
    pub dropped_count: usize,
    pub kept_count: usize,
    pub resolved_memory_count: usize,
    pub validation_blocker_count: usize,
    pub skill_retirement_candidate_count: usize,
    pub approved: bool,
    pub activated: bool,
    pub candidate_eval_passed: bool,
}

thread_local! {
    static DREAM_UI: RefCell<Option<DreamUiSnapshot>> = const { RefCell::new(None) };
    static DREAM_MORNING: RefCell<Option<DreamMorningReport>> = const { RefCell::new(None) };
}

pub fn dream_snapshot() -> Option<DreamUiSnapshot> {
    DREAM_UI.with(|store| store.borrow().clone())
}

pub fn dream_morning_report() -> Option<DreamMorningReport> {
    DREAM_MORNING.with(|store| store.borrow().clone())
}

pub fn reset_dream_projection() {
    DREAM_UI.with(|store| *store.borrow_mut() = None);
    DREAM_MORNING.with(|store| *store.borrow_mut() = None);
}

pub fn reduce_dream_event(event: &super::protocol::TaskEvent) {
    if event.event_type() == "session.ready" {
        reset_dream_projection();
        return;
    }
    if !event.event_type().starts_with("dream.") {
        return;
    }
    let data = event.data();
    let Some(dream_id) = data.get("dream_id").and_then(serde_json::Value::as_str) else {
        return;
    };
    if event.event_type() == "dream.morning_report" {
        let usize_field = |name: &str| {
            data.get(name)
                .and_then(serde_json::Value::as_u64)
                .and_then(|value| usize::try_from(value).ok())
                .unwrap_or_default()
        };
        let string_field = |name: &str| {
            data.get(name)
                .and_then(serde_json::Value::as_str)
                .unwrap_or_default()
                .to_string()
        };
        let bool_field = |name: &str| {
            data.get(name)
                .and_then(serde_json::Value::as_bool)
                .unwrap_or(false)
        };
        DREAM_MORNING.with(|store| {
            *store.borrow_mut() = Some(DreamMorningReport {
                dream_id: dream_id.to_string(),
                state: string_field("state"),
                source_created_at: string_field("source_created_at"),
                summary: string_field("summary"),
                reviewed_count: usize_field("reviewed_count"),
                added_count: usize_field("added_count"),
                merged_count: usize_field("merged_count"),
                replaced_count: usize_field("replaced_count"),
                dropped_count: usize_field("dropped_count"),
                kept_count: usize_field("kept_count"),
                resolved_memory_count: usize_field("resolved_memory_count"),
                validation_blocker_count: usize_field("validation_blocker_count"),
                skill_retirement_candidate_count: usize_field("skill_retirement_candidate_count"),
                approved: bool_field("approved"),
                activated: bool_field("activated"),
                candidate_eval_passed: bool_field("candidate_eval_passed"),
            });
        });
        return;
    }
    DREAM_UI.with(|store| {
        let mut guard = store.borrow_mut();
        let mut snapshot = guard
            .take()
            .filter(|current| current.dream_id == dream_id)
            .unwrap_or_default();
        snapshot.dream_id = dream_id.to_string();
        snapshot.state = data
            .get("state")
            .and_then(serde_json::Value::as_str)
            .map(ToString::to_string)
            .unwrap_or_else(|| {
                match event.event_type() {
                    "dream.recommended" => "RECOMMENDED",
                    "dream.started" => "DREAMING",
                    "dream.candidate_ready" => "REVIEW_REQUIRED",
                    "dream.validation_failed" => "FAILED",
                    "dream.blocked" => "BLOCKED",
                    "dream.approved" => "APPROVED",
                    "dream.rejected" => "REJECTED",
                    "dream.activated" => "ACTIVE",
                    "dream.rolled_back" => "ROLLED_BACK",
                    "dream.next_task_ready" => "RECOMMENDED",
                    "dream.revision_task_created" => "REVISION_REQUIRED",
                    "dream.next_task_approved" => "APPROVED",
                    "dream.next_task_queued" => "QUEUED",
                    "dream.next_task_started" => "RUNNING",
                    "dream.next_task_delivery_ready" => "AWAITING_DELIVERY_APPROVAL",
                    "dream.next_task_settled" => data
                        .get("outcome")
                        .and_then(serde_json::Value::as_str)
                        .map(|outcome| match outcome {
                            "accepted" => "DELIVERED",
                            "rejected" | "revision_needed" => "REJECTED",
                            "cancelled" => "CANCELLED",
                            _ => "FAILED",
                        })
                        .unwrap_or("FAILED"),
                    "dream.next_task_evaluated" => "EVALUATED",
                    "dream.next_task_learned" => "LEARNED",
                    "dream.next_cycle_recommended" => "NEXT_RECOMMENDED",
                    _ => "UNKNOWN",
                }
                .to_string()
            });
        for (field, target) in [
            ("summary", &mut snapshot.summary),
            ("base_memory_hash", &mut snapshot.base_memory_hash),
            ("candidate_memory_hash", &mut snapshot.candidate_memory_hash),
            ("next_step", &mut snapshot.next_step),
            ("cycle_id", &mut snapshot.cycle_id),
            ("kind", &mut snapshot.growth_kind),
            ("goal", &mut snapshot.growth_goal),
            ("task_run_id", &mut snapshot.task_run_id),
            ("outcome", &mut snapshot.outcome),
        ] {
            if let Some(value) = data.get(field).and_then(serde_json::Value::as_str) {
                *target = value.to_string();
            }
        }
        if let Some(blockers) = data.get("blockers").and_then(serde_json::Value::as_array) {
            snapshot.blockers = blockers
                .iter()
                .filter_map(serde_json::Value::as_str)
                .map(ToString::to_string)
                .collect();
        }
        if let Some(entries) = data
            .get("diff")
            .and_then(|value| value.get("entries"))
            .and_then(serde_json::Value::as_array)
        {
            snapshot.diff = entries
                .iter()
                .map(|entry| DreamDiffRow {
                    op: entry
                        .get("op")
                        .and_then(serde_json::Value::as_str)
                        .unwrap_or("change")
                        .to_string(),
                    text: entry
                        .get("item")
                        .and_then(|item| item.get("text"))
                        .and_then(serde_json::Value::as_str)
                        .map(ToString::to_string)
                        .or_else(|| {
                            entry
                                .get("replaces")
                                .and_then(serde_json::Value::as_array)
                                .map(|values| {
                                    values
                                        .iter()
                                        .filter_map(serde_json::Value::as_str)
                                        .collect::<Vec<_>>()
                                        .join(", ")
                                })
                        })
                        .unwrap_or_default(),
                    reason: entry
                        .get("reason")
                        .and_then(serde_json::Value::as_str)
                        .unwrap_or_default()
                        .to_string(),
                })
                .collect();
        }
        *guard = Some(snapshot);
    });
}

fn store() -> &'static RwLock<HireFlowStore> {
    HIRE_FLOW.get_or_init(|| RwLock::new(HireFlowStore::default()))
}

pub fn initialize(root: &Path) {
    let Ok(registry) = crate::read_registry(root) else {
        let mut guard = store().write().expect("hire flow write lock poisoned");
        guard.root = Some(root.to_path_buf());
        guard.flows.clear();
        return;
    };
    let mut flows = BTreeMap::new();
    for expert in &registry.experts {
        flows.insert(expert.name.clone(), inspect_employee(root, expert));
    }
    let mut guard = store().write().expect("hire flow write lock poisoned");
    guard.root = Some(root.to_path_buf());
    guard.flows = flows;
}

pub fn refresh(employee_id: &str) -> Option<HireFlowSnapshot> {
    let root = store().read().ok().and_then(|guard| guard.root.clone())?;
    let registry = crate::read_registry(&root).ok()?;
    let expert = registry
        .experts
        .iter()
        .find(|expert| expert.name == employee_id)?;
    let snapshot = inspect_employee(&root, expert);
    store()
        .write()
        .ok()?
        .flows
        .insert(employee_id.to_string(), snapshot.clone());
    Some(snapshot)
}

pub fn snapshot(employee_id: &str) -> Option<HireFlowSnapshot> {
    store().read().ok()?.flows.get(employee_id).cloned()
}

pub fn set_onboarding_step(employee_id: &str, step: usize) {
    if let Ok(mut guard) = store().write()
        && let Some(flow) = guard.flows.get_mut(employee_id)
        && matches!(flow.stage, HireStage::Onboarding(_) | HireStage::Active)
    {
        flow.stage = HireStage::Onboarding(step.min(2));
    }
}

pub fn finish_onboarding(employee_id: &str) {
    if let Ok(mut guard) = store().write()
        && let Some(flow) = guard.flows.get_mut(employee_id)
        && flow.workspace_employee_id.is_some()
    {
        flow.stage = HireStage::Active;
    }
}

/// Persist a real active team record only after all blocking checks pass. Re-hire is idempotent
/// and reconciles the permission set exactly, so a stale grant cannot survive this path.
pub fn begin_trial(employee_id: &str) -> Result<HireFlowSnapshot, String> {
    let root = store()
        .read()
        .map_err(|_| "hire flow read lock poisoned".to_string())?
        .root
        .clone()
        .ok_or_else(|| "hire flow is not attached to a workspace".to_string())?;
    let registry = crate::read_registry(&root)?;
    let expert = registry
        .experts
        .iter()
        .find(|expert| expert.name == employee_id)
        .ok_or_else(|| format!("employee {employee_id} is not in the registry"))?;
    let inspected = inspect_employee(&root, expert);
    if !inspected.trial_ready() {
        let blockers = inspected
            .checks
            .iter()
            .filter(|check| check.status.blocks_trial())
            .map(|check| format!("{}: {}", check.name, check.detail))
            .collect::<Vec<_>>();
        let reason = if blockers.is_empty() {
            "hire checks have not reached TrialReady".to_string()
        } else {
            blockers.join("; ")
        };
        update_error(employee_id, &reason);
        return Err(reason);
    }

    let existing = crate::team::read_team(&root)?;
    let existing_permissions = crate::team::active_employee(&existing, employee_id)
        .map(|employee| employee.permissions_granted.as_slice());
    let plan = if let Some(permissions) = existing_permissions {
        crate::rehire_permission_plan(&root, expert, &[], permissions)?
    } else {
        crate::hire_permission_plan(&root, expert, &[])?
    };
    // Use the canonical hire service instead of duplicating its roster mutation. `--live` skips
    // the visual demo ceremony and performs the real Hermes install/import; `--yes` keeps this
    // TUI action non-interactive. The service writes team.json only after installation succeeds.
    let hire_args = vec!["--live".to_string(), "--yes".to_string()];
    let code = match crate::run_hire(expert, &hire_args, &root, false) {
        Ok(code) => code,
        Err(error) => {
            update_error(employee_id, &error);
            return Err(error);
        }
    };
    if code != 0 {
        let reason = format!("employee install failed with exit code {code}");
        update_error(employee_id, &reason);
        return Err(reason);
    }
    let team = crate::team::read_team(&root)?;
    let record = crate::team::active_employee(&team, employee_id)
        .cloned()
        .ok_or_else(|| "hire service returned success without an active team record".to_string())?;

    let mut completed = inspect_employee(&root, expert);
    completed.stage = HireStage::Onboarding(0);
    completed.workspace_employee_id = Some(record.workspace_employee_id);
    completed.pending_permissions = plan.pending;
    completed.last_error = None;
    store()
        .write()
        .map_err(|_| "hire flow write lock poisoned".to_string())?
        .flows
        .insert(employee_id.to_string(), completed.clone());
    Ok(completed)
}

/// Fire through the same canonical service as `crew fire`, then recompute the HIRE snapshot.
/// The fired roster entry remains in team.json and the employee returns to TrialReady when its
/// checks still pass, so a later Enter performs a real re-hire.
pub fn fire_employee(
    employee_id: &str,
    mode: crate::OffboardingMode,
) -> Result<HireFlowSnapshot, String> {
    let root = store()
        .read()
        .map_err(|_| "hire flow read lock poisoned".to_string())?
        .root
        .clone()
        .ok_or_else(|| "hire flow is not attached to a workspace".to_string())?;
    crate::offboard_employee(&root, employee_id, mode, None)
        .map(|result| result.employee)
        .inspect_err(|error| {
            update_error(employee_id, error);
        })?;
    refresh(employee_id).ok_or_else(|| {
        let error = format!("employee {employee_id} disappeared from the registry after firing");
        update_error(employee_id, &error);
        error
    })
}

fn update_error(employee_id: &str, reason: &str) {
    if let Ok(mut guard) = store().write()
        && let Some(flow) = guard.flows.get_mut(employee_id)
    {
        flow.last_error = Some(reason.to_string());
    }
}

fn inspect_employee(root: &Path, expert: &crate::Expert) -> HireFlowSnapshot {
    let active = crate::team::read_team(root)
        .ok()
        .and_then(|team| crate::team::active_employee(&team, &expert.name).cloned());
    let mut checks = Vec::with_capacity(8);

    let available = expert.status == "available" && expert.local_source.is_some();
    checks.push(HireCheck {
        name: "Package",
        status: if available {
            CheckStatus::Passed
        } else {
            CheckStatus::Failed
        },
        detail: if available {
            expert.local_source.clone().unwrap_or_default()
        } else {
            format!(
                "registry status={} · local package unavailable",
                expert.status
            )
        },
    });

    let manifest = expert
        .local_source
        .as_deref()
        .ok_or_else(|| "employee has no local manifest source".to_string())
        .and_then(|source| crate::manifest::read_manifest(root, &expert.name, source));
    match manifest.as_ref() {
        Ok(manifest) => {
            let missing = manifest.missing_required_fields();
            checks.push(HireCheck {
                name: "Contract",
                status: if missing.is_empty()
                    && manifest.api_version == "crewclaw/v1"
                    && manifest.kind == "Employee"
                    && manifest.metadata.id == expert.name
                {
                    CheckStatus::Passed
                } else {
                    CheckStatus::Failed
                },
                detail: if missing.is_empty() {
                    format!(
                        "{} {} · {}",
                        manifest.api_version, manifest.kind, manifest.metadata.id
                    )
                } else {
                    format!("missing {}", missing.join(", "))
                },
            });
            let registry_version = expert.version.as_deref().unwrap_or("unknown");
            checks.push(HireCheck {
                name: "Version",
                status: if !manifest.metadata.version.is_empty()
                    && manifest.metadata.version == registry_version
                {
                    CheckStatus::Passed
                } else {
                    CheckStatus::Failed
                },
                detail: format!(
                    "registry {} · contract {}",
                    registry_version,
                    if manifest.metadata.version.is_empty() {
                        "missing"
                    } else {
                        &manifest.metadata.version
                    }
                ),
            });
            checks.push(HireCheck {
                name: "Runtime",
                status: if manifest.requires.runtime.trim().is_empty() {
                    CheckStatus::Failed
                } else {
                    CheckStatus::Passed
                },
                detail: if manifest.requires.runtime.trim().is_empty() {
                    "runtime declaration missing".to_string()
                } else {
                    format!("{} · TaskEvent bridge present", manifest.requires.runtime)
                },
            });
            let (hermes_status, hermes_detail) =
                check_hermes_requirement(&manifest.requires.hermes);
            checks.push(HireCheck {
                name: "Hermes",
                status: hermes_status,
                detail: hermes_detail,
            });
            let env_missing = manifest
                .requires
                .env
                .iter()
                .filter(|key| {
                    std::env::var(key)
                        .ok()
                        .is_none_or(|value| value.trim().is_empty())
                })
                .cloned()
                .collect::<Vec<_>>();
            checks.push(HireCheck {
                name: "Environment",
                status: if env_missing.is_empty() {
                    CheckStatus::Passed
                } else {
                    CheckStatus::Warning
                },
                detail: if env_missing.is_empty() {
                    "declared environment available".to_string()
                } else {
                    format!("missing at check time: {}", env_missing.join(", "))
                },
            });
        }
        Err(error) => {
            for name in ["Contract", "Version", "Runtime", "Hermes", "Environment"] {
                checks.push(HireCheck {
                    name,
                    status: CheckStatus::Failed,
                    detail: error.clone(),
                });
            }
        }
    }

    let permission_plan = crate::hire_permission_plan(root, expert, &[]);
    let (permission_status, permission_detail, pending_permissions) = match permission_plan {
        Ok(plan) => {
            let detail = format!(
                "{} granted · {} pending · {} disabled",
                plan.granted.len(),
                plan.pending.len(),
                plan.disabled.len()
            );
            (
                if plan.pending.is_empty() {
                    CheckStatus::Passed
                } else {
                    CheckStatus::Warning
                },
                detail,
                plan.pending,
            )
        }
        Err(error) => (CheckStatus::Failed, error, Vec::new()),
    };
    checks.push(HireCheck {
        name: "Permission",
        status: permission_status,
        detail: permission_detail,
    });

    let state_store_status = crate::team::read_team(root);
    checks.push(HireCheck {
        name: "Team Store",
        status: if state_store_status.is_ok() {
            CheckStatus::Passed
        } else {
            CheckStatus::Failed
        },
        detail: state_store_status
            .map(|team| {
                format!(
                    "{} · {} records",
                    crate::team::team_path(root).display(),
                    team.len()
                )
            })
            .unwrap_or_else(|error| error),
    });

    let blocking = checks.iter().any(|check| check.status.blocks_trial());
    HireFlowSnapshot {
        employee_id: expert.name.clone(),
        checks,
        stage: if active.is_some() {
            HireStage::Active
        } else if blocking {
            HireStage::Blocked
        } else {
            HireStage::TrialReady
        },
        workspace_employee_id: active.map(|employee| employee.workspace_employee_id),
        pending_permissions,
        last_error: None,
    }
}

fn parse_hermes_version(output: &str) -> Option<Version> {
    output
        .split(|character: char| {
            !(character.is_ascii_alphanumeric()
                || character == '.'
                || character == '-'
                || character == '+')
        })
        .filter_map(|token| token.strip_prefix('v').or(Some(token)))
        .filter(|token| {
            token
                .chars()
                .next()
                .is_some_and(|character| character.is_ascii_digit())
        })
        .find_map(|token| Version::parse(token).ok())
}

fn check_hermes_requirement(requirement: &str) -> (CheckStatus, String) {
    let required = match VersionReq::parse(requirement.trim()) {
        Ok(required) => required,
        Err(error) => {
            return (
                CheckStatus::Failed,
                format!("invalid requirement {requirement:?}: {error}"),
            );
        }
    };
    let output = match Command::new(crate::resolve_command_path("hermes"))
        .arg("--version")
        .stdin(Stdio::null())
        .output()
    {
        Ok(output) if output.status.success() => output,
        Ok(output) => {
            return (
                CheckStatus::Warning,
                format!(
                    "CLI unavailable at check time (exit {}) · requires {requirement}; local runtime remains usable",
                    output.status
                ),
            );
        }
        Err(error) => {
            return (
                CheckStatus::Warning,
                format!(
                    "CLI unavailable at check time ({error}) · requires {requirement}; local runtime remains usable"
                ),
            );
        }
    };
    let version_output = if output.stdout.is_empty() {
        String::from_utf8_lossy(&output.stderr)
    } else {
        String::from_utf8_lossy(&output.stdout)
    };
    let Some(version) = parse_hermes_version(&version_output) else {
        return (
            CheckStatus::Warning,
            format!(
                "unable to parse installed version from {:?} · requires {requirement}",
                version_output.trim()
            ),
        );
    };
    if required.matches(&version) {
        (
            CheckStatus::Passed,
            format!("installed {version} · satisfies {requirement}"),
        )
    } else {
        (
            CheckStatus::Warning,
            format!("installed {version} · does not satisfy {requirement}"),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn check_symbols_are_color_independent() {
        assert_eq!(CheckStatus::Passed.symbol(), "✓");
        assert_eq!(CheckStatus::Warning.symbol(), "△");
        assert_eq!(CheckStatus::Failed.symbol(), "✗");
        assert!(!CheckStatus::Warning.blocks_trial());
        assert!(CheckStatus::Failed.blocks_trial());
    }

    #[test]
    fn hermes_version_parser_accepts_common_cli_formats() {
        assert_eq!(
            parse_hermes_version("hermes 0.18.2\n"),
            Some(Version::new(0, 18, 2))
        );
        assert_eq!(
            parse_hermes_version("Hermes CLI v1.2.3-beta.1"),
            Some(Version::parse("1.2.3-beta.1").unwrap())
        );
        assert_eq!(parse_hermes_version("Hermes CLI unknown"), None);
    }

    #[test]
    fn hermes_requirement_uses_semver_rules() {
        let required = VersionReq::parse(">=0.18.2").unwrap();
        assert!(required.matches(&Version::new(0, 18, 2)));
        assert!(required.matches(&Version::new(0, 19, 0)));
        assert!(!required.matches(&Version::new(0, 18, 1)));
    }

    #[test]
    fn dream_reducer_keeps_candidate_diff_when_activation_is_blocked() {
        let ready = super::super::protocol::TaskEvent::from_parts(
            "dream.candidate_ready",
            1,
            json!({
                "dream_id": "dream-ui-test",
                "employee_id": "whale",
                "state": "REVIEW_REQUIRED",
                "diff": {"entries": [{
                    "op": "add",
                    "reason": "verified",
                    "item": {"text": "save evidence"}
                }]}
            }),
        );
        reduce_dream_event(&ready);
        let blocked = super::super::protocol::TaskEvent::from_parts(
            "dream.blocked",
            2,
            json!({
                "dream_id": "dream-ui-test",
                "employee_id": "whale",
                "reason": "activation_blocked",
                "blockers": ["baseline_missing"],
                "next_step": "run eval"
            }),
        );
        reduce_dream_event(&blocked);
        let snapshot = dream_snapshot().expect("dream snapshot");
        assert_eq!(snapshot.state, "BLOCKED");
        assert_eq!(snapshot.diff.len(), 1);
        assert_eq!(snapshot.diff[0].text, "save evidence");
        assert_eq!(snapshot.blockers, vec!["baseline_missing"]);
        assert_eq!(snapshot.next_step, "run eval");
    }

    #[test]
    fn dream_reducer_projects_restart_safe_morning_report() {
        reset_dream_projection();
        let event = super::super::protocol::TaskEvent::from_parts(
            "dream.morning_report",
            1,
            json!({
                "dream_id": "dream-morning-test",
                "employee_id": "whale",
                "state": "ACTIVE",
                "source_created_at": "2026-07-18T23:00:00.000Z",
                "summary": "巩固稳定 SOP",
                "reviewed_count": 4,
                "added_count": 1,
                "merged_count": 1,
                "replaced_count": 1,
                "dropped_count": 1,
                "kept_count": 0,
                "resolved_memory_count": 3,
                "validation_blocker_count": 0,
                "skill_retirement_candidate_count": 2,
                "approved": true,
                "activated": true,
                "candidate_eval_passed": true
            }),
        );
        reduce_dream_event(&event);
        let report = dream_morning_report().expect("morning report");
        assert_eq!(report.dream_id, "dream-morning-test");
        assert_eq!(report.reviewed_count, 4);
        assert_eq!(report.resolved_memory_count, 3);
        assert_eq!(report.skill_retirement_candidate_count, 2);
        assert!(report.activated);
    }

    #[test]
    fn session_ready_clears_prior_dream_session_projection() {
        let event = super::super::protocol::TaskEvent::from_parts(
            "dream.morning_report",
            1,
            json!({
                "dream_id": "dream-old-session",
                "employee_id": "whale",
                "state": "ACTIVE"
            }),
        );
        reduce_dream_event(&event);
        assert!(dream_morning_report().is_some());
        reduce_dream_event(&super::super::protocol::TaskEvent::from_parts(
            "session.ready",
            2,
            json!({"employee": {"id": "next-employee"}}),
        ));
        assert!(dream_morning_report().is_none());
        assert!(dream_snapshot().is_none());
    }

    #[test]
    fn growth_events_project_executable_goal_task_and_revision_state() {
        reset_dream_projection();
        reduce_dream_event(&super::super::protocol::TaskEvent::from_parts(
            "dream.next_task_started",
            1,
            serde_json::json!({
                "dream_id": "dream-growth-ui",
                "cycle_id": "growth-cycle-one",
                "kind": "growth_task",
                "state": "RUNNING",
                "goal": "Produce an evidence-backed delivery.",
                "task_run_id": "task-growth-one"
            }),
        ));
        let running = dream_snapshot().expect("running growth projection");
        assert_eq!(running.state, "RUNNING");
        assert_eq!(running.cycle_id, "growth-cycle-one");
        assert_eq!(running.growth_kind, "growth_task");
        assert_eq!(running.growth_goal, "Produce an evidence-backed delivery.");
        assert_eq!(running.task_run_id, "task-growth-one");

        reduce_dream_event(&super::super::protocol::TaskEvent::from_parts(
            "dream.revision_task_created",
            2,
            serde_json::json!({
                "dream_id": "dream-growth-revision",
                "cycle_id": "growth-cycle-revision",
                "kind": "dream_revision",
                "goal": "Add source provenance and resubmit.",
                "next_step": "Human approval is required before execution."
            }),
        ));
        let revision = dream_snapshot().expect("revision growth projection");
        assert_eq!(revision.state, "REVISION_REQUIRED");
        assert_eq!(revision.cycle_id, "growth-cycle-revision");
        assert_eq!(revision.growth_kind, "dream_revision");
        assert_eq!(
            revision.next_step,
            "Human approval is required before execution."
        );
    }
}
