use std::collections::BTreeMap;
use std::fs;
use std::path::Path;

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

pub(crate) fn read_manifest(root: &Path, local_source: &str) -> Result<EmployeeManifest, String> {
    let path = root.join(local_source).join("hire.yaml");
    let content = fs::read_to_string(&path)
        .map_err(|error| format!("Failed to read {}: {error}", path.display()))?;
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
                } else if indent == 4 && subsection == "env" {
                    if let Some(value) = list_value(trimmed) {
                        manifest.requires.env.push(value);
                    }
                }
            }
            "examples" => {
                if indent == 2 {
                    if let Some((key, _)) = split_key_value(trimmed) {
                        subsection = key.to_string();
                    }
                } else if indent == 4 {
                    if let Some(value) = list_value(trimmed) {
                        match subsection.as_str() {
                            "inputs" => manifest.examples.inputs.push(value),
                            "outputs" => manifest.examples.outputs.push(value),
                            _ => {}
                        }
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
}
