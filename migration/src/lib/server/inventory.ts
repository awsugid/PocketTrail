// Inventory: stock per item (optional variant) and location, updates with a
// who/what/when movement history, and the per-item movement page. Ported from
// src/web/inventory.rs.
//
// Viewing requires an active membership (ViewTransactions stands in for stock
// viewing, exactly as in Rust until the domain gains a dedicated permission).
// Recording changes requires UpdateStock. Every query is org-scoped, including
// join conditions: inventory_levels has no org_id column, so scope rides the
// item/location joins.

import type { D1Database, D1PreparedStatement } from '$lib/d1';
import { parseMinor } from '$lib/fmt';
import { committedIfChanged } from './audit';
import { nowMs, qAll, qOne } from './db';
import { memActive, type MemRow } from './rows';

export interface InventoryItemRow {
	id: number;
	name: string;
	variant: string;
}

export interface LevelRow {
	item_id: number;
	location_id: number;
	location_name: string;
	qty: number;
}

export interface LocationRow {
	id: number;
	name: string;
}

export interface MovementRow {
	created_at: number;
	delta: number;
	to_qty: number;
	reason: string;
	location_name: string;
	member_name: string;
}

const MAX_DELTA = 1_000_000_000_000_000; // < 2^53, exact as a JS number

export interface StockUpdateInput {
	delta: number;
	reason: string;
}

/** Validate a stock update form: signed nonzero delta (magnitude capped so it
 * binds to D1 losslessly and SQL bound arithmetic stays overflow-free) and a
 * nonblank reason. */
export function stockUpdateInput(
	deltaRaw: string | null | undefined,
	reasonRaw: string | null | undefined
): StockUpdateInput | { error: string } {
	const parsed = deltaRaw === null || deltaRaw === undefined ? null : parseMinor(deltaRaw);
	const delta = parsed !== null && parsed !== 0 && Math.abs(parsed) <= MAX_DELTA ? parsed : null;
	if (delta === null) {
		return {
			error: 'Quantity must be a whole number of at least 1 (and at most 1,000,000,000,000,000).'
		};
	}
	const reason = (reasonRaw ?? '').trim();
	if (reason === '') return { error: 'Reason is required for stock changes.' };
	return { delta, reason };
}

async function orgRowExists(db: D1Database, table: 'inventory_items' | 'inventory_locations', id: number, orgId: number): Promise<boolean> {
	const row = await qOne<{ id: number }>(
		db,
		`SELECT id FROM ${table} WHERE id = ?1 AND org_id = ?2`,
		[id, orgId]
	);
	return row !== null;
}

export async function inventoryItems(db: D1Database, orgId: number): Promise<InventoryItemRow[]> {
	return qAll<InventoryItemRow>(
		db,
		'SELECT id, name, variant FROM inventory_items WHERE org_id = ?1 ORDER BY name, variant, id',
		[orgId]
	);
}

export async function inventoryLevels(db: D1Database, orgId: number): Promise<LevelRow[]> {
	return qAll<LevelRow>(
		db,
		`SELECT lv.item_id, lv.location_id, loc.name AS location_name, lv.qty
		 FROM inventory_levels lv
		 JOIN inventory_locations loc ON loc.id = lv.location_id AND loc.org_id = ?1
		 JOIN inventory_items i ON i.id = lv.item_id AND i.org_id = ?1
		 ORDER BY lv.item_id, loc.name`,
		[orgId]
	);
}

export async function inventoryLocations(db: D1Database, orgId: number): Promise<LocationRow[]> {
	return qAll<LocationRow>(
		db,
		'SELECT id, name FROM inventory_locations WHERE org_id = ?1 ORDER BY name',
		[orgId]
	);
}

