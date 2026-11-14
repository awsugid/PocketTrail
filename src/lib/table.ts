// Below 640px `table.ledger.stack` is laid out with `display: block`, which
// makes some assistive technology drop the table semantics. Restore them
// explicitly so rows and cells stay navigable.
const roles: Record<string, string> = {
	TABLE: 'table',
	THEAD: 'rowgroup',
	TBODY: 'rowgroup',
	TR: 'row',
	TH: 'columnheader',
	TD: 'cell'
};

export function stack(table: HTMLTableElement) {
	const apply = () => {
		for (const element of [table, ...table.querySelectorAll('thead, tbody, tr, th, td')]) {
			const role = roles[element.tagName];
			if (role && !element.hasAttribute('role')) element.setAttribute('role', role);
		}
	};
	apply();
	const observer = new MutationObserver(apply);
	observer.observe(table, { childList: true, subtree: true });
	return { destroy: () => observer.disconnect() };
}
