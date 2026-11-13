import { actionForm, approve, addComment, requireOrg, numericPathId, requestChanges, saveDetails, submitDocumentation, suppress, txnDetail, txnShell, unsuppress, uploadDocument } from '$lib/server/txns';
import type { Actions, PageServerLoad } from './$types';

// Per-entry authorization: the row is looked up by (id, org_id) together, so a
// transaction belonging to another organization is reported as missing rather
// than as forbidden. The active-member gate runs before the lookup; the
// permission-sensitive panels below are gated again inside each action.
export const load: PageServerLoad = async (event) => {
	const ctx = await requireOrg(event, event.params.slug);
	const txn = await txnDetail(ctx, numericPathId(event.params.id));
	return {
		shell: await txnShell(ctx),
		txn,
		msg: event.url.searchParams.get('msg')
	};
};

export const actions: Actions = {
	details: async (event) => {
		const ctx = await requireOrg(event, event.params.slug);
		const form = await actionForm(event, ctx.session);
		return saveDetails(ctx, numericPathId(event.params.id), form);
	},
	submit: async (event) => {
		const ctx = await requireOrg(event, event.params.slug);
		const form = await actionForm(event, ctx.session);
		return submitDocumentation(ctx, numericPathId(event.params.id), form);
	},
	approve: async (event) => {
		const ctx = await requireOrg(event, event.params.slug);
		const form = await actionForm(event, ctx.session);
		return approve(ctx, numericPathId(event.params.id), form);
	},
	requestChanges: async (event) => {
		const ctx = await requireOrg(event, event.params.slug);
		const form = await actionForm(event, ctx.session);
		return requestChanges(ctx, numericPathId(event.params.id), form);
	},
	comment: async (event) => {
		const ctx = await requireOrg(event, event.params.slug);
		const form = await actionForm(event, ctx.session);
		return addComment(ctx, numericPathId(event.params.id), form);
	},
	suppress: async (event) => {
		const ctx = await requireOrg(event, event.params.slug);
		const form = await actionForm(event, ctx.session);
		return suppress(ctx, numericPathId(event.params.id), form);
	},
	unsuppress: async (event) => {
		const ctx = await requireOrg(event, event.params.slug);
		const form = await actionForm(event, ctx.session);
		return unsuppress(ctx, numericPathId(event.params.id), form);
	},
	document: async (event) => {
		const ctx = await requireOrg(event, event.params.slug);
		const form = await actionForm(event, ctx.session);
		return uploadDocument(ctx, numericPathId(event.params.id), form);
	}
};
