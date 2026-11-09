//! Organization-scoped membership, roles, and permission checks.

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};

use crate::{DomainError, OrgId, Permission, RoleId, UserId};

/// A configurable bundle of application permissions assigned to members of
/// one organization.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Role {
    /// Human-readable role name.
    pub name: String,
    /// Permissions granted to holders of this role.
    pub permissions: BTreeSet<Permission>,
}

/// A user's participation in one organization.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Member {
    /// Roles held within this organization.
    pub role_ids: BTreeSet<RoleId>,
    /// Removed members stay recorded with `active = false` so historical
    /// attribution survives while their access and notifications stop.
    pub active: bool,
}

/// One independent organization workspace. Records, roles, and notifications
/// never cross organization boundaries.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Organization {
    pub id: OrgId,
    pub name: String,
    /// Organization-wide outbound notification gate. Starts `false`; neither
    /// statement imports nor actor mappings may flip it.
    pub notifications_enabled: bool,
    /// Oldest transaction date that still generates reminders and digests,
    /// as an ISO 8601 date compared lexicographically against
    /// `Transaction::date`; `None` (the serde default) means no cutoff.
    /// Older items stay visible without generating reminders; mentions are
    /// unaffected.
    #[serde(default)]
    pub notification_cutoff: Option<String>,
    /// Organization-scoped roles.
    pub roles: BTreeMap<RoleId, Role>,
    /// Members keyed by user ID; removed members remain with `active = false`.
    pub members: BTreeMap<UserId, Member>,
}

impl Organization {
    /// Creates an organization with notifications disabled.
    pub fn new(id: impl Into<OrgId>, name: impl Into<String>) -> Self {
        Self {
            id: id.into(),
            name: name.into(),
            notifications_enabled: false,
            notification_cutoff: None,
            roles: BTreeMap::new(),
            members: BTreeMap::new(),
        }
    }

    /// Permissions granted to `user` by the roles of an active membership.
    /// Empty for non-members and inactive members.
    pub fn permissions_for(&self, user: &UserId) -> BTreeSet<Permission> {
        let Some(member) = self.members.get(user) else {
            return BTreeSet::new();
        };
        if !member.active {
            return BTreeSet::new();
        }
        member
            .role_ids
            .iter()
            .filter_map(|id| self.roles.get(id))
            .flat_map(|role| role.permissions.iter().copied())
            .collect()
    }

    /// Active-membership check.
    pub fn member_is_active(&self, user: &UserId) -> bool {
        self.members.get(user).is_some_and(|member| member.active)
    }
}

/// Grants or denies one permission for a user in an organization. Former and
/// missing members are denied with the specific reason.
pub fn authorize(
    org: &Organization,
    user: &UserId,
    required: Permission,
) -> Result<(), DomainError> {
    let Some(member) = org.members.get(user) else {
        return Err(DomainError::NoMembership);
    };
    if !member.active {
        return Err(DomainError::InactiveMembership);
    }
    if org.permissions_for(user).contains(&required) {
        Ok(())
    } else {
        Err(DomainError::NotAuthorized { required })
    }
}

/// Adds or replaces a membership. Requires [`Permission::ManageMembers`].
pub fn upsert_member(
    org: &mut Organization,
    actor: &UserId,
    user: UserId,
    member: Member,
) -> Result<(), DomainError> {
    authorize(org, actor, Permission::ManageMembers)?;
    org.members.insert(user, member);
    Ok(())
}

/// Marks membership inactive, keeping the record for attribution. Requires
/// [`Permission::ManageMembers`]. Removal immediately revokes access and
/// stops notifications to the former member.
pub fn remove_member(
    org: &mut Organization,
    actor: &UserId,
    user: &UserId,
) -> Result<(), DomainError> {
    authorize(org, actor, Permission::ManageMembers)?;
    if let Some(member) = org.members.get_mut(user) {
        member.active = false;
    }
    Ok(())
}

/// Flips the organization-wide notification gate. Only a member holding
/// [`Permission::ManageNotifications`] may call this; import and mapping
/// flows must not.
pub fn set_notifications_enabled(
    org: &mut Organization,
    actor: &UserId,
    enabled: bool,
) -> Result<(), DomainError> {
    authorize(org, actor, Permission::ManageNotifications)?;
    org.notifications_enabled = enabled;
    Ok(())
}

/// Sets the notification cutoff date (ISO 8601, compared lexicographically
/// against `Transaction::date`). Requires
/// [`Permission::ManageNotifications`]. See
/// [`Organization::notification_cutoff`].
pub fn set_notification_cutoff(
    org: &mut Organization,
    actor: &UserId,
    cutoff: Option<String>,
) -> Result<(), DomainError> {
    authorize(org, actor, Permission::ManageNotifications)?;
    org.notification_cutoff = cutoff;
    Ok(())
}
