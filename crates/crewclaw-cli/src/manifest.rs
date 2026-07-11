use std::collections::BTreeMap;
use std::fs::{self, File};
use std::io::Read;
use std::path::{Path, PathBuf};

#[derive(Clone, Debug, Default)]
pub(crate) struct EmployeeManifest {
    pub api_version: String,
    pub kind: String,
    pub metadata: ManifestMetadata,
    pub identity: ManifestIdentity,
    pub skills: Vec<String>,
    pub tools: Vec<String>,
    pub permissions: Vec<String>,
    pub requires: ManifestRequires,
    pub examples: ManifestExamples,
    pub limitations: Vec<String>,
    pub lifecycle: BTreeMap<String, String>,
}

#[derive(Clone, Debug, Default)]
pub(crate) struct ManifestMetadata {
    pub id: String,
    pub name: String,
    pub version: String,
}

#[derive(Clone, Debug, Default)]
pub(crate) struct ManifestIdentity {
    pub title: String,
    pub description: String,
}

#[derive(Clone, Debug, Default)]
pub(crate) struct ManifestRequires {
    pub hermes: String,
    pub runtime: String,
    pub env: Vec<String>,
}

#[derive(Clone, Debug, Default)]
pub(crate) struct ManifestExamples {
    pub inputs: Vec<String>,
    pub outputs: Vec<String>,
}

impl EmployeeManifest {
    pub(crate) fn missing_required_fields(&self) -> Vec<&'static str> {
        let mut missing = Vec::new();
        if self.api_version.is_empty() {
            missing.push("apiVersion");
        }
        if self.kind.is_empty() {
            missing.push("kind");
        }
        if self.metadata.id.is_empty() {
            missing.push("metadata.id");
        }
        if self.metadata.name.is_empty() {
            missing.push("metadata.name");
        }
        if self.metadata.version.is_empty() {
            missing.push("metadata.version");
        }
        if self.identity.title.is_empty() {
            missing.push("identity.title");
        }
        if self.identity.description.is_empty() {
            missing.push("identity.description");
        }
        if self.skills.is_empty() {
            missing.push("skills");
        }
        if self.tools.is_empty() {
            missing.push("tools");
        }
        if self.permissions.is_empty() {
            missing.push("permissions");
        }
        if self.requires.hermes.is_empty() {
            missing.push("requires.hermes");
        }
        if self.requires.runtime.is_empty() {
            missing.push("requires.runtime");
        }
        if self.examples.inputs.is_empty() {
            missing.push("examples.inputs");
        }
        if self.examples.outputs.is_empty() {
            missing.push("examples.outputs");
        }
        if self.limitations.is_empty() {
            missing.push("limitations");
        }
        if self.lifecycle.is_empty() {
            missing.push("lifecycle");
        }
        missing
    }
}

pub(crate) fn validate_registry_local_source(
    name: &str,
    status: &str,
    local_source: Option<&str>,
) -> Result<(), String> {
    if !is_valid_expert_name(name) {
        return Err(format!(
            "Registry expert name must be a lowercase kebab-case slug: {name}"
        ));
    }
    let expected = format!("experts/{name}");
    match (status, local_source) {
        ("available", Some(value)) if value == expected => Ok(()),
        ("available", _) => Err(format!(
            "Registry expert {name} local_source must equal {expected} when status is available"
        )),
        ("coming-soon", None) => Ok(()),
        ("coming-soon", Some(_)) => Err(format!(
            "Registry expert {name} local_source must be null when status is coming-soon"
        )),
        (unknown, _) => Err(format!(
            "Registry expert {name} has unsupported status: {unknown}"
        )),
    }
}

fn is_valid_expert_name(name: &str) -> bool {
    !name.is_empty()
        && name.split('-').all(|part| {
            !part.is_empty()
                && part
                    .bytes()
                    .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit())
        })
}

