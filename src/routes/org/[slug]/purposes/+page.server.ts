import { requireOrg, actionForm, txnShell } from '$lib/server/txns';
import { purposesPage, createPurpose } from '$lib/server/purposes';
import type { Actions, PageServerLoad } from './$types';
import type { PurposeKind } from '$lib/purposes';

function parseKind(value: string | null): PurposeKind | null {
	if (value === 'income' || value === 'expense') return value;
	return null;
}

export const load: PageServerLoad = async (event) => {
	const ctx = await requireOrg(event, event.params.slug, 'ViewTransactions');
	const kind = parseKind(event.url.searchParams.get('kind'));
	return {
		shell: await txnShell(ctx),
		kind,
		...(await purposesPage(ctx, kind))
	};
};

export const actions: Actions = {
	create: async (event) => {
		const ctx = await requireOrg(event, event.params.slug);
		const form = await actionForm(event, ctx.session);
		return createPurpose(ctx, form);
	}
};
