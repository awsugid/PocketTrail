// Google GIS ID-token verification, ported from src/web/google.rs.
//
// RS256 JWT checked against Google's published JWKS (fetched over fetch(),
// edge-cached best-effort through the Cache API). Fails closed on every
// malformed, mismatched, or unverifiable token; no debug or dummy path.

import { googlePicture } from './profile';

const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const JWKS_CACHE_KEY = 'https://pockettrail.local/cache/google-jwks-certs?v=1';
const JWKS_CACHE_TTL = 21_600; // seconds; matches Rust's public, max-age=21600

export interface GoogleClaims {
	sub: string;
	email: string;
	name: string;
	picture: string | null;
}

interface JwtHeader {
	alg: string;
	kid?: string;
}

interface RawClaims {
	sub: string;
	email: string;
	email_verified?: boolean;
	name?: string;
	picture?: string;
	nonce?: string;
	exp?: number;
	iss?: string;
	aud?: string | string[];
}

function b64UrlToJson<T>(part: string): T | null {
	try {
		const normalized = part.replace(/-/g, '+').replace(/_/g, '/');
		const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
		const binary = atob(padded);
		const bytes = new Uint8Array(binary.length);
		for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
		return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as T;
	} catch {
		return null;
	}
}

/** Decode the token header and admit only RS256 with a `kid`. Pure and sync
 * so it stays unit-testable. */
export function headerKid(token: string): string | null {
	const first = token.split('.')[0];
	if (!first) return null;
	const header = b64UrlToJson<JwtHeader>(first);
	if (!header || header.alg !== 'RS256' || typeof header.kid !== 'string' || header.kid === '') return null;
	return header.kid;
}

interface Jwk {
	kid: string;
	kty: string;
	n: string;
	e: string;
	alg?: string;
	use?: string;
}

interface JwkSet {
	keys: Jwk[];
}

/** The Workers Cache API when present (undefined in plain Node). */
function cacheApi(): Cache | null {
	const storage = (globalThis as { caches?: { default?: Cache } }).caches;
	return storage?.default ?? null;
}

async function fetchJwks(forceFresh: boolean): Promise<JwkSet | null> {
	if (!forceFresh) {
		const cache = cacheApi();
		if (cache) {
			try {
				const cached = await cache.match(JWKS_CACHE_KEY);
				if (cached) {
					const parsed = (await cached.json()) as JwkSet;
					if (parsed && Array.isArray(parsed.keys)) return parsed;
				}
			} catch {
				// Fall through to the network fetch.
			}
		}
	}
	let response: Response;
	try {
		response = await fetch(GOOGLE_JWKS_URL, { headers: { accept: 'application/json' } });
	} catch {
		return null;
	}
	if (response.status !== 200) return null;
	let jwks: JwkSet;
	try {
		jwks = (await response.json()) as JwkSet;
	} catch {
		return null;
	}
	if (!jwks || !Array.isArray(jwks.keys)) return null;
	const cache = cacheApi();
	if (cache) {
		try {
			const cacheResponse = new Response(JSON.stringify(jwks), {
				headers: { 'cache-control': `public, max-age=${JWKS_CACHE_TTL}` }
			});
			// Best-effort edge cache; failures never block verification.
			await cache.put(JWKS_CACHE_KEY, cacheResponse);
		} catch {
			// ignore
		}
	}
	return jwks;
}

async function verifyRsa256(tokenParts: [string, string, string], jwk: Jwk): Promise<boolean> {
	const [headerPart, payload, signature] = tokenParts;
	try {
		const key = await crypto.subtle.importKey(
			'jwk',
			{ kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: false } as JsonWebKey & { alg: string },
			{ name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
			false,
			['verify']
		);
		const normalized = signature.replace(/-/g, '+').replace(/_/g, '/');
		const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
		const binary = atob(padded);
		const sigBytes = new Uint8Array(binary.length);
		for (let i = 0; i < binary.length; i += 1) sigBytes[i] = binary.charCodeAt(i);
		const data = new TextEncoder().encode(`${headerPart}.${payload}`);
		return await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, sigBytes, data);
	} catch {
		return false;
	}
}

const LEEWAY_SECS = 60;

async function verifyInner(
	token: string,
	clientId: string,
	nonce: string
): Promise<GoogleClaims | string> {
	const parts = token.split('.');
	if (parts.length !== 3) return 'invalid token shape';
	const [headerPart, payloadPart, signaturePart] = parts;
	if (!headerPart || !payloadPart || !signaturePart) return 'invalid token shape';
	const kid = headerKid(token);
	if (!kid) return 'bad header';
	let jwks = await fetchJwks(false);
	let jwk = jwks?.keys.find((k) => k.kid === kid);
	if (!jwk) {
		// Assume a recent Google key rotation and refetch bypassing the cache.
		jwks = await fetchJwks(true);
		jwk = jwks?.keys.find((k) => k.kid === kid);
	}
	if (!jwk) return 'Google signing key not found';
	if (!(await verifyRsa256([headerPart, payloadPart, signaturePart], jwk))) return 'invalid signature';
	const raw = b64UrlToJson<RawClaims>(payloadPart);
	if (!raw || typeof raw.sub !== 'string' || typeof raw.email !== 'string') return 'invalid claims';
	if (!raw.email_verified) return 'email not verified';
	const audiences = Array.isArray(raw.aud) ? raw.aud : [raw.aud];
	if (!audiences.includes(clientId)) return 'invalid audience';
	if (raw.iss !== 'https://accounts.google.com' && raw.iss !== 'accounts.google.com') return 'invalid issuer';
	if (typeof raw.exp !== 'number' || raw.exp + LEEWAY_SECS <= Math.floor(Date.now() / 1000)) return 'expired token';
	if (nonce === '' || raw.nonce !== nonce) return 'login nonce mismatch';
	return {
		sub: raw.sub,
		email: raw.email,
		name: raw.name ?? raw.email,
		picture: raw.picture ? googlePicture(raw.picture) : null
	};
}

/** Verify a Google GIS ID token against `client_id`. Returns the claims or an
 * error string (logged by the caller); never trusts an unverified token. */
export async function verifyIdToken(
	token: string,
	clientId: string,
	nonce: string
): Promise<{ ok: true; claims: GoogleClaims } | { ok: false; error: string }> {
	const result = await verifyInner(token, clientId, nonce);
	if (typeof result === 'string') return { ok: false, error: result };
	return { ok: true, claims: result };
}