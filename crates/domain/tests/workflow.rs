//! Scenario coverage required by the product rules.

use std::collections::BTreeSet;

use pockettrail_domain::*;

const SPENDER: &str = "spender";
const REVIEWER: &str = "reviewer";
const ORGANIZER2: &str = "organizer2";
const ADMIN: &str = "admin";

fn treasurer_role() -> Role {
    Role {
        name: "Treasurer".into(),
        permissions: BTreeSet::from([
            Permission::ViewTransactions,
            Permission::CommentTransactions,
            Permission::DocumentTransactions,
            Permission::ApproveTransactions,
        ]),
    }
}

fn admin_role() -> Role {
    Role {
        name: "Admin".into(),
        permissions: BTreeSet::from([
            Permission::ViewTransactions,
            Permission::CommentTransactions,
            Permission::ManageNotifications,
            Permission::SuppressNotifications,
            Permission::ManageMembers,
            Permission::ManageRoles,
            Permission::UpdateStock,
        ]),
    }
}

fn org() -> Organization {
    let mut org = Organization::new("org-1", "AWS User Group Jakarta");
    org.roles.insert(RoleId::new("treasurer"), treasurer_role());
    org.roles.insert(RoleId::new("admin"), admin_role());
    for user_name in [SPENDER, REVIEWER, ORGANIZER2] {
        org.members.insert(
            UserId::new(user_name),
            Member {
                role_ids: BTreeSet::from([RoleId::new("treasurer")]),
                active: true,
            },
        );
    }
    org.members.insert(
        UserId::new(ADMIN),
        Member {
            role_ids: BTreeSet::from([RoleId::new("admin")]),
            active: true,
        },
    );
    org
}

fn split_txn(org_id: &str) -> Transaction {
    Transaction {
        id: TransactionId::new("t-1"),
        organization_id: OrgId::new(org_id),
        pocket_id: PocketId::new("main"),
        jago_transaction_id: Some("jago-0001".into()),
        direction: Direction::Outflow,
        amount: 15_000_000,
        date: "2026-02-01".into(),
        purposes: vec![
            Purpose::new("p-food", "Meetup food", 9_000_000, SPENDER),
            Purpose::new("p-swag", "Swag reprint", 6_000_000, ORGANIZER2),
        ],
        documentation: Documentation::new("Monthly meetup costs", vec!["receipt-1".into()]),
        status: DocumentationStatus::Draft,
        suppression: None,
        comments: Vec::new(),
        approval_exclusions: BTreeSet::new(),
    }
}

fn user(name: &str) -> UserId {
    UserId::new(name)
}

#[test]
fn cross_organization_access_denied() {
    let org_a = org();
    let org_b = Organization::new("org-b", "Other Org");
    let mut foreign = split_txn("org-b");

    // REVIEWER has no membership in org-b at all.
    assert_eq!(
        authorize(&org_b, &user(REVIEWER), Permission::ApproveTransactions),
        Err(DomainError::NoMembership)
    );
    // Acting on a foreign transaction through the reviewer's own organization
    // is rejected by the organization guard before anything else.
    assert_eq!(
        approve_transaction(&org_a, &mut foreign, &user(REVIEWER)),
        Err(DomainError::WrongOrganization)
    );
    // Acting via the foreign organization is rejected by membership.
    assert_eq!(
        approve_transaction(&org_b, &mut foreign, &user(REVIEWER)),
        Err(DomainError::NoMembership)
    );
    // Foreign transactions never leak into notification assembly.
    assert!(build_notifications(&org_a, &[foreign]).is_empty());
}

#[test]
fn former_members_denied_everywhere() {
    let mut org = org();
    let mut txn = split_txn("org-1");
    submit_transaction(&org, &mut txn, &user(SPENDER)).unwrap();

    // Membership mutations are gated; a plain treasurer cannot remove.
    assert_eq!(
        remove_member(&mut org, &user(SPENDER), &user(REVIEWER)),
        Err(DomainError::NotAuthorized {
            required: Permission::ManageMembers
        })
    );
    remove_member(&mut org, &user(ADMIN), &user(SPENDER)).unwrap();
    // Record kept for attribution, but access is gone.
    assert!(org.members.contains_key(&user(SPENDER)));
    assert_eq!(
        authorize(&org, &user(SPENDER), Permission::DocumentTransactions),
        Err(DomainError::InactiveMembership)
    );
    assert_eq!(
        approve_transaction(&org, &mut txn, &user(SPENDER)),
        Err(DomainError::InactiveMembership)
    );
    assert_eq!(
        submit_transaction(&org, &mut txn, &user(SPENDER)),
        Err(DomainError::InactiveMembership)
    );

    // And notifications stop: no reminder or digest to the former member,
    // even though they are still recorded as responsible.
    org.notifications_enabled = true;
    let out = build_notifications(&org, &[txn]);
    assert!(!out.iter().any(|n| n.recipient == user(SPENDER)));
}

