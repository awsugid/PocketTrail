export type Status = 'needs_details' | 'pending_review' | 'approved' | 'changes_requested';
export const statuses = [
	{ value: 'needs_action', label: 'Needs your action' }, { value: '', label: 'All' },
	{ value: 'needs_details', label: 'Needs details' }, { value: 'pending_review', label: 'Pending review' },
	{ value: 'approved', label: 'Approved' }, { value: 'changes_requested', label: 'Changes requested' }
];

export function filterHref(url: URL, key: string, value: string, toggle = false): string {
	const params = new URLSearchParams(url.search);
	params.delete('page');
	const values = params.getAll(key);
	params.delete(key);
	if (toggle) {
		for (const item of values.filter(item => item !== value)) params.append(key, item);
		if (!values.includes(value)) params.append(key, value);
	} else if (value) params.set(key, value);
	const query = params.toString();
	return url.pathname + (query ? `?${query}` : '');
}

export function pageNumbers(page: number, count: number): (number | 'ellipsis')[] {
	const visible = count <= 7 ? Array.from({ length: count }, (_, i) => i + 1) : [...new Set([1, page - 1, page, page + 1, count].filter(n => n >= 1 && n <= count))].sort((a, b) => a - b);
	return visible.flatMap((n, i) => i && n - (visible[i - 1] ?? n) > 1 ? ['ellipsis' as const, n] : [n]);
}

export function ledgerDate(date: string): string {
	const parsed = new Date(`${date}T00:00:00Z`);
	return Number.isNaN(parsed.getTime()) ? date : new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(parsed);
}
