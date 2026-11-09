//! Inventory routes: stock per item (optional variant) and location, updates
//! with a who/what/when movement history, and the per-item movement page.
//!
//! Viewing requires organization membership; `Permission::ViewTransactions`
//! stands in for stock viewing until the domain gains a dedicated permission.
//! Recording changes requires `Permission::UpdateStock`. Every query is
//! org-scoped, including join conditions.

use super::*;
use pockettrail_domain::Permission;
use serde::Deserialize;

#[derive(Debug, Deserialize)]
struct ItemRow {
    id: i64,
    name: String,
    variant: String,
}

#[derive(Debug, Deserialize)]
struct LevelRow {
    item_id: i64,
    location_name: String,
    qty: i64,
}

#[derive(Debug, Deserialize)]
struct LocationRow {
    id: i64,
    name: String,
}

#[derive(Debug, Deserialize)]
struct MovementRow {
    created_at: i64,
    delta: i64,
    to_qty: i64,
    reason: String,
    location_name: String,
    member_name: String,
}

#[derive(Debug, Deserialize)]
struct AppliedRow {
    id: i64,
}

/// Validate a stock update form: signed nonzero delta (magnitude capped so it
/// binds to D1 losslessly and SQL bound arithmetic stays overflow-free) and a
/// nonblank reason. Returns (delta, trimmed reason).
fn stock_update_input(
    delta_raw: Option<&str>,
    reason_raw: Option<&str>,
) -> Result<(i64, String), &'static str> {
    const MAX_DELTA: i64 = 1_000_000_000_000_000; // < 2^53, exact as f64
    let delta = delta_raw
        .and_then(crate::fmt::parse_minor)
        .filter(|d| *d != 0 && d.abs() <= MAX_DELTA)
        .ok_or("Change must be a nonzero integer with magnitude at most 1,000,000,000,000,000.")?;
    let reason = reason_raw.unwrap_or_default().trim();
    if reason.is_empty() {
        return Err("Reason is required for stock changes.");
    }
    Ok((delta, reason.to_string()))
}

/// Item or location lookup scoped to the organization.
async fn org_row_exists(db: &D1Database, table: &str, id: i64, org_id: i64) -> db::WResult<bool> {
    // table is a compile-time constant at both call sites.
    let ok: Option<AppliedRow> = db::q_one(
        db,
        &format!("SELECT id FROM {table} WHERE id = ?1 AND org_id = ?2"),
        vec![db::i(id), db::i(org_id)],
    )
    .await?;
    Ok(ok.is_some())
}

// ------------------------------------------------------------------- pages

pub async fn list_page(req: Request, ctx: RouteContext<App>) -> worker::Result<Response> {
    let app = ctx.data.clone();
    let slug = path_param(&ctx, "org");
    let g = try_resp!(require_member(app, &req, &slug, Permission::ViewTransactions).await);
    let items: Vec<ItemRow> = db::q_all(
        &g.app.db,
        "SELECT id, name, variant FROM inventory_items WHERE org_id = ?1 ORDER BY name, variant, id",
        vec![db::i(g.org.id)],
    )
    .await?;
    // Org scope rides the joins: inventory_levels has no org_id column.
    let levels: Vec<LevelRow> = db::q_all(
        &g.app.db,
        "SELECT lv.item_id, loc.name AS location_name, lv.qty FROM inventory_levels lv JOIN inventory_locations loc ON loc.id = lv.location_id AND loc.org_id = ?1 JOIN inventory_items i ON i.id = lv.item_id AND i.org_id = ?1 ORDER BY lv.item_id, loc.name",
        vec![db::i(g.org.id)],
    )
    .await?;
    let locations: Vec<LocationRow> = db::q_all(
        &g.app.db,
        "SELECT id, name FROM inventory_locations WHERE org_id = ?1 ORDER BY name",
        vec![db::i(g.org.id)],
    )
    .await?;

    let mut by_item: BTreeMap<i64, Vec<serde_json::Value>> = BTreeMap::new();
    let mut totals: BTreeMap<i64, i64> = BTreeMap::new();
    for lv in &levels {
        *totals.entry(lv.item_id).or_insert(0) += lv.qty;
        by_item
            .entry(lv.item_id)
            .or_default()
            .push(serde_json::json!({"location_name": lv.location_name, "qty": lv.qty}));
    }
    let items_json: Vec<serde_json::Value> = items
        .iter()
        .map(|i| {
            serde_json::json!({
                "id": i.id,
                "name": i.name,
                "variant": i.variant,
                "levels": by_item.remove(&i.id).unwrap_or_default(),
                "total_qty": totals.remove(&i.id).unwrap_or(0),
            })
        })
        .collect();

    let mut body = g
        .base_json("inventory", query_param(&req, "msg").as_deref(), None)
        .await;
    body["items"] = serde_json::json!(items_json);
    body["locations"] = serde_json::json!(locations
        .iter()
        .map(|l| serde_json::json!({"id": l.id, "name": l.name}))
        .collect::<Vec<_>>());
    body["can"] = serde_json::json!({"update_stock":g.can(Permission::UpdateStock)});
    Ok(page(&g.app, "inventory", body))
}

