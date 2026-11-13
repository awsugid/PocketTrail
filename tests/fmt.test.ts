import { describe, expect, it } from 'vitest';

import { fmtMoney, fmtSize, fmtTs, parseMinor, parseRupiah, rupiahInput, validDate, validTime } from '$lib/fmt';

describe('money formatting', () => {
	it('formats the UI contract exactly', () => {
		expect(fmtMoney(1_500_000_000)).toBe('Rp 15.000.000');
		expect(fmtMoney(-150_000_000)).toBe('-Rp 1.500.000');
		expect(fmtMoney(5)).toBe('Rp 0,05');
		expect(fmtMoney(50)).toBe('Rp 0,50');
		expect(fmtMoney(0)).toBe('Rp 0');
	});
});

describe('timestamps', () => {
	it('renders Jakarta +07:00 with day rollover', () => {
		expect(fmtTs(1_748_736_000_000)).toBe('2025-06-01 07:00');
		expect(fmtTs(1_748_712_600_000)).toBe('2025-06-01 00:30');
	});
});

describe('sizes', () => {
	it('formats bounded sizes', () => {
		expect(fmtSize(0)).toBe('0 B');
		expect(fmtSize(12)).toBe('12 B');
		expect(fmtSize(3584)).toBe('3.5 KB');
		expect(fmtSize(2_202_010)).toBe('2.1 MB');
		expect(fmtSize(-5)).toBe('0 B');
	});
});

describe('amount parsing', () => {
	it('parses strict minor integers', () => {
		expect(parseMinor('1500000000')).toBe(1_500_000_000);
		expect(parseMinor(' -42 ')).toBe(-42);
		expect(parseMinor('1,000')).toBeNull();
		expect(parseMinor('12a')).toBeNull();
		expect(parseMinor('')).toBeNull();
		expect(parseMinor('9007199254740993')).toBeNull();
		expect(parseMinor('-9007199254740993')).toBeNull();
	});
	it('parses exact rupiah without floats', () => {
		expect(parseRupiah('15000000')).toBe(1_500_000_000);
		expect(parseRupiah('120000.05')).toBe(12_000_005);
		expect(parseRupiah('0.1')).toBe(10);
		expect(parseRupiah('1e3')).toBeNull();
		expect(parseRupiah('1,000')).toBeNull();
		expect(parseRupiah('1.001')).toBeNull();
		expect(rupiahInput(12_000_005)).toBe('120000.05');
	});
});

describe('dates and times', () => {
	it('validates real calendar dates', () => {
		expect(validDate('2025-06-01')).toBe(true);
		expect(validDate('2025-6-1')).toBe(false);
		expect(validDate('2025/06/01')).toBe(false);
		expect(validDate('2025-02-29')).toBe(false);
		expect(validDate('2024-02-29')).toBe(true);
		expect(validDate('2025-13-01')).toBe(false);
		expect(validDate('2025-04-31')).toBe(false);
	});
	it('validates HH:MM loosely', () => {
		expect(validTime('09:05')).toBe(true);
		expect(validTime('24:00')).toBe(false);
		expect(validTime('9:05')).toBe(false);
	});
});