#[test]
fn responsible_member_cannot_approve_split_transaction() {
    let org = org();
    let mut txn = split_txn("org-1");
    submit_transaction(&org, &mut txn, &user(SPENDER)).unwrap();

    // SPENDER is responsible for one purpose of two: denied.
    assert_eq!(
        approve_transaction(&org, &mut txn, &user(SPENDER)),
        Err(DomainError::SelfApprovalDenied)
    );
    // ORGANIZER2 is responsible for the other purpose: also denied.
    assert_eq!(
        approve_transaction(&org, &mut txn, &user(ORGANIZER2)),
        Err(DomainError::SelfApprovalDenied)
    );
    // Without another eligible approver the transaction stays pending.
    assert_eq!(txn.status, DocumentationStatus::Submitted);

    // REVIEWER is responsible for no part: approves the whole transaction,
    // every purpose included.
    approve_transaction(&org, &mut txn, &user(REVIEWER)).unwrap();
    assert_eq!(txn.status, DocumentationStatus::Approved);
}

#[test]
fn purpose_totals_must_equal_bank_amount() {
    let org = org();
    let mut txn = split_txn("org-1");
    txn.amount = 1_000_000;
    txn.purposes = vec![
        Purpose::new("p-1", "Food", 600_000, SPENDER),
        Purpose::new("p-2", "Drinks", 500_000, ORGANIZER2),
    ];
    assert_eq!(
        submit_transaction(&org, &mut txn, &user(SPENDER)),
        Err(DomainError::PurposeTotalMismatch {
            bank_amount: 1_000_000,
            purpose_total: 1_100_000,
        })
    );
    assert_eq!(txn.status, DocumentationStatus::Draft);

    // Same rule when editing allocations later.
    txn.amount = 15_000_000;
    let bad = vec![Purpose::new("p-1", "Food", 9_000_000, SPENDER)];
    assert_eq!(
        set_purposes(&org, &mut txn, &user(SPENDER), bad),
        Err(DomainError::PurposeTotalMismatch {
            bank_amount: 15_000_000,
            purpose_total: 9_000_000,
        })
    );
}

#[test]
fn suppression_stops_mentions_digest_and_reminders() {
    let mut org = org();
    set_notifications_enabled(&mut org, &user(ADMIN), true).unwrap();
    let mut txn = split_txn("org-1");
    submit_transaction(&org, &mut txn, &user(SPENDER)).unwrap();
    // Reviewer asks changes: documentation is owed again, so reminders and
    // digests exist for this transaction.
    request_changes(&org, &mut txn, &user(REVIEWER)).unwrap();
    add_comment(
        &org,
        &mut txn,
        &user(REVIEWER),
        "@spender please attach the invoice",
        vec![user(SPENDER)],
        "2026-02-02T10:00:00Z",
    )
    .unwrap();

    // Before suppression: both responsible members get reminders and digest
    // entries, plus one mention: 5 notifications.
    let out = build_notifications(&org, &[txn.clone()]);
    assert_eq!(
        out.len(),
        5,
        "2 reminders + 2 digests + 1 mention while changes are requested, got {out:?}"
    );

    // Only authorized members may suppress; others are denied.
    assert_eq!(
        suppress_transaction_notifications(
            &org,
            &mut txn,
            &user(REVIEWER),
            "should not work",
            "2026-02-02T11:00:00Z",
        ),
        Err(DomainError::NotAuthorized {
            required: Permission::SuppressNotifications
        })
    );
    // A reason is required.
    assert_eq!(
        suppress_transaction_notifications(&org, &mut txn, &user(ADMIN), "  ", "x"),
        Err(DomainError::MissingReason)
    );
    suppress_transaction_notifications(
        &org,
        &mut txn,
        &user(ADMIN),
        "Imported before mapping; handled offline",
        "2026-02-02T11:00:00Z",
    )
    .unwrap();

    // Suppression covers mentions, reminders, and digests alike.
    assert!(is_suppressed(&txn));
    assert!(build_notifications(&org, &[txn.clone()]).is_empty());
    // It records author and reason, stays visible, and does not approve.
    assert_eq!(txn.status, DocumentationStatus::ChangesRequested);
    let s = txn.suppression.as_ref().unwrap();
    assert_eq!(s.author, user(ADMIN));
    assert_eq!(s.reason, "Imported before mapping; handled offline");

    // Retained until an authorized member changes it.
    unsuppress_transaction_notifications(&org, &mut txn, &user(ADMIN)).unwrap();
    assert_eq!(build_notifications(&org, &[txn]).len(), 5);
}

