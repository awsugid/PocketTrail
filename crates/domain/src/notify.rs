//! Notification assembly and the suppression gates. Delivery itself lives
//! outside this crate; this module decides what may leave.

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};

use crate::{
    DocumentationStatus, DomainError, OrgId, Organization, Permission, Suppression, Transaction,
    TransactionId, UserId, authorize,
};

/// Kind of one outbound notification after all gates.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum NotificationKind {
    /// Explicit mention in one discussion comment, indexed from zero.
    Mention {
        transaction: TransactionId,
        comment: usize,
    },
    /// Per-transaction nudge to a responsible member while documentation is
    /// still owed (`Draft` or `ChangesRequested`). `Submitted` items await
    /// review by somebody else and are not chased.
    Reminder { transaction: TransactionId },
    /// Digest of a member's transactions still awaiting their documentation.
    Digest { transactions: Vec<TransactionId> },
}

/// One notification cleared for delivery.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Notification {
    pub organization: OrgId,
    pub recipient: UserId,
    pub kind: NotificationKind,
}

/// Result of one incremental notification build. Persist `mention_cursor`
/// and pass it back on the next build so historical mentions never replay.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct NotificationBatch {
    pub notifications: Vec<Notification>,
    /// Per transaction: number of comments already scanned. Advances past
    /// suppressed or undeliverable comments too, so enabling organization
    /// notifications releases no queued flood of earlier mentions. Keys are
    /// transaction IDs; persist one map per organization.
    pub mention_cursor: BTreeMap<TransactionId, usize>,
}

/// True while every notification about `txn` is stopped, mentions included.
pub fn is_suppressed(txn: &Transaction) -> bool {
    txn.suppression.is_some()
}

/// A member may receive notifications only while an active member holding
/// [`Permission::ViewTransactions`].
fn is_recipient(org: &Organization, user: &UserId) -> bool {
    org.member_is_active(user)
        && org
            .permissions_for(user)
            .contains(&Permission::ViewTransactions)
}

/// Reminders and digests skip transactions older than the organization's
/// cutoff; mentions are unaffected.
fn chases_date(org: &Organization, txn: &Transaction) -> bool {
    org.notification_cutoff
        .as_ref()
        .is_none_or(|cutoff| txn.date.as_str() >= cutoff.as_str())
}

/// Suppresses all notifications about the transaction, including explicit
/// mentions, reminders, and digests. Requires
/// [`Permission::SuppressNotifications`] and a nonempty reason; records the
/// author and reason and keeps the suppression until an authorized member
/// changes it. Does not change approval state or imply evidence exists.
pub fn suppress_transaction_notifications(
    org: &Organization,
    txn: &mut Transaction,
    actor: &UserId,
    reason: impl Into<String>,
    at: impl Into<String>,
) -> Result<(), DomainError> {
    if txn.organization_id != org.id {
        return Err(DomainError::WrongOrganization);
    }
    authorize(org, actor, Permission::SuppressNotifications)?;
    let reason = reason.into();
    if reason.trim().is_empty() {
        return Err(DomainError::MissingReason);
    }
    txn.suppression = Some(Suppression {
        reason,
        author: actor.clone(),
        at: at.into(),
    });
    Ok(())
}

/// Restores notifications for the transaction. Requires
/// [`Permission::SuppressNotifications`].
pub fn unsuppress_transaction_notifications(
    org: &Organization,
    txn: &mut Transaction,
    actor: &UserId,
) -> Result<(), DomainError> {
    if txn.organization_id != org.id {
        return Err(DomainError::WrongOrganization);
    }
    authorize(org, actor, Permission::SuppressNotifications)?;
    txn.suppression = None;
    Ok(())
}

/// Assembles notifications for one organization, scanning only comments at
/// or after `mention_cursor`; persist and pass back the returned cursor
/// (keys are transaction IDs; keep one map per organization).
///
/// - Mentions: comments new since the cursor.
/// - Reminders and digests: derived from current state, only for
///   transactions still owing documentation (`Draft` or `ChangesRequested`)
///   that are not older than the organization's cutoff; `Submitted` items
///   await review by somebody else and are not chased.
///
/// Gates, all applied here: organization notifications disabled blocks
/// everything while the cursor still advances; a suppressed transaction
/// produces no notifications of any kind; recipients must be active members
/// holding [`Permission::ViewTransactions`]; transactions of other
/// organizations are ignored.
pub fn notifications_since(
    org: &Organization,
    transactions: &[Transaction],
    mention_cursor: &BTreeMap<TransactionId, usize>,
) -> NotificationBatch {
    let mut notifications = Vec::new();
    let mut new_cursor = mention_cursor.clone();
    if !org.notifications_enabled {
        // Advance past everything scanned: enabling must not release a
        // queued flood of earlier notifications.
        for txn in transactions {
            if txn.organization_id == org.id {
                new_cursor.insert(txn.id.clone(), txn.comments.len());
            }
        }
        return NotificationBatch {
            notifications,
            mention_cursor: new_cursor,
        };
    }
    let mut digest_recipients: BTreeMap<UserId, BTreeSet<TransactionId>> = BTreeMap::new();
    for txn in transactions {
        if txn.organization_id != org.id {
            continue;
        }
        let cursor = mention_cursor.get(&txn.id).copied().unwrap_or(0);
        new_cursor.insert(txn.id.clone(), txn.comments.len());
        if is_suppressed(txn) {
            continue;
        }
        if chases_date(org, txn)
            && matches!(
                txn.status,
                DocumentationStatus::Draft | DocumentationStatus::ChangesRequested
            )
        {
            let mut responsible: Vec<UserId> = txn
                .purposes
                .iter()
                .map(|p| p.responsible_member.clone())
                .collect();
            responsible.sort();
            responsible.dedup();
            for member in responsible {
                if !is_recipient(org, &member) {
                    continue;
                }
                notifications.push(Notification {
                    organization: org.id.clone(),
                    recipient: member.clone(),
                    kind: NotificationKind::Reminder {
                        transaction: txn.id.clone(),
                    },
                });
                digest_recipients
                    .entry(member)
                    .or_default()
                    .insert(txn.id.clone());
            }
        }
        for (index, comment) in txn.comments.iter().enumerate().skip(cursor) {
            let mut mentioned: BTreeSet<&UserId> = BTreeSet::new();
            for mention in &comment.mentions {
                if mention == &comment.author
                    || !is_recipient(org, mention)
                    || !mentioned.insert(mention)
                {
                    continue;
                }
                notifications.push(Notification {
                    organization: org.id.clone(),
                    recipient: mention.clone(),
                    kind: NotificationKind::Mention {
                        transaction: txn.id.clone(),
                        comment: index,
                    },
                });
            }
        }
    }
    for (recipient, transactions) in digest_recipients {
        notifications.push(Notification {
            organization: org.id.clone(),
            recipient,
            kind: NotificationKind::Digest {
                transactions: transactions.into_iter().collect(),
            },
        });
    }
    NotificationBatch {
        notifications,
        mention_cursor: new_cursor,
    }
}

/// One-shot snapshot over every comment: use for previews such as the
/// enablement recipient preview. For recurring builds use
/// [`notifications_since`] so historical mentions do not replay.
pub fn build_notifications(org: &Organization, transactions: &[Transaction]) -> Vec<Notification> {
    notifications_since(org, transactions, &BTreeMap::new()).notifications
}