pub async fn item_page(req: Request, ctx: RouteContext<App>) -> worker::Result<Response> {
    let app = ctx.data.clone();
    let slug = path_param(&ctx, "org");
    let item_id: i64 = path_param(&ctx, "id").parse().unwrap_or(0);
    let g = try_resp!(require_member(app, &req, &slug, Permission::ViewTransactions).await);
    let Some(item) = db::q_one::<ItemRow>(
        &g.app.db,
        "SELECT id, name, variant FROM inventory_items WHERE id = ?1 AND org_id = ?2",
        vec![db::i(item_id), db::i(g.org.id)],
    )
    .await?
    else {
        return Ok(fail(404, "Item not found."));
    };
    let movements: Vec<MovementRow> = db::q_all(
        &g.app.db,
        "SELECT sm.created_at, sm.delta, sm.to_qty, sm.reason, loc.name AS location_name, u.name AS member_name FROM stock_movements sm JOIN inventory_locations loc ON loc.id = sm.location_id AND loc.org_id = ?1 JOIN memberships mem ON mem.id = sm.by_membership_id AND mem.org_id = ?1 JOIN users u ON u.id = mem.user_id WHERE sm.org_id = ?1 AND sm.item_id = ?2 ORDER BY sm.id DESC LIMIT 500",
        vec![db::i(g.org.id), db::i(item_id)],
    )
    .await?;
    let movements_json: Vec<serde_json::Value> = movements
        .iter()
        .map(|mv| {
            serde_json::json!({
                "created_at": crate::fmt::fmt_ts(mv.created_at),
                "member_name": mv.member_name,
                "location_name": mv.location_name,
                "delta": mv.delta,
                "result_qty": mv.to_qty,
                "reason": mv.reason,
            })
        })
        .collect();
    let mut body = g.base_json("inventory", None, None).await;
    body["item"] = serde_json::json!({"name": item.name, "variant": item.variant});
    body["movements"] = serde_json::json!(movements_json);
    Ok(page(&g.app, "inventory_item", body))
}

// ------------------------------------------------------------------ changes

pub async fn add_item(mut req: Request, ctx: RouteContext<App>) -> worker::Result<Response> {
    let app = ctx.data.clone();
    let slug = path_param(&ctx, "org");
    let g = try_resp!(require_member(app, &req, &slug, Permission::UpdateStock).await);
    let form = try_resp!(form_post(&g, &mut req).await);
    let name = form_str(&form, "name").unwrap_or_default();
    let name = name.trim();
    if name.is_empty() {
        return Ok(fail(400, "Item name is required."));
    }
    let variant = form_str(&form, "variant").unwrap_or_default();
    let variant = variant.trim();
    // UNIQUE(org_id, name, variant): OR IGNORE makes re-adding a no-op.
    db::exec(
        &g.app.db,
        "INSERT OR IGNORE INTO inventory_items (org_id, name, variant) VALUES (?1, ?2, ?3)",
        vec![db::i(g.org.id), db::s(name), db::s(variant)],
    )
    .await?;
    Ok(redirect(&format!("/org/{slug}/inventory?msg=Added")))
}

pub async fn add_location(mut req: Request, ctx: RouteContext<App>) -> worker::Result<Response> {
    let app = ctx.data.clone();
    let slug = path_param(&ctx, "org");
    let g = try_resp!(require_member(app, &req, &slug, Permission::UpdateStock).await);
    let form = try_resp!(form_post(&g, &mut req).await);
    let name = form_str(&form, "name").unwrap_or_default();
    let name = name.trim();
    if name.is_empty() {
        return Ok(fail(400, "Location name is required."));
    }
    db::exec(
        &g.app.db,
        "INSERT OR IGNORE INTO inventory_locations (org_id, name) VALUES (?1, ?2)",
        vec![db::i(g.org.id), db::s(name)],
    )
    .await?;
    Ok(redirect(&format!("/org/{slug}/inventory?msg=Added")))
}

