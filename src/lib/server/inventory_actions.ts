// Inventory metadata mutations share the same permission, CSRF and tenant
// checks. Conditional SQL serializes archival against concurrent stock changes.
import { error, redirect, type RequestEvent } from '@sveltejs/kit';
import { requireMember, verifiedForm } from './auth';
import { committedIfChanged } from './audit';
import { nowMs, qOne } from './db';

export type InventoryKind = 'item' | 'location';
export type InventoryOperation = 'save' | 'archive' | 'restore';

export async function maintainInventory(event: RequestEvent, kind: InventoryKind, operation: InventoryOperation) {
	const ctx = await requireMember(event, event.params.slug!, 'UpdateStock');
	const form = await verifiedForm(event, ctx.session);
	const raw = String(event.params.id ?? form.get('id') ?? '');
	if (!/^[0-9]{1,15}$/.test(raw)) throw error(400, 'Choose an inventory record.');
	const id = Number(raw);
	const table = kind === 'item' ? 'inventory_items' : 'inventory_locations';
	const row = await qOne<{ name: string; variant?: string; archived_at: number | null }>(
		ctx.db, `SELECT * FROM ${table} WHERE id=?1 AND org_id=?2`, [id, ctx.org.id]
	);
	if (!row) throw error(404, 'Inventory record not found in this organization.');
	const back = `/org/${ctx.org.slug}/inventory${event.params.id ? `/${id}` : ''}`;
	let statement;
	if (operation === 'save') {
		if (row.archived_at !== null) throw error(400, 'Restore this record before editing it.');
		const name = String(form.get('name') ?? '').trim();
		const variant = String(form.get('variant') ?? '').trim();
		if (!name || name.length > 100 || variant.length > 100) {
			throw error(400, 'Name is required; name and variant must be at most 100 characters.');
		}
		if (name === row.name && (kind === 'location' || variant === row.variant)) redirect(303, back);
		statement = kind === 'item'
			? ctx.db.prepare('UPDATE inventory_items SET name=?1,variant=?2 WHERE id=?3 AND org_id=?4 AND archived_at IS NULL AND NOT EXISTS(SELECT 1 FROM inventory_items WHERE org_id=?4 AND name=?1 AND variant=?2 AND id<>?3)')
				.bind(name, variant, id, ctx.org.id)
			: ctx.db.prepare('UPDATE inventory_locations SET name=?1 WHERE id=?2 AND org_id=?3 AND archived_at IS NULL AND NOT EXISTS(SELECT 1 FROM inventory_locations WHERE org_id=?3 AND name=?1 AND id<>?2)')
				.bind(name, id, ctx.org.id);
	} else {
		const column = kind === 'item' ? 'item_id' : 'location_id';
		statement = operation === 'archive'
			? ctx.db.prepare(`UPDATE ${table} SET archived_at=?1 WHERE id=?2 AND org_id=?3 AND archived_at IS NULL AND NOT EXISTS(SELECT 1 FROM inventory_levels WHERE ${column}=?2 AND qty<>0)`)
				.bind(nowMs(), id, ctx.org.id)
			: ctx.db.prepare(`UPDATE ${table} SET archived_at=NULL WHERE id=?1 AND org_id=?2 AND archived_at IS NOT NULL`)
				.bind(id, ctx.org.id);
	}
	const results = await ctx.db.batch([
		statement,
		committedIfChanged(ctx.db, ctx.org.id, ctx.user.id, `${kind}.${operation === 'save' ? 'updated' : operation === 'archive' ? 'archived' : 'restored'}`, `${kind}:${id}`)
	]);
	if (results[0]?.meta?.changes !== 1) {
		throw error(400, operation === 'archive'
			? 'Record stock changes to bring all quantities to zero before archiving. The record may already be archived.'
			: 'The name is already in use, or this record changed. Refresh and try again.');
	}
	redirect(303, `${back}?msg=${operation === 'save' ? 'Saved' : operation === 'archive' ? 'Archived' : 'Restored'}`);
}
