import type { PageServerLoad } from './$types';

import { orgsOfUser } from '$lib/server/auth';
import { platformPageData, requirePlatformAdmin } from '$lib/server/platform';

// Platform administration. Being a platform administrator grants no
// organization access: the page shows accounts, role templates, the global
// audit trail, and the organization list without any financial records.

export const load: PageServerLoad = async (event) => {
	const login = await requirePlatformAdmin(event);
	// OrgShell needs an organization context; the administrator's first
	// active membership supplies chrome, when one exists.
	const organizations = await orgsOfUser(login.db, login.user.id);
	return {
		platform: await platformPageData(login, event.url),
		organizations,
		user: { name: login.user.name, email: login.user.email, isPlatformAdmin: true },
		csrfToken: login.session.csrf
	};
};