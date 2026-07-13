use std::io::Write;

use super::{
    protocol::UserAction,
    state::{AppState, UiState},
};

pub(crate) fn should_route_pending_action_digit(
    state: &AppState,
    ui_state: &UiState,
    input_empty: bool,
    ch: char,
) -> bool {
    if state.approval.is_some()
        || state.pending_actions.is_empty()
        || ui_state.drawer.is_some()
        || ui_state.overlay.is_some()
        || !input_empty
        || !('1'..='9').contains(&ch)
    {
        return false;
    }

    state.pending_action_for_key(ch).is_some()
}

pub(crate) fn user_action_for_pending_digit(
    state: &AppState,
    ui_state: &UiState,
    input_empty: bool,
    ch: char,
) -> Option<UserAction> {
    if !should_route_pending_action_digit(state, ui_state, input_empty, ch) {
        return None;
    }
    let action = state.pending_action_for_key(ch)?;
    Some(UserAction::pending_run(
        action.key.clone(),
        action.command.clone(),
    ))
}

pub(crate) fn artifact_action_for_selected(
    state: &AppState,
    action_type: &str,
) -> Option<UserAction> {
    state
        .selected_artifact_id()
        .map(|id| UserAction::artifact(action_type, id))
}

// 泛型化到 `impl Write`：线上仍传 ChildStdin，但让 await_engine_boot 之类逻辑可用 mock writer 做单测。
pub(crate) fn write_user_action<W: Write + ?Sized>(
    child_stdin: &mut W,
    action: &UserAction,
) -> Result<(), String> {
    let line = serde_json::to_string(action)
        .map_err(|error| format!("Failed to serialize UserAction: {error}"))?;
    writeln!(child_stdin, "{line}")
        .map_err(|error| format!("Failed to write user action to Node runtime stdin: {error}"))?;
    child_stdin
        .flush()
        .map_err(|error| format!("Failed to flush Node runtime stdin: {error}"))
}
