import { describe, expect, it } from 'vitest';

import { extractMentions, mentionNameMap, resolveMentions } from '#lib/mentions.ts';
import { renderMarkdown } from '#lib/markdown.ts';
import { mentionRecipients } from '#lib/server/txns_notify.ts';

describe('mention extraction', () => {
	it('matches handles and skips emails', () => {
		expect(extractMentions('cc @Bob and @alice_c, email bob@x.com')).toEqual(['bob', 'alice_c']);
		expect(extractMentions('mail bob@example.test')).toEqual([]);
		expect(extractMentions('@alice@again')).toEqual(['alice']);
		expect(extractMentions('no one')).toEqual([]);
	});
});

describe('mention resolution', () => {
	it('resolves exact membership references only among eligible candidates', () => {
		const member = { id: 802, handle: 'github:12345', name: 'Mochamad Suhri Ardiansyah' };
		const body = '@{m:802} @{M:802} @{m:999} @{m:0802} x@{m:803} @alice';
		const tokens = extractMentions(body);
		expect(tokens).toEqual(['{m:802}', '{m:999}', 'alice']);
		expect(resolveMentions(tokens, [[member.handle, member.id]])).toEqual([802]);
		expect(mentionRecipients(`${body} @${member.name}`, [member, { id: 803, handle: 'other', name: 'Other' }])).toEqual([802]);
		expect(mentionRecipients('@{m:802}', [])).toEqual([]);
		expect(renderMarkdown(body, mentionNameMap([member]))).toContain('data-handle="{m:802}">@Mochamad Suhri Ardiansyah</span>');
	});
	it('maps known handles to membership ids only', () => {
		const members: Array<[string, number]> = [
			['alice', 1],
			['bob', 2]
		];
		expect(resolveMentions(['alice', 'ghost'], members)).toEqual([1]);
	});
});
