use serde::Deserialize;
use std::path::Path;
use std::process::{Command, Stdio};

#[derive(Clone, Debug, Deserialize)]
pub(crate) struct ImportedEmployeePackage {
    pub(crate) slug: String,
    pub(crate) version: String,
    pub(crate) sha256: String,
    pub(crate) installed: bool,
}

pub(crate) fn import_employee_package(
    root: &Path,
    archive: &Path,
    expected_sha256: Option<&str>,
) -> Result<ImportedEmployeePackage, String> {
    let script = root.join("packages/runtime/import-employee-package.mjs");
    if !script.is_file() {
        return Err(format!(
            "Employee package importer is missing: {}",
            script.display()
        ));
    }
    let output = Command::new(crate::resolve_command_path("node"))
        .arg(&script)
        .arg(root)
        .arg(archive)
        .arg(expected_sha256.unwrap_or("-"))
        .current_dir(root)
        .env("CREWCLAW_ROOT", root)
        .stdin(Stdio::null())
        .output()
        .map_err(|error| format!("Failed to launch employee package importer: {error}"))?;
    if !output.status.success() {
        return Err(crate::non_empty(
            &String::from_utf8_lossy(&output.stderr),
            &String::from_utf8_lossy(&output.stdout),
            "Employee package import failed",
        ));
    }
    let imported: ImportedEmployeePackage = serde_json::from_slice(&output.stdout)
        .map_err(|error| format!("Employee package importer returned invalid JSON: {error}"))?;
    if !is_slug(&imported.slug)
        || imported.version.trim().is_empty()
        || !is_sha256(&imported.sha256)
    {
        return Err("Employee package importer returned an invalid identity".to_string());
    }
    Ok(imported)
}

fn is_slug(value: &str) -> bool {
    !value.is_empty()
        && value.split('-').all(|part| {
            !part.is_empty()
                && part
                    .bytes()
                    .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit())
        })
}

fn is_sha256(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}
