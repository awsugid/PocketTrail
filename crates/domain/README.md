# pockettrail-domain

Pure domain crate for PocketTrail: organization-scoped membership, roles built
from named permissions, the transaction documentation and approval workflow,
notification suppression rules, and merchandise stock. No persistence, no
parsing, no delivery — the runtime, UI, and parser crates own those and call
into this API.

- Package: `pockettrail-domain`, edition 2024
- Dependencies: `serde` (derive). `serde_json` only as a dev-dependency for tests.
- Amounts are integer **minor units** (`i64`); for IDR, 100 minor units = Rp 1.
  Timestamps are caller-supplied strings (RFC 3339 recommended).

## Concepts

- **Organization** — independent workspace; members, roles, transactions, and
  notifications never cross its boundary.
- **Member** — one user's participation in an organization. Removal keeps the
  record with `active = false` (historical attribution survives; access and
  notifications stop).
- **Role** — a named bundle of [`Permission`]s assigned inside one
  organization. Deliberately not IAM: no conditions, denies, or inheritance.
- **Transaction** — one bank movement (with its Jago transaction ID) split
  into one or more **purposes**, each with a responsible member. Purposes must
  sum to the bank amount.
- **Documentation status** — `Draft -> Submitted -> Approved`, with
  `ChangesRequested` as the reviewer's rejection state. Approval covers the
  whole transaction, all purposes included.
- **Suppression** — an authorized, reasoned decision that stops every
  notification about one transaction (mentions, reminders, digests). It is
  visible, recorded, never implies approval, and never implies evidence.

## Workflow rules

- Validation on `submit_transaction`, `set_purposes`, and approval: positive
  minor-unit amounts (`direction` supplies the sign), unique purpose ids with
  nonblank names and positive magnitudes, nonblank evidence references and
  unavailable reasons, `sum(purposes) == amount`, and every purpose's
  responsible member currently active. A draft may keep departed attribution
  but cannot be submitted or approved until resolved.
- `approve_transaction` requires `ApproveTransactions` and is denied for
  anyone currently or historically responsible for a purpose: `set_purposes`
  preserves reassigned responsible members in `approval_exclusions`, so
  reassignment never enables self-approval. Without another eligible approver
  the transaction stays pending.
- Membership mutations — `upsert_member`, `remove_member` — require
  `ManageMembers`. Removal keeps attribution and stops access and
  notifications.
- Substantive edits — `edit_documentation` (explanation/evidence) and
  `set_purposes` (allocations and responsible members) — reopen an approval to
  `Submitted`. `add_comment` never changes status.
- `notifications_since` applies every gate: organization notifications
  disabled blocks all while its mention cursor still advances (enabling
  releases no queued flood); a suppressed transaction blocks its mentions,
  reminders, and digest entries; only active members receive anything; other
  organizations' transactions are ignored. Reminders and digests chase only
  transactions still owing documentation (`Draft`, `ChangesRequested`);
  `Submitted` items await review and are not chased. The returned mention
  cursor stops historical mentions from replaying (persist one cursor map
  per organization); `build_notifications` is the one-shot snapshot for
  previews. `Organization::notification_cutoff` (set via
  `set_notification_cutoff`) hides reminders and digests for older
  transactions; mentions are unaffected. Recipients must hold
  `ViewTransactions`.
- `update_stock` rejects negative quantities and appends a who/what/when
  history entry.

## Usage

