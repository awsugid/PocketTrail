//! Local notification outbox and gating. Local-only stand-in for the future
//! email integration: rows are written to D1 and shown in the settings outbox;
//! nothing is sent and there is no cron/real delivery.
//!
//! Bodies never carry financial details or attachments (product policy): they
//! name the organization, transaction date, and in-app link only.
//!
//! Contracts used by the transactions module (fresh generation only, no
//! replay of history):
//! - [`enqueue_mentions`](`enqueue_mentions`) after a comment is stored;
//! - [`enqueue_assignment`] after import/assignment confirms a responsible member.
//! Gates at enqueue time: org disabled / transaction suppressed / inactive
//! member / (assignment, digest) date cutoff — see `notify_rules`. Read side
//! re-filters ([`outbox_view`], [`digest_targets`]) so rows queued before a
//! removal or suppression stay invisible.

use super::*;
use crate::notify_rules::{should_notify, Kind};
use pockettrail_domain::{Organization, Permission, UserId};
use serde::Deserialize;
use std::collections::BTreeMap;

pub const DIGEST_WEEK_MS: i64 = 7 * 24 * 3600 * 1000;

// ------------------------------------------------------------- mention match

/// One candidate recipient for @mention resolution (pre-filtered by the
/// caller to active members holding ViewTransactions, author excluded).
#[derive(Debug, Clone)]
pub struct MentionCand {
    pub id: i64,
    /// Lowercased handle (comment tokens match this exactly).
    pub handle: String,
    /// Display name as inserted by UI mention chips ("@Full Name").
    pub name: String,
}

/// Memberships mentioned in `body`: exact `@handle` tokens plus exact
/// `@Display Name` spans (case-insensitive, word boundaries on the outer
/// edge so `x@Alice` and `@Alice2` never match). Deduped, input order.
pub fn mention_recipients(body: &str, cands: &[MentionCand]) -> Vec<i64> {
    let lower = body.to_lowercase();
    let tokens = crate::mentions::extract_mentions(body);
    let mut out: Vec<i64> = Vec::new();
    for c in cands {
        let hit = tokens.iter().any(|t| *t == c.handle)
            || name_mentioned(&lower, &c.name.trim().to_lowercase());
        if hit && !out.contains(&c.id) {
            out.push(c.id);
        }
    }
    out
}

fn name_mentioned(lower_body: &str, lower_name: &str) -> bool {
    if lower_name.is_empty() {
        return false;
    }
    let pat = format!("@{lower_name}");
    let bytes = lower_body.as_bytes();
    let mut from = 0;
    while let Some(pos) = lower_body[from..].find(&pat) {
        let at = from + pos;
        let before_ok = at == 0 || !bytes[at - 1].is_ascii_alphanumeric();
        let after = at + pat.len();
        let after_ok = after >= bytes.len() || !bytes[after].is_ascii_alphanumeric();
        if before_ok && after_ok {
            return true;
        }
        from = at + 1; // '@' is one byte, so at + 1 is a char boundary
    }
    false
}

// ---------------------------------------------------------------- enqueue

fn kind_str(k: Kind) -> &'static str {
    match k {
        Kind::Assignment => "assignment",
        Kind::Digest => "digest",
        Kind::Mention => "mention",
    }
}

