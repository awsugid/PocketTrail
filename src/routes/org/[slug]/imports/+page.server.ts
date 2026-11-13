import type { Actions, PageServerLoad } from './$types';

import { createImport, importsPageData } from '$lib/server/imports';
import { actionForm, requireOrg, txnShell } from '$lib/server/txns';

// Import landing: batched history plus the staging form. Both the page and the
// action require ImportStatements; the pocket list is scoped to this org.
export const load: PageServerLoad = async (event) => {
	const ctx = await requireOrg(event, event.params.slug, 'ImportStatements');
	return {
		shell: await txnShell(ctx),
		...(await importsPageData(ctx)),
		msg: event.url.searchParams.get('msg') ?? ''
	};
};

export const actions: Actions = {
	default: async (event) => {
		const ctx = await requireOrg(event, event.params.slug, 'ImportStatements');
		const form = await actionForm(event, ctx.session);
		return createImport(ctx, form);
	}
};