export async function itemMovements(db: D1Database, orgId: number, itemId: number): Promise<MovementRow[]> {
	return qAll<MovementRow>(
		db,
		`SELECT sm.created_at, sm.delta, sm.to_qty, sm.reason, loc.name AS location_name, u.name AS member_name
		 FROM stock_movements sm
		 JOIN inventory_locations loc ON loc.id = sm.location_id AND loc.org_id = ?1
		 JOIN memberships mem ON mem.id = sm.by_membership_id AND mem.org_id = ?1
		 JOIN users u ON u.id = mem.user_id
		 WHERE sm.org_id = ?1 AND sm.item_id = ?2
		 ORDER BY sm.id DESC LIMIT 500`,
		[orgId, itemId]
	);
}

/** Add an item (OR IGNORE on the UNIQUE(org_id, name, variant) constraint);
 * re-adding an identical row records no audit event. */
export function addItemStatements(
	db: D1Database,
	orgId: number,
	actorId: string,
	actorMembershipId: number,
	name: string,
	variant: string
): D1PreparedStatement[] {
	void actorMembershipId;
	return [
		db.prepare('INSERT OR IGNORE INTO inventory_items (org_id, name, variant) VALUES (?1, ?2, ?3)').bind(orgId, name, variant),
		committedIfChanged(db, orgId, actorId, 'item.added', `item:${name}:${variant}`)
	];
}

export function addLocationStatements(
	db: D1Database,
	orgId: number,
	actorId: string,
	name: string
): D1PreparedStatement[] {
	return [
		db.prepare('INSERT OR IGNORE INTO inventory_locations (org_id, name) VALUES (?1, ?2)').bind(orgId, name),
		committedIfChanged(db, orgId, actorId, 'location.added', `location:${name}`)
	];
}

export interface StockUpdate {
	item_id: number;
	location_id: number;
	delta: number;
	reason: string;
	actor_membership_id: number;
	actor_user_id: string;
	org_id: number;
}

/** The four-statement update chain, ported verbatim. The batch commits
 * atomically and serializes against concurrent writers: statement 2's
 * changes() decides accept/reject, and statements 3-4 only write when it
 * applied. */
export function stockUpdateStatements(db: D1Database, update: StockUpdate): D1PreparedStatement[] {
	const now = nowMs();
	return [
		db
			.prepare('INSERT OR IGNORE INTO inventory_levels (item_id, location_id, qty) VALUES (?1, ?2, 0)')
			.bind(update.item_id, update.location_id),
		db
			.prepare(
				'UPDATE inventory_levels SET qty = qty + ?1 WHERE item_id = ?2 AND location_id = ?3 AND qty + ?1 >= 0 AND qty + ?1 <= 9000000000000000'
			)
			.bind(update.delta, update.item_id, update.location_id),
		db
			.prepare(
				'INSERT INTO stock_movements (org_id, item_id, location_id, delta, from_qty, to_qty, reason, by_membership_id, created_at) SELECT ?1, ?2, ?3, ?4, qty - ?4, qty, ?5, ?6, ?7 FROM inventory_levels WHERE item_id = ?2 AND location_id = ?3 AND changes() = 1'
			)
			.bind(update.org_id, update.item_id, update.location_id, update.delta, update.reason, update.actor_membership_id, now),
		db
			.prepare(
				"INSERT INTO audit_events (actor_id, org_id, action, target, outcome, created_at) SELECT ?1, ?2, 'stock.changed', ?3, 'committed', ?4 FROM inventory_levels WHERE item_id = ?5 AND location_id = ?6 AND changes() = 1"
			)
			.bind(
				update.actor_user_id,
				update.org_id,
				`item:${update.item_id} location:${update.location_id} delta:${update.delta}`,
				now,
				update.item_id,
				update.location_id
			)
	];
}

/** The applied/failed decision reads statement 2's meta.changes (index 1):
 * 0 means the guard rejected the delta. */
export function stockApplied(changes: number | null | undefined): boolean {
	return changes === 1;
}

/** Own membership row of the acting user among freshly read members. */
export function ownMembership(mems: readonly MemRow[], userId: string): MemRow | null {
	const me = mems.find((m) => m.user_id === userId);
	return me && memActive(me) ? me : null;
}