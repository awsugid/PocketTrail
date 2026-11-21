import { expect, test } from 'vitest';
import { filterHref, pageNumbers, ledgerDate } from '../src/lib/components/list/helpers';

test('filter changes preserve repeated fields and reset pagination', () => {
	const url = new URL('https://example.test/org/demo/transactions?tag=1&tag=2&responsible=4&page=3&q=food');
	const toggled = new URL(filterHref(url, 'tag', '1', true), url);
	expect(toggled.searchParams.getAll('tag')).toEqual(['2']);
	expect(toggled.searchParams.get('responsible')).toBe('4');
	expect(toggled.searchParams.has('page')).toBe(false);
	expect(new URL(filterHref(url, 'status', 'approved'), url).searchParams.getAll('tag')).toEqual(['1', '2']);
	expect(new URL(filterHref(url, 'tag', '3', true), url).searchParams.getAll('tag')).toEqual(['1', '2', '3']);
});

test('action status and ordinary statuses replace one another', () => {
 const url = new URL('https://example.test/org/demo/transactions?status=needs_action&page=4&tag=1');
 const approved = new URL(filterHref(url, 'status', 'approved'), url);
 expect(approved.searchParams.getAll('status')).toEqual(['approved']);
 expect(approved.searchParams.has('page')).toBe(false);
 expect(new URL(filterHref(approved, 'status', 'needs_action'), url).searchParams.getAll('status')).toEqual(['needs_action']);
});

test('pagination includes boundaries and gaps without enumerating every page', () => {
	expect(pageNumbers(1, 1)).toEqual([1]);
	expect(pageNumbers(4, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
	expect(pageNumbers(50, 100)).toEqual([1, 'ellipsis', 49, 50, 51, 'ellipsis', 100]);
	expect(pageNumbers(1, 1000000)).toEqual([1, 2, 'ellipsis', 1000000]);
	expect(ledgerDate('2026-11-08')).toBe('Sunday, 8 Nov 2026');
});
