// Money helpers, ported from src/fmt.rs and shared by server and browser.
//
// Amounts are integer minor units with 100 minor units per IDR. Nothing in this
// module uses floating point arithmetic: IDR values are only split into
// whole/frac with integer division, and every value crossing this boundary is
// checked against MAX_SAFE_MINOR first.

/** Largest magnitude accepted anywhere; matches MAX_SAFE_MINOR in src/fmt.rs
 * and stays inside Number.MAX_SAFE_INTEGER (9_007_199_254_740_991). */
export const MAX_SAFE_MINOR = 9_000_000_000_000_000;

/** True when `value` is an integer the rest of the code can treat exactly. */
export function isSafeMinor(value: number): boolean {
	return Number.isSafeInteger(value) && Math.abs(value) <= MAX_SAFE_MINOR;
}

/** Fail closed instead of rendering a lossy amount. */
export function assertSafeMinor(value: number, where: string): number {
	if (!isSafeMinor(value)) {
		throw new Error(`${where}: amount ${String(value)} is outside the exact money range`);
	}
	return value;
}

/** `Rp 15.000.000` / `-Rp 1.250,50`: dot grouping, comma fractions when the
 * amount is not a whole rupiah, sign before the currency. */
export function fmtMoney(minor: number): string {
	assertSafeMinor(minor, 'fmtMoney');
	const negative = minor < 0;
	const abs = Math.abs(minor);
	const whole = Math.floor(abs / 100);
	const frac = abs % 100;
	const digits = String(whole);
	let grouped = '';
	for (let i = 0; i < digits.length; i += 1) {
		if (i > 0 && (digits.length - i) % 3 === 0) grouped += '.';
		grouped += digits[i];
	}
	const sign = negative ? '-' : '';
	return frac === 0
		? `${sign}Rp ${grouped}`
		: `${sign}Rp ${grouped},${String(frac).padStart(2, '0')}`;
}

/** Strict integer parser for minor-unit form fields: optional leading `-`,
 * digits only, within MAX_SAFE_MINOR. */
export function parseMinor(input: string): number | null {
	const text = input.trim();
	if (text === '' || text.length > 17) return null;
	const negative = text.startsWith('-');
	const digits = negative ? text.slice(1) : text;
	if (digits === '' || !/^[0-9]+$/.test(digits)) return null;
	const value = Number(digits);
	if (!Number.isSafeInteger(value) || value > MAX_SAFE_MINOR) return null;
	return negative ? -value : value;
}

/** Form-facing IDR amount to exact minor units. English number inputs use a
 * decimal point and no grouping separators; more than two fraction digits is
 * rejected rather than rounded. */
export function parseRupiah(input: string): number | null {
	const text = input.trim();
	const negative = text.startsWith('-');
	const digits = negative ? text.slice(1) : text;
	const pieces = digits.split('.');
	const whole = pieces[0] ?? '';
	if (whole === '' || !/^[0-9]+$/.test(whole)) return null;
	if (pieces.length > 2) return null;
	const fraction = pieces[1] ?? '';
	if (fraction.length > 2 || !/^[0-9]*$/.test(fraction)) return null;
	const wholeValue = Number(whole);
	if (!Number.isSafeInteger(wholeValue)) return null;
	const cents = fraction.length === 0 ? 0 : Number(fraction.padEnd(2, '0'));
	const value = wholeValue * 100 + cents;
	if (!Number.isSafeInteger(value) || value > MAX_SAFE_MINOR) return null;
	return negative ? -value : value;
}

/** Minor units back to an editable input value. */
export function rupiahInput(minor: number): string {
	assertSafeMinor(minor, 'rupiahInput');
	const sign = minor < 0 ? '-' : '';
	const value = Math.abs(minor);
	if (value % 100 === 0) return `${sign}${value / 100}`;
	return `${sign}${Math.floor(value / 100)}.${String(value % 100).padStart(2, '0')}`;
}