fn reject_link(path: &Path) -> Result<fs::Metadata, String> {
    let metadata = fs::symlink_metadata(path)
        .map_err(|error| format!("Failed to inspect {}: {error}", path.display()))?;
    if metadata.file_type().is_symlink() {
        return Err(format!(
            "Expert source must not contain symlinks or junctions: {}",
            path.display()
        ));
    }
    Ok(metadata)
}

#[cfg(unix)]
fn has_multiple_hard_links(_path: &Path, metadata: &fs::Metadata) -> Result<bool, String> {
    use std::os::unix::fs::MetadataExt;
    Ok(metadata.nlink() > 1)
}

#[cfg(windows)]
fn windows_file_information(
    file: &File,
    path: &Path,
) -> Result<windows_sys::Win32::Storage::FileSystem::BY_HANDLE_FILE_INFORMATION, String> {
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::Foundation::HANDLE;
    use windows_sys::Win32::Storage::FileSystem::{
        BY_HANDLE_FILE_INFORMATION, GetFileInformationByHandle,
    };

    let mut information = BY_HANDLE_FILE_INFORMATION::default();
    // SAFETY: `file` owns a valid handle for the duration of the call and `information` points to
    // writable storage of the exact structure required by GetFileInformationByHandle.
    let ok =
        unsafe { GetFileInformationByHandle(file.as_raw_handle() as HANDLE, &mut information) };
    if ok == 0 {
        return Err(format!(
            "Failed to inspect hardlinks for {}: {}",
            path.display(),
            std::io::Error::last_os_error()
        ));
    }
    Ok(information)
}

#[cfg(windows)]
fn has_multiple_hard_links(path: &Path, _metadata: &fs::Metadata) -> Result<bool, String> {
    let file =
        File::open(path).map_err(|error| format!("Failed to open {}: {error}", path.display()))?;
    Ok(windows_file_information(&file, path)?.nNumberOfLinks > 1)
}

#[cfg(not(any(unix, windows)))]
fn has_multiple_hard_links(_path: &Path, _metadata: &fs::Metadata) -> Result<bool, String> {
    Ok(false)
}

#[cfg(unix)]
fn same_open_file(left: &File, right: &File, _path: &Path) -> Result<bool, String> {
    use std::os::unix::fs::MetadataExt;
    let left = left
        .metadata()
        .map_err(|error| format!("Failed to inspect open manifest: {error}"))?;
    let right = right
        .metadata()
        .map_err(|error| format!("Failed to inspect current manifest: {error}"))?;
    Ok(left.dev() == right.dev() && left.ino() == right.ino())
}

#[cfg(windows)]
fn same_open_file(left: &File, right: &File, path: &Path) -> Result<bool, String> {
    let left = windows_file_information(left, path)?;
    let right = windows_file_information(right, path)?;
    Ok(left.dwVolumeSerialNumber == right.dwVolumeSerialNumber
        && left.nFileIndexHigh == right.nFileIndexHigh
        && left.nFileIndexLow == right.nFileIndexLow)
}

#[cfg(not(any(unix, windows)))]
fn same_open_file(left: &File, right: &File, _path: &Path) -> Result<bool, String> {
    let left = left
        .metadata()
        .map_err(|error| format!("Failed to inspect open manifest: {error}"))?;
    let right = right
        .metadata()
        .map_err(|error| format!("Failed to inspect current manifest: {error}"))?;
    Ok(left.len() == right.len() && left.modified().ok() == right.modified().ok())
}

fn verify_manifest_path_identity(source: &Path, path: &Path, opened: &File) -> Result<(), String> {
    let metadata = reject_link(path)?;
    if !metadata.is_file() || has_multiple_hard_links(path, &metadata)? {
        return Err(format!(
            "Employee manifest is not a single-link regular file: {}",
            path.display()
        ));
    }
    let canonical_path = fs::canonicalize(path)
        .map_err(|error| format!("Failed to resolve {}: {error}", path.display()))?;
    if !canonical_path.starts_with(source) || canonical_path != path {
        return Err(format!(
            "Employee manifest escapes its expert source: {}",
            path.display()
        ));
    }
    let current =
        File::open(path).map_err(|error| format!("Failed to open {}: {error}", path.display()))?;
    if !same_open_file(opened, &current, path)? {
        return Err(format!(
            "Employee manifest changed while being read: {}",
            path.display()
        ));
    }
    Ok(())
}

