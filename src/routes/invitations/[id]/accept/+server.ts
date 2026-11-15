import type { RequestHandler } from './$types';

import { requireLogin, verifiedForm } from '$lib/server/auth';
import { acceptFromOrganizations } from '$lib/server/invitations';

// POST /invitations/:id/accept — in-app acceptance from the Organizations
// hub. Same-origin and session CSRF are checked before anything is read or
// written; then a verified Google sign-in matching the invited email is needed.
export const POST: RequestHandler = async (event) => {
	const login = await requireLogin(event);
	await verifiedForm(event, login.session);
	return acceptFromOrganizations(event, event.params.id, login);
};