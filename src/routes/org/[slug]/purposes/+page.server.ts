import { requireOrg, actionForm, txnShell } from '#lib/server/txns.ts';
import { filteredPurposesPage, createPurpose } from '#lib/server/purposes.ts';
import { parseListFilters } from '#lib/server/list_filters.ts';
import type { Actions, PageServerLoad } from './$types';
import type { PurposeKind } from '#lib/purposes.ts';

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
		...(await filteredPurposesPage(ctx, parseListFilters(event.url.searchParams)))
	};
};

export const actions: Actions = {
	create: async (event) => {
		const ctx = await requireOrg(event, event.params.slug);
		const form = await actionForm(event, ctx.session);
		return createPurpose(ctx, form);
	}
};
