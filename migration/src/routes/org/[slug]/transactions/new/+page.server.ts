import { actionForm, activeMembers, createTransaction, requireOrg, txnShell } from '$lib/server/txns';
import { pocketsOf } from '$lib/server/rows';
import type { Actions, PageServerLoad } from './$types';

// Manual creation. The page itself needs only ledger visibility; the create
// action enforces DocumentTransactions (the same two-step gate as the Rust
// new_page/create pair).
export const load: PageServerLoad = async (event) => {
	const ctx = await requireOrg(event, event.params.slug, 'ViewTransactions');
	const pockets = await pocketsOf(ctx.db, ctx.org.id);
	return {
		shell: await txnShell(ctx),
		pockets: pockets.map((p) => ({ id: p.id, name: p.name })),
		members: activeMembers(ctx),
		canRecord: ctx.can('DocumentTransactions'),
		msg: event.url.searchParams.get('msg')
	};
};

export const actions: Actions = {
	default: async (event) => {
		const ctx = await requireOrg(event, event.params.slug);
		const form = await actionForm(event, ctx.session);
		return createTransaction(ctx, form);
	}
};