import type { Actions, PageServerLoad } from './$types';

import { confirmImport, importBatchPage } from '$lib/server/imports';
import { actionForm, numericPathId, requireOrg, txnShell } from '$lib/server/txns';

// One staged batch: preview before committing, then a result view. The id is
// looked up with the org id, so a batch from another organization is missing.
export const load: PageServerLoad = async (event) => {
	const ctx = await requireOrg(event, event.params.slug, 'ImportStatements');
	return {
		shell: await txnShell(ctx),
		...(await importBatchPage(ctx, numericPathId(event.params.id)))
	};
};

export const actions: Actions = {
	confirm: async (event) => {
		const ctx = await requireOrg(event, event.params.slug, 'ImportStatements');
		await actionForm(event, ctx.session);
		return confirmImport(ctx, numericPathId(event.params.id));
	}
};
