use super::super::state::AppState;

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct ArtifactPanelRow {
    pub marker: &'static str,
    pub status: String,
    pub name: String,
    pub details: Vec<String>,
}

pub(crate) fn artifact_panel_rows(state: &AppState) -> Vec<ArtifactPanelRow> {
    state
        .artifacts
        .iter()
        .map(|artifact| {
            let selected = artifact.id.as_deref() == state.selected_artifact.as_deref();
            let mut details = Vec::new();
            if let Some(path) = &artifact.path {
                details.push(path.clone());
            }
            if let Some(summary) = &artifact.summary {
                details.push(summary.clone());
            }
            details.extend(artifact.checks.iter().map(|check| format!("? {check}")));

            ArtifactPanelRow {
                marker: if selected { ">" } else { " " },
                status: artifact.status.clone(),
                name: artifact
                    .name
                    .clone()
                    .unwrap_or_else(|| "(unnamed)".to_string()),
                details,
            }
        })
        .collect()
}
