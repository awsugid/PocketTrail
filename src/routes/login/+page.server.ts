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
import { auditEvent } from '$lib/server/audit';
import { nowMs, nowSecs, qAll, qOne } from '$lib/server/db';
import { verifyIdToken } from '$lib/server/google';
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
		googleClientId: config.googleClientId ?? '',
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
		// First authenticated login: recorded with the actor, not just the
		// HTTP status the request layer sees.
		await auditEvent(env.DB, user.id, null, 'auth.login', 'session');
		throw redirect(303, '/orgs');
	},

	/** Google GIS ID-token exchange: verify the credential against Google's
	 * JWKS, upsert the user keyed by the stable Google subject, and open a
	 * session. The challenge cookie's CSRF token doubles as the login nonce,
	 * so a replayed token cannot pass verification. */
	google: async (event) => {
		const config = appConfig(event.platform);
		if (!config.googleClientId) {
			throw error(503, 'Google sign-in is not configured.');
		}
		const secret = config.secret;
		if (!secret) throw error(503, 'SECRET_SESSION_KEY not configured; fails closed.');
		assertSameOrigin(event.request, event.url);
		const form = await event.request.formData();
		const challenge: Session | null = await sessionOf(event, config);
		if (!challenge || !challenge.uid.startsWith('preauth:')) {
			throw error(403, 'Sign-in session expired. Reload the sign-in page.');
		}
		assertFormCsrf(form.get('csrf_token'), challenge);
		const credential = typeof form.get('credential') === 'string' ? String(form.get('credential')) : '';
		if (credential === '') throw error(400, 'Missing Google credential.');
		const nonce = challenge.csrf;
		const verified = await verifyIdToken(credential, config.googleClientId, nonce);
		if (!verified.ok) {
			console.error(`google id-token rejected: ${verified.error}`);
			throw error(403, 'Google sign-in failed: invalid ID token.');
		}
		const claims = verified.claims;
		const uid = `g:${claims.sub}`;
		const db = bindings(event.platform).DB;
		const owner = await qOne<{ id: string }>(
			db,
			'SELECT id FROM users WHERE LOWER(email)=LOWER(?1)',
			[claims.email]
		);
		if (owner && owner.id !== uid) {
			throw error(409, 'This email is associated with another account record. Contact a platform administrator.');
		}
		// User upsert and the authenticated login event commit together.
		const now = nowMs();
		await db.batch([
			db
				.prepare(
					`INSERT INTO users (id, email, name, google_sub, is_platform_admin, created_at, picture)
					 VALUES (?1, ?2, ?3, ?4, 0, ?5, ?6)
					 ON CONFLICT(id) DO UPDATE SET email = excluded.email, name = excluded.name, picture = excluded.picture`
				)
				.bind(uid, claims.email, claims.name, claims.sub, now, claims.picture),
			db
				.prepare(
					"INSERT INTO audit_events(actor_id,org_id,action,target,outcome,created_at) VALUES(?1,NULL,'auth.login','session','committed',?2)"
				)
				.bind(uid, now)
		]);
		const session = await newSession(secret, uid, nowSecs());
		event.cookies.set(
			SESSION_COOKIE,
			await encodeCookie(secret, session),
			sessionCookie(isHttps(event.url))
		);
		throw redirect(303, '/orgs');
	}
};
