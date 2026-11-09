//! PocketTrail domain: organization-scoped membership, roles, permission
//! checks, transaction documentation workflow, notification suppression, and
//! merchandise stock. Pure data and rules; persistence, UI, parsing, and
//! notification delivery live outside this crate.

use serde::{Deserialize, Serialize};

mod notify;
mod org;
mod stock;
mod transaction;

pub use notify::*;
pub use org::*;
pub use stock::*;
pub use transaction::*;

macro_rules! define_id {
    ($(#[$doc:meta])* $name:ident) => {
        $(#[$doc])*
        #[derive(Debug, Clone, Default, PartialEq, Eq, PartialOrd, Ord, Hash, serde::Serialize, serde::Deserialize)]
        #[serde(transparent)]
        pub struct $name(pub String);

        impl $name {
            /// Creates an ID from any string-like value.
            pub fn new(value: impl Into<String>) -> Self {
                Self(value.into())
            }
        }

        impl From<&str> for $name {
            fn from(value: &str) -> Self {
                Self(value.to_owned())
            }
        }

        impl From<String> for $name {
            fn from(value: String) -> Self {
                Self(value)
            }
        }

        impl std::fmt::Display for $name {
            fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                f.write_str(&self.0)
            }
        }
    };
}

define_id!(
    /// Identifies an organization workspace.
    OrgId
);
define_id!(
    /// Identifies a login user across all organizations.
    UserId
);
define_id!(
    /// Identifies a role within one organization.
    RoleId
);
define_id!(
    /// Identifies a bank pocket holding community funds.
    PocketId
);
define_id!(
    /// Identifies one bank movement.
    TransactionId
);
define_id!(
    /// Identifies one purpose within a transaction.
    PurposeId
);
define_id!(
    /// Identifies one merchandise item.
    StockItemId
);

/// Named application permissions that organization roles bundle. Deliberately
/// not full IAM: no conditions, denies, or inheritance.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub enum Permission {
    /// View transactions and discussions in the organization.
    ViewTransactions,
    /// Participate in transaction discussions, including mentions.
    CommentTransactions,
    /// Submit and edit transaction explanations, evidence, and purposes.
    DocumentTransactions,
    /// Request changes and approve whole transactions.
    ApproveTransactions,
    /// Import bank statements and manage actor mappings.
    ImportStatements,
    /// Manage organization roles and membership assignments.
    ManageRoles,
    /// Add, remove, and reactivate members.
    ManageMembers,
    /// Enable or disable organization-level notification delivery.
    ManageNotifications,
    /// Suppress or restore notifications for individual transactions.
    SuppressNotifications,
    /// Record merchandise stock changes.
    UpdateStock,
}

/// Everything a domain operation can reject.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DomainError {
    /// Caller holds no membership in the organization.
    NoMembership,
    /// Membership exists but is inactive, e.g. a removed former member.
    InactiveMembership,
    /// Active membership, but no held role grants `required`.
    NotAuthorized { required: Permission },
    /// Entity belongs to a different organization.
    WrongOrganization,
    /// Documentation incomplete; the payload names what is missing.
    IncompleteDocumentation(&'static str),
    /// Purpose allocations do not sum to the bank amount.
    PurposeTotalMismatch {
        bank_amount: i64,
        purpose_total: i64,
    },
    /// Action not allowed from `actual`; `expected` names a required state.
    InvalidStatus {
        expected: DocumentationStatus,
        actual: DocumentationStatus,
    },
    /// Approver is currently or was historically responsible for a purpose.
    SelfApprovalDenied,
    /// A purpose's responsible member is not an active member.
    ResponsibleMemberInactive { member: UserId },
    /// Bank amount must be positive minor units; direction supplies the sign.
    InvalidAmount { amount: i64 },
    /// A purpose is invalid; the payload names the problem.
    InvalidPurpose {
        purpose: PurposeId,
        reason: &'static str,
    },
    /// Stock quantity must be nonnegative.
    InvalidQuantity { quantity: i64 },
    /// Notification suppression requires a nonempty reason.
    MissingReason,
}

impl std::fmt::Display for DomainError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NoMembership => write!(f, "user is not a member of this organization"),
            Self::InactiveMembership => write!(f, "membership is inactive"),
            Self::NotAuthorized { required } => write!(f, "missing permission {required:?}"),
            Self::WrongOrganization => write!(f, "entity belongs to a different organization"),
            Self::IncompleteDocumentation(what) => {
                write!(f, "incomplete documentation: missing {what}")
            }
            Self::PurposeTotalMismatch {
                bank_amount,
                purpose_total,
            } => write!(
                f,
                "purposes total {purpose_total} but bank amount is {bank_amount}"
            ),
            Self::InvalidStatus { expected, actual } => {
                write!(f, "action requires status {expected:?}, found {actual:?}")
            }
            Self::SelfApprovalDenied => {
                write!(
                    f,
                    "a responsible member cannot approve their own transaction"
                )
            }
            Self::ResponsibleMemberInactive { member } => {
                write!(f, "responsible member {member} is not an active member")
            }
            Self::InvalidAmount { amount } => {
                write!(f, "bank amount must be positive minor units, got {amount}")
            }
            Self::InvalidPurpose { purpose, reason } => {
                write!(f, "invalid purpose {purpose}: {reason}")
            }
            Self::InvalidQuantity { quantity } => {
                write!(f, "stock quantity must be nonnegative, got {quantity}")
            }
            Self::MissingReason => write!(f, "a nonempty reason is required"),
        }
    }
}

impl std::error::Error for DomainError {}