#[test]
fn no_notifications_until_organization_enables_them() {
    let mut org = org();
    // Default state after creation, and after any import/mapping flow: off.
    assert!(!org.notifications_enabled);
    let mut txn = split_txn("org-1");
    submit_transaction(&org, &mut txn, &user(SPENDER)).unwrap();
    add_comment(
        &org,
        &mut txn,
        &user(REVIEWER),
        "ping",
        vec![user(SPENDER)],
        "t",
    )
    .unwrap();
    assert!(build_notifications(&org, &[txn.clone()]).is_empty());

    // Enabling requires ManageNotifications.
    assert_eq!(
        set_notifications_enabled(&mut org, &user(SPENDER), true),
        Err(DomainError::NotAuthorized {
            required: Permission::ManageNotifications
        })
    );
    assert!(!org.notifications_enabled);
    set_notifications_enabled(&mut org, &user(ADMIN), true).unwrap();
    // Submitted awaits review: only the mention is delivered, no chase.
    assert_eq!(build_notifications(&org, &[txn]).len(), 1);
}

#[test]
fn substantive_edits_reopen_approval_but_comments_do_not() {
    let org = org();
    let mut txn = split_txn("org-1");

    // Approval only from Submitted.
    assert_eq!(
        approve_transaction(&org, &mut txn, &user(REVIEWER)),
        Err(DomainError::InvalidStatus {
            expected: DocumentationStatus::Submitted,
            actual: DocumentationStatus::Draft,
        })
    );
    submit_transaction(&org, &mut txn, &user(SPENDER)).unwrap();
    request_changes(&org, &mut txn, &user(REVIEWER)).unwrap();
    submit_transaction(&org, &mut txn, &user(SPENDER)).unwrap();
    approve_transaction(&org, &mut txn, &user(REVIEWER)).unwrap();
    assert_eq!(txn.status, DocumentationStatus::Approved);

    // Comments are not substantive: approval stands.
    add_comment(
        &org,
        &mut txn,
        &user(REVIEWER),
        "noted, thanks",
        vec![],
        "t",
    )
    .unwrap();
    assert_eq!(txn.status, DocumentationStatus::Approved);

    // Changing the explanation reopens review.
    edit_documentation(
        &org,
        &mut txn,
        &user(SPENDER),
        Documentation::new(
            "Corrected: food plus swag deposit",
            vec!["receipt-1".into()],
        ),
    )
    .unwrap();
    assert_eq!(txn.status, DocumentationStatus::Submitted);
    approve_transaction(&org, &mut txn, &user(REVIEWER)).unwrap();

    // Changing purpose allocations reopens review too.
    set_purposes(
        &org,
        &mut txn,
        &user(SPENDER),
        vec![
            Purpose::new("p-food", "Meetup food", 10_000_000, SPENDER),
            Purpose::new("p-swag", "Swag reprint", 5_000_000, ORGANIZER2),
        ],
    )
    .unwrap();
    assert_eq!(txn.status, DocumentationStatus::Submitted);
    approve_transaction(&org, &mut txn, &user(REVIEWER)).unwrap();

    // Evidence edits are substantive as well.
    edit_documentation(
        &org,
        &mut txn,
        &user(SPENDER),
        Documentation::new("Monthly meetup costs", vec!["receipt-2".into()]),
    )
    .unwrap();
    assert_eq!(txn.status, DocumentationStatus::Submitted);
}

