import { describe, expect, it } from 'vitest';
import {
	aggregatePurposeStatuses,
	allocationExact,
	allocationRemainder,
	effectiveResponsibles,
	mayApprovePurpose,
	purposeKindOf,
	purposeReady,
	validateAllocations
} from '../src/lib/purposes';

describe('purpose kinds', () => {
	it('are fixed by the direction of money', () => {
		expect(purposeKindOf(15000)).toBe('income');
		expect(purposeKindOf(-1)).toBe('expense');
	});
});

describe('purpose documentation gate', () => {
	it('expense needs evidence or Notes; income needs Notes', () => {
		expect(purposeReady('expense', '', 0)).toBe(false);
		expect(purposeReady('expense', 'Team dinner receipts missing', 0)).toBe(true);
		expect(purposeReady('expense', '', 2)).toBe(true);
		expect(purposeReady('income', '   ', 5)).toBe(false);
		expect(purposeReady('income', 'Ticket sales', 0)).toBe(true);
	});
});

describe('allocation validation', () => {
	const row = (purposeId: number, amountMinor: number, responsibleMembershipId: number | null = null) => ({
		purposeId,
		amountMinor,
		responsibleMembershipId
	});

	it('allows drafts: empty or partial', () => {
		expect(validateAllocations(10000, [])).toBeNull();
		expect(validateAllocations(10000, [row(1, 4000)])).toBeNull();
	});

	it('rejects overallocation against the bank magnitude', () => {
		expect(validateAllocations(10000, [row(1, 6000), row(2, 5000)])).toMatch(/exceed the bank amount/);
	});

	it('accepts an exact allocation', () => {
		expect(validateAllocations(10000, [row(1, 6000), row(2, 4000)])).toBeNull();
	});

	it('rejects duplicates, nonpositive amounts, and bad ids', () => {
		expect(validateAllocations(10000, [row(1, 1000), row(1, 2000)])).toMatch(/once per transaction/);
		expect(validateAllocations(10000, [row(1, 0)])).toMatch(/positive IDR/);
		expect(validateAllocations(10000, [row(NaN, 100)])).toMatch(/invalid/);
		expect(validateAllocations(10000, [row(-1, 100)])).toBeNull(); // pre-create sentinel for a new purpose
	});
});

describe('allocation totals', () => {
	it('remainder is visible and exactness gates submission', () => {
		expect(allocationRemainder(10_000_000, [9_000_000, 1_000_000])).toBe(0);
		expect(allocationExact(10_000_000, [9_000_000, 1_000_000])).toBe(true);
		expect(allocationRemainder(10_000_000, [9_000_000])).toBe(1_000_000);
		expect(allocationExact(10_000_000, [9_000_000])).toBe(false);
		expect(allocationExact(10_000_000, [])).toBe(false);
	});
});

describe('effective responsibility', () => {
	it('override wins, then purpose members, then the transaction member', () => {
		expect(effectiveResponsibles(7, [1, 2], 3)).toEqual([7]);
		expect(effectiveResponsibles(null, [1, 2], 3)).toEqual([1, 2]);
		expect(effectiveResponsibles(null, [], 3)).toEqual([3]);
		expect(effectiveResponsibles(null, [], null)).toEqual([]);
	});
});

describe('approval exclusion', () => {
	it('denies current and historical responsibles only', () => {
		expect(mayApprovePurpose([1], [2], 3)).toBe(true);
		expect(mayApprovePurpose([1], [2], 1)).toBe(false);
		expect(mayApprovePurpose([], [9], 9)).toBe(false);
	});
});

describe('aggregate purpose statuses', () => {
	it('approves only when every purpose is approved', () => {
		expect(aggregatePurposeStatuses(['approved', 'approved']).label).toBe('Approved');
		expect(aggregatePurposeStatuses(['approved', 'submitted']).label).toBe('Pending review');
		expect(aggregatePurposeStatuses(['approved', 'changes_requested']).label).toBe('Changes requested');
		expect(aggregatePurposeStatuses(['pending', 'submitted']).label).toBe('Pending review');
		expect(aggregatePurposeStatuses(['pending']).label).toBe('Needs details');
		expect(aggregatePurposeStatuses([]).label).toBe('Unallocated');
	});
});
