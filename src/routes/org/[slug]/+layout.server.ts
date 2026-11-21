import { requireMember } from '#lib/server/auth.ts';
import { showMcpBanner } from '#lib/server/announcements.ts';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async (event) => {
	const ctx = await requireMember(event, event.params.slug, ['ViewTransactions', 'UpdateStock', 'ExplainOwnActions', 'DocumentTransactions']);
	return { showMcpBanner: await showMcpBanner(ctx.db, ctx.user.id, ctx.can('DocumentTransactions')) };
};
