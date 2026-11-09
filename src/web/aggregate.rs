//! D1 row structs and domain-aggregate builders.

use pockettrail_domain::{
    Comment, Direction, Documentation, DocumentationStatus, Member, Organization, Purpose,
    Role as DomRole, RoleId, Suppression, Transaction, UserId,
};
use serde::Deserialize;
use std::collections::{BTreeMap, BTreeSet};
use worker::D1Database;

use super::db;
use crate::domain_map;

#[derive(Debug, Deserialize)]
pub struct OrgRow {
    pub id: i64,
    pub slug: String,
    pub name: String,
    pub is_synthetic: i64,
    pub notifications_enabled: i64,
    pub notification_cutoff_date: Option<String>,
    #[serde(default)]
    pub notification_revision: i64,
    pub created_at: i64,
}

#[derive(Debug, Deserialize)]
pub struct RoleRow {
    pub id: i64,
    pub org_id: i64,
    pub name: String,
    pub permissions: String,
}

/// membership joined with its user (memberships always reference a user).
#[derive(Debug, Clone, Deserialize)]
pub struct MemRow {
    pub id: i64,
    pub org_id: i64,
    pub user_id: String,
    pub role_id: i64,
    pub handle: String,
    pub created_at: i64,
    pub removed_at: Option<i64>,
    pub name: String,
    pub email: String,
}

impl MemRow {
    pub fn active(&self) -> bool {
        self.removed_at.is_none()
    }
}

/// Resolve a responsible membership id to an ACTIVE membership row of this
/// org; None when unassigned/removed/foreign.
pub fn active_mem<'a>(mems: &'a [MemRow], id: Option<i64>) -> Option<&'a MemRow> {
    id.and_then(|id| mems.iter().find(|m| m.id == id))
        .filter(|m| m.active())
}

