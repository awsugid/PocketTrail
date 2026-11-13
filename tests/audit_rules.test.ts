import { describe, expect, it } from 'vitest';

import {
	actionLabel,
	authOwned,
	classify,
	normalizeTarget,
	observe,
	orgSlug,
	outcomeLabel,
	pageNumber,
	pageOffset,
	successOwned,
	targetLabel
} from '$lib/server/audit_rules';

describe('observe', () => {
	it('records intent for mutations and downloads', () => {
		expect(observe('/org/acme/settings', true)).toEqual({ action: 'http.post', intent: true });
		expect(observe('/login/google', true)).toEqual({ action: 'http.post', intent: true });
		expect(observe('/org/acme/documents/7', false)).toEqual({ action: 'document.download', intent: true });
		expect(observe('/org/acme/documents/7', true)).toEqual({ action: 'http.post', intent: true });
	});
	it('watches private pages only', () => {
		expect(observe('/org/acme/transactions', false)).toEqual({ action: 'http.get', intent: false });
		expect(observe('/platform', false)).toEqual({ action: 'http.get', intent: false });
		expect(observe('/platform/users/admin', false)).toEqual({ action: 'http.get', intent: false });
	});
	it('ignores public paths', () => {
		expect(observe('/orgs', false)).toBeNull();
		expect(observe('/login', false)).toBeNull();
		expect(observe('/healthz', false)).toBeNull();
		expect(observe('/', false)).toBeNull();
		expect(observe('/invitations/abc/accept', false)).toBeNull();
		expect(observe('/org', false)).toBeNull();
	});
	it('extracts the org slug', () => {
		expect(orgSlug('/org/acme/transactions')).toBe('acme');
		expect(orgSlug('/org/acme')).toBe('acme');
		expect(orgSlug('/org/')).toBeNull();
		expect(orgSlug('/platform')).toBeNull();
	});
});

const ROUTES: Array<[string, string]> = [
	['/login/dev', '/login/dev'],
	['/login/google', '/login/google'],
	['/logout', '/logout'],
	['/orgs', '/orgs'],
	['/platform', '/platform'],
	['/platform/users/admin', '/platform/users/admin'],
	['/platform/role-templates', '/platform/role-templates'],
	['/invitations/accept', '/invitations/accept'],
	['/org/acme/transactions', '/org/:org/transactions'],
	['/org/acme/transactions/5', '/org/:org/transactions/5'],
	['/org/acme/transactions/5/details', '/org/:org/transactions/5/details'],
	['/org/acme/transactions/5/submit', '/org/:org/transactions/5/submit'],
	['/org/acme/transactions/5/approve', '/org/:org/transactions/5/approve'],
	['/org/acme/transactions/5/request-changes', '/org/:org/transactions/5/request-changes'],
	['/org/acme/transactions/5/comments', '/org/:org/transactions/5/comments'],
	['/org/acme/transactions/5/documents', '/org/:org/transactions/5/documents'],
	['/org/acme/transactions/5/suppress', '/org/:org/transactions/5/suppress'],
	['/org/acme/transactions/5/unsuppress', '/org/:org/transactions/5/unsuppress'],
	['/org/acme/documents/7', '/org/:org/documents/7'],
	['/org/acme/imports', '/org/:org/imports'],
	['/org/acme/imports/9', '/org/:org/imports/9'],
	['/org/acme/imports/9/confirm', '/org/:org/imports/9/confirm'],
	['/org/acme/inventory', '/org/:org/inventory'],
	['/org/acme/inventory/items', '/org/:org/inventory/items'],
	['/org/acme/inventory/locations', '/org/:org/inventory/locations'],
	['/org/acme/inventory/stock', '/org/:org/inventory/stock'],
	['/org/acme/inventory/items/3', '/org/:org/inventory/items/3'],
	['/org/acme/settings', '/org/:org/settings'],
	['/org/acme/settings/mappings', '/org/:org/settings/mappings'],
	['/org/acme/settings/pockets', '/org/:org/settings/pockets'],
	['/org/acme/settings/pockets/3/owner', '/org/:org/settings/pockets/3/owner'],
	['/org/acme/settings/income-role', '/org/:org/settings/income-role'],
	['/org/acme/settings/members', '/org/:org/settings/members'],
	['/org/acme/settings/members/3/role', '/org/:org/settings/members/3/role'],
	['/org/acme/settings/members/3/remove', '/org/:org/settings/members/3/remove'],
	['/org/acme/settings/members/3/restore', '/org/:org/settings/members/3/restore'],
	['/org/acme/settings/roles', '/org/:org/settings/roles'],
	['/org/acme/settings/roles/4', '/org/:org/settings/roles/4'],
	['/org/acme/settings/notifications', '/org/:org/settings/notifications'],
	['/org/acme/settings/role-templates', '/org/:org/settings/role-templates'],
	['/org/acme/settings/invitations', '/org/:org/settings/invitations'],
	['/org/acme/settings/invitations/abc123/revoke', '/org/:org/settings/invitations/:invitation/revoke'],
	['/org/acme/settings/invitations/abc123/resend', '/org/:org/settings/invitations/:invitation/resend'],
	['/org/acme/settings/mappings/6/delete', '/org/:org/settings/mappings/6/delete'],
	['/org/acme/notifications/digest', '/org/:org/notifications/digest']
];

