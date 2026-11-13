import { describe, expect, it } from 'vitest';

import { headerKid } from '$lib/server/google';

const part = (json: string) => Buffer.from(json, 'utf8').toString('base64url');

describe('google id-token header gate', () => {
	it('rejects garbage', () => {
		expect(headerKid('not-a-token')).toBeNull();
	});
	it('rejects non-RS256 algorithms', () => {
		const token = `${part('{"alg":"HS256"}')}.${part('{}')}.x`;
		expect(headerKid(token)).toBeNull();
	});
	it('rejects missing kid', () => {
		const token = `${part('{"alg":"RS256"}')}.${part('{}')}.x`;
		expect(headerKid(token)).toBeNull();
	});
	it('admits RS256 with kid', () => {
		const token = `${part('{"alg":"RS256","kid":"abc"}')}.${part('{}')}.x`;
		expect(headerKid(token)).toBe('abc');
	});
});
