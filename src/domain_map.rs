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

/// Badge wording for a persisted status string.
pub fn status_label(status_row: &str) -> &'static str {
    match status_row {
        "approved" => "Approved",
        "changes_requested" => "Changes requested",
        "pending" | "submitted" => "Pending review",
        _ => "Unknown",
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

/// Transaction history `details` JSON rendered as organizer-facing
/// (label, value) rows. Internal keys and minor units never reach the page;
/// unknown shapes fall back to a single "Details" row with the raw text.
pub fn history_facts(
    details: &str,
    member_name: &dyn Fn(i64) -> Option<String>,
) -> Vec<(String, String)> {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(details) else {
        return if details.trim().is_empty() { vec![] } else { vec![("Details".into(), details.into())] };
    };
    let Some(map) = value.as_object() else {
        return vec![];
    };
    let name = |v: &serde_json::Value| -> String {
        v.as_i64()
            .and_then(member_name)
            .unwrap_or_else(|| "Unassigned".into())
    };
    let snapshot = |snap: &serde_json::Value| -> Vec<(String, String)> {
        let mut rows = Vec::new();
        let Some(s) = snap.as_object() else { return rows };
        if let Some(e) = s.get("explanation").and_then(|v| v.as_str()) {
            rows.push(("Explanation".into(), if e.is_empty() { "—".into() } else { e.into() }));
        }
        if let Some(r) = s.get("responsible_member_id") {
            rows.push(("Responsible member".into(), name(r)));
        }
        if let Some(p) = s.get("purposes").and_then(|v| v.as_array()) {
            let list: Vec<String> = p
                .iter()
                .map(|x| {
                    format!(
                        "{} · {} · {}",
                        x.get("label").and_then(|v| v.as_str()).unwrap_or("—"),
                        x.get("amount_minor").and_then(|v| v.as_i64()).map(crate::fmt::fmt_money).unwrap_or_else(|| "—".into()),
                        name(x.get("responsible_member_id").unwrap_or(&serde_json::Value::Null))
                    )
                })
                .collect();
            rows.push(("Purposes".into(), if list.is_empty() { "None".into() } else { list.join("\n") }));
        }
        if let Some(r) = s.get("evidence_unavailable_reason").and_then(|v| v.as_str()) {
            if !r.is_empty() {
                rows.push(("Document-unavailable reason".into(), r.into()));
            }
        }
        rows
    };
    let mut rows = Vec::new();
    if let (Some(before), Some(after)) = (map.get("before"), map.get("after")) {
        let (b, a) = (snapshot(before), snapshot(after));
        for (label, after_value) in a {
            let before_value = b.iter().find(|(l, _)| *l == label).map(|(_, v)| v.clone());
            match before_value {
                Some(ref bv) if *bv == after_value => {}
                Some(bv) => rows.push((label, format!("{bv}\n→ {after_value}"))),
                None => rows.push((label, after_value)),
            }
        }
        if rows.is_empty() {
            rows.push(("Changes".into(), "No substantive change".into()));
        }
        return rows;
    }
    for (key, value) in map {
        let label = match key.as_str() {
            "note" => "Note",
            "reason" => "Reason",
            "filename" => "File",
            other => other,
        };
        let text = match value {
            serde_json::Value::String(s) => s.clone(),
            other => other.to_string(),
        };
        if !text.is_empty() {
            rows.push((label.to_string(), text));
        }
    }
    rows
}

#[cfg(test)]
mod history_tests {
    use super::*;

    #[test]
    fn history_facts_show_names_and_money_not_internals() {
        let names = |id: i64| (id == 1).then(|| "Alice".to_string());
        let rows = history_facts(
            r#"{"before":{"explanation":"","responsible_member_id":1,"purposes":[],"evidence_unavailable_reason":""},
                "after":{"explanation":"Cloud","responsible_member_id":1,"purposes":[{"label":"Hosting","amount_minor":12000000,"responsible_member_id":1}],"evidence_unavailable_reason":"No receipt"}}"#,
            &names,
        );
        let text = rows.iter().map(|(l, v)| format!("{l}: {v}")).collect::<Vec<_>>().join("\n");
        assert!(text.contains("Explanation: —\n→ Cloud"), "{text}");
        assert!(text.contains("Hosting · Rp 120.000 · Alice"), "{text}");
        assert!(!text.contains("amount_minor") && !text.contains("member_id"), "{text}");
        assert!(!text.contains("Responsible member"), "unchanged rows are omitted: {text}");
        assert_eq!(history_facts(r#"{"note":""}"#, &names), vec![]);
        assert_eq!(history_facts(r#"{"reason":"Old"}"#, &names), vec![("Reason".into(), "Old".into())]);
    }
}