#[test]
fn stock_quantity_nonnegative_with_history() {
    let org = org();
    let mut item = StockItem::new("shirt", "org-1", "Event shirt", Some("size L".into()));

    assert_eq!(
        update_stock(&org, &mut item, &user(ADMIN), "storage", -1, "t1"),
        Err(DomainError::InvalidQuantity { quantity: -1 })
    );
    assert!(item.quantity_by_location.is_empty());

    let c1 = update_stock(&org, &mut item, &user(ADMIN), "storage", 40, "t1").unwrap();
    assert_eq!((c1.from, c1.to), (0, 40));
    let c2 = update_stock(&org, &mut item, &user(ADMIN), "organizer2", 5, "t2").unwrap();
    assert_eq!(item.quantity_at("organizer2"), 5);
    assert_eq!(item.history.len(), 2);
    assert_eq!(item.history[1].by, user(ADMIN));
    assert_eq!(item.history[1].at, "t2");
    assert_eq!(c2.location, "organizer2");

    // Wrong organization and missing permission are rejected.
    let org_b = Organization::new("org-b", "Other");
    assert_eq!(
        update_stock(&org_b, &mut item, &user(ADMIN), "storage", 1, "t3"),
        Err(DomainError::WrongOrganization)
    );
    assert_eq!(
        update_stock(&org, &mut item, &user(SPENDER), "storage", 1, "t3"),
        Err(DomainError::NotAuthorized {
            required: Permission::UpdateStock
        })
    );
}

#[test]
fn submitted_transactions_are_not_chased_for_details() {
    let mut org = org();
    set_notifications_enabled(&mut org, &user(ADMIN), true).unwrap();
    let mut txn = split_txn("org-1");
    submit_transaction(&org, &mut txn, &user(SPENDER)).unwrap();
    add_comment(
        &org,
        &mut txn,
        &user(REVIEWER),
        "looking at it",
        vec![user(SPENDER)],
        "t",
    )
    .unwrap();

    // Submitted = awaiting review: no reminders or digests, mentions flow.
    let batch = notifications_since(&org, &[txn.clone()], &std::collections::BTreeMap::new());
    assert!(!batch.notifications.iter().any(|n| matches!(
        n.kind,
        NotificationKind::Reminder { .. } | NotificationKind::Digest { .. }
    )));
    assert!(
        batch
            .notifications
            .iter()
            .any(|n| matches!(n.kind, NotificationKind::Mention { .. }))
    );

    // Changes requested: documentation is owed again, chase returns.
    request_changes(&org, &mut txn, &user(REVIEWER)).unwrap();
    let batch = notifications_since(&org, &[txn], &std::collections::BTreeMap::new());
    assert_eq!(
        batch
            .notifications
            .iter()
            .filter(|n| matches!(n.kind, NotificationKind::Reminder { .. }))
            .count(),
        2
    );
    assert_eq!(
        batch
            .notifications
            .iter()
            .filter(|n| matches!(n.kind, NotificationKind::Digest { .. }))
            .count(),
        2
    );
}

#[test]
fn enabling_notifications_does_not_replay_old_mentions() {
    let mut org = org();
    let mut txn = split_txn("org-1");
    submit_transaction(&org, &mut txn, &user(SPENDER)).unwrap();
    approve_transaction(&org, &mut txn, &user(REVIEWER)).unwrap();
    add_comment(
        &org,
        &mut txn,
        &user(REVIEWER),
        "old ping",
        vec![user(SPENDER)],
        "t1",
    )
    .unwrap();

    // Disabled: nothing is produced, but the cursor still advances.
    let batch = notifications_since(&org, &[txn.clone()], &std::collections::BTreeMap::new());
    assert!(batch.notifications.is_empty());
    assert_eq!(batch.mention_cursor.get(&txn.id), Some(&1));

    // Enabling releases no queued flood: the old mention is gone for good.
    set_notifications_enabled(&mut org, &user(ADMIN), true).unwrap();
    let batch = notifications_since(&org, &[txn.clone()], &batch.mention_cursor);
    assert!(batch.notifications.is_empty());

    // Comments after the cursor still generate mentions.
    add_comment(
        &org,
        &mut txn,
        &user(ORGANIZER2),
        "new ping",
        vec![user(SPENDER)],
        "t2",
    )
    .unwrap();
    let batch = notifications_since(&org, &[txn.clone()], &batch.mention_cursor);
    assert_eq!(batch.notifications.len(), 1);
    assert!(matches!(
        batch.notifications[0].kind,
        NotificationKind::Mention { comment: 1, .. }
    ));

    // The snapshot API deliberately still reports all mentions (previews).
    assert_eq!(build_notifications(&org, &[txn]).len(), 2);
}

