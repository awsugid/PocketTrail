import type { RequestHandler } from './$types';

import { requireMember } from '$lib/server/auth';
import { inviteCtxFrom, revokeInvitation } from '$lib/server/invitations';

// POST /org/:slug/settings/invitations/:id/revoke
export const POST: RequestHandler = async (event) => {
	const ctx = await requireMember(event, event.params.slug, 'ManageMembers');
	return revokeInvitation(inviteCtxFrom(ctx, event.url.pathname), event.params.id);
};