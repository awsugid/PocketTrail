//! Notification gating rules. Pure, testable natively.
//!
//! Org-level disablement blocks ALL outbound notifications (mentions and
//! digests included). Transaction suppression likewise blocks every
//! notification related to that transaction, including explicit mentions.
//! Removed members (inactive) never receive anything. Assignment and digest
//! notifications additionally respect the org's transaction-date cutoff;
//! mentions are explicit and skip the cutoff.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    Assignment,
    Digest,
    Mention,
}

pub fn should_notify(
    kind: Kind,
    org_enabled: bool,
    suppressed: bool,
    member_active: bool,
    txn_date: Option<&str>,
    cutoff: Option<&str>,
) -> bool {
    if !org_enabled || suppressed || !member_active {
        return false;
    }
    match kind {
        Kind::Mention => true,
        Kind::Assignment | Kind::Digest => match (txn_date, cutoff) {
            (Some(d), Some(c)) => d >= c,
            _ => true,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gates() {
        // org off blocks everything, including mentions
        assert!(!should_notify(
            Kind::Mention,
            false,
            false,
            true,
            None,
            None
        ));
        // suppression blocks all kinds for that transaction
        assert!(!should_notify(Kind::Mention, true, true, true, None, None));
        assert!(!should_notify(
            Kind::Assignment,
            true,
            true,
            true,
            Some("2025-06-01"),
            None
        ));
        // removed member gets nothing
        assert!(!should_notify(
            Kind::Digest,
            true,
            false,
            false,
            Some("2025-06-01"),
            None
        ));
        // cutoff excludes older items for reminder kinds but not mentions
        assert!(!should_notify(
            Kind::Assignment,
            true,
            false,
            true,
            Some("2024-12-31"),
            Some("2025-01-01")
        ));
        assert!(should_notify(
            Kind::Assignment,
            true,
            false,
            true,
            Some("2025-01-01"),
            Some("2025-01-01")
        ));
        assert!(should_notify(
            Kind::Mention,
            true,
            false,
            true,
            Some("2020-01-01"),
            Some("2025-01-01")
        ));
        // no cutoff configured: everything in range
        assert!(should_notify(
            Kind::Digest,
            true,
            false,
            true,
            Some("2020-01-01"),
            None
        ));
    }
}