#[test]
fn validation_rejects_bad_splits_names_and_responsible() {
    let mut org = org();
    let mut txn = split_txn("org-1");

    // Bank amount must be positive minor units.
    txn.amount = 0;
    txn.purposes = vec![Purpose::new("p", "x", 0, SPENDER)];
    assert_eq!(
        submit_transaction(&org, &mut txn, &user(SPENDER)),
        Err(DomainError::InvalidAmount { amount: 0 })
    );

    // Purpose magnitude and name.
    txn.amount = 1_000_000;
    txn.purposes = vec![Purpose::new("p", "x", 0, SPENDER)];
    assert_eq!(
        submit_transaction(&org, &mut txn, &user(SPENDER)),
        Err(DomainError::InvalidPurpose {
            purpose: PurposeId::new("p"),
            reason: "amount must be positive",
        })
    );
    txn.purposes = vec![Purpose::new("p", "  ", 1_000_000, SPENDER)];
    assert_eq!(
        submit_transaction(&org, &mut txn, &user(SPENDER)),
        Err(DomainError::InvalidPurpose {
            purpose: PurposeId::new("p"),
            reason: "blank name",
        })
    );

    // Duplicate purpose ids.
    txn.purposes = vec![
        Purpose::new("p", "a", 500_000, SPENDER),
        Purpose::new("p", "b", 500_000, ORGANIZER2),
    ];
    assert_eq!(
        submit_transaction(&org, &mut txn, &user(SPENDER)),
        Err(DomainError::InvalidPurpose {
            purpose: PurposeId::new("p"),
            reason: "duplicate id",
        })
    );

    // Blank evidence reference, then whitespace-only unavailable reason.
    txn.purposes = vec![Purpose::new("p", "a", 1_000_000, SPENDER)];
    txn.documentation = Documentation::new("x", vec!["   ".into()]);
    assert_eq!(
        submit_transaction(&org, &mut txn, &user(SPENDER)),
        Err(DomainError::IncompleteDocumentation("evidence"))
    );
    txn.documentation = Documentation::without_evidence("x", "  ");
    assert_eq!(
        submit_transaction(&org, &mut txn, &user(SPENDER)),
        Err(DomainError::IncompleteDocumentation("evidence"))
    );

    // A departed responsible member blocks submission until resolved;
    // another active member with the permission still hits the same wall.
    txn.documentation = Documentation::new("x", vec!["receipt".into()]);
    remove_member(&mut org, &user(ADMIN), &user(SPENDER)).unwrap();
    assert_eq!(
        submit_transaction(&org, &mut txn, &user(ORGANIZER2)),
        Err(DomainError::ResponsibleMemberInactive {
            member: user(SPENDER),
        })
    );
}

#[test]
fn reassignment_keeps_former_spender_excluded_from_approval() {
    let org = org();
    let mut txn = split_txn("org-1");
    submit_transaction(&org, &mut txn, &user(SPENDER)).unwrap();

    // Reassign every purpose away from SPENDER.
    set_purposes(
        &org,
        &mut txn,
        &user(SPENDER),
        vec![
            Purpose::new("p-food", "Meetup food", 9_000_000, ORGANIZER2),
            Purpose::new("p-swag", "Swag reprint", 6_000_000, ORGANIZER2),
        ],
    )
    .unwrap();

    // The former spender cannot approve their own spend ...
    assert_eq!(
        approve_transaction(&org, &mut txn, &user(SPENDER)),
        Err(DomainError::SelfApprovalDenied)
    );
    // ... and the new responsible member cannot either.
    assert_eq!(
        approve_transaction(&org, &mut txn, &user(ORGANIZER2)),
        Err(DomainError::SelfApprovalDenied)
    );
    // A member never responsible approves.
    approve_transaction(&org, &mut txn, &user(REVIEWER)).unwrap();
    assert_eq!(txn.status, DocumentationStatus::Approved);
}

