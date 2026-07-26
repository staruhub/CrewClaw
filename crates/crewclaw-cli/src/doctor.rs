use serde::Serialize;

use crate::Expert;
use crate::manifest::EmployeeManifest;
use crate::permissions::{self, DefaultPermissionClass};
use crate::team::{self, WorkspaceEmployee, WorkspaceEmployeeStatus};

#[derive(Clone, Debug, Serialize)]
pub(crate) struct DoctorReport {
    pub report_id: String,
    pub workspace_employee_id: String,
    pub health_status: HealthStatus,
    pub issues: Vec<String>,
    pub suggestions: Vec<String>,
    pub checked_at: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum HealthStatus {
    Healthy,
    Warning,
    Broken,
}

impl HealthStatus {
    pub(crate) fn as_str(&self) -> &'static str {
        match self {
            Self::Healthy => "healthy",
            Self::Warning => "warning",
            Self::Broken => "broken",
        }
    }
}

pub(crate) fn build_report(
    expert: &Expert,
    manifest: Result<EmployeeManifest, String>,
    team: &[WorkspaceEmployee],
) -> DoctorReport {
    let checked_at = team::now_iso8601();
    let workspace_employee = team::active_employee(team, &expert.name);
    let workspace_employee_id = workspace_employee
        .map(|employee| employee.workspace_employee_id.clone())
        .unwrap_or_else(|| format!("unhired:{}", expert.name));
    let mut issues = Vec::new();
    let mut suggestions = Vec::new();
    let mut broken = false;
    let mut warning = false;

    match manifest {
        Ok(manifest) => {
            let missing = manifest.missing_required_fields();
            if !missing.is_empty() {
                broken = true;
                issues.push(format!(
                    "Manifest is missing required fields: {}",
                    missing.join(", ")
                ));
                suggestions.push(
                    "Complete experts/<name>/hire.yaml before hiring or running this employee."
                        .to_string(),
                );
            }

            if manifest.api_version != "crewclaw/v1" || manifest.kind != "Employee" {
                broken = true;
                issues.push(format!(
                    "Manifest type mismatch: apiVersion={}, kind={}",
                    blank(&manifest.api_version),
                    blank(&manifest.kind)
                ));
                suggestions.push("Use apiVersion crewclaw/v1 and kind Employee.".to_string());
            }

            if !manifest.metadata.id.is_empty() && manifest.metadata.id != expert.name {
                broken = true;
                issues.push(format!(
                    "Registry name mismatch: registry={} hire.yaml={}",
                    expert.name, manifest.metadata.id
                ));
                suggestions
                    .push("Align registry/experts.json with the employee manifest id.".to_string());
            }

            if let Some(version) = expert.version.as_ref()
                && !manifest.metadata.version.is_empty()
                && manifest.metadata.version != *version
            {
                warning = true;
                issues.push(format!(
                    "Version mismatch: registry={} hire.yaml={}",
                    version, manifest.metadata.version
                ));
                suggestions.push("Update either registry/experts.json or hire.yaml so the published version is unambiguous.".to_string());
            }

            if workspace_employee.is_none() {
                warning = true;
                issues.push("Employee is not active in .crewclaw/team.json; permissions have not been granted in this workspace.".to_string());
                suggestions.push(format!(
                    "Run crew hire {} before assigning work.",
                    expert.name
                ));
            } else if let Some(employee) = workspace_employee {
                let missing_permissions = manifest
                    .permissions
                    .iter()
                    .filter(|permission| {
                        permissions::is_safe_default_permission(permission)
                            && !employee.permissions_granted.contains(permission)
                    })
                    .cloned()
                    .collect::<Vec<_>>();
                if !missing_permissions.is_empty() {
                    warning = true;
                    issues.push(format!(
                        "Missing granted permissions: {}",
                        missing_permissions.join(", ")
                    ));
                    suggestions.push("Re-hire or update the team record after reviewing the required permissions.".to_string());
                }

                let pending_permissions = manifest
                    .permissions
                    .iter()
                    .filter(|permission| {
                        permissions::classify_default_permission(permission)
                            == DefaultPermissionClass::Pending
                    })
                    .cloned()
                    .collect::<Vec<_>>();
                if !pending_permissions.is_empty() {
                    suggestions.push(format!(
                        "Permission controls pending explicit approval (not auto-granted): {}.",
                        pending_permissions.join(", ")
                    ));
                }

                let disabled_permissions = manifest
                    .permissions
                    .iter()
                    .filter(|permission| {
                        permissions::classify_default_permission(permission)
                            == DefaultPermissionClass::Disabled
                    })
                    .cloned()
                    .collect::<Vec<_>>();
                if !disabled_permissions.is_empty() {
                    suggestions.push(format!(
                        "Manifest-disabled permissions remain ungranted: {}.",
                        disabled_permissions.join(", ")
                    ));
                }

                if let Some(version) = expert.version.as_ref()
                    && employee.version != *version
                {
                    warning = true;
                    issues.push(format!(
                        "Hired version is out of date: team={} registry={}",
                        employee.version, version
                    ));
                    suggestions.push(format!(
                        "Run crew update {} --apply after reviewing the updated permissions.",
                        expert.name
                    ));
                }

                if employee.status != WorkspaceEmployeeStatus::Active {
                    broken = true;
                    issues.push(format!(
                        "Workspace employee status is {}.",
                        employee.status.as_str()
                    ));
                    suggestions.push("Only active employees can receive new tasks.".to_string());
                }
            }

            if manifest.requires.hermes.is_empty() || manifest.requires.runtime.is_empty() {
                broken = true;
                issues.push("Dependency declaration is incomplete: requires.hermes and requires.runtime are both required.".to_string());
                suggestions
                    .push("Declare the Hermes constraint and runtime in hire.yaml.".to_string());
            }
        }
        Err(error) => {
            broken = true;
            issues.push(error);
            suggestions.push("Add a complete experts/<name>/hire.yaml manifest or fix the local_source path in registry/experts.json.".to_string());
        }
    }

    if issues.is_empty() {
        suggestions
            .push("No action required. This employee is healthy and ready to work.".to_string());
    }

    let health_status = if broken {
        HealthStatus::Broken
    } else if warning {
        HealthStatus::Warning
    } else {
        HealthStatus::Healthy
    };

    DoctorReport {
        report_id: format!(
            "doctor-{}-{}",
            expert.name,
            checked_at.replace([':', '-'], "")
        ),
        workspace_employee_id,
        health_status,
        issues,
        suggestions,
        checked_at,
    }
}

