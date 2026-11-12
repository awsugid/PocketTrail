import { error } from '@sveltejs/kit';
import { requireMember, shellContext } from '$lib/server/auth';
import { fmtTs } from '$lib/fmt';
import { inventoryItems, itemMovements } from '$lib/server/inventory';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const ctx = await requireMember(event, event.params.slug, 'ViewTransactions');
	const id = /^[0-9]{1,15}$/.test(event.params.id) ? Number(event.params.id) : null;
	if (id === null) throw error(404, 'That item does not exist in this organization.');
	const items = await inventoryItems(ctx.db, ctx.org.id);
	const item = items.find((candidate) => candidate.id === id);
	if (!item) throw error(404, 'That item does not exist in this organization.');
	const movements = await itemMovements(ctx.db, ctx.org.id, id);
	return {
		shell: await shellContext(ctx),
		item: { id: item.id, name: item.name, variant: item.variant },
		movements: movements.map((movement) => ({
			at: fmtTs(movement.created_at),
			memberName: movement.member_name,
			locationName: movement.location_name,
			delta: movement.delta,
			resultQty: movement.to_qty,
			reason: movement.reason
		}))
	};
};