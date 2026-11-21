import { error } from '@sveltejs/kit';
import { requireMember, shellContext } from '#lib/server/auth.ts';
import { fmtTsOrDash } from '#lib/fmt.ts';
import { inventoryItems, inventoryLevels, inventoryLocations, itemMovements } from '#lib/server/inventory.ts';
import { updateStock } from '#lib/server/stock_action.ts';
import { maintainInventory } from '#lib/server/inventory_actions.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const ctx = await requireMember(event, event.params.slug, ['ViewTransactions', 'UpdateStock']);
	const id = /^[0-9]{1,15}$/.test(event.params.id) ? Number(event.params.id) : null;
	if (id === null) throw error(404, 'That item does not exist in this organization.');
	const items = await inventoryItems(ctx.db, ctx.org.id, true);
	const item = items.find((candidate) => candidate.id === id);
	if (!item) throw error(404, 'That item does not exist in this organization.');
	const [movements, levels, locations] = await Promise.all([
		itemMovements(ctx.db, ctx.org.id, id),
		inventoryLevels(ctx.db, ctx.org.id),
		inventoryLocations(ctx.db, ctx.org.id)
	]);
	const held = levels.filter((level) => level.item_id === id);
	return {
		shell: await shellContext(ctx),
		message: event.url.searchParams.get('msg') ?? '',
		item: { id: item.id, name: item.name, variant: item.variant, archived: item.archived_at !== null },
		levels: held.map((level) => ({ locationName: level.location_name, qty: level.qty })),
		totalQty: held.reduce((sum, level) => sum + level.qty, 0),
		locations,
		can: { updateStock: ctx.can('UpdateStock') },
		movements: movements.map((movement) => ({
			id: movement.id,
			at: fmtTsOrDash(movement.created_at),
			memberName: movement.member_name,
			locationName: movement.location_name,
			delta: movement.delta,
			resultQty: movement.to_qty,
			reason: movement.reason
		}))
	};
};

export const actions: Actions = {
	updateStock: (event) => updateStock(event, (slug) => `/org/${slug}/inventory/${event.params.id}`),
	saveItem: (event) => maintainInventory(event, 'item', 'save'),
	archiveItem: (event) => maintainInventory(event, 'item', 'archive'),
	restoreItem: (event) => maintainInventory(event, 'item', 'restore')
};