#[test]
fn notification_cutoff_hides_older_reminders_but_not_mentions() {
    let mut org = org();
    // The cutoff itself is permission-gated.
    assert_eq!(
        set_notification_cutoff(&mut org, &user(SPENDER), Some("2026-02-01".into())),
        Err(DomainError::NotAuthorized {
            required: Permission::ManageNotifications
        })
    );
    set_notifications_enabled(&mut org, &user(ADMIN), true).unwrap();
    set_notification_cutoff(&mut org, &user(ADMIN), Some("2026-02-01".into())).unwrap();

    let mut older = split_txn("org-1");
    older.id = TransactionId::new("t-old");
    older.date = "2026-01-15".into();
    submit_transaction(&org, &mut older, &user(SPENDER)).unwrap();
    request_changes(&org, &mut older, &user(REVIEWER)).unwrap();

    let mut newer = split_txn("org-1");
    newer.id = TransactionId::new("t-new");
    newer.date = "2026-02-20".into();
    submit_transaction(&org, &mut newer, &user(SPENDER)).unwrap();
    request_changes(&org, &mut newer, &user(REVIEWER)).unwrap();

    // A mention on the older transaction still flows.
    add_comment(
        &org,
        &mut older,
        &user(REVIEWER),
        "ping",
        vec![user(SPENDER)],
        "t",
    )
    .unwrap();

    let batch = notifications_since(
        &org,
        &[older.clone(), newer],
        &std::collections::BTreeMap::new(),
    );
    // Only the newer transaction is chased.
    assert!(batch.notifications.iter().all(|n| match &n.kind {
        NotificationKind::Reminder { transaction } => transaction == &TransactionId::new("t-new"),
        NotificationKind::Digest { transactions } => {
            !transactions.contains(&TransactionId::new("t-old"))
        }
        NotificationKind::Mention { .. } => true,
    }));
    assert_eq!(
        batch
            .notifications
            .iter()
            .filter(|n| matches!(n.kind, NotificationKind::Reminder { .. }))
            .count(),
        2
    );
    assert!(batch.notifications.iter().any(|n| matches!(
        &n.kind,
        NotificationKind::Mention { transaction, .. }
            if transaction == &TransactionId::new("t-old")
    )));
}

#[test]
fn new_fields_have_serde_defaults() {
    let txn: Transaction = serde_json::from_value(serde_json::json!({
        "id": "t-9",
        "organization_id": "org-1",
        "pocket_id": "main",
        "jago_transaction_id": null,
        "direction": "Outflow",
        "amount": 100,
        "date": "2026-02-01",
        "purposes": [],
        "documentation": {
            "explanation": "",
            "evidence": [],
            "evidence_unavailable_reason": null
        },
        "status": "Draft",
        "suppression": null,
        "comments": []
    }))
    .unwrap();
    assert!(txn.approval_exclusions.is_empty());

    let org: Organization = serde_json::from_value(serde_json::json!({
        "id": "org-2",
        "name": "Other",
        "notifications_enabled": false,
        "roles": {},
        "members": {}
    }))
    .unwrap();
    assert_eq!(org.notification_cutoff, None);
}

#[test]
fn models_round_trip_through_json() {
    let mut org = org();
    org.notifications_enabled = true;
    let mut txn = split_txn("org-1");
    submit_transaction(&org, &mut txn, &user(SPENDER)).unwrap();
    suppress_transaction_notifications(&org, &mut txn, &user(ADMIN), "offline", "t").unwrap();
    let out = build_notifications(&org, &[txn.clone()]);

    let org_back: Organization =
        serde_json::from_str(&serde_json::to_string(&org).unwrap()).unwrap();
    assert_eq!(org_back, org);
    let txn_back: Transaction =
        serde_json::from_str(&serde_json::to_string(&txn).unwrap()).unwrap();
    assert_eq!(txn_back, txn);
    let notif_back: Vec<Notification> =
        serde_json::from_str(&serde_json::to_string(&out).unwrap()).unwrap();
    assert_eq!(notif_back, out);
}
