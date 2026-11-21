import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { orgsOfUser, requireLogin } from '#lib/server/auth.ts';

// Sign-in state decides the landing page; the guards themselves live in
// $lib/server/auth.
export const load: PageServerLoad = async (event) => {
	const login = await requireLogin(event);
	const organizations = await orgsOfUser(login.db, login.user.id);
	const remembered = event.cookies.get(`pt_org_${encodeURIComponent(login.user.id)}`);
	const selected = organizations.find((org) => org.slug === remembered) ??
		(!remembered && organizations.length === 1 ? organizations[0] : undefined);
	throw redirect(303, selected ? `/org/${encodeURIComponent(selected.slug)}` : '/orgs');
};