pub async fn insert_row(
    db: &D1Database,
    org_id: i64,
    kind: &str,
    to_mid: i64,
    txn_id: Option<i64>,
    subject: &str,
    body: &str,
    now: i64,
    expected_revision: Option<i64>,
) -> db::WResult<()> {
    db::exec(
        db,
        "INSERT INTO notification_outbox (org_id, kind, to_membership_id, transaction_id, subject, body, created_at) SELECT ?1,?2,?3,?4,?5,?6,?7 FROM organizations o JOIN memberships m ON m.org_id=o.id JOIN roles r ON r.id=m.role_id AND r.org_id=o.id LEFT JOIN transactions t ON t.id=?4 AND t.org_id=o.id WHERE o.id=?1 AND o.notifications_enabled=1 AND m.id=?3 AND m.removed_at IS NULL AND (?8 IS NULL OR o.notification_revision=?8) AND (EXISTS(SELECT 1 FROM json_each(r.permissions) WHERE value='ViewTransactions') OR (?4 IS NULL AND ?2='digest' AND (m.role_id=o.income_explanation_role_id OR (NOT EXISTS(SELECT 1 FROM memberships im WHERE im.org_id=o.id AND im.role_id=o.income_explanation_role_id AND im.removed_at IS NULL) AND EXISTS(SELECT 1 FROM pockets p WHERE p.org_id=o.id AND p.owner_membership_id=m.id)))) OR (t.amount_minor>0 AND ((m.role_id=o.income_explanation_role_id) OR (NOT EXISTS(SELECT 1 FROM memberships im WHERE im.org_id=o.id AND im.role_id=o.income_explanation_role_id AND im.removed_at IS NULL) AND m.id=(SELECT p.owner_membership_id FROM pockets p WHERE p.id=t.pocket_id AND p.org_id=o.id))))) AND (?4 IS NULL OR (t.id IS NOT NULL AND t.suppressed=0 AND (?2='mention' OR o.notification_cutoff_date IS NULL OR t.txn_date>=o.notification_cutoff_date)))",
        vec![
            db::i(org_id),
            db::s(kind),
            db::i(to_mid),
            db::opt_i(txn_id),
            db::s(subject),
            db::s(body),
            db::i(now),
            db::opt_i(expected_revision),
        ],
    )
    .await
}

/// Core enqueue: gates each recipient through `notify_rules::should_notify`
/// (org enabled, not suppressed, active member, cutoff for assignments).
async fn enqueue_for(g: &Ctx, t: &TxnRow, recipients: &[i64], kind: Kind) -> worker::Result<()> {
    let suppressed = db::flag(t.suppressed);
    let cutoff = g
        .org
        .notification_cutoff_date
        .as_deref()
        .filter(|c| !c.is_empty());
    let enabled = db::flag(g.org.notifications_enabled);
    let now = db::now_ms();
    for mid in recipients {
        let Some(m) = g.mems.iter().find(|m| m.id == *mid) else {
            continue;
        };
        if !should_notify(
            kind,
            enabled,
            suppressed,
            m.active(),
            Some(&t.txn_date),
            cutoff,
        ) {
            continue;
        }
        let link = format!("/org/{}/transactions/{}", g.org.slug, t.id);
        let (subject, body) = match kind {
            Kind::Mention => (
                format!("You were mentioned — {}", g.org.name),
                format!(
                    "You were mentioned in {}. Sign in to read the discussion.\n{}",
                    g.org.name, link
                ),
            ),
            Kind::Assignment => (
                format!("Documentation assignment — {}", g.org.name),
                format!(
                    "A transaction needs your documentation in {}.\n{}",
                    g.org.name, link
                ),
            ),
            // Digests are written by send_digest with cadence dedup.
            Kind::Digest => continue,
        };
        insert_row(
            &g.app.db,
            g.org.id,
            kind_str(kind),
            *mid,
            Some(t.id),
            &subject,
            &body,
            now,
            None,
        )
        .await?;
    }
    Ok(())
}

/// Enqueue mention notifications for a stored comment. Resolves both
/// `@handle` tokens and UI-chip `@Full Name` spans against ACTIVE members
/// holding ViewTransactions, excluding the author (`g.user`). Exact matches
/// only; no replay — one call covers exactly this comment body.
pub async fn enqueue_mentions(g: &Ctx, t: &TxnRow, body: &str) -> worker::Result<()> {
    let income_recipients = if t.amount_minor > 0 {
        super::txns::income_recipients(g, t).await?
    } else { Vec::new() };
    let cands: Vec<MentionCand> = g
        .mems
        .iter()
        .filter(|m| m.active() && m.user_id != g.user.id)
        .filter(|m| {
            income_recipients.contains(&m.id) || g.dom_org
                .permissions_for(&UserId::new(m.user_id.clone()))
                .contains(&Permission::ViewTransactions)
        })
        .map(|m| MentionCand {
            id: m.id,
            handle: m.handle.to_lowercase(),
            name: m.name.trim().to_string(),
        })
        .collect();
    let ids = mention_recipients(body, &cands);
    enqueue_for(g, t, &ids, Kind::Mention).await
}

