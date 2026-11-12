import { describe, expect, it } from 'vitest';

import { stockApplied, stockUpdateInput } from '$lib/server/inventory';

describe('stock input validation', () => {
	it('accepts whole deltas and trims the reason', () => {
		expect(stockUpdateInput('5', 'sold')).toEqual({ delta: 5, reason: 'sold' });
		expect(stockUpdateInput(' -2 ', ' x ')).toEqual({ delta: -2, reason: 'x' });
		// parseMinor accepts an optional '-' only; a leading '+' is not a
		// whole-number form value.
		expect(stockUpdateInput('+3', 'r')).toHaveProperty('error');
	});
	it('rejects zero, non-numeric, and over-cap deltas', () => {
		const rejected = [stockUpdateInput('0', 'r'), stockUpdateInput('', 'r'), stockUpdateInput('abc', 'r'), stockUpdateInput('99999999999999999999', 'r'), stockUpdateInput('1000000000000001', 'r')];
		for (const result of rejected) expect(result).toHaveProperty('error');
	});
	it('requires a nonblank reason', () => {
		expect(stockUpdateInput('5', '')).toEqual({ error: 'Reason is required for stock changes.' });
		expect(stockUpdateInput('5', '   ')).toEqual({ error: 'Reason is required for stock changes.' });
		expect(stockUpdateInput(null, 'r')).toHaveProperty('error');
	});
	it('statement-2 changes of exactly 1 means applied', () => {
		expect(stockApplied(1)).toBe(true);
		expect(stockApplied(0)).toBe(false);
		expect(stockApplied(null)).toBe(false);
		expect(stockApplied(undefined)).toBe(false);
	});
});
