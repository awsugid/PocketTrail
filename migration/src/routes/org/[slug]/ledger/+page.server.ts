import { orgsOfUser, requireMember } from '$lib/server/auth';
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
		org: { slug: ctx.org.slug, name: ctx.org.name, isSynthetic: ctx.org.is_synthetic !== 0 },
		user: { name: ctx.user.name },
		organizations: await orgsOfUser(ctx.db, ctx.user.id),
		csrfToken: ctx.session.csrf,
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