/// Enqueue the initial assignment notice to the transaction-level responsible
/// member (no-op when unassigned; inactive/removed members are gated out).
pub async fn enqueue_assignment(g: &Ctx, t: &TxnRow) -> worker::Result<()> {
    if t.amount_minor > 0 {
        if crate::domain_map::income_complete(&t.explanation) {
            return Ok(());
        }
        return enqueue_for(
            g,
            t,
            &super::txns::income_recipients(g, t).await?,
            Kind::Assignment,
        )
        .await;
    }
    let evidence = evidence_of(&g.app.db, t.id).await?;
    let complete = !t.explanation.trim().is_empty()
        && (!evidence.is_empty() || !t.evidence_unavailable_reason.trim().is_empty());
    if !crate::domain_map::documentation_owed(&t.status, complete) {
        return Ok(());
    }
    let mut recipients: std::collections::BTreeSet<i64> = std::collections::BTreeSet::new();
    recipients.extend(t.responsible_membership_id);
    for split in splits_of(&g.app.db, t.id).await? {
        recipients.extend(split.responsible_membership_id);
    }
    let recipients: Vec<i64> = recipients
        .into_iter()
        .filter(|mid| {
            g.mems.iter().find(|m| m.id == *mid).is_some_and(|m| {
                g.dom_org
                    .permissions_for(&UserId::new(m.user_id.clone()))
                    .contains(&Permission::ViewTransactions)
            })
        })
        .collect();
    enqueue_for(g, t, &recipients, Kind::Assignment).await
}

// ------------------------------------------------------------------ read side

#[derive(Debug, Deserialize)]
pub struct OutboxRow {
    pub id: i64,
    pub kind: String,
    pub subject: String,
    pub created_at: i64,
    pub to_name: String,
}

