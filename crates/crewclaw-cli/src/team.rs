use serde::{Deserialize, Serialize};
use std::fs;
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
    if !path.exists() {
        return Ok(Vec::new());
    }
    let content = fs::read_to_string(&path)
        .map_err(|error| format!("Failed to read {}: {error}", path.display()))?;
    serde_json::from_str(&content)
        .map_err(|error| format!("Failed to parse {}: {error}", path.display()))
}

pub(crate) fn write_team(root: &Path, employees: &[WorkspaceEmployee]) -> Result<(), String> {
    let path = team_path(root);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Failed to create {}: {error}", parent.display()))?;
    }
    let content = serde_json::to_string_pretty(employees)
        .map_err(|error| format!("Failed to serialize team state: {error}"))?;
    fs::write(&path, format!("{content}\n"))
        .map_err(|error| format!("Failed to write {}: {error}", path.display()))
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
    };
    employees.push(record.clone());
    record
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
        };
        let json = serde_json::to_string(&employee).expect("serialize employee");
        assert!(json.contains(r#""status":"active""#));
    }

    #[test]
    fn formats_unix_epoch_as_utc_datetime() {
        assert_eq!(civil_from_days(0), (1970, 1, 1));
        assert_eq!(civil_from_days(1), (1970, 1, 2));
    }
}
