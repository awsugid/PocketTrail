import { requireMember, shellContext } from '$lib/server/auth';
import { LEDGER_FILTERS, ledgerPage, parseFilter, parsePage } from '$lib/server/ledger';
import type { PageServerLoad } from './$types';

// The ledger read is authorized here, per request, against current membership
// rows. There is no parent layout load to lean on.
export const load: PageServerLoad = async (event) => {
	const ctx = await requireMember(event, event.params.slug, 'ViewTransactions');
	const filter = parseFilter(event.url.searchParams.get('status'));
	const page = parsePage(event.url.searchParams.get('page'));
	const result = await ledgerPage(ctx.db, ctx.org.id, filter, page);
	return {
		shell: await shellContext(ctx),
		filter: filter ?? 'all',
		filters: LEDGER_FILTERS,
		canImport: ctx.can('ImportStatements'),
		canDocument: ctx.can('DocumentTransactions'),
		entries: result.entries,
		page: result.page,
		hasNext: result.hasNext,
		owedCount: result.owedCount
	};
};
