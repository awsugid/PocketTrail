import type { RequestHandler } from './$types';

import { requireLogin } from '$lib/server/auth';
import { acceptFromOrganizations } from '$lib/server/invitations';

// POST /invitations/:id/accept — in-app acceptance from the Organizations
// hub. Requires a verified Google sign-in matching the invited email.
export const POST: RequestHandler = async (event) => {
	const login = await requireLogin(event);
	return acceptFromOrganizations(event, event.params.id, login);
};