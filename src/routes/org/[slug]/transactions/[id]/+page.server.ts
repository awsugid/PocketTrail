import { actionForm, approve, addComment, requireOrg, numericPathId, moveEvidence, requestChanges, saveAllocations, saveDetails, saveTag, submitDocumentation, suppress, txnDetail, txnShell, unsuppress, uploadDocument } from '#lib/server/txns.ts';
import { qAll } from '#lib/server/db.ts';
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
		tags: await qAll<{ id: number; name: string; assigned: number }>(ctx.db, 'SELECT g.id, g.name, EXISTS(SELECT 1 FROM transaction_tags tt WHERE tt.org_id=g.org_id AND tt.tag_id=g.id AND tt.transaction_id=?2) AS assigned FROM tags g WHERE g.org_id=?1 AND (?3=1 OR EXISTS(SELECT 1 FROM transaction_tags tt WHERE tt.org_id=g.org_id AND tt.tag_id=g.id AND tt.transaction_id=?2)) ORDER BY g.name COLLATE NOCASE', [ctx.org.id, txn.id, ctx.can('ViewTransactions') ? 1 : 0]),
		canTag: ctx.can('DocumentTransactions'),
		msg: event.url.searchParams.get('msg')
	};
};

export const actions: Actions = {
	tag: async (event) => {
		const ctx = await requireOrg(event, event.params.slug);
		const form = await actionForm(event, ctx.session);
		return saveTag(ctx, numericPathId(event.params.id), form);
	},
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
	allocations: async (event) => {
		const ctx = await requireOrg(event, event.params.slug);
		const form = await actionForm(event, ctx.session);
		return saveAllocations(ctx, numericPathId(event.params.id), form);
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
