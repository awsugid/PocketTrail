// Native <details> menus: close on Escape (focus returns to the trigger), on a
// press outside, when focus leaves, and after a link or button inside is used.
export function menu(node: HTMLDetailsElement) {
	const close = (restoreFocus: boolean) => {
		if (!node.open) return;
		node.open = false;
		if (restoreFocus) node.querySelector('summary')?.focus();
	};
	const onKey = (event: KeyboardEvent) => {
		if (event.key === 'Escape') close(true);
	};
	const onPress = (event: PointerEvent) => {
		if (!node.contains(event.target as Node)) close(false);
	};
	const onClick = (event: MouseEvent) => {
		if ((event.target as Element).closest('a, button')) close(false);
	};
	const onFocusOut = (event: FocusEvent) => {
		const next = event.relatedTarget as Node | null;
		if (next && !node.contains(next)) close(false);
	};
	node.addEventListener('keydown', onKey);
	node.addEventListener('focusout', onFocusOut);
	node.addEventListener('click', onClick);
	document.addEventListener('pointerdown', onPress);
	return {
		destroy() {
			node.removeEventListener('keydown', onKey);
			node.removeEventListener('focusout', onFocusOut);
			node.removeEventListener('click', onClick);
			document.removeEventListener('pointerdown', onPress);
		}
	};
}
