import type { RequestHandler } from './$types';

import { bindings, requireMember } from '$lib/server/auth';
import { createInvitation, inviteCtxFrom } from '$lib/server/invitations';

// POST /org/:slug/settings/invitations — its own path so the audit trail
// records the same normalized target as the Rust app.
export const POST: RequestHandler = async (event) => {
	const ctx = await requireMember(event, event.params.slug, 'ManageMembers');
	const form = await event.request.formData();
	return createInvitation(inviteCtxFrom(ctx, event.url.pathname), form, bindings(event.platform), event.url.origin);
};