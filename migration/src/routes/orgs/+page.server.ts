// Organization selection hub: active memberships, pending invitations for the
// signed-in email, and (platform administrators only) organization creation.
// Ported from list/create in src/web/orgs.rs.

import type { Actions, PageServerLoad } from './$types';
import { requireLogin } from '$lib/server/auth';
import { createOrg, orgsPageData } from '$lib/server/orgs';

export const load: PageServerLoad = async (event) => {
	const login = await requireLogin(event);
	return orgsPageData(login, event.url);
};

export const actions: Actions = {
	create: async (event) => {
		const login = await requireLogin(event);
		const form = await event.request.formData();
		return createOrg(event, login, form);
	}
};
