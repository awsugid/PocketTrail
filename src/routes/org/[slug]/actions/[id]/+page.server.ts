import { redirect } from '@sveltejs/kit';
import { requireMember, shellContext, verifiedForm } from '$lib/server/auth';
import { ownAction, explainOwnAction } from '$lib/server/own_actions';
import { numericPathId } from '$lib/server/txns';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const ctx = await requireMember(event, event.params.slug, 'ExplainOwnActions');
	return { shell: await shellContext(ctx), task: await ownAction(ctx, numericPathId(event.params.id)) };
};
export const actions: Actions = {
	default: async (event) => {
		const ctx = await requireMember(event, event.params.slug, 'ExplainOwnActions');
		const form = await verifiedForm(event, ctx.session);
		await explainOwnAction(ctx, numericPathId(event.params.id), form);
		redirect(303, `/org/${ctx.org.slug}/actions`);
	}
};
