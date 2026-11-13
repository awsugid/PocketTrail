import { describe, expect, it } from 'vitest';
import {
	MAX_SAFE_MINOR,
	assertSafeMinor,
	fmtMoney,
	isSafeMinor,
	parseMinor,
	parseRupiah,
	rupiahInput
} from '../src/lib/money';
import { counterpartyDisplay, needsDetails, parseFilter, parsePage, statusLabel } from '../src/lib/server/ledger';

describe('money formatting', () => {
	it('groups rupiah with dots and 100 minor units per IDR', () => {
		expect(fmtMoney(0)).toBe('Rp 0');
		expect(fmtMoney(100)).toBe('Rp 1');
		expect(fmtMoney(150_000_000)).toBe('Rp 1.500.000');
		expect(fmtMoney(-150_000_000)).toBe('-Rp 1.500.000');
		expect(fmtMoney(850_000_000)).toBe('Rp 8.500.000');
	});

	it('renders nonzero fractions losslessly', () => {
		expect(fmtMoney(50)).toBe('Rp 0,50');
		expect(fmtMoney(125_050)).toBe('Rp 1.250,50');
		expect(fmtMoney(-1)).toBe('-Rp 0,01');
	});

	it('refuses amounts outside the exact range', () => {
		expect(() => fmtMoney(Number.MAX_SAFE_INTEGER)).toThrow(/exact money range/);
		expect(() => fmtMoney(Number.NaN)).toThrow(/exact money range/);
		expect(isSafeMinor(MAX_SAFE_MINOR)).toBe(true);
		expect(isSafeMinor(MAX_SAFE_MINOR + 1)).toBe(false);
		expect(assertSafeMinor(MAX_SAFE_MINOR, 'test')).toBe(MAX_SAFE_MINOR);
	});
});

describe('rupiah input parsing', () => {
	it('converts whole rupiah to exact minor units', () => {
		expect(parseRupiah('1500000')).toBe(150_000_000);
		expect(parseRupiah('0')).toBe(0);
		expect(parseRupiah('-2.5')).toBe(-250);
	});

	it('accepts at most two fraction digits', () => {
		expect(parseRupiah('1.5')).toBe(150);
		expect(parseRupiah('1.05')).toBe(105);
		expect(parseRupiah('1.234')).toBeNull();
	});

	it('rejects grouping separators, signs in the wrong place and junk', () => {
		expect(parseRupiah('1.234.567')).toBeNull();
		expect(parseRupiah('1,5')).toBeNull();
		expect(parseRupiah('')).toBeNull();
		expect(parseRupiah('abc')).toBeNull();
		expect(parseRupiah('.5')).toBeNull();
		expect(parseRupiah('1 000')).toBeNull();
	});

	it('rejects amounts above MAX_SAFE_MINOR', () => {
		expect(parseRupiah('90000000000000')).toBe(MAX_SAFE_MINOR);
		expect(parseRupiah('90000000000001')).toBeNull();
	});

	it('round-trips through rupiahInput', () => {
		expect(rupiahInput(150_000_000)).toBe('1500000');
		expect(rupiahInput(125_050)).toBe('1250.50');
		expect(rupiahInput(-250)).toBe('-2.50');
		expect(fmtMoney(parseRupiah(rupiahInput(125_050))!)).toBe('Rp 1.250,50');
	});
});

describe('minor-unit parsing', () => {
	it('accepts signed integers only', () => {
		expect(parseMinor('150000000')).toBe(150_000_000);
		expect(parseMinor('-150000000')).toBe(-150_000_000);
		expect(parseMinor('1.5')).toBeNull();
		expect(parseMinor('1e5')).toBeNull();
		expect(parseMinor('--1')).toBeNull();
	});
});

describe('counterparty display', () => {
	it('splits a Jago account suffix', () => {
		expect(counterpartyDisplay('Demo Venue / Jago 123456789')).toEqual({
			name: 'Demo Venue',
			bankAccount: '123456789'
		});
	});

	it('keeps labels that are not a Jago account suffix intact', () => {
		expect(counterpartyDisplay('Demo Coffee Supplier')).toEqual({
			name: 'Demo Coffee Supplier',
			bankAccount: null
		});
		expect(counterpartyDisplay('Demo Venue / Jago abc')).toEqual({
			name: 'Demo Venue / Jago abc',
			bankAccount: null
		});
		expect(counterpartyDisplay(' / Jago 123')).toEqual({
			name: ' / Jago 123',
			bankAccount: null
		});
	});
});

describe('documentation owed', () => {
	it('income needs member-authored notes only', () => {
		expect(needsDetails(25_000_000, '', 0, '', 'pending')).toBe(true);
		expect(needsDetails(25_000_000, 'Venue deposit refund', 0, '', 'pending')).toBe(false);
	});

	it('expenses need notes plus evidence or a stated reason', () => {
		expect(needsDetails(-15_000, 'Coffee', 1, '', 'pending')).toBe(false);
		expect(needsDetails(-15_000, 'Coffee', 0, 'Supplier had no receipt', 'pending')).toBe(false);
		expect(needsDetails(-15_000, 'Coffee', 0, '', 'pending')).toBe(true);
		expect(needsDetails(-15_000, '', 1, '', 'pending')).toBe(true);
	});

	it('approval closes the obligation and requested changes reopen it', () => {
		expect(needsDetails(-15_000, '', 0, '', 'approved')).toBe(false);
		expect(needsDetails(-15_000, 'Coffee', 1, '', 'approved')).toBe(false);
		expect(needsDetails(-15_000, 'Coffee', 1, '', 'changes_requested')).toBe(true);
	});

	it('labels the persisted statuses the way the workspace does', () => {
		expect(statusLabel('pending', true)).toBe('Needs details');
		expect(statusLabel('pending', false)).toBe('Pending review');
		expect(statusLabel('approved', false)).toBe('Approved');
		expect(statusLabel('changes_requested', true)).toBe('Changes requested');
	});
});

describe('ledger query parameters', () => {
	it('accepts only the filters the UI offers', () => {
		expect(parseFilter('needs_details')).toBe('needs_details');
		expect(parseFilter('pending')).toBe('pending');
		expect(parseFilter('approved')).toBe('approved');
		expect(parseFilter('changes_requested')).toBe('changes_requested');
		expect(parseFilter('injected')).toBeNull();
		expect(parseFilter('all')).toBeNull();
		expect(parseFilter(null)).toBeNull();
	});

	it('clamps pagination to safe values', () => {
		expect(parsePage(null)).toBe(1);
		expect(parsePage('3')).toBe(3);
		expect(parsePage('0')).toBe(1);
		expect(parsePage('-2')).toBe(1);
		expect(parsePage('1e6')).toBe(1);
		expect(parsePage('99999999')).toBe(1);
	});
});
