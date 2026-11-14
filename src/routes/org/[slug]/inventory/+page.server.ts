import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

import { requireMember, shellContext, verifiedForm, type TenantContext } from '$lib/server/auth';
import { updateStock } from '$lib/server/stock_action';
import {
	addItemStatements,
	addLocationStatements,
	inventoryItems,
	inventoryLevels,
	inventoryLocations
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
		const form = await verifiedForm(event, ctx.session);
		const name = String(form.get('name') ?? '').trim();
		if (name === '') return fail(400, { message: 'Item name is required.' });
		const variant = String(form.get('variant') ?? '').trim();
		await ctx.db.batch(addItemStatements(ctx.db, ctx.org.id, ctx.user.id, own, name, variant));
		throw redirect(303, `/org/${ctx.org.slug}/inventory?msg=Added`);
	},

	addLocation: async (event) => {
		const ctx = await requireMember(event, event.params.slug, 'UpdateStock');
		const form = await verifiedForm(event, ctx.session);
		const name = String(form.get('name') ?? '').trim();
		if (name === '') return fail(400, { message: 'Location name is required.' });
		await ctx.db.batch(addLocationStatements(ctx.db, ctx.org.id, ctx.user.id, name));
		throw redirect(303, `/org/${ctx.org.slug}/inventory?msg=Added`);
	},

	updateStock: (event) => updateStock(event, (slug) => `/org/${slug}/inventory?msg=Updated`)
};