/// Outbox rows still deliverable-if-there-were-delivery: recipient membership
/// active, org notifications ON, and — for rows tied to a transaction — that
/// transaction not suppressed NOW (covers rows queued before suppression).
/// Digest rows (transaction_id NULL) pass the transaction filter.
pub async fn outbox_view(db: &D1Database, org: &OrgRow) -> db::WResult<Vec<OutboxRow>> {
    if !db::flag(org.notifications_enabled) {
        return Ok(Vec::new());
    }
    db::q_all(
        db,
        "SELECT n.id, n.kind, n.subject, n.created_at, u.name AS to_name FROM notification_outbox n JOIN memberships m ON m.id=n.to_membership_id AND m.org_id=n.org_id AND m.removed_at IS NULL JOIN roles r ON r.id=m.role_id AND r.org_id=m.org_id JOIN users u ON u.id=m.user_id LEFT JOIN transactions t ON t.id=n.transaction_id WHERE n.org_id=?1 AND n.cancelled_at IS NULL AND (EXISTS(SELECT 1 FROM json_each(r.permissions) WHERE value='ViewTransactions') OR (n.kind='digest' AND EXISTS(SELECT 1 FROM transactions dt JOIN pockets dp ON dp.id=dt.pocket_id AND dp.org_id=dt.org_id JOIN organizations o ON o.id=dt.org_id WHERE dt.org_id=n.org_id AND dt.amount_minor>0 AND trim(dt.explanation)='' AND dt.suppressed=0 AND (o.notification_cutoff_date IS NULL OR dt.txn_date>=o.notification_cutoff_date) AND instr(n.body, '/org/' || o.slug || '/transactions/' || dt.id || char(10))>0 AND (m.role_id=?2 OR (NOT EXISTS(SELECT 1 FROM memberships im WHERE im.org_id=n.org_id AND im.role_id=?2 AND im.removed_at IS NULL) AND dp.owner_membership_id=m.id)))) OR (t.amount_minor>0 AND (m.role_id=?2 OR (NOT EXISTS(SELECT 1 FROM memberships im WHERE im.org_id=n.org_id AND im.role_id=?2 AND im.removed_at IS NULL) AND m.id=(SELECT p.owner_membership_id FROM pockets p WHERE p.id=t.pocket_id AND p.org_id=n.org_id))))) AND (t.id IS NULL OR (t.suppressed=0 AND (n.kind='mention' OR EXISTS(SELECT 1 FROM organizations o WHERE o.id=n.org_id AND (o.notification_cutoff_date IS NULL OR t.txn_date>=o.notification_cutoff_date))) AND (t.amount_minor<=0 OR n.kind='mention' OR trim(t.explanation)=''))) AND (t.amount_minor IS NULL OR t.amount_minor<=0 OR n.kind='mention' OR (m.role_id=?2 OR (NOT EXISTS(SELECT 1 FROM memberships im WHERE im.org_id=n.org_id AND im.role_id=?2 AND im.removed_at IS NULL) AND m.id=(SELECT p.owner_membership_id FROM pockets p WHERE p.id=t.pocket_id AND p.org_id=n.org_id)))) AND (n.kind<>'digest' OR NOT EXISTS(SELECT 1 FROM transactions dt JOIN organizations o ON o.id=dt.org_id JOIN pockets dp ON dp.id=dt.pocket_id AND dp.org_id=dt.org_id WHERE dt.org_id=n.org_id AND instr(n.body, '/org/' || o.slug || '/transactions/' || dt.id || char(10))>0 AND (dt.suppressed<>0 OR (o.notification_cutoff_date IS NOT NULL AND dt.txn_date<o.notification_cutoff_date) OR (dt.amount_minor>0 AND (trim(dt.explanation)<>'' OR NOT (m.role_id=coalesce(?2,-1) OR (NOT EXISTS(SELECT 1 FROM memberships im WHERE im.org_id=n.org_id AND im.role_id=?2 AND im.removed_at IS NULL) AND coalesce(dp.owner_membership_id,-1)=m.id))))))) ORDER BY n.id DESC LIMIT 100",
        vec![db::i(org.id), db::opt_i(org.income_explanation_role_id)],
    )
    .await
}

// ---------------------------------------------------------------- digest

#[derive(Debug, Clone)]
pub struct DigestItem {
    pub txn_id: i64,
    pub date: String,
}

/// Recipient groups for reminders/digest: active members holding
/// ViewTransactions with their documentation-owed transactions (Draft or
/// ChangesRequested only — Submitted items await somebody else's review),
/// unsuppressed, at/after the org cutoff. `limited` marks the 500-row scan
/// ceiling so previews can say they are partial.
pub struct DigestTargets {
    pub groups: Vec<(MemRow, Vec<DigestItem>)>,
    pub total_items: usize,
    pub limited: bool,
}

#[derive(Debug, Deserialize)]
struct OwedRow {
    id: i64,
    txn_date: String,
    responsible_membership_id: Option<i64>,
    status: String,
    explanation: String,
    evidence_unavailable_reason: String,
    evidence_count: i64,
    amount_minor: i64,
    owner_membership_id: Option<i64>,
}

#[derive(Debug, Deserialize)]
struct SplitResp {
    transaction_id: i64,
    responsible_membership_id: i64,
}

