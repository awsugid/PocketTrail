// Session cookie codec, ported from src/auth.rs so existing `pt_session`
// cookies stay verifiable during the migration.
//
// Cookie value: `<base64url(json payload)>.<hex hmac-sha256>`, keyed by
// SECRET_SESSION_KEY. Payload keys are written in the same order as the Rust
// struct (uid, csrf, exp) and the CSRF token is re-derived after verification,
// so a forged payload cannot smuggle a token in.
//
// Uses WebCrypto and btoa/atob only: the same code runs in the Workers runtime
// and in plain Node, with no nodejs_compat requirement.

export const SESSION_COOKIE = 'pt_session';
/** Matches SESSION_TTL_SECS in src/auth.rs (12 hours). */
export const SESSION_TTL_SECS = 12 * 3600;

export interface Session {
	uid: string;
	csrf: string;
	/** Expiry as epoch seconds. */
	exp: number;
}

const encoder = new TextEncoder();
const BASE64URL = /^[A-Za-z0-9_-]*$/;
const HEX_SHA256 = 64;

function bytesToBase64Url(bytes: Uint8Array): string {
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBytes(text: string): Uint8Array | null {
	if (!BASE64URL.test(text)) return null;
	const base64 = text.replace(/-/g, '+').replace(/_/g, '/');
	const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
	try {
		const binary = atob(padded);
		const bytes = new Uint8Array(binary.length);
		for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
		return bytes;
	} catch {
		return null;
	}
}

async function hmacHex(secret: string, data: string): Promise<string> {
	const key = await crypto.subtle.importKey(
		'raw',
		encoder.encode(secret),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign']
	);
	const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(data));
	return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, '0')).join(
		''
	);
}

/** Constant-time comparison for hex strings of equal length. */
function sameString(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
	return diff === 0;
}

/** Build a session for `uid`, valid until `nowSecs + 12h`. */
export async function newSession(
	secret: string,
	uid: string,
	nowSecs: number
): Promise<Session> {
	const exp = nowSecs + SESSION_TTL_SECS;
	const csrf = (await hmacHex(secret, `csrf:${uid}:${exp}`)).slice(0, 32);
	return { uid, csrf, exp };
}

/** CSRF token for an unauthenticated page (the login form). Stable per purpose
 * and unguessable without the secret. */
export async function csrfForSecret(secret: string, purpose: string): Promise<string> {
	return (await hmacHex(secret, `csrf-page:${purpose}`)).slice(0, 32);
}

export async function encodeCookie(secret: string, session: Session): Promise<string> {
	const payload = bytesToBase64Url(encoder.encode(JSON.stringify(session)));
	const signature = await hmacHex(secret, payload);
	return `${payload}.${signature}`;
}

function parseSessionJson(text: string): Session | null {
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch {
		return null;
	}
	if (typeof value !== 'object' || value === null) return null;
	const { uid, csrf, exp } = value as Record<string, unknown>;
	if (typeof uid !== 'string' || typeof csrf !== 'string' || typeof exp !== 'number') return null;
	if (!Number.isSafeInteger(exp)) return null;
	return { uid, csrf, exp };
}

/** Verify signature, payload shape, expiry and the re-derived CSRF token. Any
 * failure yields `null` so callers fail closed. */
export async function decodeCookie(
	secret: string,
	value: string,
	nowSecs: number
): Promise<Session | null> {
	const split = value.indexOf('.');
	if (split < 0) return null;
	const payload = value.slice(0, split);
	const signature = value.slice(split + 1);
	if (signature.length !== HEX_SHA256 || !/^[0-9a-f]+$/.test(signature)) return null;
	const expected = await hmacHex(secret, payload);
	if (!sameString(expected, signature)) return null;
	const bytes = base64UrlToBytes(payload);
	if (!bytes) return null;
	let text: string;
	try {
		text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
	} catch {
		return null;
	}
	const session = parseSessionJson(text);
	if (!session) return null;
	if (session.exp <= nowSecs) return null;
	const expectCsrf = (await hmacHex(secret, `csrf:${session.uid}:${session.exp}`)).slice(0, 32);
	if (!sameString(session.csrf, expectCsrf)) return null;
	return session;
}

/** Parse a `Cookie:` header into name/value pairs, first occurrence wins. */
export function parseCookies(header: string): Map<string, string> {
	const cookies = new Map<string, string>();
	for (const part of header.split(';')) {
		const index = part.indexOf('=');
		if (index < 0) continue;
		const name = part.slice(0, index).trim();
		const value = part.slice(index + 1).trim();
		if (!cookies.has(name)) cookies.set(name, value);
	}
	return cookies;
}

/** The `pt_session` value from a `Cookie:` header, if present. */
export function sessionCookieValue(header: string): string | null {
	return parseCookies(header).get(SESSION_COOKIE) ?? null;
}

/** Cookie attributes mirror set_cookie_header in src/auth.rs. */
export interface CookieOptions {
	path: string;
	httpOnly: true;
	sameSite: 'lax';
	secure: boolean;
	maxAge: number;
}

export function sessionCookieOptions(secure: boolean): CookieOptions {
	return { path: '/', httpOnly: true, sameSite: 'lax', secure, maxAge: SESSION_TTL_SECS };
}

/** Fixture login is allowed only on loopback hostnames, regardless of port.
 * Mirrors host_is_loopback in src/auth.rs, including IPv6 brackets. */
export function hostIsLoopback(hostHeader: string): boolean {
	const colon = hostHeader.lastIndexOf(':');
	let host = colon > 0 ? hostHeader.slice(0, colon) : hostHeader;
	host = host.replace(/^\[/, '').replace(/\]$/, '');
	return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}
