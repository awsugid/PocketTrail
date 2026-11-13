import type { RequestHandler } from './$types';

import { requireMember, verifiedForm } from '$lib/server/auth';
import { inviteCtxFrom, revokeInvitation } from '$lib/server/invitations';

// POST /org/:slug/settings/invitations/:id/revoke
export const POST: RequestHandler = async (event) => {
	const ctx = await requireMember(event, event.params.slug, 'ManageMembers');
	await verifiedForm(event, ctx.session);
	return revokeInvitation(inviteCtxFrom(ctx, event.url.pathname), event.params.id);
};