import { requireMember, shellContext } from '$lib/server/auth';
import { filteredLedgerPage } from '$lib/server/ledger';
import { parseListFilters } from '$lib/server/list_filters';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
 const ctx = await requireMember(event, event.params.slug, 'ViewTransactions');
 const selection = parseListFilters(event.url.searchParams);
 const result = await filteredLedgerPage(ctx.db,ctx.org.id,selection,{
 membershipIds:ctx.memberRows.filter(m => m.user_id === ctx.user.id && m.removed_at === null && !m.invited).map(m => m.id),
 reviewer:ctx.can('ApproveTransactions')
 });
 return {shell:await shellContext(ctx),canImport:ctx.can('ImportStatements'),canDocument:ctx.can('DocumentTransactions'),...result};
};