describe('normalizeTarget', () => {
	it('normalizes every registered route bounded', () => {
		for (const [route, target] of ROUTES) {
			expect(normalizeTarget(route), route).toBe(target);
		}
	});

	it('keeps invitation ids opaque', () => {
		expect(normalizeTarget('/invitations/secret-token/accept')).toBe('/invitations/accept');
	});

	it('rejects hostile dynamic segments', () => {
		for (const path of [
			'/org/acme/transactions/SECRET/details',
			'/org/acme/documents/not-a-number',
			'/org/acme/imports/9e9/confirm',
			'/org/acme/settings/members/abc/role',
			'/org/acme/settings/invitations/-1/revoke',
			'/org/acme/settings/invitations/not-hex-token/revoke',
			'/org/acme/settings/mappings/1.5/delete',
			'/org/acme/inventory/items/99999999999999999999',
			'/org/acme/transactions/%20/details'
		]) {
			expect(normalizeTarget(path)).toBe('/unrecognized');
		}
		expect(normalizeTarget('/org/SECRET/settings')).toBe('/org/:org/settings');
		expect(normalizeTarget('/org/../settings')).toBe('/org/:org/settings');
		const redacted = normalizeTarget('/org/some-long-slug-from-a-link/transactions/5');
		expect(redacted).toBe('/org/:org/transactions/5');
		expect(redacted).not.toContain('some-long-slug');
	});

	it('never persists arbitrary paths verbatim', () => {
		for (const path of [
			'/org/acme/transactions/5/accept?ticket=opaque-abc123',
			'/deep/link/with/opaque-token-9f8e7d',
			'/org/acme/settings/mappings/5/unknown-verb',
			'/org/acme/unknown-resource',
			'/org/acme/settings/invitations/5/forward',
			'/platform/unknown',
			'/login/other',
			'/password-reset/8f3b2c',
			'/org/acme/settings/',
			'',
			'/',
			'/org/acme/transactions/5/details/extra'
		]) {
			expect(normalizeTarget(path)).toBe('/unrecognized');
		}
		expect(authOwned(normalizeTarget('/login/dev'))).toBe(true);
		expect(successOwned(normalizeTarget('/org/acme/settings/members'))).toBe(true);
		expect(successOwned('/unrecognized')).toBe(false);
		expect(authOwned('/unrecognized')).toBe(false);
		expect(classify(normalizeTarget('/deep/link/opaque-token'), 'http.post', true, false, 404)).toBe('failed');
	});
});

