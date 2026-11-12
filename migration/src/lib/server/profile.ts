// Profile data guards, ported from src/profile.rs.

/** Only Google's HTTPS image hosts may supply account avatars. */
export function googlePicture(value: string): string | null {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		return null;
	}
	const host = url.hostname.toLowerCase();
	const ok =
		url.protocol === 'https:' &&
		url.username === '' &&
		url.password === '' &&
		url.port === '' &&
		(host === 'googleusercontent.com' || host.endsWith('.googleusercontent.com'));
	return ok ? url.toString() : null;
}

/** Conservative mailbox validation; no display names or SMTP command
 * characters. */
export function validEmail(value: string): boolean {
	const at = value.lastIndexOf('@');
	if (at < 0) return false;
	const local = value.slice(0, at);
	const domain = value.slice(at + 1);
	return (
		value.length <= 254 &&
		local.length > 0 &&
		local.length <= 64 &&
		local.split('').every((c) => {
			const code = c.charCodeAt(0);
			return (
				(code >= 97 && code <= 122) ||
				(code >= 65 && code <= 90) ||
				(code >= 48 && code <= 57) ||
				'.!#$%&\'*+-/=?^_`{|}~'.includes(c)
			);
		}) &&
		!local.startsWith('.') &&
		!local.endsWith('.') &&
		!local.includes('..') &&
		domain.includes('.') &&
		domain.split('.').every((part) => {
			if (part === '' || part.startsWith('-') || part.endsWith('-')) return false;
			return part.split('').every((c) => {
				const code = c.charCodeAt(0);
				return (code >= 97 && code <= 122) || (code >= 65 && code <= 90) || (code >= 48 && code <= 57) || c === '-';
			});
		})
	);
}