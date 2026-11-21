import type { Actions, PageServerLoad } from './$types';
import { error, redirect } from '@sveltejs/kit';
import { qAll, nowMs } from '#lib/server/db.ts';
import { requireMember, shellContext, verifiedForm } from '#lib/server/auth.ts';
import { settingsPageData } from '#lib/server/settings.ts';

export const load: PageServerLoad = async (event) => {
	const ctx = await requireMember(event, event.params.slug, 'DocumentTransactions');
	return {
		shell: await shellContext(ctx),
		settings: await settingsPageData(ctx, event.url),
		endpoint: `${event.url.origin}/mcp`,
		grants: await qAll<{ id: string; client_id: string; scope: string; created_at: number }>(ctx.db,
			'SELECT id,client_id,scope,created_at FROM mcp_grants WHERE org_id=?1 AND user_id=?2 AND revoked_at IS NULL AND (EXISTS(SELECT 1 FROM mcp_tokens t WHERE t.grant_id=mcp_grants.id AND t.expires_at>?3) OR (created_at+7776000000>?3 AND EXISTS(SELECT 1 FROM mcp_refresh_tokens r WHERE r.grant_id=mcp_grants.id AND r.expires_at>?3 AND r.used_at IS NULL)))',
			[ctx.org.id, ctx.user.id, nowMs()])
	};
};

export const actions: Actions = {
	revokeMcp: async (event) => {
		// Keep revocation available at the old settings URL, including after a role downgrade.
		const ctx = await requireMember(event, event.params.slug, 'ViewTransactions');
		const form = await verifiedForm(event, ctx.session);
		const id = form.get('grant_id');
		if (typeof id !== 'string') throw error(400, 'Connection required.');
		await ctx.db.prepare('UPDATE mcp_grants SET revoked_at=?1 WHERE id=?2 AND org_id=?3 AND user_id=?4 AND revoked_at IS NULL')
			.bind(nowMs(), id, ctx.org.id, ctx.user.id).run();
		redirect(303, event.url.pathname);
	}
};
