import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

import { requireMember, shellContext, verifiedForm, type TenantContext } from '#lib/server/auth.ts';
import { updateStock } from '#lib/server/stock_action.ts';
import { maintainInventory } from '#lib/server/inventory_actions.ts';
import {
	addItemStatements,
	addLocationStatements,
	inventoryItems,
	inventoryLevels,
	inventoryLocations
} from '#lib/server/inventory.ts';

// Inventory viewing accepts ledger viewers or independent inventory maintainers;
// recording changes requires UpdateStock. Every mutation re-checks its own
// permission here — there is no layout-level gate.

export const load: PageServerLoad = async (event) => {
	const ctx = await requireMember(event, event.params.slug, ['ViewTransactions', 'UpdateStock']);
	const showArchived = event.url.searchParams.get('archived') === '1';
	const [items, levels, locations] = await Promise.all([
		inventoryItems(ctx.db, ctx.org.id, true),
		inventoryLevels(ctx.db, ctx.org.id),
		inventoryLocations(ctx.db, ctx.org.id, true)
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
		showArchived,
		stockItems: items.filter((item) => item.archived_at === null),
		items: items.filter((item) => (item.archived_at !== null) === showArchived).map((item) => ({
			id: item.id,
			name: item.name,
			variant: item.variant,
			archived: item.archived_at !== null,
			levels: byItem.get(item.id) ?? [],
			totalQty: totals.get(item.id) ?? 0
		})),
		locations: locations.filter((location) => location.archived_at === null),
		managedLocations: locations.filter((location) => (location.archived_at !== null) === showArchived),
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
		if (name === '' || name.length > 100) return fail(400, { message: 'Item name must be 1–100 characters.' });
		const variant = String(form.get('variant') ?? '').trim();
		if (variant.length > 100) return fail(400, { message: 'Variant must be at most 100 characters.' });
		const results = await ctx.db.batch(addItemStatements(ctx.db, ctx.org.id, ctx.user.id, own, name, variant));
		if (results[0]?.meta?.changes !== 1) return fail(400, { message: 'This item already exists. Check Archived and restore it if needed.' });
		throw redirect(303, `/org/${ctx.org.slug}/inventory?msg=Added`);
	},

	addLocation: async (event) => {
		const ctx = await requireMember(event, event.params.slug, 'UpdateStock');
		const form = await verifiedForm(event, ctx.session);
		const name = String(form.get('name') ?? '').trim();
		if (name === '' || name.length > 100) return fail(400, { message: 'Location name must be 1–100 characters.' });
		const results = await ctx.db.batch(addLocationStatements(ctx.db, ctx.org.id, ctx.user.id, name));
		if (results[0]?.meta?.changes !== 1) return fail(400, { message: 'This location already exists. Check Archived and restore it if needed.' });
		throw redirect(303, `/org/${ctx.org.slug}/inventory?msg=Added`);
	},

	updateStock: (event) => updateStock(event, (slug) => `/org/${slug}/inventory?msg=Updated`),
	saveLocation: (event) => maintainInventory(event, 'location', 'save'),
	archiveLocation: (event) => maintainInventory(event, 'location', 'archive'),
	restoreLocation: (event) => maintainInventory(event, 'location', 'restore')
};
