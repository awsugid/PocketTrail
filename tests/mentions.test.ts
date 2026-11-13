import { describe, expect, it } from 'vitest';

import { extractMentions, resolveMentions } from '$lib/mentions';

describe('mention extraction', () => {
	it('matches handles and skips emails', () => {
		expect(extractMentions('cc @Bob and @alice_c, email bob@x.com')).toEqual(['bob', 'alice_c']);
		expect(extractMentions('mail bob@example.test')).toEqual([]);
		expect(extractMentions('@alice@again')).toEqual(['alice']);
		expect(extractMentions('no one')).toEqual([]);
	});
});

describe('mention resolution', () => {
	it('maps known handles to membership ids only', () => {
		const members: Array<[string, number]> = [
			['alice', 1],
			['bob', 2]
		];
		expect(resolveMentions(['alice', 'ghost'], members)).toEqual([1]);
	});
});