pub async fn digest_targets(
    db: &D1Database,
    org: &OrgRow,
    dom: &Organization,
    mems: &[MemRow],
) -> db::WResult<DigestTargets> {
    let rows: Vec<OwedRow> = db::q_all(
        db,
        "SELECT t.id, t.txn_date, t.responsible_membership_id, t.status, t.explanation, t.evidence_unavailable_reason, t.amount_minor, p.owner_membership_id, (SELECT COUNT(*) FROM documents d WHERE d.transaction_id = t.id AND d.kind = 'evidence' AND d.superseded = 0) AS evidence_count FROM transactions t JOIN pockets p ON p.id=t.pocket_id AND p.org_id=t.org_id WHERE t.org_id = ?1 AND t.suppressed = 0 ORDER BY t.txn_date DESC, t.id DESC LIMIT 500",
        vec![db::i(org.id)],
    )
    .await?;
    let limited = rows.len() == 500;
    let cutoff = org
        .notification_cutoff_date
        .as_deref()
        .filter(|c| !c.is_empty());
    let owed: Vec<&OwedRow> = rows
        .iter()
        .filter(|r| {
            let complete = !r.explanation.trim().is_empty()
                && (r.evidence_count > 0 || !r.evidence_unavailable_reason.trim().is_empty());
            (if r.amount_minor > 0 {
                !crate::domain_map::income_complete(&r.explanation)
            } else {
                crate::domain_map::documentation_owed(&r.status, complete)
            }) && cutoff.map_or(true, |c| r.txn_date.as_str() >= c)
        })
        .collect();

    // Split-level responsibles chase their own purposes (txn-level inheriting
    // NULLs are covered by responsible_membership_id below).
    let ids: Vec<i64> = owed.iter().map(|r| r.id).collect();
    let mut split_resps: BTreeMap<i64, Vec<i64>> = BTreeMap::new();
    if !ids.is_empty() {
        // D1 has a finite bind-parameter limit; never expand one placeholder
        // per historical transaction.
        let srows: Vec<SplitResp> = db::q_all(db,
            "SELECT s.transaction_id,s.responsible_membership_id FROM transaction_splits s JOIN transactions t ON t.id=s.transaction_id WHERE t.org_id=?1 AND t.suppressed=0 AND s.responsible_membership_id IS NOT NULL",
            vec![db::i(org.id)]).await?;
        for s in srows {
            if ids.contains(&s.transaction_id) {
                split_resps
                    .entry(s.transaction_id)
                    .or_default()
                    .push(s.responsible_membership_id);
            }
        }
    }

    let eligible = |mid: i64| -> Option<MemRow> {
        let m = mems.iter().find(|m| m.id == mid)?;
        if !m.active() {
            return None;
        }
        Some(m.clone())
    };

    let mut by_mem: BTreeMap<i64, Vec<DigestItem>> = BTreeMap::new();
    for r in &owed {
        let members: Vec<_> = mems.iter().map(|m| (m.id, m.role_id, m.active())).collect();
        let mut resps = if r.amount_minor > 0 {
            crate::domain_map::income_recipients(
                org.income_explanation_role_id,
                r.owner_membership_id,
                &members,
            )
        } else {
            split_resps.remove(&r.id).unwrap_or_default()
        };
        if let Some(x) = r.responsible_membership_id.filter(|_| r.amount_minor <= 0) {
            if !resps.contains(&x) {
                resps.push(x);
            }
        }
        for mid in resps {
            if eligible(mid).is_some_and(|m| {
                r.amount_minor > 0
                    || dom
                        .permissions_for(&UserId::new(m.user_id))
                        .contains(&Permission::ViewTransactions)
            }) {
                let items = by_mem.entry(mid).or_default();
                if !items.iter().any(|i| i.txn_id == r.id) {
                    items.push(DigestItem {
                        txn_id: r.id,
                        date: r.txn_date.clone(),
                    });
                }
            }
        }
    }

    let mut groups = Vec::new();
    for (mid, items) in by_mem {
        if let Some(m) = eligible(mid) {
            groups.push((m, items));
        }
    }
    groups.sort_by(|a, b| a.0.name.to_lowercase().cmp(&b.0.name.to_lowercase()));
    Ok(DigestTargets {
        groups,
        total_items: owed.len(),
        limited,
    })
}

