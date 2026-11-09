//! Bank transactions, purpose splits, and the documentation approval
//! workflow.

use std::collections::BTreeSet;

use serde::{Deserialize, Serialize};

use crate::{
    DomainError, OrgId, Organization, Permission, PocketId, PurposeId, TransactionId, UserId,
    authorize,
};

/// Direction of the bank movement. Supplies the sign; magnitudes are stored
/// positive.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Direction {
    /// Money received by the pocket.
    Inflow,
    /// Money paid out of the pocket.
    Outflow,
}

/// One purpose covered by a transaction.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Purpose {
    pub id: PurposeId,
    /// Short purpose label, e.g. "event food"; must be nonblank and unique
    /// within the transaction.
    pub name: String,
    /// Share of the bank amount, positive integer minor units (IDR: 100
    /// minor = Rp 1).
    pub amount: i64,
    /// Member accountable for this purpose's explanation and evidence.
    pub responsible_member: UserId,
}

impl Purpose {
    pub fn new(
        id: impl Into<PurposeId>,
        name: impl Into<String>,
        amount: i64,
        responsible_member: impl Into<UserId>,
    ) -> Self {
        Self {
            id: id.into(),
            name: name.into(),
            amount,
            responsible_member: responsible_member.into(),
        }
    }
}

/// The spender's explanation plus supporting evidence. Separate from the
/// discussion comments.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Documentation {
    /// The responsible member's own explanation; bank note text is context,
    /// not a substitute.
    pub explanation: String,
    /// Opaque references to retained supporting documents; each must be
    /// nonblank.
    pub evidence: Vec<String>,
    /// Set when documents are legitimately unavailable, per product rules;
    /// must be nonblank when present.
    pub evidence_unavailable_reason: Option<String>,
}

impl Documentation {
    pub fn new(explanation: impl Into<String>, evidence: Vec<String>) -> Self {
        Self {
            explanation: explanation.into(),
            evidence,
            evidence_unavailable_reason: None,
        }
    }

    /// Documentation with an explicit reason why no evidence exists.
    pub fn without_evidence(explanation: impl Into<String>, reason: impl Into<String>) -> Self {
        Self {
            explanation: explanation.into(),
            evidence: Vec::new(),
            evidence_unavailable_reason: Some(reason.into()),
        }
    }
}

/// Documentation workflow state of the whole transaction, all purposes
/// included.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum DocumentationStatus {
    /// Being written; not yet submitted for review.
    Draft,
    /// Submitted and awaiting review or approval.
    Submitted,
    /// A reviewer requested changes; the responsible member must resubmit.
    ChangesRequested,
    /// Approved in full, including every purpose.
    Approved,
}

/// An authorized decision to stop every notification about one transaction,
/// including mentions and digests. Never implies approval or that evidence
/// exists. Retained until an authorized member changes it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Suppression {
    /// Required reason, recorded for traceability.
    pub reason: String,
    /// Authorizing member.
    pub author: UserId,
    /// Caller-supplied timestamp, RFC 3339 recommended.
    pub at: String,
}

/// One discussion comment. Comments never change approval state.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Comment {
    pub author: UserId,
    pub body: String,
    /// Mentioned members; their notifications stay gated by suppression and
    /// organization rules.
    pub mentions: Vec<UserId>,
    /// Caller-supplied timestamp.
    pub at: String,
}

/// One bank movement and its documentation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Transaction {
    pub id: TransactionId,
    pub organization_id: OrgId,
    pub pocket_id: PocketId,
    /// Bank-provided Jago transaction ID, retained as the bank reference.
    pub jago_transaction_id: Option<String>,
    pub direction: Direction,
    /// Bank amount as a positive integer in minor units (IDR: 100 minor =
    /// Rp 1); `direction` supplies the sign.
    pub amount: i64,
    /// Movement date, ISO 8601 recommended; compared against the
    /// organization's notification cutoff.
    pub date: String,
    /// Purposes the movement covers; must sum to `amount`.
    pub purposes: Vec<Purpose>,
    pub documentation: Documentation,
    pub status: DocumentationStatus,
    /// Present while notifications for this transaction are suppressed.
    pub suppression: Option<Suppression>,
    /// Chronological discussion, visible to members permitted to view the
    /// transaction.
    pub comments: Vec<Comment>,
    /// Members ever responsible for a purpose; `set_purposes` accumulates
    /// the previous responsible members here so a reassigned spender cannot
    /// approve their own spend. Serde default keeps persisted documents
    /// from before this field loadable.
    #[serde(default)]
    pub approval_exclusions: BTreeSet<UserId>,
}

