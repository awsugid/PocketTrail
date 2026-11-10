//! Mapping between the runtime's persisted strings and domain enums.
//! Pure, testable natively.
//!
//! Runtime status vocabulary (agreed with the UI contract):
//! `pending | approved | changes_requested`. Domain distinguishes `Draft`
//! (documentation incomplete) from `Submitted` (complete, awaiting review);
//! the runtime stores both as `pending` and derives the domain state from
//! documentation completeness.

use pockettrail_domain::{DocumentationStatus, Permission};
use std::collections::BTreeSet;

pub fn status_to_runtime(s: DocumentationStatus) -> &'static str {
    match s {
        DocumentationStatus::Draft | DocumentationStatus::Submitted => "pending",
        DocumentationStatus::ChangesRequested => "changes_requested",
        DocumentationStatus::Approved => "approved",
    }
}

/// Domain status for a persisted transaction. `complete` means documentation
/// would pass `validate_documentation` (explanation + complete split +
/// evidence or explicit unavailable reason).
pub fn runtime_status(status_row: &str, complete: bool) -> DocumentationStatus {
    match status_row {
        "approved" => DocumentationStatus::Approved,
        "changes_requested" => DocumentationStatus::ChangesRequested,
        _ => {
            if complete {
                DocumentationStatus::Submitted
            } else {
                DocumentationStatus::Draft
            }
        }
    }
}

/// Transactions still owing documentation (reminders/digest chase these);
/// `Submitted` items await review by somebody else and are not chased.
pub fn documentation_owed(status_row: &str, complete: bool) -> bool {
    matches!(
        runtime_status(status_row, complete),
        DocumentationStatus::Draft | DocumentationStatus::ChangesRequested
    )
}

/// Organizer-facing explanation of a domain rejection. `DomainError`'s
/// `Display` is for logs; it names internal states (Draft/Submitted) that the
/// UI never shows.
pub fn user_message(e: &pockettrail_domain::DomainError) -> String {
    use pockettrail_domain::DomainError::*;
    use DocumentationStatus as S;
    match e {
        NoMembership | InactiveMembership => "you are not an active member of this organization".into(),
        NotAuthorized { required } => format!(
            "your role does not include “{}”",
            perm_label(*required)
        ),
        WrongOrganization => "this record belongs to a different organization".into(),
        IncompleteDocumentation(what) => format!("documentation is incomplete: {what}"),
        PurposeTotalMismatch { .. } => "purpose allocations must add up to the bank amount".into(),
        InvalidStatus { actual: S::Draft, .. } => "the explanation, purposes, and evidence must be completed before it can be reviewed".into(),
        InvalidStatus { actual: S::Approved, .. } => "it is already approved; edit details or evidence to reopen review".into(),
        InvalidStatus { actual: S::ChangesRequested, .. } => "changes were requested; the responsible member must save details before review".into(),
        InvalidStatus { actual: S::Submitted, .. } => "it is already awaiting review".into(),
        SelfApprovalDenied => "a member responsible for any part of a transaction cannot approve it".into(),
        ResponsibleMemberInactive { .. } => "a responsible member is no longer active; reassign first".into(),
        InvalidAmount { .. } => "amount must be a positive IDR value".into(),
        InvalidPurpose { reason, .. } => format!("a purpose is invalid: {reason}"),
        InvalidQuantity { .. } => "stock cannot go below zero".into(),
        MissingReason => "a reason is required".into(),
    }
}

pub fn perm_variant(p: Permission) -> &'static str {
    match p {
        Permission::ViewTransactions => "ViewTransactions",
        Permission::CommentTransactions => "CommentTransactions",
        Permission::DocumentTransactions => "DocumentTransactions",
        Permission::ApproveTransactions => "ApproveTransactions",
        Permission::ImportStatements => "ImportStatements",
        Permission::ManageRoles => "ManageRoles",
        Permission::ManageMembers => "ManageMembers",
        Permission::ManageNotifications => "ManageNotifications",
        Permission::SuppressNotifications => "SuppressNotifications",
        Permission::UpdateStock => "UpdateStock",
    }
}

pub fn perm_label(p: Permission) -> &'static str {
    match p {
        Permission::ViewTransactions => "View transactions",
        Permission::CommentTransactions => "Comment on transactions",
        Permission::DocumentTransactions => "Document transactions",
        Permission::ApproveTransactions => "Approve or request changes",
        Permission::ImportStatements => "Import statements and manage actor mappings",
        Permission::ManageRoles => "Manage roles",
        Permission::ManageMembers => "Manage members",
        Permission::ManageNotifications => "Manage notifications",
        Permission::SuppressNotifications => "Suppress transaction notifications",
        Permission::UpdateStock => "Update stock",
    }
}

/// All permissions as (variant id, human label) for the roles editor.
pub fn permission_options() -> Vec<(String, String)> {
    use Permission::*;
    [
        ViewTransactions,
        CommentTransactions,
        DocumentTransactions,
        ApproveTransactions,
        ImportStatements,
        ManageRoles,
        ManageMembers,
        ManageNotifications,
        SuppressNotifications,
        UpdateStock,
    ]
    .into_iter()
    .map(|p| (perm_variant(p).to_string(), perm_label(p).to_string()))
    .collect()
}

/// Parse a role row's permissions JSON (`["ViewTransactions",...]`).
pub fn parse_role_permissions(json: &str) -> BTreeSet<Permission> {
    serde_json::from_str(json).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn user_messages_hide_internal_states() {
        use pockettrail_domain::DomainError;
        let m = user_message(&DomainError::InvalidStatus {
            expected: DocumentationStatus::Submitted,
            actual: DocumentationStatus::Draft,
        });
        assert!(!m.contains("Draft") && !m.contains("Submitted"), "{m}");
        assert!(m.contains("completed"));
        assert!(user_message(&DomainError::SelfApprovalDenied).contains("cannot approve"));
    }

    #[test]
    fn status_mapping() {
        assert_eq!(
            status_to_runtime(runtime_status("pending", true)),
            "pending"
        );
        assert_eq!(
            status_to_runtime(runtime_status("pending", false)),
            "pending"
        );
        assert_eq!(
            status_to_runtime(runtime_status("approved", true)),
            "approved"
        );
        assert_eq!(
            status_to_runtime(runtime_status("changes_requested", false)),
            "changes_requested"
        );
        // Draft and Submitted differ at the domain layer even though both
        // persist as "pending".
        assert_ne!(
            runtime_status("pending", true),
            runtime_status("pending", false)
        );
        // Reminders chase incomplete docs; submitted items await review.
        assert!(documentation_owed("pending", false));
        assert!(!documentation_owed("pending", true));
        assert!(documentation_owed("changes_requested", false));
        assert!(!documentation_owed("approved", true));
    }

    #[test]
    fn permissions_roundtrip() {
        let set: BTreeSet<Permission> = [Permission::ViewTransactions, Permission::UpdateStock]
            .into_iter()
            .collect();
        let json = serde_json::to_string(&set).unwrap();
        assert_eq!(parse_role_permissions(&json), set);
        assert!(parse_role_permissions("[]").is_empty());
        assert!(parse_role_permissions("garbage").is_empty());
        let opts = permission_options();
        assert_eq!(opts.len(), 10);
        assert!(opts.iter().any(|(id, _)| id == "SuppressNotifications"));
    }
}
