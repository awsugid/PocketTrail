// Emailed invitation link tokens, ported from src/tokens.rs.
//
// Raw tokens live in the emailed link only; D1 stores the SHA-256 hash, so a
// database leak cannot mint acceptance links.

import { createHash, randomBytes } from 'node:crypto';

/** 32 random bytes -> 43-char unpadded base64url token (URL-safe by design). */
export function encodeToken(): string {
	return randomBytes(32).toString('base64url');
}

/** Fixed-width, non-reversible lookup key for a raw token. */
export function hashToken(raw: string): string {
	return createHash('sha256').update(raw, 'utf8').digest('hex');
}

/** Random hex string of `bytes` random bytes (invitation ids, op tokens). */
export function randomHex(bytes: number): string {
	return randomBytes(bytes).toString('hex');
}