describe('classify', () => {
	const post = 'http.post';
	it('watched pages record only explicit denials', () => {
		expect(classify('/org/acme/transactions', 'http.get', false, true, 403)).toBe('denied');
		expect(classify('/org/acme/transactions', 'http.get', false, false, 401)).toBe('denied');
		expect(classify('/org/acme/transactions', 'http.get', false, false, 303)).toBeNull();
		expect(classify('/org/acme/transactions', 'http.get', false, true, 200)).toBeNull();
	});
	it('intents classify denied/failed/committed', () => {
		expect(classify('/org/acme/settings', post, true, true, 403)).toBe('denied');
		expect(classify('/org/acme/settings', post, true, false, 303)).toBe('denied');
		expect(classify('/invitations/accept', post, true, false, 303)).toBe('denied');
		expect(classify('/org/acme/settings', post, true, true, 400)).toBe('failed');
		expect(classify('/org/acme/settings', post, true, true, 500)).toBe('failed');
		expect(classify('/invitations/accept', post, true, true, 303)).toBeNull();
		expect(classify('/org/acme/settings', post, true, true, 303)).toBeNull();
		expect(classify('/login/google', post, true, false, 303)).toBeNull();
		expect(classify('/logout', post, true, false, 303)).toBeNull();
	});
	it('downloads record outcome', () => {
		expect(classify('/org/acme/documents/7', 'document.download', true, true, 200)).toBe('committed');
		expect(classify('/org/acme/documents/7', 'document.download', true, false, 303)).toBe('denied');
		expect(classify('/org/acme/documents/7', 'document.download', true, true, 404)).toBe('failed');
	});
	it('success registry matches handler ownership', () => {
		expect(successOwned('/orgs')).toBe(true);
		expect(authOwned('/login/dev')).toBe(true);
		expect(successOwned('/org/acme/transactions/5/approve')).toBe(true);
		expect(successOwned('/org/acme/transactions/5/comments')).toBe(true);
		expect(successOwned('/org/acme/imports')).toBe(true);
		expect(successOwned('/org/acme/imports/9/confirm')).toBe(true);
		expect(successOwned('/org/acme/inventory/stock')).toBe(true);
		expect(successOwned('/org/acme/settings/members')).toBe(true);
		expect(successOwned('/invitations/accept')).toBe(true);
		expect(successOwned('/platform/users/admin')).toBe(true);
		expect(successOwned('/platform/role-templates')).toBe(true);
		expect(successOwned('/org/acme/settings/role-templates')).toBe(true);
		expect(successOwned('/org/acme/documents/7')).toBe(false);
		expect(successOwned('/org/acme/notifications/digest')).toBe(false);
	});
});

describe('labels', () => {
	it('hide route syntax and bank labels', () => {
		expect(targetLabel('/org/:org/transactions/29/approve')).toBe('Transaction #29 · approve');
		expect(targetLabel('/org/:org/settings/members/3/remove')).toBe('Member #3 · remove');
		expect(targetLabel('Treasurer')).toBe('Treasurer');
		expect(targetLabel('transaction:3')).toBe('Transaction #3');
		expect(targetLabel('import_batch:3')).toBe('Import batch #3');
		expect(actionLabel('documentation_submitted')).toBe('Submitted for review');
		expect(targetLabel('item:1 location:1 delta:-2')).toBe('Item 1 · Location 1 · change -2');
		expect(targetLabel('membership:bob')).toBe('Member @bob');
		expect(outcomeLabel('attempt')).toBe('Attempted');
		expect(actionLabel('transaction.notifications_suppressed')).toBe('Transaction notifications suppressed');
		expect(actionLabel('member.removed')).toBe('Member removed');
		expect(actionLabel('custom.code')).toBe('custom.code');
	});
});

describe('pagination bounds', () => {
	it('clamps to page 1', () => {
		expect(pageNumber(null)).toBe(1);
		expect(pageNumber('0')).toBe(1);
		expect(pageNumber('junk')).toBe(1);
		expect(pageNumber('3')).toBe(3);
		expect(pageOffset(1)).toBe(0);
		expect(pageOffset(2)).toBe(50);
	});
});
