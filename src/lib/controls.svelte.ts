// Shared by the custom controls (Select, Combobox, DatePicker, TimeField,
// Checkbox).
//
// Progressive enhancement: the server renders a native control that posts the
// same field, so every form works without JavaScript. Once the page has
// hydrated, `enhanced.on` flips and the bits-ui control replaces it, bound to
// the same state, so JavaScript users never see a native select, date or time.
import type { Attachment } from 'svelte/attachments';

export const enhanced = $state({ on: false });

/** Attach to a hidden sentinel inside a control: runs `reset` when the
 * enclosing form is reset (after a successful create, for instance), because a
 * native `form.reset()` cannot reach state held by a custom control. */
export function onFormReset(reset: () => void): Attachment<HTMLElement> {
	return (node) => {
		const form = node.closest('form');
		form?.addEventListener('reset', reset);
		return () => form?.removeEventListener('reset', reset);
	};
}