/// Validates one transaction's split and documentation without touching it:
/// purposes exist and are well formed, their sum equals the bank amount, and
/// explanation plus evidence (or an explicit evidence-unavailable reason) are
/// present. Membership checks live in the workflow functions.
pub fn validate_documentation(txn: &Transaction) -> Result<(), DomainError> {
    validate_parts(txn.amount, &txn.purposes, &txn.documentation)
}

fn validate_parts(
    bank_amount: i64,
    purposes: &[Purpose],
    documentation: &Documentation,
) -> Result<(), DomainError> {
    if bank_amount <= 0 {
        return Err(DomainError::InvalidAmount {
            amount: bank_amount,
        });
    }
    if purposes.is_empty() {
        return Err(DomainError::IncompleteDocumentation("purposes"));
    }
    let mut seen = BTreeSet::new();
    for purpose in purposes {
        if purpose.name.trim().is_empty() {
            return Err(DomainError::InvalidPurpose {
                purpose: purpose.id.clone(),
                reason: "blank name",
            });
        }
        if purpose.amount <= 0 {
            return Err(DomainError::InvalidPurpose {
                purpose: purpose.id.clone(),
                reason: "amount must be positive",
            });
        }
        if !seen.insert(purpose.id.clone()) {
            return Err(DomainError::InvalidPurpose {
                purpose: purpose.id.clone(),
                reason: "duplicate id",
            });
        }
    }
    let purpose_total = purposes.iter().map(|p| p.amount as i128).sum::<i128>();
    if purpose_total != bank_amount as i128 {
        return Err(DomainError::PurposeTotalMismatch {
            bank_amount,
            purpose_total: i64::try_from(purpose_total).unwrap_or(i64::MAX),
        });
    }
    if documentation.explanation.trim().is_empty() {
        return Err(DomainError::IncompleteDocumentation("explanation"));
    }
    if documentation.evidence.iter().any(|e| e.trim().is_empty()) {
        return Err(DomainError::IncompleteDocumentation("evidence"));
    }
    let has_evidence = !documentation.evidence.is_empty();
    let has_reason = documentation
        .evidence_unavailable_reason
        .as_ref()
        .is_some_and(|reason| !reason.trim().is_empty());
    if !has_evidence && !has_reason {
        return Err(DomainError::IncompleteDocumentation("evidence"));
    }
    Ok(())
}

fn validate_responsible(org: &Organization, purposes: &[Purpose]) -> Result<(), DomainError> {
    for purpose in purposes {
        if !org.member_is_active(&purpose.responsible_member) {
            return Err(DomainError::ResponsibleMemberInactive {
                member: purpose.responsible_member.clone(),
            });
        }
    }
    Ok(())
}

fn require_organization(org: &Organization, txn: &Transaction) -> Result<(), DomainError> {
    if txn.organization_id == org.id {
        Ok(())
    } else {
        Err(DomainError::WrongOrganization)
    }
}

/// Submits documentation for review. Requires
/// [`Permission::DocumentTransactions`]. Allowed from `Draft` or
/// `ChangesRequested`. Validates completeness, the purpose split, and that
/// every purpose's responsible member is currently active; a draft may keep
/// departed attribution but cannot be submitted until resolved.
pub fn submit_transaction(
    org: &Organization,
    txn: &mut Transaction,
    actor: &UserId,
) -> Result<(), DomainError> {
    require_organization(org, txn)?;
    authorize(org, actor, Permission::DocumentTransactions)?;
    if !matches!(
        txn.status,
        DocumentationStatus::Draft | DocumentationStatus::ChangesRequested
    ) {
        return Err(DomainError::InvalidStatus {
            expected: DocumentationStatus::Draft,
            actual: txn.status,
        });
    }
    validate_documentation(txn)?;
    validate_responsible(org, &txn.purposes)?;
    txn.status = DocumentationStatus::Submitted;
    Ok(())
}

