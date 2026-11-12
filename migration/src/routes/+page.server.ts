import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

// Sign-in state decides the landing page; the guards themselves live in
// $lib/server/auth.
export const load: PageServerLoad = async () => {
	throw redirect(303, '/orgs');
};
