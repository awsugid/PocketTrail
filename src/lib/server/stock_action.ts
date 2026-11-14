// The stock-change form action, shared by the inventory list and item pages.
// Both post the same fields; only the page the user lands on afterwards differs.

import { fail, redirect, type RequestEvent } from '@sveltejs/kit';
import { requireMember, verifiedForm } from './auth';
import { qOne } from './db';
import { stockApplied, stockUpdateInput, stockUpdateStatements } from './inventory';

export async function updateStock(event: RequestEvent, landOn: (slug: string) => string) {
	const ctx = await requireMember(event, event.params.slug as string, 'UpdateStock');
	const own = ctx.memberRows.find((m) => m.user_id === ctx.user.id && m.removed_at === null);
	if (!own) return fail(403, { message: 'Active membership required.' });
	const form = await verifiedForm(event, ctx.session);
	const itemId = Number(String(form.get('item_id') ?? '').trim()) || 0;
	const locationId = Number(String(form.get('location_id') ?? '').trim()) || 0;
	// The form posts direction + positive quantity; `delta` is the signed
	// internal value (still accepted directly for scripted clients).
	let signed: string | null = null;
	const direction = form.get('direction');
	const quantity = form.get('quantity');
	if (typeof direction === 'string' && typeof quantity === 'string') {
		signed = `${direction === 'remove' ? '-' : ''}${quantity.trim()}`;
	} else {
		const raw = form.get('delta');
		signed = typeof raw === 'string' ? raw : null;
	}
	const reasonValue = form.get('reason');
	const input = stockUpdateInput(signed, typeof reasonValue === 'string' ? reasonValue : null);
	if ('error' in input) return fail(400, { message: input.error });
	if (!(await qOne(ctx.db, 'SELECT id FROM inventory_items WHERE id = ?1 AND org_id = ?2', [itemId, ctx.org.id]))) {
		return fail(400, { message: 'Unknown item for this organization.' });
	}
	if (!(await qOne(ctx.db, 'SELECT id FROM inventory_locations WHERE id = ?1 AND org_id = ?2', [locationId, ctx.org.id]))) {
		return fail(400, { message: 'Unknown location for this organization.' });
	}
	const results = await ctx.db.batch(
		stockUpdateStatements(ctx.db, {
			item_id: itemId,
			location_id: locationId,
			delta: input.delta,
			reason: input.reason,
			actor_membership_id: own.id,
			actor_user_id: ctx.user.id,
			org_id: ctx.org.id
		})
	);
	if (!stockApplied(results[1]?.meta?.changes)) {
		return fail(400, { message: 'Change rejected: resulting quantity must stay nonnegative and within range.' });
	}
	throw redirect(303, landOn(ctx.org.slug));
}
