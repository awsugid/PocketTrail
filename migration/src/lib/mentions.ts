// @mention extraction and resolution, ported from src/mentions.rs.
//
// Extract @handle tokens: `@` followed by [a-z0-9._-]+, lowercased, deduped,
// in first-appearance order. An email address is never a mention (the `@`
// must not follow a handle character).

export function extractMentions(body: string): string[] {
	const out: string[] = [];
	const lower = body.toLowerCase();
	let i = 0;
	while (i < lower.length) {
		if (lower[i] === '@' && (i === 0 || !isHandleChar(lower[i - 1]))) {
			const start = i + 1;
			let end = start;
			while (end < lower.length && isHandleChar(lower[end])) end += 1;
			if (end > start) {
				const handle = lower.slice(start, end);
				if (!out.includes(handle)) out.push(handle);
			}
			i = end;
		} else {
			i += 1;
		}
	}
	return out;
}

function isHandleChar(ch: string | undefined): boolean {
	return ch !== undefined && ((ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9') || ch === '.' || ch === '_' || ch === '-');
}

/** Map extracted handles to membership IDs of ACTIVE members, excluding the
 * author. Caller passes (lowercased handle, membership_id) pairs. */
export function resolveMentions(mentions: readonly string[], members: ReadonlyArray<[string, number]>): number[] {
	return members
		.filter(([handle]) => mentions.includes(handle))
		.map(([, id]) => id);
}