#[derive(Debug, Deserialize)]
pub struct UserRow {
    pub id: String,
    pub email: String,
    pub name: String,
    pub google_sub: Option<String>,
    pub is_platform_admin: i64,
    pub created_at: i64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct TxnRow {
    pub id: i64,
    pub org_id: i64,
    pub pocket_id: i64,
    pub bank_id: Option<String>,
    pub txn_date: String,
    pub txn_time: Option<String>,
    pub counterparty: String,
    pub transaction_type: String,
    pub bank_notes: String,
    pub amount_minor: i64,
    pub balance_minor: Option<i64>,
    pub explanation: String,
    pub evidence_unavailable_reason: String,
    pub responsible_membership_id: Option<i64>,
    pub status: String,
    pub approved_by_membership_id: Option<i64>,
    pub approved_at: Option<i64>,
    pub approval_note: String,
    pub suppressed: i64,
    pub suppressed_by_membership_id: Option<i64>,
    pub suppressed_reason: String,
    pub suppressed_at: Option<i64>,
    pub import_batch_id: Option<i64>,
    pub comment_cursor: i64,
    pub created_at: i64,
    pub updated_at: i64,
    #[serde(default)]
    pub revision: i64,
    #[serde(default)]
    pub mutation_token: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SplitRow {
    pub id: i64,
    pub transaction_id: i64,
    pub label: String,
    pub amount_minor: i64,
    pub responsible_membership_id: Option<i64>,
    pub created_at: i64,
}

#[derive(Debug, Deserialize)]
pub struct CommentRow {
    pub id: i64,
    pub org_id: i64,
    pub transaction_id: i64,
    pub author_membership_id: i64,
    pub body: String,
    pub created_at: i64,
    pub author_name: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct DocRow {
    pub id: i64,
    pub org_id: i64,
    pub transaction_id: Option<i64>,
    pub import_batch_id: Option<i64>,
    pub kind: String,
    pub r2_key: String,
    pub filename: String,
    pub content_type: String,
    pub size_bytes: i64,
    pub note: String,
    pub superseded: i64,
    pub uploaded_by_membership_id: i64,
    pub created_at: i64,
}

#[derive(Debug, Deserialize)]
pub struct PocketRow {
    pub id: i64,
    pub org_id: i64,
    pub name: String,
    pub opening_balance_minor: i64,
}

#[derive(Debug, Deserialize)]
pub struct MappingRow {
    pub id: i64,
    pub pattern: String,
    pub membership_id: i64,
    pub member_name: String,
}

#[derive(Debug, Deserialize)]
pub struct OrgLite {
    pub slug: String,
    pub name: String,
}

/// List row for the transactions table (joined responsible name + evidence count).
#[derive(Debug, Deserialize)]
pub struct TxnListRow {
    pub id: i64,
    #[serde(default)]
    pub pocket_name: String,
    pub txn_date: String,
    pub txn_time: Option<String>,
    pub counterparty: String,
    pub transaction_type: String,
    pub amount_minor: i64,
    pub balance_minor: Option<i64>,
    pub explanation: String,
    pub evidence_unavailable_reason: String,
    pub status: String,
    pub suppressed: i64,
    pub responsible_membership_id: Option<i64>,
    pub responsible_name: Option<String>,
    pub evidence_count: i64,
}

impl TxnListRow {
    /// Documentation still owed by the responsible member (Draft/ChangesRequested).
    pub fn needs_details(&self) -> bool {
        let complete = !self.explanation.trim().is_empty() && self.evidence_count > 0
            || (!self.explanation.trim().is_empty()
                && !self.evidence_unavailable_reason.trim().is_empty());
        domain_map::documentation_owed(&self.status, complete)
    }
}

pub async fn org_by_slug(db: &D1Database, slug: &str) -> db::WResult<Option<OrgRow>> {
    db::q_one(
        db,
        "SELECT * FROM organizations WHERE slug = ?1",
        vec![db::s(slug)],
    )
    .await
}

pub async fn orgs_of_user(db: &D1Database, user_id: &str) -> db::WResult<Vec<OrgLite>> {
    db::q_all(
        db,
        "SELECT o.slug, o.name FROM organizations o JOIN memberships m ON m.org_id = o.id WHERE m.user_id = ?1 AND m.removed_at IS NULL ORDER BY o.name",
        vec![db::s(user_id)],
    )
    .await
}

pub async fn roles_of_org(db: &D1Database, org_id: i64) -> db::WResult<Vec<RoleRow>> {
    db::q_all(
        db,
        "SELECT id, org_id, name, permissions FROM roles WHERE org_id = ?1 ORDER BY id",
        vec![db::i(org_id)],
    )
    .await
}

pub async fn mems_of_org(db: &D1Database, org_id: i64) -> db::WResult<Vec<MemRow>> {
    db::q_all(
        db,
        "SELECT m.id, m.org_id, m.user_id, m.role_id, m.handle, m.created_at, m.removed_at, u.name, u.email FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.org_id = ?1 ORDER BY m.id",
        vec![db::i(org_id)],
    )
    .await
}

/// Build the domain Organization aggregate from persisted rows.
pub fn build_dom_org(org: &OrgRow, roles: &[RoleRow], mems: &[MemRow]) -> Organization {
    let mut o = Organization::new(org.id.to_string(), org.name.clone());
    o.notifications_enabled = db::flag(org.notifications_enabled);
    o.notification_cutoff = org
        .notification_cutoff_date
        .clone()
        .filter(|s| !s.is_empty());
    for r in roles {
        o.roles.insert(
            RoleId::new(r.id.to_string()),
            DomRole {
                name: r.name.clone(),
                permissions: domain_map::parse_role_permissions(&r.permissions),
            },
        );
    }
    for m in mems {
        let mut role_ids = BTreeSet::new();
        role_ids.insert(RoleId::new(m.role_id.to_string()));
        o.members.insert(
            UserId::new(m.user_id.clone()),
            Member {
                role_ids,
                active: m.active(),
            },
        );
    }
    o
}

fn user_of(mem: Option<&MemRow>) -> UserId {
    mem.map(|m| UserId::new(m.user_id.clone()))
        .unwrap_or_default()
}

/// Build the domain Transaction aggregate. Status is set from the persisted
/// string after completeness validation (Draft vs Submitted derivation).
/// `exclusions` are membership ids of every historical responsible member
/// (anti self-approval laundering) — mapped to users on the aggregate.
#[allow(clippy::too_many_arguments)]
pub fn build_dom_txn(
    org: &OrgRow,
    _org_dom: &Organization,
    txn: &TxnRow,
    splits: &[SplitRow],
    comments: &[CommentRow],
    evidence: &[DocRow],
    mems: &[MemRow],
    exclusions: &[i64],
) -> Transaction {
    let mem = |id: i64| mems.iter().find(|m| m.id == id);
    let responsible = txn.responsible_membership_id.and_then(mem);

    // Convention (runtime invariant): the bank record is signed, purpose
    // amounts are positive magnitudes summing to abs(bank amount).
    let bank_magnitude = txn.amount_minor.checked_abs().unwrap_or(0);

    let purposes: Vec<Purpose> = if splits.is_empty() {
        // No split recorded: one implicit purpose covering the whole amount.
        let label = if txn.explanation.trim().is_empty() {
            format!("Movement from {}", txn.counterparty)
        } else {
            txn.explanation.clone()
        };
        vec![Purpose::new(
            "0",
            label,
            bank_magnitude,
            user_of(responsible),
        )]
    } else {
        splits
            .iter()
            .map(|s| {
                let uid = s
                    .responsible_membership_id
                    .and_then(mem)
                    .map(|m| UserId::new(m.user_id.clone()))
                    .unwrap_or_else(|| user_of(responsible));
                Purpose::new(s.id.to_string(), s.label.clone(), s.amount_minor, uid)
            })
            .collect()
    };

    let documentation = Documentation {
        explanation: txn.explanation.clone(),
        evidence: evidence.iter().map(|d| d.r2_key.clone()).collect(),
        evidence_unavailable_reason: (!txn.evidence_unavailable_reason.trim().is_empty())
            .then(|| txn.evidence_unavailable_reason.clone()),
    };

    let mut dom = Transaction {
        id: pockettrail_domain::TransactionId::new(txn.id.to_string()),
        organization_id: pockettrail_domain::OrgId::new(org.id.to_string()),
        pocket_id: pockettrail_domain::PocketId::new(txn.pocket_id.to_string()),
        jago_transaction_id: txn.bank_id.clone(),
        direction: if txn.amount_minor < 0 {
            Direction::Outflow
        } else {
            Direction::Inflow
        },
        amount: bank_magnitude,
        date: txn.txn_date.clone(),
        purposes,
        documentation,
        status: DocumentationStatus::Draft,
        suppression: None,
        comments: Vec::new(),
        approval_exclusions: exclusions
            .iter()
            .filter_map(|id| mems.iter().find(|m| m.id == *id))
            .map(|m| UserId::new(m.user_id.clone()))
            .collect(),
    };

    // Completeness comes from domain validation, not ad-hoc field checks.
    let complete = pockettrail_domain::validate_documentation(&dom).is_ok();
    dom.status = domain_map::runtime_status(&txn.status, complete);

    if db::flag(txn.suppressed) {
        dom.suppression = Some(Suppression {
            reason: txn.suppressed_reason.clone(),
            author: txn
                .suppressed_by_membership_id
                .and_then(mem)
                .map(|m| UserId::new(m.user_id.clone()))
                .unwrap_or_default(),
            at: crate::fmt::fmt_ts(txn.suppressed_at.unwrap_or(0)),
        });
    }

    let handles: Vec<(String, i64)> = mems
        .iter()
        .map(|m| (m.handle.to_lowercase(), m.id))
        .collect();
    dom.comments = comments
        .iter()
        .map(|c| {
            let mention_ids = crate::mentions::resolve_mentions(
                &crate::mentions::extract_mentions(&c.body),
                &handles,
            );
            Comment {
                author: mem(c.author_membership_id)
                    .map(|m| UserId::new(m.user_id.clone()))
                    .unwrap_or_default(),
                body: c.body.clone(),
                mentions: mention_ids
                    .into_iter()
                    .filter_map(|mid| mem(mid).map(|m| UserId::new(m.user_id.clone())))
                    .collect(),
                at: crate::fmt::fmt_ts(c.created_at),
            }
        })
        .collect();

    dom
}

pub async fn txn_by_id(db: &D1Database, org_id: i64, id: i64) -> db::WResult<Option<TxnRow>> {
    db::q_one(
        db,
        "SELECT * FROM transactions WHERE id = ?1 AND org_id = ?2",
        vec![db::i(id), db::i(org_id)],
    )
    .await
}

pub async fn splits_of(db: &D1Database, txn_id: i64) -> db::WResult<Vec<SplitRow>> {
    db::q_all(
        db,
        "SELECT * FROM transaction_splits WHERE transaction_id = ?1 ORDER BY id",
        vec![db::i(txn_id)],
    )
    .await
}

pub async fn comments_of(db: &D1Database, txn_id: i64) -> db::WResult<Vec<CommentRow>> {
    db::q_all(
        db,
        "SELECT c.id, c.org_id, c.transaction_id, c.author_membership_id, c.body, c.created_at, u.name AS author_name FROM comments c JOIN memberships m ON m.id = c.author_membership_id JOIN users u ON u.id = m.user_id WHERE c.transaction_id = ?1 ORDER BY c.id",
        vec![db::i(txn_id)],
    )
    .await
}

pub async fn evidence_of(db: &D1Database, txn_id: i64) -> db::WResult<Vec<DocRow>> {
    db::q_all(
        db,
        "SELECT * FROM documents WHERE transaction_id = ?1 AND kind = 'evidence' AND superseded = 0 ORDER BY id",
        vec![db::i(txn_id)],
    )
    .await
}

pub async fn pockets_of(db: &D1Database, org_id: i64) -> db::WResult<Vec<PocketRow>> {
    db::q_all(
        db,
        "SELECT * FROM pockets WHERE org_id = ?1 ORDER BY id",
        vec![db::i(org_id)],
    )
    .await
}

pub async fn mappings_of(db: &D1Database, org_id: i64) -> db::WResult<Vec<MappingRow>> {
    db::q_all(
        db,
        "SELECT a.id, a.pattern, a.membership_id, u.name AS member_name FROM actor_mappings a JOIN memberships m ON m.id = a.membership_id JOIN users u ON u.id = m.user_id WHERE a.org_id = ?1 ORDER BY a.pattern",
        vec![db::i(org_id)],
    )
    .await
}

pub async fn doc_by_id(db: &D1Database, org_id: i64, id: i64) -> db::WResult<Option<DocRow>> {
    db::q_one(
        db,
        "SELECT * FROM documents WHERE id = ?1 AND org_id = ?2",
        vec![db::i(id), db::i(org_id)],
    )
    .await
}

pub async fn txn_list(
    db: &D1Database,
    org_id: i64,
    status: Option<&str>,
) -> db::WResult<Vec<TxnListRow>> {
    txn_list_page(db, org_id, status, 0, 500).await
}

pub async fn txn_list_page(
    db: &D1Database,
    org_id: i64,
    status: Option<&str>,
    offset: i64,
    limit: i64,
) -> db::WResult<Vec<TxnListRow>> {
    let sql = "SELECT t.id, p.name AS pocket_name, t.txn_date, t.txn_time, t.counterparty, t.transaction_type, t.amount_minor, t.balance_minor, t.explanation, t.evidence_unavailable_reason, t.status, t.suppressed, t.responsible_membership_id, u.name AS responsible_name, (SELECT COUNT(*) FROM documents d WHERE d.transaction_id = t.id AND d.kind = 'evidence' AND d.superseded = 0) AS evidence_count FROM transactions t JOIN pockets p ON p.id=t.pocket_id AND p.org_id=t.org_id LEFT JOIN memberships m ON m.id = t.responsible_membership_id LEFT JOIN users u ON u.id = m.user_id WHERE t.org_id = ?1 AND (?2='' OR (?2='pending' AND t.status IN ('pending','submitted')) OR t.status=?2) ORDER BY t.txn_date DESC, t.id DESC LIMIT ?3 OFFSET ?4";
    db::q_all(
        db,
        sql,
        vec![
            db::i(org_id),
            db::s(status.unwrap_or("")),
            db::i(limit),
            db::i(offset),
        ],
    )
    .await
}

/// Best-effort actor mapping: exact, trimmed, case-insensitive label match.
pub fn map_counterparty<'a>(
    mappings: &'a [MappingRow],
    counterparty: &str,
) -> Option<&'a MappingRow> {
    let want = counterparty.trim().to_lowercase();
    if let Some(exact) = mappings
        .iter()
        .find(|m| m.pattern.trim().to_lowercase() == want)
    {
        return Some(exact);
    }
    // Wrapped source cells may include a separate bank/account continuation.
    // Only use an explicit exact name mapping, never fuzzy or substring matches.
    let name = want.split(" / ").next()?.trim();
    let mut matches = mappings
        .iter()
        .filter(|m| m.pattern.trim().to_lowercase() == name);
    let first = matches.next()?;
    matches.next().is_none().then_some(first)
}

/// Split rows from parallel form arrays. Returns None on shape mismatch.
pub fn splits_from_form(
    labels: &[String],
    amounts: &[i64],
    members: &[Option<i64>],
    now: i64,
) -> Option<Vec<SplitRow>> {
    if labels.len() != amounts.len() || labels.len() != members.len() {
        return None;
    }
    Some(
        labels
            .iter()
            .zip(amounts)
            .zip(members)
            .enumerate()
            .map(|(i, ((label, amount), member))| SplitRow {
                id: -(i as i64 + 1),
                transaction_id: 0,
                label: label.trim().to_string(),
                amount_minor: *amount,
                responsible_membership_id: *member,
                created_at: now,
            })
            .collect::<Vec<_>>(),
    )
}

pub fn mems_by_id(mems: &[MemRow]) -> BTreeMap<i64, MemRow> {
    mems.iter().map(|m| (m.id, m.clone())).collect()
}

#[derive(Debug, Deserialize)]
pub struct HistRow {
    pub membership_id: i64,
}

pub async fn history_of(db: &D1Database, txn_id: i64) -> db::WResult<Vec<i64>> {
    let rows: Vec<HistRow> = db::q_all(
        db,
        "SELECT membership_id FROM responsible_history WHERE transaction_id = ?1",
        vec![db::i(txn_id)],
    )
    .await?;
    Ok(rows.into_iter().map(|h| h.membership_id).collect())
}

/// Sync the domain aggregate's approval_exclusions back to the history table
/// after a purpose reassignment recorded new exclusions.
pub async fn sync_history(
    db: &D1Database,
    org: &OrgRow,
    txn_id: i64,
    dom: &pockettrail_domain::Transaction,
    mems: &[MemRow],
) -> db::WResult<()> {
    let excluded_users: Vec<&str> = dom
        .approval_exclusions
        .iter()
        .map(|u| u.0.as_str())
        .collect();
    let now = db::now_ms();
    for m in mems {
        if excluded_users.iter().any(|u| *u == m.user_id) {
            db::exec(
                db,
                "INSERT OR IGNORE INTO responsible_history (transaction_id, membership_id, since) VALUES (?1, ?2, ?3)",
                vec![db::i(txn_id), db::i(m.id), db::i(now)],
            )
            .await?;
        }
    }
    let _ = org;
    Ok(())
}
