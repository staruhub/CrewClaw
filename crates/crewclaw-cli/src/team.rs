use serde::{Deserialize, Serialize};
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Clone, Debug, Deserialize, Serialize)]
pub(crate) struct WorkspaceEmployee {
    pub workspace_employee_id: String,
    pub employee_id: String,
    pub version: String,
    pub status: WorkspaceEmployeeStatus,
    pub hired_at: String,
    pub fired_at: Option<String>,
    pub permissions_granted: Vec<String>,
    /// Website hires bind the exact downloaded archive. CLI hires install a verified local
    /// source directly, so this remains `None` while `hire_source` records that provenance.
    #[serde(default)]
    pub package_sha256: Option<String>,
    #[serde(default)]
    pub hire_source: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum WorkspaceEmployeeStatus {
    Active,
    Warning,
    Broken,
    Fired,
}

impl WorkspaceEmployeeStatus {
    pub(crate) fn as_str(&self) -> &'static str {
        match self {
            Self::Active => "active",
            Self::Warning => "warning",
            Self::Broken => "broken",
            Self::Fired => "fired",
        }
    }
}

pub(crate) fn read_team(root: &Path) -> Result<Vec<WorkspaceEmployee>, String> {
    let path = team_path(root);
    let content = crate::state_store::read_string(root, "team.json")
        .map_err(|error| format!("Failed to read {}: {error}", path.display()))?;
    let Some(content) = content else {
        return Ok(Vec::new());
    };
    serde_json::from_str(&content)
        .map_err(|error| format!("Failed to parse {}: {error}", path.display()))
}

fn write_team_unlocked(root: &Path, employees: &[WorkspaceEmployee]) -> Result<(), String> {
    let path = team_path(root);
    let content = serde_json::to_string_pretty(employees)
        .map_err(|error| format!("Failed to serialize team state: {error}"))?;
    crate::state_store::write_atomic(root, "team.json", format!("{content}\n").as_bytes())
        .map_err(|error| format!("Failed to write {}: {error}", path.display()))
}

/// Serialize the complete read-modify-write transaction across processes. The callback always
/// receives the latest durable roster after the owner lock is acquired.
pub(crate) fn mutate_team<T>(
    root: &Path,
    mutate: impl FnOnce(&mut Vec<WorkspaceEmployee>) -> Result<T, String>,
) -> Result<T, String> {
    let path = team_path(root);
    let _lock = crate::state_store::acquire_owner_lock(root, "team.json")
        .map_err(|error| format!("Failed to lock {}: {error}", path.display()))?;
    let mut employees = read_team(root)?;
    let result = mutate(&mut employees)?;
    write_team_unlocked(root, &employees)?;
    Ok(result)
}

pub(crate) fn active_employee<'a>(
    employees: &'a [WorkspaceEmployee],
    employee_id: &str,
) -> Option<&'a WorkspaceEmployee> {
    employees.iter().find(|employee| {
        employee.employee_id == employee_id && employee.status == WorkspaceEmployeeStatus::Active
    })
}

pub(crate) fn active_employee_mut<'a>(
    employees: &'a mut [WorkspaceEmployee],
    employee_id: &str,
) -> Option<&'a mut WorkspaceEmployee> {
    employees.iter_mut().find(|employee| {
        employee.employee_id == employee_id && employee.status == WorkspaceEmployeeStatus::Active
    })
}

pub(crate) fn add_active_employee(
    employees: &mut Vec<WorkspaceEmployee>,
    employee_id: &str,
    version: &str,
    permissions_granted: Vec<String>,
) -> WorkspaceEmployee {
    let now = now_iso8601();
    let record = WorkspaceEmployee {
        workspace_employee_id: format!("{employee_id}-{}", unix_seconds()),
        employee_id: employee_id.to_string(),
        version: version.to_string(),
        status: WorkspaceEmployeeStatus::Active,
        hired_at: now,
        fired_at: None,
        permissions_granted,
        package_sha256: None,
        hire_source: Some("cli".to_string()),
    };
    employees.push(record.clone());
    record
}

/// Test-only reference mutation. Production CLI/TUI offboarding must cross the shared Node
/// service so memory export, handoff, purge, activity, and the final receipt cannot diverge.
#[cfg(test)]
fn fire_active_employee(root: &Path, employee_id: &str) -> Result<WorkspaceEmployee, String> {
    mutate_team(root, |employees| {
        let employee = active_employee_mut(employees, employee_id)
            .ok_or_else(|| format!("{employee_id} is not active in this crew"))?;
        employee.status = WorkspaceEmployeeStatus::Fired;
        employee.fired_at = Some(now_iso8601());
        Ok(employee.clone())
    })
}

