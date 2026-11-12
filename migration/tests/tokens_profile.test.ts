import { describe, expect, it } from 'vitest';

import { encodeToken, hashToken } from '$lib/server/tokens';
import { googlePicture, validEmail } from '$lib/server/profile';
import { hostIsLoopback } from '$lib/server/session';

describe('invitation tokens', () => {
	it('is url-safe and fixed width', () => {
		expect(encodeToken()).toHaveLength(43);
	});
	it('hashes deterministically', () => {
		expect(hashToken('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
		expect(hashToken('')).toHaveLength(64);
		expect(hashToken('a')).not.toBe(hashToken('b'));
	});
});

describe('mailbox validation', () => {
	it('accepts plain mailboxes', () => {
		expect(validEmail('organizer+test@example.test')).toBe(true);
	});
	it('rejects hostile values', () => {
		for (const value of ['bad', 'a@@example.test', 'a\r\n@example.test', 'a@-example.test', 'a..b@example.test']) {
			expect(validEmail(value)).toBe(false);
		}
	});
});

describe('avatar host guard', () => {
	it('accepts verified Google image hosts', () => {
		expect(googlePicture('https://lh3.googleusercontent.com/a/photo')).not.toBeNull();
		expect(googlePicture('https://googleusercontent.com/a')).not.toBeNull();
		expect(googlePicture('https://a.b.googleusercontent.com/a')).not.toBeNull();
		expect(googlePicture('https://LH3.GOOGLEUSERCONTENT.COM/a')).not.toBeNull();
		expect(googlePicture('https://lh3.googleusercontent.com/a?sz=64')).not.toBeNull();
	});
	it('rejects spoofed or non-HTTPS sources', () => {
		for (const url of [
			'http://lh3.googleusercontent.com/a',
			'https://googleusercontent.com.evil.test/a',
			'https://evil.test/a',
			'https://user@lh3.googleusercontent.com/a',
			'https://lh3.googleusercontent.com:8443/a',
			'javascript:alert(1)',
			'file:///etc/passwd',
			'https:///a',
			''
		]) {
			expect(googlePicture(url)).toBeNull();
		}
	});
});

describe('loopback gate', () => {
	it('admits only loopback hosts', () => {
		expect(hostIsLoopback('localhost:8787')).toBe(true);
		expect(hostIsLoopback('127.0.0.1:8787')).toBe(true);
		expect(hostIsLoopback('[::1]:8787')).toBe(true);
		expect(hostIsLoopback('example.com')).toBe(false);
		expect(hostIsLoopback('pockettrail.workers.dev')).toBe(false);
		expect(hostIsLoopback('localhost.example.com')).toBe(false);
	});
});
