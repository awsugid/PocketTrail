// Pure formatting helpers, ported from src/fmt.rs.
//
// Money is exact: integer minor units (100 minor = 1 IDR), never floats.
// Amounts from users or the database must stay under MAX_SAFE_MINOR so every
// value survives the D1 number round-trip losslessly.

/** Matches MAX_SAFE_MINOR in src/fmt.rs. */
export const MAX_SAFE_MINOR = 9_000_000_000_000_000;

/** Format minor units per the UI contract: `Rp 15.000.000`; nonzero fractions
 * render as `,xx` (lossless). */
export function fmtMoney(minor: number): string {
	const neg = minor < 0;
	const abs = Math.abs(minor);
	const whole = Math.trunc(abs / 100);
	const frac = abs % 100;
	const digits = String(whole);
	let grouped = '';
	for (let i = 0; i < digits.length; i += 1) {
		if (i > 0 && (digits.length - i) % 3 === 0) grouped += '.';
		grouped += digits[i];
	}
	const sign = neg ? '-' : '';
	return frac === 0 ? `${sign}Rp ${grouped}` : `${sign}Rp ${grouped},${String(frac).padStart(2, '0')}`;
}

/** Epoch milliseconds -> "YYYY-MM-DD HH:MM" in UTC+7 (Jakarta, no DST). */
export function fmtTs(ms: number): string {
	const secs = Math.floor(ms / 1000) + 7 * 3600;
	const days = Math.floor(secs / 86_400);
	const rem = ((secs % 86_400) + 86_400) % 86_400;
	const [y, m, d] = civilFromDays(days);
	const pad = (value: number, width = 2) => String(value).padStart(width, '0');
	return `${pad(y, 4)}-${pad(m)}-${pad(d)} ${pad(Math.floor(rem / 3600))}:${pad(Math.floor((rem % 3600) / 60))}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** ISO `YYYY-MM-DD` -> "1 Jan 2025", the one date format shown to people. */
export function fmtDate(iso: string): string {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
	return match ? `${Number(match[3])} ${MONTHS[Number(match[2]) - 1] ?? ''} ${match[1]}` : iso;
}

/** Like `fmtTs`, but an unset (epoch or earlier) time is "—", never 1970. */
export function fmtTsOrDash(ms: number): string {
	return ms > 0 ? fmtTs(ms) : '—';
}

/** Days since 1970-01-01 -> [year, month, day]. Howard Hinnant's algorithm. */
function civilFromDays(zRaw: number): [number, number, number] {
	const z = zRaw + 719_468;
	const era = Math.floor(z / 146_097);
	const doe = z - era * 146_097;
	const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146_096)) / 365);
	const y = yoe + era * 400;
	const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
	const mp = Math.floor((5 * doy + 2) / 153);
	const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
	const m = mp < 10 ? mp + 3 : mp - 9;
	return [m <= 2 ? y + 1 : y, m, d];
}

/** Strict integer parser for form amounts (minor units): optional leading `-`,
 * digits only, magnitude under 9e15. */
export function parseMinor(s: string): number | null {
	const t = s.trim();
	if (t === '' || t.length > 17) return null;
	const neg = t.startsWith('-');
	const digits = neg ? t.slice(1) : t;
	if (digits === '' || !/^\d+$/.test(digits)) return null;
	const value = Number(digits);
	if (!Number.isSafeInteger(value) || value > MAX_SAFE_MINOR) return null;
	return neg ? -value : value;
}

/** Form-facing IDR amount to exact integer minor units; no floating point.
 * English number inputs use a decimal point and no grouping separators. */
export function parseRupiah(s: string): number | null {
	const text = s.trim();
	const negative = text.startsWith('-');
	const digits = negative ? text.slice(1) : text;
	const pieces = digits.split('.');
	const whole = pieces[0];
	if (whole === undefined || whole === '' || !/^\d+$/.test(whole)) return null;
	const fraction = pieces[1] ?? '';
	if (pieces.length > 2 || fraction.length > 2 || !/^\d*$/.test(fraction)) return null;
	const wholeValue = Number(whole);
	if (!Number.isSafeInteger(wholeValue)) return null;
	const cents = fraction === '' ? 0 : fraction.length === 1 ? Number(fraction) * 10 : Number(fraction);
	const value = wholeValue * 100 + cents;
	if (value > MAX_SAFE_MINOR) return null;
	return negative ? -value : value;
}

/** Editable form value for stored minor units. */
export function rupiahInput(minor: number): string {
	const sign = minor < 0 ? '-' : '';
	const value = Math.abs(minor);
	return value % 100 === 0 ? `${sign}${value / 100}` : `${sign}${Math.trunc(value / 100)}.${String(value % 100).padStart(2, '0')}`;
}

/** Validate an actual calendar date in YYYY-MM-DD form. */
export function validDate(s: string): boolean {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
	const year = Number(s.slice(0, 4));
	const month = Number(s.slice(5, 7));
	const day = Number(s.slice(8));
	if (year <= 0) return false;
	const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
	let days: number;
	switch (month) {
		case 1: case 3: case 5: case 7: case 8: case 10: case 12: days = 31; break;
		case 4: case 6: case 9: case 11: days = 30; break;
		case 2: days = leap ? 29 : 28; break;
		default: return false;
	}
	return day >= 1 && day <= days;
}

/** Validate HH:MM loosely. */
export function validTime(s: string): boolean {
	if (!/^\d\d:\d\d$/.test(s)) return false;
	const h = Number(s.slice(0, 2));
	const m = Number(s.slice(3));
	return h <= 23 && m <= 59;
}

/** Human-readable file size: "12 B", "3.5 KB", "2.1 MB", "1.0 GB". */
export function fmtSize(bytes: number): string {
	const b = Math.max(0, bytes);
	if (b < 1024) return `${b} B`;
	if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
	if (b < 1024 * 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1)} MB`;
	return `${(b / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}