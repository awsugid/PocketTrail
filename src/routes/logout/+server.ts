import { redirect } from '@sveltejs/kit';
import {
	appConfig,
	assertFormCsrf,
	assertSameOrigin,
	sessionOf
} from '$lib/server/auth';
import { SESSION_COOKIE } from '$lib/server/session';
import type { RequestHandler } from './$types';

/** Clears the session cookie. A pre-authentication challenge session keeps the
 * same CSRF rule; an absent session still clears the cookie without error. */
export const POST: RequestHandler = async (event) => {
	const config = appConfig(event.platform);
	const session = await sessionOf(event, config);
	if (session) {
		assertSameOrigin(event.request, event.url);
		const form = await event.request.formData();
		assertFormCsrf(form.get('csrf_token'), session);
	}
	event.cookies.delete(SESSION_COOKIE, { path: '/' });
	throw redirect(303, '/login');
};
