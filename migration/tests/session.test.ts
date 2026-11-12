import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
	SESSION_COOKIE,
	SESSION_TTL_SECS,
	decodeCookie,
	encodeCookie,
	hostIsLoopback,
	newSession,
	parseCookies,
	sessionCookieValue,
	type Session
} from '../src/lib/server/session';

const SECRET = 'test-secret-with-at-least-32-characters';

/** Independent re-implementation of the Rust codec (src/auth.rs), using
 * node:crypto and Buffer instead of WebCrypto. Agreement between the two is the
 * evidence that a cookie minted by the Rust application still verifies here. */
function rustHmacHex(secret: string, data: string): string {
	return createHmac('sha256', secret).update(data, 'utf8').digest('hex');
}

function rustEncode(secret: string, session: Session): string {
	// serde serializes Session in declaration order: uid, csrf, exp.
	const payload = Buffer.from(JSON.stringify(session), 'utf8').toString('base64url');
	return `${payload}.${rustHmacHex(secret, payload)}`;
}

function rustCsrf(secret: string, uid: string, exp: number): string {
	return rustHmacHex(secret, `csrf:${uid}:${exp}`).slice(0, 32);
}

describe('session cookie codec', () => {
	it('round-trips a freshly minted session', async () => {
		const session = await newSession(SECRET, 'alice', 1000);
		const cookie = await encodeCookie(SECRET, session);
		const decoded = await decodeCookie(SECRET, cookie, 2000);
		expect(decoded).toEqual(session);
	});

	it('encodes byte-for-byte the same cookie as the Rust implementation', async () => {
		const session = await newSession(SECRET, 'alice', 1_700_000_000);
		expect(await encodeCookie(SECRET, session)).toBe(rustEncode(SECRET, session));
	});

	it('verifies a cookie produced by the Rust implementation', async () => {
		const exp = 1_700_000_000 + SESSION_TTL_SECS;
		const session = { uid: 'alice', csrf: rustCsrf(SECRET, 'alice', exp), exp };
		expect(await decodeCookie(SECRET, rustEncode(SECRET, session), 1_700_000_100)).toEqual(session);
	});

	it('rejects an expired session', async () => {
		const session = await newSession(SECRET, 'alice', 1000);
		const cookie = await encodeCookie(SECRET, session);
		expect(await decodeCookie(SECRET, cookie, session.exp)).toBeNull();
		expect(await decodeCookie(SECRET, cookie, session.exp - 1)).not.toBeNull();
	});

	it('rejects a cookie signed with another key', async () => {
		const session = await newSession(SECRET, 'alice', 1000);
		const cookie = await encodeCookie(SECRET, session);
		expect(await decodeCookie('another-secret-of-sufficient-length', cookie, 2000)).toBeNull();
	});

	it('rejects a tampered payload', async () => {
		const session = await newSession(SECRET, 'alice', 1000);
		const cookie = await encodeCookie(SECRET, session);
		const [payload, signature] = cookie.split('.');
		const flipped = `${payload!.slice(0, -1)}${payload!.endsWith('A') ? 'B' : 'A'}.${signature}`;
		expect(await decodeCookie(SECRET, flipped, 0)).toBeNull();
	});

	it('rejects a correctly signed payload whose CSRF token was substituted', async () => {
		const exp = 1_700_000_000 + SESSION_TTL_SECS;
		const forged = { uid: 'root', csrf: 'f'.repeat(32), exp };
		expect(await decodeCookie(SECRET, rustEncode(SECRET, forged), 1_700_000_100)).toBeNull();
	});

	it('rejects malformed values without throwing', async () => {
		const cases = [
			'',
			'no-dot',
			'.',
			'a.b',
			`${'a'.repeat(10)}.${'z'.repeat(64)}`,
			`${'a'.repeat(10)}.${'0'.repeat(63)}`,
			`${'***'}.${'0'.repeat(64)}`,
			`${Buffer.from('{}').toString('base64url')}.${'0'.repeat(64)}`
		];
		for (const value of cases) {
			expect(await decodeCookie(SECRET, value, 0)).toBeNull();
		}
	});

	it('takes CSRF tokens from the secret, not the payload', async () => {
		const session = await newSession(SECRET, 'alice', 1000);
		expect(session.csrf).toBe(rustCsrf(SECRET, 'alice', session.exp));
		expect(session.csrf).toHaveLength(32);
	});
});

describe('cookie header parsing', () => {
	it('finds the session value among other cookies', () => {
		const header = `a=1; ${SESSION_COOKIE}=x.y; b=2`;
		expect(sessionCookieValue(header)).toBe('x.y');
		expect(sessionCookieValue('other=1')).toBeNull();
	});

	it('keeps the first occurrence of a repeated name', () => {
		expect(parseCookies('a=1; a=2').get('a')).toBe('1');
	});
});

describe('loopback detection for fixture sign-in', () => {
	it('accepts any port on a loopback host', () => {
		expect(hostIsLoopback('localhost:8787')).toBe(true);
		expect(hostIsLoopback('127.0.0.1:8787')).toBe(true);
		expect(hostIsLoopback('[::1]:8787')).toBe(true);
	});

	it('rejects everything else', () => {
		expect(hostIsLoopback('example.com')).toBe(false);
		expect(hostIsLoopback('pockettrail.workers.dev')).toBe(false);
		expect(hostIsLoopback('localhost.example.com')).toBe(false);
		expect(hostIsLoopback('127.0.0.1.example.com:8787')).toBe(false);
	});
});
