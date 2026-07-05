use super::super::state::AppState;

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct ArtifactPreviewRow {
    pub title: String,
    pub detail: String,
}

pub(crate) fn artifact_preview_row(state: &AppState) -> Option<ArtifactPreviewRow> {
    let preview = state.preview.as_ref()?;
    Some(ArtifactPreviewRow {
        title: preview.title.clone(),
        detail: preview.detail.clone(),
    })
}
