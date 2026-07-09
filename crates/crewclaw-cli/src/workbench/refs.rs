use super::{
    fuzzy,
    protocol::ResolvedReference,
    state::{AppState, RefPicker, ReferenceCandidate},
};

pub(crate) fn reference_candidates(state: &AppState, query: &str) -> Vec<ReferenceCandidate> {
    let query = query.trim_start_matches('@').to_string();
    let mut candidates = Vec::new();

    for artifact in &state.artifacts {
        let Some(id) = artifact.id.as_deref() else {
            continue;
        };
        let label = artifact.name.as_deref().unwrap_or(id);
        candidates.push(ReferenceCandidate {
            kind: "artifact".to_string(),
            id: id.to_string(),
            label: label.to_string(),
            token: format!("@artifact:{id}"),
        });
    }

    if let Some(task) = &state.task {
        if let Some(id) = task.id.as_deref() {
            candidates.push(ReferenceCandidate {
                kind: "task".to_string(),
                id: id.to_string(),
                label: task.title.clone(),
                token: format!("@task:{id}"),
            });
        }
    }

    if let Some(employee) = &state.employee {
        candidates.push(ReferenceCandidate {
            kind: "employee".to_string(),
            id: employee.name.clone(),
            label: employee.role.clone(),
            token: "@employee".to_string(),
        });
    }

    // v0.8 M3: fuzzy rank on kind/id/label so an out-of-order subsequence still finds an artifact.
    fuzzy::rank(candidates, &query, |candidate| {
        format!("{} {} {}", candidate.kind, candidate.id, candidate.label)
    })
}

pub(crate) fn picker_for_query(state: &AppState, query: &str) -> Option<RefPicker> {
    let candidates = reference_candidates(state, query);
    if candidates.is_empty() {
        return None;
    }
    Some(RefPicker {
        query: query.to_string(),
        selected: 0,
        candidates,
    })
}

pub(crate) fn resolve_references(state: &AppState, text: &str) -> Vec<ResolvedReference> {
    let mut refs = Vec::new();
    for artifact in &state.artifacts {
        let Some(id) = artifact.id.as_deref() else {
            continue;
        };
        let label = artifact.name.as_deref().unwrap_or(id);
        if text.contains(&format!("@artifact:{id}")) || text.contains(&format!("@{label}")) {
            refs.push(ResolvedReference {
                kind: "artifact".to_string(),
                id: id.to_string(),
                label: label.to_string(),
            });
        }
    }
    if let Some(task) = &state.task {
        if let Some(id) = task.id.as_deref() {
            if text.contains(&format!("@task:{id}")) || text.contains("@current-task") {
                refs.push(ResolvedReference {
                    kind: "task".to_string(),
                    id: id.to_string(),
                    label: task.title.clone(),
                });
            }
        }
    }
    if let Some(employee) = &state.employee {
        if text.contains(&format!("@{}", employee.name)) || text.contains("@employee") {
            refs.push(ResolvedReference {
                kind: "employee".to_string(),
                id: employee.name.clone(),
                label: employee.role.clone(),
            });
        }
    }
    refs
}
