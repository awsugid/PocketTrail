import type { RequestHandler } from './$types';

import { bindings, requireMember, verifiedForm } from '$lib/server/auth';
import { inviteCtxFrom, resendInvitation } from '$lib/server/invitations';

// POST /org/:slug/settings/invitations/:id/resend
export const POST: RequestHandler = async (event) => {
	const ctx = await requireMember(event, event.params.slug, 'ManageMembers');
	await verifiedForm(event, ctx.session);
	return resendInvitation(inviteCtxFrom(ctx, event.url.pathname), event.params.id, bindings(event.platform), event.url.origin);
};