```rust
use std::collections::BTreeSet;
use pockettrail_domain::*;

// Roles bundle named permissions; members hold roles inside one organization.
let mut org = Organization::new("org-1", "AWS User Group Jakarta");
org.roles.insert(
    RoleId::new("treasurer"),
    Role {
        name: "Treasurer".into(),
        permissions: BTreeSet::from([
            Permission::ViewTransactions,
            Permission::DocumentTransactions,
            Permission::ApproveTransactions,
            Permission::ManageNotifications,
        ]),
    },
);
org.members.insert(
    UserId::new("organizer-a"),
    Member { role_ids: BTreeSet::from([RoleId::new("treasurer")]), active: true },
);
org.members.insert(
    UserId::new("organizer-b"),
    Member { role_ids: BTreeSet::from([RoleId::new("treasurer")]), active: true },
);

// Authorization is organization-scoped.
authorize(&org, &UserId::new("organizer-a"), Permission::ApproveTransactions)?;
assert_eq!(
    authorize(&Organization::new("org-2", "Other"), &UserId::new("organizer-a"),
              Permission::ViewTransactions),
    Err(DomainError::NoMembership)
);

// One bank movement covering two purposes; the split must equal the amount.
let mut txn = Transaction {
    id: TransactionId::new("t-1"),
    organization_id: org.id.clone(),
    pocket_id: PocketId::new("main"),
    jago_transaction_id: Some("jago-0001".into()),
    direction: Direction::Outflow,
    // Minor units: 15_000_000 minor = Rp 150,000 (100 minor = Rp 1).
    amount: 15_000_000,
    date: "2026-02-01".into(),
    purposes: vec![
        Purpose::new("p-food", "Meetup food", 9_000_000, "organizer-a"),
        Purpose::new("p-swag", "Swag reprint", 6_000_000, "organizer-b"),
    ],
    documentation: Documentation::new("Monthly meetup costs", vec!["receipt-1".into()]),
    status: DocumentationStatus::Draft,
    suppression: None,
    comments: Vec::new(),
    approval_exclusions: BTreeSet::new(),
};

submit_transaction(&org, &mut txn, &UserId::new("organizer-a"))?;
// organizer-a is responsible for a purpose: denied.
assert_eq!(
    approve_transaction(&org, &mut txn, &UserId::new("organizer-a")),
    Err(DomainError::SelfApprovalDenied)
);
approve_transaction(&org, &mut txn, &UserId::new("organizer-b"))?;

// Comments never reopen approval; documentation or purpose edits do.
add_comment(&org, &mut txn, &UserId::new("organizer-b"), "noted", vec![], "2026-02-02T10:00:00Z")?;
assert_eq!(txn.status, DocumentationStatus::Approved);

// Notifications start disabled per organization and must be enabled
// explicitly by a member holding ManageNotifications.
set_notifications_enabled(&mut org, &UserId::new("organizer-a"), true)?;
// Incremental build: persist the cursor and pass it back next time so old
// mentions never replay.
let mut cursor = std::collections::BTreeMap::new();
let batch = notifications_since(&org, &[txn.clone()], &cursor);
cursor = batch.mention_cursor;
let outbox = batch.notifications;

// Suppressing one transaction stops every notification about it, mentions
// included, until an authorized member restores it.
suppress_transaction_notifications(&org, &mut txn, &UserId::new("organizer-a"),
                                   "handled offline", "2026-02-02T11:00:00Z")?;
assert!(build_notifications(&org, &[txn]).is_empty());
# Ok::<(), DomainError>(())
```

## API summary

| Item | Purpose |
| --- | --- |
| `Organization`, `Member`, `Role` | Org-scoped membership and custom roles |
| `authorize`, `Organization::permissions_for` | Permission checks with denial reason |
| `upsert_member`, `remove_member` | Membership mutations, gated by `ManageMembers` |
| `set_notifications_enabled` | Org-wide gate; starts off, requires `ManageNotifications` |
| `set_notification_cutoff` | Reminder/digest date cutoff, gated by `ManageNotifications` |
| `Transaction`, `Purpose`, `Documentation`, `DocumentationStatus` | Bank movement, split, explanation, workflow state |
| `validate_documentation` | Completeness + split check without mutating |
| `submit_transaction`, `request_changes`, `approve_transaction` | Workflow transitions |
| `edit_documentation`, `set_purposes`, `add_comment` | Substantive edits reopen; comments never do |
| `Suppression`, `suppress_transaction_notifications`, `unsuppress_transaction_notifications`, `is_suppressed` | Reasoned, recorded, restore-able suppression |
| `Notification`, `NotificationKind`, `build_notifications` | Gated outbox: mentions, reminders, digests |
| `notifications_since`, `NotificationBatch` | Incremental build with mention cursor; no replay, no flood on enable |
| `StockItem`, `StockChange`, `update_stock` | Nonnegative stock per location with history |
| `DomainError` | Every rejection, strongly typed |

Permissions: `ViewTransactions`, `CommentTransactions`, `DocumentTransactions`,
`ApproveTransactions`, `ImportStatements`, `ManageRoles`, `ManageMembers`,
`ManageNotifications`, `SuppressNotifications`, `UpdateStock`.

Run tests with `cargo test --manifest-path crates/domain/Cargo.toml`.