/// Settings-page preview payload. `limited` marks a partial scan; mentions are
/// never previewed (they depend on future comments).
pub fn preview_json(t: &DigestTargets) -> serde_json::Value {
    serde_json::json!({
        "recipients": t.groups.iter().map(|(m, items)| serde_json::json!({"name": m.name, "pending": items.len()})).collect::<Vec<_>>(),
        "total_items": t.total_items,
        "limited": t.limited,
    })
}

/// True when no digest went to this member within the last week. Durable
/// cadence key = existing outbox timestamps (kind='digest').
pub fn digest_due(last: Option<i64>, now_ms: i64) -> bool {
    match last {
        None => true,
        Some(t) => now_ms - t >= DIGEST_WEEK_MS,
    }
}

#[derive(Debug, Deserialize)]
struct LastDigest {
    to_membership_id: i64,
    last: i64,
}

pub async fn last_digest_ms(db: &D1Database, org_id: i64) -> db::WResult<BTreeMap<i64, i64>> {
    let rows: Vec<LastDigest> = db::q_all(
        db,
        "SELECT to_membership_id, MAX(created_at) AS last FROM notification_outbox WHERE org_id = ?1 AND kind = 'digest' AND cancelled_at IS NULL GROUP BY to_membership_id",
        vec![db::i(org_id)],
    )
    .await?;
    Ok(rows
        .into_iter()
        .map(|r| (r.to_membership_id, r.last))
        .collect())
}

/// Digest body: counts, dates, links only — no amounts, balances, notes,
/// counterparties, or attachments.
pub fn digest_body(org_name: &str, slug: &str, items: &[DigestItem]) -> String {
    let mut b = format!(
        "Weekly digest — {org_name}: {} item(s) still await your documentation.\n\n",
        items.len()
    );
    for i in items {
        b.push_str(&format!(
            "Documentation task — /org/{slug}/transactions/{}\n",
            i.txn_id
        ));
    }
    b.push_str("\nFinancial details stay in PocketTrail; this email carries none.");
    b
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cand(id: i64, handle: &str, name: &str) -> MentionCand {
        MentionCand {
            id,
            handle: handle.to_string(),
            name: name.to_string(),
        }
    }

    #[test]
    fn mention_matching() {
        let cands = vec![cand(1, "alice", "Alice (fixture)"), cand(2, "bob", "Bob")];
        // handle token
        assert_eq!(mention_recipients("cc @bob please", &cands), vec![2]);
        // UI chip full name
        assert_eq!(
            mention_recipients("thanks @Alice (fixture)!", &cands),
            vec![1]
        );
        // case-insensitive name span
        assert_eq!(mention_recipients("@BOB look", &cands), vec![2]);
        // no partial-word or email-shaped matches
        assert_eq!(
            mention_recipients("mail bob@x.test @bobby", &cands),
            Vec::<i64>::new()
        );
        // both, deduped in candidate order
        assert_eq!(
            mention_recipients("@Alice (fixture) and @bob", &cands),
            vec![1, 2]
        );
        assert_eq!(mention_recipients("nobody here", &cands), Vec::<i64>::new());
    }

    #[test]
    fn digest_cadence() {
        assert!(digest_due(None, 1_000));
        assert!(!digest_due(Some(900), 1_000 + DIGEST_WEEK_MS - 1));
        assert!(digest_due(Some(900), 1_000 + DIGEST_WEEK_MS));
    }

    #[test]
    fn digest_body_has_no_financial_facts() {
        let items = vec![DigestItem {
            txn_id: 7,
            date: "2025-06-01".into(),
        }];
        let b = digest_body("Org", "org", &items);
        assert!(b.contains("2025-06-01"));
        assert!(b.contains("/org/org/transactions/7"));
        assert!(!b.contains("Rp"));
    }
}
