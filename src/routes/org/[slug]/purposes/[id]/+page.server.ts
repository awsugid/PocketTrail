import { requireOrg, actionForm, numericPathId, txnShell } from '$lib/server/txns';
import {
	purposeDetail,
	postPurposeMessage,
	reviewPurpose,
	savePurposeNotes,
	setPurposeResponsibles,
	uploadPurposeEvidence
} from '$lib/server/purposes';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const ctx = await requireOrg(event, event.params.slug, 'ViewTransactions');
	const purpose = await purposeDetail(ctx, numericPathId(event.params.id));
	return {
		shell: await txnShell(ctx),
		purpose,
		msg: event.url.searchParams.get('msg')
	};
};

export const actions: Actions = {
	notes: async (event) => {
		const ctx = await requireOrg(event, event.params.slug);
		const form = await actionForm(event, ctx.session);
		return savePurposeNotes(ctx, numericPathId(event.params.id), form);
	},
	evidence: async (event) => {
		const ctx = await requireOrg(event, event.params.slug);
		const form = await actionForm(event, ctx.session);
		return uploadPurposeEvidence(ctx, numericPathId(event.params.id), form);
	},
	message: async (event) => {
		const ctx = await requireOrg(event, event.params.slug);
		const form = await actionForm(event, ctx.session);
		return postPurposeMessage(ctx, numericPathId(event.params.id), form);
	},
	responsibles: async (event) => {
		const ctx = await requireOrg(event, event.params.slug);
		const form = await actionForm(event, ctx.session);
		return setPurposeResponsibles(ctx, numericPathId(event.params.id), form);
	},
	approve: async (event) => {
		const ctx = await requireOrg(event, event.params.slug);
		const form = await actionForm(event, ctx.session);
		return reviewPurpose(ctx, numericPathId(event.params.id), form, false);
	},
	requestChanges: async (event) => {
		const ctx = await requireOrg(event, event.params.slug);
		const form = await actionForm(event, ctx.session);
		return reviewPurpose(ctx, numericPathId(event.params.id), form, true);
	}
};
