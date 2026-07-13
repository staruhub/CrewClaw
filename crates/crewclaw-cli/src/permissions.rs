#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum DefaultPermissionClass {
    Granted,
    Pending,
    Disabled,
}

// Automatic grants must remain an explicit, auditable list. A shape such as `*:read`
// is not intrinsically safe: `secrets:read` and `contacts:read` are reads too.
const SAFE_DEFAULT_PERMISSIONS: &[&str] = &[
    "git_diff:read",
    "prd_docs:read",
    "public_web:read",
    "repo_files:read",
];

pub(crate) fn classify_default_permission(permission: &str) -> DefaultPermissionClass {
    if permission.split(':').any(|field| field == "disabled") {
        DefaultPermissionClass::Disabled
    } else if is_safe_default_permission(permission) {
        DefaultPermissionClass::Granted
    } else {
        DefaultPermissionClass::Pending
    }
}

pub(crate) fn is_safe_default_permission(permission: &str) -> bool {
    SAFE_DEFAULT_PERMISSIONS.contains(&permission)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_explicit_low_risk_permissions_are_safe_by_default() {
        for permission in SAFE_DEFAULT_PERMISSIONS {
            assert_eq!(
                classify_default_permission(permission),
                DefaultPermissionClass::Granted
            );
        }
        for permission in [
            "secrets:read",
            "contacts:read",
            "*:read",
            "internal_docs:read:with_consent",
            "deploy:human_confirmation_required",
        ] {
            assert_eq!(
                classify_default_permission(permission),
                DefaultPermissionClass::Pending,
                "{permission}"
            );
        }
        assert_eq!(
            classify_default_permission("code:write:disabled"),
            DefaultPermissionClass::Disabled
        );
    }
}