fn read_manifest_content_after_open<F>(
    source: &Path,
    path: &Path,
    after_open: F,
) -> Result<String, String>
where
    F: FnOnce(),
{
    let metadata = reject_link(path)?;
    if !metadata.is_file() || has_multiple_hard_links(path, &metadata)? {
        return Err(format!(
            "Employee manifest is not a single-link regular file: {}",
            path.display()
        ));
    }
    let canonical_path = fs::canonicalize(path)
        .map_err(|error| format!("Failed to resolve {}: {error}", path.display()))?;
    if !canonical_path.starts_with(source) || canonical_path != path {
        return Err(format!(
            "Employee manifest escapes its expert source: {}",
            path.display()
        ));
    }

    let mut opened =
        File::open(path).map_err(|error| format!("Failed to open {}: {error}", path.display()))?;
    let opened_before = opened
        .metadata()
        .map_err(|error| format!("Failed to inspect {}: {error}", path.display()))?;
    if !opened_before.is_file() {
        return Err(format!(
            "Employee manifest is not a regular file: {}",
            path.display()
        ));
    }

    after_open();
    verify_manifest_path_identity(source, path, &opened)?;

    let mut bytes = Vec::new();
    opened
        .read_to_end(&mut bytes)
        .map_err(|error| format!("Failed to read {}: {error}", path.display()))?;
    let opened_after = opened
        .metadata()
        .map_err(|error| format!("Failed to inspect {}: {error}", path.display()))?;
    if opened_before.len() != opened_after.len()
        || opened_before.modified().ok() != opened_after.modified().ok()
        || bytes.len() as u64 != opened_after.len()
    {
        return Err(format!(
            "Employee manifest changed while being read: {}",
            path.display()
        ));
    }
    verify_manifest_path_identity(source, path, &opened)?;

    String::from_utf8(bytes)
        .map_err(|error| format!("Employee manifest is not valid UTF-8: {error}"))
}

fn read_manifest_content(source: &Path, path: &Path) -> Result<String, String> {
    read_manifest_content_after_open(source, path, || {})
}

fn validate_link_free_tree(source: &Path, directory: &Path) -> Result<(), String> {
    let entries = fs::read_dir(directory)
        .map_err(|error| format!("Failed to read {}: {error}", directory.display()))?;
    for entry in entries {
        let entry =
            entry.map_err(|error| format!("Failed to read {}: {error}", directory.display()))?;
        let path = entry.path();
        let metadata = reject_link(&path)?;
        let canonical = fs::canonicalize(&path)
            .map_err(|error| format!("Failed to resolve {}: {error}", path.display()))?;
        if !canonical.starts_with(source) || canonical != path {
            return Err(format!(
                "Expert source entry escapes its canonical package root: {}",
                path.display()
            ));
        }
        if metadata.is_dir() {
            validate_link_free_tree(source, &canonical)?;
        } else if !metadata.is_file() {
            return Err(format!(
                "Expert source contains an unsupported file: {}",
                path.display()
            ));
        } else if has_multiple_hard_links(&path, &metadata)? {
            return Err(format!(
                "Expert source must not contain hardlinks: {}",
                path.display()
            ));
        }
    }
    Ok(())
}