pub async fn update_stock(mut req: Request, ctx: RouteContext<App>) -> worker::Result<Response> {
    let app = ctx.data.clone();
    let slug = path_param(&ctx, "org");
    let g = try_resp!(require_member(app, &req, &slug, Permission::UpdateStock).await);
    let form = try_resp!(form_post(&g, &mut req).await);
    let item_id: i64 = form_str(&form, "item_id")
        .and_then(|s| s.trim().parse().ok())
        .unwrap_or(0);
    let location_id: i64 = form_str(&form, "location_id")
        .and_then(|s| s.trim().parse().ok())
        .unwrap_or(0);
    let (delta, reason) = match stock_update_input(
        form_str(&form, "delta").as_deref(),
        form_str(&form, "reason").as_deref(),
    ) {
        Ok(v) => v,
        Err(msg) => return Ok(fail(400, msg)),
    };
    if !org_row_exists(&g.app.db, "inventory_items", item_id, g.org.id).await? {
        return Ok(fail(400, "Unknown item for this organization."));
    }
    if !org_row_exists(&g.app.db, "inventory_locations", location_id, g.org.id).await? {
        return Ok(fail(400, "Unknown location for this organization."));
    }

    // Three statements in one D1 batch: an implicit single transaction, so
    // they commit atomically and serialize against concurrent writers — every
    // fact below comes from the level row's actual state, never a reread.
    //   1. ensure the level row exists (qty starts 0); OR IGNORE on re-add.
    //   2. apply the delta only while the result stays in [0, 9e15]. The cap
    //      keeps every stored quantity a JS-safe integer for D1, and with
    //      |delta| <= 1e15 no bound arithmetic can overflow i64.
    //   3. append the movement from the level's post-update qty, gated on
    //      changes() = 1 so a rejected delta records no movement.
    // Statement 2's meta.changes decides accept/reject: 0 => 400.
    let now = db::now_ms();
    let p_level = vec![db::i(item_id), db::i(location_id)];
    let p_update = vec![db::i(delta), db::i(item_id), db::i(location_id)];
    let p_movement = vec![
        db::i(g.org.id),
        db::i(item_id),
        db::i(location_id),
        db::i(delta),
        db::s(&reason),
        db::i(g.me().id),
        db::i(now),
    ];
    let results = g
        .app
        .db
        .batch(vec![
            g.app
                .db
                .prepare(
                    "INSERT OR IGNORE INTO inventory_levels (item_id, location_id, qty) VALUES (?1, ?2, 0)",
                )
                .bind(&p_level)?,
            g.app
                .db
                .prepare(
                    "UPDATE inventory_levels SET qty = qty + ?1 WHERE item_id = ?2 AND location_id = ?3 AND qty + ?1 >= 0 AND qty + ?1 <= 9000000000000000",
                )
                .bind(&p_update)?,
            g.app
                .db
                .prepare(
                    "INSERT INTO stock_movements (org_id, item_id, location_id, delta, from_qty, to_qty, reason, by_membership_id, created_at) SELECT ?1, ?2, ?3, ?4, qty - ?4, qty, ?5, ?6, ?7 FROM inventory_levels WHERE item_id = ?2 AND location_id = ?3 AND changes() = 1",
                )
                .bind(&p_movement)?,
        ])
        .await?;
    let applied = results
        .get(1)
        .and_then(|r| r.meta().ok())
        .flatten()
        .and_then(|m| m.changes)
        .unwrap_or(0);
    if applied != 1 {
        return Ok(fail(
            400,
            "Change rejected: resulting quantity must stay nonnegative and within range.",
        ));
    }
    Ok(redirect(&format!("/org/{slug}/inventory?msg=Updated")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stock_input_validation() {
        assert_eq!(
            stock_update_input(Some("5"), Some("sold")),
            Ok((5, "sold".into()))
        );
        assert_eq!(
            stock_update_input(Some(" -2 "), Some(" x ")),
            Ok((-2, "x".into()))
        );
        assert_eq!(
            stock_update_input(Some("+3"), Some("r")),
            Ok((3, "r".into()))
        );
        // zero, non-numeric, i64-overflowing, and over-cap deltas are rejected
        assert!(stock_update_input(Some("0"), Some("r")).is_err());
        assert!(stock_update_input(Some(""), Some("r")).is_err());
        assert!(stock_update_input(Some("abc"), Some("r")).is_err());
        assert!(stock_update_input(Some("99999999999999999999"), Some("r")).is_err());
        assert!(stock_update_input(Some("1000000000000001"), Some("r")).is_err());
        assert_eq!(
            stock_update_input(Some("5"), Some("")),
            Err("Reason is required for stock changes.")
        );
        assert_eq!(
            stock_update_input(Some("5"), Some("   ")),
            Err("Reason is required for stock changes.")
        );
        assert!(stock_update_input(None, Some("r")).is_err());
    }
}
