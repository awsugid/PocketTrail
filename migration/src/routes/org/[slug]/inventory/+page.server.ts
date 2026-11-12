import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

import { requireMember, shellContext, type TenantContext } from '$lib/server/auth';
import { qOne } from '$lib/server/db';
import {
	addItemStatements,
	addLocationStatements,
	inventoryItems,
	inventoryLevels,
	inventoryLocations,
	itemMovements,
	stockApplied,
	stockUpdateInput,
	stockUpdateStatements
} from '$lib/server/inventory';

// Inventory pages: viewing requires an active membership (ViewTransactions);
// recording changes requires UpdateStock. Every mutation re-checks its own
// permission here — there is no layout-level gate.

export const load: PageServerLoad = async (event) => {
	const ctx = await requireMember(event, event.params.slug, 'ViewTransactions');
	const [items, levels, locations] = await Promise.all([
		inventoryItems(ctx.db, ctx.org.id),
		inventoryLevels(ctx.db, ctx.org.id),
		inventoryLocations(ctx.db, ctx.org.id)
	]);
	const byItem = new Map<number, Array<{ locationId: number; locationName: string; qty: number }>>();
	const totals = new Map<number, number>();
	for (const level of levels) {
		totals.set(level.item_id, (totals.get(level.item_id) ?? 0) + level.qty);
		const list = byItem.get(level.item_id) ?? [];
		list.push({ locationId: level.location_id, locationName: level.location_name, qty: level.qty });
		byItem.set(level.item_id, list);
	}
	return {
		shell: await shellContext(ctx),
		message: event.url.searchParams.get('msg') ?? '',
		items: items.map((item) => ({
			id: item.id,
			name: item.name,
			variant: item.variant,
			levels: byItem.get(item.id) ?? [],
			totalQty: totals.get(item.id) ?? 0
		})),
		locations,
		can: { updateStock: ctx.can('UpdateStock') }
	};
};

/** The acting user's active membership id, or null without one. */
function ownMembershipId(ctx: TenantContext): number | null {
	const own = ctx.memberRows.find((m) => m.user_id === ctx.user.id);
	return own && own.removed_at === null ? own.id : null;
}

export const actions: Actions = {
	addItem: async (event) => {
		const ctx = await requireMember(event, event.params.slug, 'UpdateStock');
		const own = ownMembershipId(ctx);
		if (own === null) return fail(403, { message: 'Active membership required.' });
		const form = await event.request.formData();
		const name = String(form.get('name') ?? '').trim();
		if (name === '') return fail(400, { message: 'Item name is required.' });
		const variant = String(form.get('variant') ?? '').trim();
		await ctx.db.batch(addItemStatements(ctx.db, ctx.org.id, ctx.user.id, own, name, variant));
		throw redirect(303, `/org/${ctx.org.slug}/inventory?msg=Added`);
	},

	addLocation: async (event) => {
		const ctx = await requireMember(event, event.params.slug, 'UpdateStock');
		const form = await event.request.formData();
		const name = String(form.get('name') ?? '').trim();
		if (name === '') return fail(400, { message: 'Location name is required.' });
		await ctx.db.batch(addLocationStatements(ctx.db, ctx.org.id, ctx.user.id, name));
		throw redirect(303, `/org/${ctx.org.slug}/inventory?msg=Added`);
	},

	updateStock: async (event) => {
		const ctx = await requireMember(event, event.params.slug, 'UpdateStock');
		const own = ownMembershipId(ctx);
		if (own === null) return fail(403, { message: 'Active membership required.' });
		const form = await event.request.formData();
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
				actor_membership_id: own,
				actor_user_id: ctx.user.id,
				org_id: ctx.org.id
			})
		);
		if (!stockApplied(results[1]?.meta?.changes)) {
			return fail(400, { message: 'Change rejected: resulting quantity must stay nonnegative and within range.' });
		}
		throw redirect(303, `/org/${ctx.org.slug}/inventory?msg=Updated`);
	}
};