import { error, redirect, type Actions } from '@sveltejs/kit';
import {
	appConfig,
	assertFormCsrf,
	assertSameOrigin,
	bindings,
	devLoginAllowed,
	isHttps,
	sessionCookie,
	sessionOf,
	type UserRow
} from '$lib/server/auth';
import { nowSecs, qAll, qOne } from '$lib/server/db';
import {
	SESSION_COOKIE,
	encodeCookie,
	newSession,
	type Session
} from '$lib/server/session';
import type { PageServerLoad } from './$types';

function randomHex(bytes: number): string {
	const buffer = new Uint8Array(bytes);
	crypto.getRandomValues(buffer);
	return Array.from(buffer, (value) => value.toString(16).padStart(2, '0')).join('');
}

/** Fixture identities are the seeded local users with no Google subject. */
async function fixtureIdentities(db: App.Platform['env']['DB']): Promise<UserRow[]> {
	return qAll<UserRow>(
		db,
		`SELECT id, email, name, google_sub, picture, is_platform_admin, created_at
		 FROM users WHERE google_sub IS NULL ORDER BY id`
	);
}

export const load: PageServerLoad = async (event) => {
	const config = appConfig(event.platform);
	if (!config.secret) {
		throw error(503, 'SECRET_SESSION_KEY is not configured; authentication fails closed.');
	}
	const existing = await sessionOf(event, config);
	if (existing && !existing.uid.startsWith('preauth:')) throw redirect(303, '/orgs');

	// A short-lived challenge session carries the CSRF token the sign-in form
	// must return, exactly as the Rust login page does.
	const challenge = await newSession(config.secret, `preauth:${randomHex(32)}`, nowSecs());
	event.cookies.set(
		SESSION_COOKIE,
		await encodeCookie(config.secret, challenge),
		sessionCookie(isHttps(event.url))
	);

	const allowed = devLoginAllowed(config, event.url);
	const users = allowed ? await fixtureIdentities(bindings(event.platform).DB) : [];
	return {
		csrfToken: challenge.csrf,
		devLoginEnabled: allowed && users.length > 0,
		googleConfigured: config.googleClientId !== null,
		users: users.map((user) => ({ id: user.id, name: user.name, email: user.email }))
	};
};

/** Rejects any sign-in attempt that is not a loopback fixture login, returning
 * the bindings and signing key once every gate has passed. */
function requireLocalFixtureLogin(
	config: ReturnType<typeof appConfig>,
	url: URL,
	platform: App.Platform | undefined
): { env: App.Platform['env']; secret: string } {
	if (!platform) throw error(500, 'Platform bindings are unavailable.');
	if (!config.secret) throw error(503, 'SECRET_SESSION_KEY not configured; fails closed.');
	if (!config.localDev) throw error(403, 'Local fixture sign-in is disabled (LOCAL_DEV is not set).');
	if (!devLoginAllowed(config, url)) {
		throw error(403, 'Local fixture sign-in is restricted to loopback hostnames.');
	}
	return { env: platform.env, secret: config.secret };
}

export const actions: Actions = {
	dev: async (event) => {
		const config = appConfig(event.platform);
		const { env, secret } = requireLocalFixtureLogin(config, event.url, event.platform);
		assertSameOrigin(event.request, event.url);
		const form = await event.request.formData();
		const challenge: Session | null = await sessionOf(event, config);
		if (!challenge || !challenge.uid.startsWith('preauth:')) {
			throw error(403, 'Sign-in session expired. Reload the sign-in page.');
		}
		assertFormCsrf(form.get('csrf_token'), challenge);
		const userId = typeof form.get('user_id') === 'string' ? String(form.get('user_id')) : '';
		const user = await qOne<UserRow>(
			env.DB,
			'SELECT id, email, name, google_sub, picture, is_platform_admin, created_at FROM users WHERE id = ?1 AND google_sub IS NULL',
			[userId]
		);
		if (!user) throw error(403, 'Unknown fixture identity.');
		const session = await newSession(secret, user.id, nowSecs());
		event.cookies.set(
			SESSION_COOKIE,
			await encodeCookie(secret, session),
			sessionCookie(isHttps(event.url))
		);
		throw redirect(303, '/orgs');
	}
};