pub(crate) fn print_report(expert: &Expert, report: &DoctorReport) {
    println!("Doctor report");
    println!("employee_id: {}", expert.name);
    println!("workspace_employee_id: {}", report.workspace_employee_id);
    println!("health_status: {}", report.health_status.as_str());
    println!("checked_at: {}", report.checked_at);
    println!("issues:");
    if report.issues.is_empty() {
        println!("  - none");
    } else {
        for issue in &report.issues {
            println!("  - {issue}");
        }
    }
    println!("suggestions:");
    for suggestion in &report.suggestions {
        println!("  - {suggestion}");
    }
}

fn blank(value: &str) -> &str {
    if value.is_empty() { "(missing)" } else { value }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::manifest::{
        EmployeeManifest, ManifestExamples, ManifestIdentity, ManifestMetadata, ManifestRequires,
    };
    use crate::{Expert, Requirements};

    fn expert() -> Expert {
        Expert {
            name: "macao-networking-agent".to_string(),
            display_name: "Macao Networking Agent".to_string(),
            status: "available".to_string(),
            certification: "C2".to_string(),
            evidence_state: crate::RegistryEvidenceState::default(),
            evaluation: None,
            category: "local-expert".to_string(),
            description: "Networking".to_string(),
            local_source: Some("experts/macao-networking-agent".to_string()),
            version: Some("0.1.0".to_string()),
            tags: vec!["macao".to_string()],
            requires: Requirements {
                hermes: ">=0.12.0".to_string(),
                env: Vec::new(),
            },
            first_task: "Find events".to_string(),
        }
    }

    fn manifest() -> EmployeeManifest {
        EmployeeManifest {
            api_version: "crewclaw/v1".to_string(),
            kind: "Employee".to_string(),
            metadata: ManifestMetadata {
                id: "macao-networking-agent".to_string(),
                name: "Macao Networking Agent".to_string(),
                version: "0.1.0".to_string(),
            },
            identity: ManifestIdentity {
                title: "Macao Networking Specialist".to_string(),
                description: "Finds local leads".to_string(),
            },
            skills: vec!["icebreaker".to_string()],
            tools: vec!["browser".to_string()],
            permissions: vec!["public_web:read".to_string()],
            requires: ManifestRequires {
                hermes: ">=0.12.0".to_string(),
                runtime: "openclaw".to_string(),
                env: Vec::new(),
            },
            examples: ManifestExamples {
                inputs: vec!["Find an event".to_string()],
                outputs: vec!["Event list".to_string()],
            },
            limitations: vec!["No private contacts".to_string()],
            lifecycle: [("hireable".to_string(), "true".to_string())].into(),
        }
    }

    #[test]
    fn healthy_when_manifest_and_team_match() {
        let expert = expert();
        let team = vec![WorkspaceEmployee {
            workspace_employee_id: "macao-1".to_string(),
            employee_id: expert.name.clone(),
            version: "0.1.0".to_string(),
            status: WorkspaceEmployeeStatus::Active,
            hired_at: "2026-06-22T00:00:00Z".to_string(),
            fired_at: None,
            permissions_granted: vec!["public_web:read".to_string()],
            package_sha256: None,
            hire_source: Some("cli".to_string()),
        }];

        let report = build_report(&expert, Ok(manifest()), &team);

        assert_eq!(report.health_status, HealthStatus::Healthy);
        assert!(report.issues.is_empty());
    }

    #[test]
    fn broken_when_manifest_is_missing() {
        let expert = expert();
        let report = build_report(&expert, Err("missing".to_string()), &[]);

        assert_eq!(report.health_status, HealthStatus::Broken);
        assert!(report.issues.iter().any(|issue| issue == "missing"));
    }

    #[test]
    fn gated_disabled_and_unknown_reads_are_compliance_info_not_missing_grants() {
        let expert = expert();
        let mut manifest = manifest();
        manifest.permissions.extend([
            "internal_docs:read:with_consent".to_string(),
            "contacts:read:disabled".to_string(),
            "secrets:read".to_string(),
        ]);
        let team = vec![WorkspaceEmployee {
            workspace_employee_id: "macao-1".to_string(),
            employee_id: expert.name.clone(),
            version: "0.1.0".to_string(),
            status: WorkspaceEmployeeStatus::Active,
            hired_at: "2026-06-22T00:00:00Z".to_string(),
            fired_at: None,
            permissions_granted: vec!["public_web:read".to_string()],
            package_sha256: None,
            hire_source: Some("cli".to_string()),
        }];

        let report = build_report(&expert, Ok(manifest), &team);

        assert_eq!(report.health_status, HealthStatus::Healthy);
        assert!(report.issues.is_empty());
        assert!(report.suggestions.iter().any(|suggestion| {
            suggestion.contains("internal_docs:read:with_consent")
                && suggestion.contains("secrets:read")
        }));
        assert!(
            report
                .suggestions
                .iter()
                .any(|suggestion| suggestion.contains("contacts:read:disabled"))
        );
    }

    #[test]
    fn outdated_hire_points_to_the_available_update_command() {
        let expert = expert();
        let team = vec![WorkspaceEmployee {
            workspace_employee_id: "macao-1".to_string(),
            employee_id: expert.name.clone(),
            version: "0.0.9".to_string(),
            status: WorkspaceEmployeeStatus::Active,
            hired_at: "2026-06-22T00:00:00Z".to_string(),
            fired_at: None,
            permissions_granted: vec!["public_web:read".to_string()],
            package_sha256: None,
            hire_source: Some("cli".to_string()),
        }];

        let report = build_report(&expert, Ok(manifest()), &team);

        assert_eq!(report.health_status, HealthStatus::Warning);
        assert!(report.suggestions.iter().any(|suggestion| {
            suggestion ==
                "Run crew update macao-networking-agent --apply after reviewing the updated permissions."
        }));
        assert!(
            report
                .suggestions
                .iter()
                .all(|suggestion| !suggestion.contains("when available"))
        );
    }
}
