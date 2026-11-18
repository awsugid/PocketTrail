import { describe, expect, it } from 'vitest';
import { isInternalMovement, isPlaceholderUser, labelMatches, mapCounterparty, memActive, memJoined, type MappingRow, type MemRow } from '../src/lib/server/rows';

const mapping = (id: number, pattern: string, membership_id: number, pocket_id = 1) =>
	({ id, org_id: 1, pocket_id, pattern, membership_id }) as unknown as MappingRow;

describe('mapping labels', () => {
	it('match the full statement label or the displayed name', () => {
		expect(labelMatches('AZMI FAIZ HABIBI / Jago 102707966843', 'AZMI FAIZ HABIBI / Jago 102707966843')).toBe(true);
		expect(labelMatches(' azmi faiz habibi ', 'AZMI FAIZ HABIBI / Jago 102707966843')).toBe(true);
		expect(labelMatches('MOCHAMAD SUHRI / AINUR RIFKY', 'MOCHAMAD SUHRI / AINUR RIFKY / Jago 105470370612')).toBe(true);
		expect(labelMatches('MOCHAMAD SUHRI', 'MOCHAMAD SUHRI / AINUR RIFKY / Jago 105470370612')).toBe(false);
		expect(labelMatches('', 'Anything')).toBe(false);
	});

	it('prefer an exact full-label mapping over a display-name one', () => {
		const rows = [mapping(1, 'Vendor', 7), mapping(2, 'Vendor / Jago 123', 8), mapping(3, 'Vendor', 9, 2)];
		expect(mapCounterparty(rows, 1, 'Vendor / Jago 123')?.membership_id).toBe(8);
		expect(mapCounterparty(rows, 1, 'Vendor / Jago 999')?.membership_id).toBe(7);
		expect(mapCounterparty(rows, 2, 'Vendor / Jago 999')?.membership_id).toBe(9);
		expect(mapCounterparty(rows, 1, 'Other')).toBeNull();
	});
});

describe('internal pocket movements', () => {
	it('are recognised by Jago transaction type', () => {
		expect(isInternalMovement('Pocket Money Out')).toBe(true);
		expect(isInternalMovement(' movement between pockets ')).toBe(true);
		expect(isInternalMovement('Outgoing Transfer')).toBe(false);
	});
});

describe('invited members', () => {
	const mem = (removed_at: number | null, invited: number) => ({ removed_at, invited }) as MemRow;
	it('are assignable but not joined', () => {
		expect(memActive(mem(null, 1))).toBe(true);
		expect(memJoined(mem(null, 1))).toBe(false);
		expect(memJoined(mem(null, 0))).toBe(true);
		expect(memActive(mem(5, 0))).toBe(false);
	});
	it('placeholder users are only unclaimed invite: rows', () => {
		expect(isPlaceholderUser({ id: 'invite:abc', google_sub: null })).toBe(true);
		expect(isPlaceholderUser({ id: 'invite:abc', google_sub: '123' })).toBe(false);
		expect(isPlaceholderUser({ id: 'g:123', google_sub: null })).toBe(false);
	});
});
