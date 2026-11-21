import { redirect } from '@sveltejs/kit';
import { requireMember } from '$lib/server/auth';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const ctx = await requireMember(event, event.params.slug, ['ViewTransactions', 'UpdateStock', 'ExplainOwnActions']);
	redirect(303, `/org/${ctx.org.slug}/${ctx.can('ExplainOwnActions') ? 'actions' : ctx.can('ViewTransactions') ? 'transactions' : 'inventory'}`);
};
