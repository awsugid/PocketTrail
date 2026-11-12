import { describe, expect, it } from 'vitest';

import { DIGEST_WEEK_MS, digestBody, digestDue, shouldNotify } from '$lib/notify_rules';

describe('notification gates', () => {
	it('blocks everything when the org disables notifications', () => {
		expect(shouldNotify('mention', false, false, true, null, null)).toBe(false);
	});
	it('suppression blocks all kinds for the transaction', () => {
		expect(shouldNotify('mention', true, true, true, null, null)).toBe(false);
		expect(shouldNotify('assignment', true, true, true, '2025-06-01', null)).toBe(false);
	});
	it('removed members get nothing', () => {
		expect(shouldNotify('digest', true, false, false, '2025-06-01', null)).toBe(false);
	});
	it('cutoff excludes older items for reminders but not mentions', () => {
		expect(shouldNotify('assignment', true, false, true, '2024-12-31', '2025-01-01')).toBe(false);
		expect(shouldNotify('assignment', true, false, true, '2025-01-01', '2025-01-01')).toBe(true);
		expect(shouldNotify('mention', true, false, true, '2020-01-01', '2025-01-01')).toBe(true);
		expect(shouldNotify('digest', true, false, true, '2020-01-01', null)).toBe(true);
	});
});

describe('digest cadence and body', () => {
	it('one week between digests', () => {
		expect(digestDue(null, 1_000)).toBe(true);
		expect(digestDue(900, 900 + DIGEST_WEEK_MS - 1)).toBe(false);
		expect(digestDue(900, 900 + DIGEST_WEEK_MS)).toBe(true);
	});
	it('carries links only, never financial facts', () => {
		const body = digestBody('Org', 'org', [{ txnId: 7 }]);
		expect(body).toContain('/org/org/transactions/7');
		expect(body).toContain('1 item(s)');
		expect(body).not.toContain('Rp');
	});
});
