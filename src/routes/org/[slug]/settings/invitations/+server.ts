import type { RequestHandler } from './$types';

import { bindings, requireMember, verifiedForm } from '#lib/server/auth.ts';
import { addPerson } from '#lib/server/people.ts';

// POST /org/:slug/settings/invitations — its own path so the audit trail
// records the same normalized target as the Rust app.
export const POST: RequestHandler = async (event) => {
	const ctx = await requireMember(event, event.params.slug, 'ManageMembers');
	const form = await verifiedForm(event, ctx.session);
	return addPerson({ ...ctx, secret: ctx.config.secret, section: 'people' }, form, bindings(event.platform), event.url.origin);
};