pub(crate) fn resolve_local_source(
    root: &Path,
    expert_name: &str,
    local_source: &str,
) -> Result<PathBuf, String> {
    let expected = format!("experts/{expert_name}");
    if local_source != expected {
        return Err(format!(
            "Registry expert {expert_name} local_source must equal {expected}"
        ));
    }

    let canonical_root = fs::canonicalize(root)
        .map_err(|error| format!("Failed to resolve {}: {error}", root.display()))?;
    let experts_dir = root.join("experts");
    let source = experts_dir.join(expert_name);
    let experts_metadata = reject_link(&experts_dir)?;
    if !experts_metadata.is_dir() {
        return Err(format!(
            "Expert source parent is not a directory: {}",
            experts_dir.display()
        ));
    }
    let source_metadata = reject_link(&source)?;
    if !source_metadata.is_dir() {
        return Err(format!(
            "Expert source is not a directory: {}",
            source.display()
        ));
    }

    let canonical_source = fs::canonicalize(&source)
        .map_err(|error| format!("Failed to resolve {}: {error}", source.display()))?;
    let canonical_expected = canonical_root.join("experts").join(expert_name);
    if !canonical_source.starts_with(&canonical_root) || canonical_source != canonical_expected {
        return Err(format!(
            "Expert source escapes the canonical repository root: {}",
            source.display()
        ));
    }

    validate_link_free_tree(&canonical_source, &canonical_source)?;
    Ok(canonical_source)
}

pub(crate) fn read_manifest(
    root: &Path,
    expert_name: &str,
    local_source: &str,
) -> Result<EmployeeManifest, String> {
    let source = resolve_local_source(root, expert_name, local_source)?;
    let path = source.join("hire.yaml");
    let content = read_manifest_content(&source, &path)?;
    Ok(parse_manifest(&content))
}

fn parse_manifest(content: &str) -> EmployeeManifest {
    let mut manifest = EmployeeManifest::default();
    let mut section = String::new();
    let mut subsection = String::new();

    for raw_line in content.lines() {
        let line = raw_line.trim_end();
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }

        let indent = line.chars().take_while(|ch| *ch == ' ').count();
        if indent == 0 {
            subsection.clear();
            if let Some((key, value)) = split_key_value(trimmed) {
                section = key.to_string();
                let value = clean_value(value);
                match key {
                    "apiVersion" => manifest.api_version = value,
                    "kind" => manifest.kind = value,
                    _ => {}
                }
            }
            continue;
        }

        match section.as_str() {
            "metadata" if indent == 2 => {
                if let Some((key, value)) = split_key_value(trimmed) {
                    let value = clean_value(value);
                    match key {
                        "id" => manifest.metadata.id = value,
                        "name" => manifest.metadata.name = value,
                        "version" => manifest.metadata.version = value,
                        _ => {}
                    }
                }
            }
            "identity" if indent == 2 => {
                if let Some((key, value)) = split_key_value(trimmed) {
                    let value = clean_value(value);
                    match key {
                        "title" => manifest.identity.title = value,
                        "description" => manifest.identity.description = value,
                        _ => {}
                    }
                }
            }
            "skills" | "tools" | "permissions" | "limitations" if indent == 2 => {
                if let Some(value) = list_value(trimmed) {
                    match section.as_str() {
                        "skills" => manifest.skills.push(value),
                        "tools" => manifest.tools.push(value),
                        "permissions" => manifest.permissions.push(value),
                        "limitations" => manifest.limitations.push(value),
                        _ => {}
                    }
                }
            }
            "requires" => {
                if indent == 2 {
                    if let Some((key, value)) = split_key_value(trimmed) {
                        let value = clean_value(value);
                        subsection = key.to_string();
                        match key {
                            "hermes" => manifest.requires.hermes = value,
                            "runtime" => manifest.requires.runtime = value,
                            _ => {}
                        }
                    }
                } else if indent == 4
                    && subsection == "env"
                    && let Some(value) = list_value(trimmed)
                {
                    manifest.requires.env.push(value);
                }
            }
            "examples" => {
                if indent == 2 {
                    if let Some((key, _)) = split_key_value(trimmed) {
                        subsection = key.to_string();
                    }
                } else if indent == 4
                    && let Some(value) = list_value(trimmed)
                {
                    match subsection.as_str() {
                        "inputs" => manifest.examples.inputs.push(value),
                        "outputs" => manifest.examples.outputs.push(value),
                        _ => {}
                    }
                }
            }
            "lifecycle" if indent == 2 => {
                if let Some((key, value)) = split_key_value(trimmed) {
                    manifest
                        .lifecycle
                        .insert(key.to_string(), clean_value(value));
                }
            }
            _ => {}
        }
    }

    manifest
}