/// Records a reviewer's request for changes. Requires
/// [`Permission::ApproveTransactions`]. Allowed from `Submitted`; discussion
/// happens through comments, not this transition.
pub fn request_changes(
    org: &Organization,
    txn: &mut Transaction,
    actor: &UserId,
) -> Result<(), DomainError> {
    require_organization(org, txn)?;
    authorize(org, actor, Permission::ApproveTransactions)?;
    if txn.status != DocumentationStatus::Submitted {
        return Err(DomainError::InvalidStatus {
            expected: DocumentationStatus::Submitted,
            actual: txn.status,
        });
    }
    txn.status = DocumentationStatus::ChangesRequested;
    Ok(())
}

/// Approves the whole transaction, every purpose included. Requires
/// [`Permission::ApproveTransactions`]. Denied for anyone currently or
/// historically responsible for a purpose, so without another eligible
/// approver the transaction stays pending. Only allowed from `Submitted`.
pub fn approve_transaction(
    org: &Organization,
    txn: &mut Transaction,
    actor: &UserId,
) -> Result<(), DomainError> {
    require_organization(org, txn)?;
    authorize(org, actor, Permission::ApproveTransactions)?;
    if txn.status != DocumentationStatus::Submitted {
        return Err(DomainError::InvalidStatus {
            expected: DocumentationStatus::Submitted,
            actual: txn.status,
        });
    }
    validate_documentation(txn)?;
    validate_responsible(org, &txn.purposes)?;
    if txn.purposes.iter().any(|p| p.responsible_member == *actor)
        || txn.approval_exclusions.contains(actor)
    {
        return Err(DomainError::SelfApprovalDenied);
    }
    txn.status = DocumentationStatus::Approved;
    Ok(())
}

/// Replaces the explanation and evidence. Substantive edit: an approval
/// reopens to `Submitted` for review again. Requires
/// [`Permission::DocumentTransactions`].
pub fn edit_documentation(
    org: &Organization,
    txn: &mut Transaction,
    actor: &UserId,
    documentation: Documentation,
) -> Result<(), DomainError> {
    require_organization(org, txn)?;
    authorize(org, actor, Permission::DocumentTransactions)?;
    validate_parts(txn.amount, &txn.purposes, &documentation)?;
    reopen_approval(txn);
    txn.documentation = documentation;
    Ok(())
}

/// Replaces purpose allocations, including responsible members. Substantive
/// edit: an approval reopens to `Submitted`. Requires
/// [`Permission::DocumentTransactions`]. The new split must be valid, every
/// new responsible member active, and the previous responsible members are
/// preserved in `approval_exclusions` so reassignment never enables
/// self-approval.
pub fn set_purposes(
    org: &Organization,
    txn: &mut Transaction,
    actor: &UserId,
    purposes: Vec<Purpose>,
) -> Result<(), DomainError> {
    require_organization(org, txn)?;
    authorize(org, actor, Permission::DocumentTransactions)?;
    validate_parts(txn.amount, &purposes, &txn.documentation)?;
    validate_responsible(org, &purposes)?;
    for purpose in &txn.purposes {
        txn.approval_exclusions
            .insert(purpose.responsible_member.clone());
    }
    reopen_approval(txn);
    txn.purposes = purposes;
    Ok(())
}

fn reopen_approval(txn: &mut Transaction) {
    if txn.status == DocumentationStatus::Approved {
        txn.status = DocumentationStatus::Submitted;
    }
}

/// Adds one discussion comment. Not substantive: approval state is untouched.
/// Requires [`Permission::CommentTransactions`].
pub fn add_comment(
    org: &Organization,
    txn: &mut Transaction,
    actor: &UserId,
    body: impl Into<String>,
    mentions: Vec<UserId>,
    at: impl Into<String>,
) -> Result<(), DomainError> {
    require_organization(org, txn)?;
    authorize(org, actor, Permission::CommentTransactions)?;
    txn.comments.push(Comment {
        author: actor.clone(),
        body: body.into(),
        mentions,
        at: at.into(),
    });
    Ok(())
}
