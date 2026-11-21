import { redirect } from '@sveltejs/kit';
import { requireMember } from '#lib/server/auth.ts';
import { verifiedForm } from '#lib/server/auth.ts';
import { dismissMcpBanner } from '#lib/server/announcements.ts';
import type { Actions, PageServerLoad } from './$types';

export const actions: Actions = {
	dismissMcp: async (event) => {
		const ctx = await requireMember(event, event.params.slug, 'DocumentTransactions');
		await verifiedForm(event, ctx.session);
		await dismissMcpBanner(ctx.db, ctx.user.id);
		return { dismissed: true };
	}
};

export const load: PageServerLoad = async (event) => {
	const ctx = await requireMember(event, event.params.slug, ['ViewTransactions', 'UpdateStock', 'ExplainOwnActions']);
	redirect(303, `/org/${ctx.org.slug}/${ctx.can('ExplainOwnActions') ? 'actions' : ctx.can('ViewTransactions') ? 'transactions' : 'inventory'}`);
};