pub(crate) fn team_path(root: &Path) -> std::path::PathBuf {
    root.join(".crewclaw/team.json")
}

pub(crate) fn now_iso8601() -> String {
    let seconds = unix_seconds();
    let days = (seconds / 86_400) as i64;
    let day_seconds = seconds % 86_400;
    let (year, month, day) = civil_from_days(days);
    let hour = day_seconds / 3_600;
    let minute = (day_seconds % 3_600) / 60;
    let second = day_seconds % 60;
    format!("{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}Z")
}

fn unix_seconds() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

fn civil_from_days(days_since_unix_epoch: i64) -> (i64, i64, i64) {
    let z = days_since_unix_epoch + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let mut year = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = mp + if mp < 10 { 3 } else { -9 };
    if month <= 2 {
        year += 1;
    }
    (year, month, day)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeSet;
    use std::sync::{Arc, Barrier};
    use std::thread;

    #[test]
    fn status_serializes_lowercase() {
        let employee = WorkspaceEmployee {
            workspace_employee_id: "macao-1".to_string(),
            employee_id: "macao".to_string(),
            version: "0.1.0".to_string(),
            status: WorkspaceEmployeeStatus::Active,
            hired_at: "2026-06-22T00:00:00Z".to_string(),
            fired_at: None,
            permissions_granted: vec!["public_web:read".to_string()],
            package_sha256: None,
            hire_source: Some("cli".to_string()),
        };
        let json = serde_json::to_string(&employee).expect("serialize employee");
        assert!(json.contains(r#""status":"active""#));
        assert!(json.contains(r#""hire_source":"cli""#));
    }

    #[test]
    fn legacy_records_without_package_provenance_remain_readable() {
        let employee: WorkspaceEmployee = serde_json::from_str(
            r#"{
                "workspace_employee_id":"legacy-1",
                "employee_id":"legacy",
                "version":"0.1.0",
                "status":"active",
                "hired_at":"2026-06-22T00:00:00Z",
                "fired_at":null,
                "permissions_granted":[]
            }"#,
        )
        .expect("legacy team record");
        assert_eq!(employee.package_sha256, None);
        assert_eq!(employee.hire_source, None);
    }

    #[test]
    fn formats_unix_epoch_as_utc_datetime() {
        assert_eq!(civil_from_days(0), (1970, 1, 1));
        assert_eq!(civil_from_days(1), (1970, 1, 2));
    }

    #[test]
    fn firing_retains_history_and_allows_a_new_active_record() {
        let root = std::env::temp_dir().join(format!(
            "crewclaw-team-fire-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("time")
                .as_nanos()
        ));
        std::fs::create_dir(&root).expect("workspace root");
        mutate_team(&root, |employees| {
            add_active_employee(employees, "macao", "1.0.0", Vec::new());
            Ok(())
        })
        .expect("hire");

        let fired = fire_active_employee(&root, "macao").expect("fire");
        assert_eq!(fired.status, WorkspaceEmployeeStatus::Fired);
        assert!(fired.fired_at.is_some());
        mutate_team(&root, |employees| {
            add_active_employee(employees, "macao", "1.1.0", Vec::new());
            Ok(())
        })
        .expect("rehire");

        let team = read_team(&root).expect("team");
        assert_eq!(team.len(), 2);
        assert_eq!(team[0].status, WorkspaceEmployeeStatus::Fired);
        assert_eq!(team[1].status, WorkspaceEmployeeStatus::Active);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn concurrent_roster_mutations_do_not_lose_employees() {
        let root = Arc::new(std::env::temp_dir().join(format!(
            "crewclaw-team-concurrency-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("time")
                .as_nanos()
        )));
        std::fs::create_dir(root.as_ref()).expect("workspace root");
        let workers = 6;
        let rounds = 10;
        let barrier = Arc::new(Barrier::new(workers));
        let mut joins = Vec::new();
        for worker in 0..workers {
            let root = Arc::clone(&root);
            let barrier = Arc::clone(&barrier);
            joins.push(thread::spawn(move || {
                barrier.wait();
                for round in 0..rounds {
                    let employee_id = format!("worker-{worker}-employee-{round}");
                    mutate_team(&root, |employees| {
                        add_active_employee(employees, &employee_id, "1.0.0", Vec::new());
                        Ok(())
                    })
                    .expect("serialized team mutation");
                }
            }));
        }
        for join in joins {
            join.join().expect("worker");
        }
        let employees = read_team(&root).expect("final roster");
        assert_eq!(employees.len(), workers * rounds);
        assert_eq!(
            employees
                .iter()
                .map(|employee| employee.employee_id.as_str())
                .collect::<BTreeSet<_>>()
                .len(),
            workers * rounds
        );
        let _ = std::fs::remove_dir_all(root.as_ref());
    }
}