fn split_key_value(line: &str) -> Option<(&str, &str)> {
    let (key, value) = line.split_once(':')?;
    Some((key.trim(), value.trim()))
}

fn list_value(line: &str) -> Option<String> {
    line.strip_prefix("- ").map(clean_value)
}

fn clean_value(value: &str) -> String {
    let trimmed = value.trim();
    let unquoted = trimmed
        .strip_prefix('"')
        .and_then(|value| value.strip_suffix('"'))
        .or_else(|| {
            trimmed
                .strip_prefix('\'')
                .and_then(|value| value.strip_suffix('\''))
        })
        .unwrap_or(trimmed);
    unquoted.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn unique_test_root(label: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time")
            .as_nanos();
        std::env::temp_dir().join(format!(
            "crewclaw-manifest-{label}-{}-{nonce}",
            std::process::id()
        ))
    }

    #[cfg(unix)]
    fn create_directory_link(target: &Path, link: &Path) {
        std::os::unix::fs::symlink(target, link).expect("create directory symlink");
    }

    #[cfg(windows)]
    fn create_directory_link(target: &Path, link: &Path) {
        let escape = |path: &Path| path.to_string_lossy().replace('\'', "''");
        let command = format!(
            "New-Item -ItemType Junction -Path '{}' -Target '{}' | Out-Null",
            escape(link),
            escape(target)
        );
        let output = std::process::Command::new("powershell.exe")
            .args(["-NoProfile", "-NonInteractive", "-Command", &command])
            .output()
            .expect("run PowerShell");
        assert!(
            output.status.success(),
            "create junction: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    #[cfg(unix)]
    fn remove_directory_link(link: &Path) {
        fs::remove_file(link).expect("remove directory symlink");
    }

    #[cfg(windows)]
    fn remove_directory_link(link: &Path) {
        fs::remove_dir(link).expect("remove junction");
    }

    #[test]
    fn parses_employee_manifest_sections() {
        let manifest = parse_manifest(
            r#"
apiVersion: crewclaw/v1
kind: Employee
metadata:
  id: macao-networking-agent
  name: Macao Networking Agent
  version: 0.1.0
identity:
  title: Macao Networking Specialist
  description: "Finds leads."
skills:
  - icebreaker
tools:
  - browser
permissions:
  - public_web:read
requires:
  hermes: ">=0.12.0"
  runtime: openclaw
  env:
    - HERMES_MODEL
examples:
  inputs:
    - "Find an event."
  outputs:
    - "Event list."
limitations:
  - No private contacts.
lifecycle:
  hireable: true
"#,
        );

        assert_eq!(manifest.metadata.id, "macao-networking-agent");
        assert_eq!(manifest.identity.description, "Finds leads.");
        assert_eq!(manifest.permissions, vec!["public_web:read"]);
        assert_eq!(manifest.requires.env, vec!["HERMES_MODEL"]);
        assert_eq!(manifest.examples.inputs, vec!["Find an event."]);
        assert!(manifest.missing_required_fields().is_empty());
    }

    #[test]
    fn enforces_registry_status_and_local_source_contract() {
        assert!(
            validate_registry_local_source(
                "code-review-shrimp",
                "available",
                Some("experts/code-review-shrimp")
            )
            .is_ok()
        );
        assert!(validate_registry_local_source("docs-octopus", "coming-soon", None).is_ok());

        for local_source in [
            "../../outside",
            "/tmp/outside",
            r"C:\outside",
            "experts/product-prd-crab",
        ] {
            assert!(
                validate_registry_local_source(
                    "code-review-shrimp",
                    "available",
                    Some(local_source)
                )
                .is_err(),
                "accepted unsafe local_source: {local_source}"
            );
        }
        assert!(
            validate_registry_local_source(
                "docs-octopus",
                "coming-soon",
                Some("experts/docs-octopus")
            )
            .is_err()
        );
        assert!(
            validate_registry_local_source("../outside", "available", Some("experts/../outside"))
                .is_err()
        );
    }

    #[test]
    fn resolves_only_the_exact_canonical_expert_source() {
        let root = unique_test_root("canonical");
        let source = root.join("experts/code-review-shrimp");
        fs::create_dir_all(&source).expect("create source");

        let resolved =
            resolve_local_source(&root, "code-review-shrimp", "experts/code-review-shrimp")
                .expect("resolve canonical source");
        assert_eq!(
            resolved,
            fs::canonicalize(&source).expect("canonical source")
        );
        for local_source in [
            "../code-review-shrimp",
            "/tmp/code-review-shrimp",
            r"C:\code-review-shrimp",
            "experts/product-prd-crab",
        ] {
            assert!(
                resolve_local_source(&root, "code-review-shrimp", local_source).is_err(),
                "accepted unsafe local_source: {local_source}"
            );
        }

        fs::remove_dir_all(root).expect("remove test root");
    }

    #[test]
    fn rejects_a_symlink_or_junction_as_the_expert_source() {
        let root = unique_test_root("source-link");
        let outside = root.join("outside");
        let source = root.join("experts/code-review-shrimp");
        fs::create_dir_all(root.join("experts")).expect("create experts directory");
        fs::create_dir_all(&outside).expect("create outside directory");
        create_directory_link(&outside, &source);

        let error = resolve_local_source(&root, "code-review-shrimp", "experts/code-review-shrimp")
            .expect_err("source link must be rejected");
        assert!(error.contains("symlinks or junctions") || error.contains("escapes"));

        remove_directory_link(&source);
        fs::remove_dir_all(root).expect("remove test root");
    }

    #[test]
    fn rejects_a_symlink_or_junction_nested_in_the_expert_source() {
        let root = unique_test_root("nested-link");
        let outside = root.join("outside");
        let source = root.join("experts/code-review-shrimp");
        let nested = source.join("nested");
        fs::create_dir_all(&source).expect("create source");
        fs::create_dir_all(&outside).expect("create outside directory");
        create_directory_link(&outside, &nested);

        let error = resolve_local_source(&root, "code-review-shrimp", "experts/code-review-shrimp")
            .expect_err("nested link must be rejected");
        assert!(error.contains("symlinks or junctions") || error.contains("escapes"));

        remove_directory_link(&nested);
        fs::remove_dir_all(root).expect("remove test root");
    }

    #[test]
    fn rejects_a_hardlink_nested_in_the_expert_source() {
        let root = unique_test_root("nested-hardlink");
        let source = root.join("experts/code-review-shrimp");
        let outside = root.join("outside-secret.txt");
        fs::create_dir_all(&source).expect("create source");
        fs::write(&outside, "outside secret").expect("write outside source");
        fs::hard_link(&outside, source.join("SKILL.md")).expect("create hardlink");

        let error = resolve_local_source(&root, "code-review-shrimp", "experts/code-review-shrimp")
            .expect_err("nested hardlink must be rejected");
        assert!(error.contains("hardlinks"));

        fs::remove_dir_all(root).expect("remove test root");
    }

    #[test]
    fn rejects_a_manifest_replaced_after_its_handle_is_opened() {
        let root = unique_test_root("manifest-swap");
        let requested_source = root.join("experts/code-review-shrimp");
        let requested_manifest = requested_source.join("hire.yaml");
        fs::create_dir_all(&requested_source).expect("create source");
        fs::write(&requested_manifest, "apiVersion: crewclaw/v1\n").expect("write manifest");
        let source = fs::canonicalize(&requested_source).expect("canonical source");
        let manifest = source.join("hire.yaml");
        let original = source.join("hire.original.yaml");

        let result = read_manifest_content_after_open(&source, &manifest, || {
            fs::rename(&manifest, &original).expect("move open manifest");
            fs::write(&manifest, "apiVersion: attacker/v1\n").expect("replace manifest");
        });

        let error = result.expect_err("a swapped manifest path must fail closed");
        assert!(error.contains("changed while being read"));
        fs::remove_dir_all(root).expect("remove test root");
    }
}
