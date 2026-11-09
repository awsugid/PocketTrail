//! Merchandise stock levels with a basic who/what/when change history.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::{DomainError, OrgId, Organization, Permission, StockItemId, UserId, authorize};

/// One stock change history entry.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StockChange {
    pub location: String,
    pub from: i64,
    pub to: i64,
    pub by: UserId,
    pub at: String,
}

/// One merchandise item and its current quantity per location.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct StockItem {
    pub id: StockItemId,
    pub organization_id: OrgId,
    pub name: String,
    /// Optional variant such as a shirt size.
    pub variant: Option<String>,
    /// Current quantity per location name: a storage place or a holding
    /// member's label.
    pub quantity_by_location: BTreeMap<String, i64>,
    /// Chronological update history.
    pub history: Vec<StockChange>,
}

impl StockItem {
    pub fn new(
        id: impl Into<StockItemId>,
        organization_id: impl Into<OrgId>,
        name: impl Into<String>,
        variant: Option<String>,
    ) -> Self {
        Self {
            id: id.into(),
            organization_id: organization_id.into(),
            name: name.into(),
            variant,
            quantity_by_location: BTreeMap::new(),
            history: Vec::new(),
        }
    }

    /// Current quantity at `location`; zero for untracked locations.
    pub fn quantity_at(&self, location: &str) -> i64 {
        self.quantity_by_location
            .get(location)
            .copied()
            .unwrap_or(0)
    }
}

/// Sets a location's quantity to `new_quantity`, which must be nonnegative.
/// Requires [`Permission::UpdateStock`] and appends one history entry.
/// Unknown locations start at zero and are created by the update.
pub fn update_stock(
    org: &Organization,
    item: &mut StockItem,
    actor: &UserId,
    location: impl Into<String>,
    new_quantity: i64,
    at: impl Into<String>,
) -> Result<StockChange, DomainError> {
    if item.organization_id != org.id {
        return Err(DomainError::WrongOrganization);
    }
    authorize(org, actor, Permission::UpdateStock)?;
    if new_quantity < 0 {
        return Err(DomainError::InvalidQuantity {
            quantity: new_quantity,
        });
    }
    let location = location.into();
    let from = item.quantity_at(&location);
    item.quantity_by_location
        .insert(location.clone(), new_quantity);
    let change = StockChange {
        location,
        from,
        to: new_quantity,
        by: actor.clone(),
        at: at.into(),
    };
    item.history.push(change.clone());
    Ok(change)
}
