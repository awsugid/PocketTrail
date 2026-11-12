import { orgsOfUser, requireLogin } from '$lib/server/auth';
import type { PageServerLoad } from './$types';

// Organization selection. Only active memberships appear; a removed member's
// organization disappears from this list without affecting their attribution
// on historical records.
export const load: PageServerLoad = async (event) => {
	const login = await requireLogin(event);
	const organizations = await orgsOfUser(login.db, login.user.id);
	return {
		user: {
			name: login.user.name,
			email: login.user.email,
			isPlatformAdmin: login.user.is_platform_admin !== 0
		},
		csrfToken: login.session.csrf,
		organizations
	};
};
