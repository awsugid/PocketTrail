// Progressive form behaviour shared by every page. Without JavaScript each
// form is an ordinary POST; with it, `use:submit` (form actions) and
// `use:guard` (plain endpoints) add one coherent rule:
// - an optional inline two-step confirmation for destructive actions;
// - a pending state (aria-busy form, disabled submitter);
// - a redirect is followed in place, keeping scroll position;
// - a rejection renders inline in a focused alert and keeps what was typed,
//   instead of replacing the page with the error screen.
import { applyAction, enhance } from '$app/forms';
import { beforeNavigate, goto } from '$app/navigation';

export interface SubmitOptions {
	/** Short consequence, asked inline before posting: "Revoke Alice? Access ends now." */
	confirm?: string;
	/** Label of the confirming button, e.g. "Revoke". */
	confirmLabel?: string;
	/** Clear the fields after a successful create. */
	reset?: boolean;
}

let confirmCount = 0;

/**
 * Two-step confirmation: the destructive button is held in place (hidden, but
 * keeping its width, so siblings do not move) and "message [Confirm] [Cancel]"
 * opens on its own line below it, in the same row. Focus moves to Cancel, the
 * safe choice; Escape or Cancel restores the button and its focus; a prompt
 * left alone for ~5s reverts, but never while focus is inside it. Interaction
 * restarts the wait.
 */
function askConfirm(form: HTMLFormElement, trigger: HTMLElement | null, message: string, label = 'Confirm'): Promise<boolean> {
	const anchor = trigger ?? form.querySelector<HTMLElement>('button[type=submit], button:not([type])');
	if (!anchor) return Promise.resolve(true);
	return new Promise((resolve) => {
		const box = document.createElement('div');
		box.className = 'confirm';
		box.setAttribute('role', 'group');
		const text = document.createElement('span');
		text.className = 'confirm__text';
		text.id = `confirm-${++confirmCount}`;
		text.setAttribute('role', 'status');
		text.setAttribute('aria-live', 'polite');
		text.textContent = message;
		box.setAttribute('aria-labelledby', text.id);
		const yes = document.createElement('button');
		yes.type = 'button';
		yes.className = 'btn btn--sm btn--danger btn--solid';
		yes.textContent = label;
		const no = document.createElement('button');
		no.type = 'button';
		no.className = 'btn btn--sm';
		no.textContent = 'Cancel';
		box.append(text, no, yes);

		let timer: ReturnType<typeof setTimeout>;
		const done = (ok: boolean, refocus: boolean) => {
			clearTimeout(timer);
			box.remove();
			anchor.style.visibility = '';
			if (refocus) anchor.focus();
			resolve(ok);
		};
		const arm = () => {
			clearTimeout(timer);
			timer = setTimeout(() => box.contains(document.activeElement) ? arm() : done(false, false), 5000);
		};
		yes.addEventListener('click', () => done(true, false));
		no.addEventListener('click', () => done(false, true));
		box.addEventListener('keydown', (event) => {
			if (event.key !== 'Escape') return arm();
			event.stopPropagation();
			done(false, true);
		});
		box.addEventListener('pointermove', arm);
		box.addEventListener('pointerdown', arm);

		anchor.style.visibility = 'hidden';
		(form.closest('li') ?? form).append(box);
		no.focus();
		arm();
	});
}

/** The control a person sees for a named field: the Select, DatePicker or
 * Combobox trigger carries `data-field`; otherwise the named element itself. */
function controlFor(form: HTMLFormElement, field: string): HTMLElement | null {
	const visible = Array.from(form.querySelectorAll<HTMLElement>('[data-field]')).find((node) => node.dataset.field === field);
	if (visible) return visible;
	const named = form.elements.namedItem(field);
	return named instanceof HTMLElement ? named : null;
}

/** Adds or removes one id in a space-separated token list attribute. */
function toggleToken(element: HTMLElement, attribute: string, token: string, on: boolean) {
	const tokens = new Set((element.getAttribute(attribute) ?? '').split(/\s+/).filter(Boolean));
	if (on) tokens.add(token);
	else tokens.delete(token);
	if (tokens.size > 0) element.setAttribute(attribute, [...tokens].join(' '));
	else element.removeAttribute(attribute);
}

/** Shows `message` in the form's alert, focuses it and scrolls it into view.
 * `field` (when the server names it) is marked invalid and described by it,
 * alongside whatever hints already describe it. */
function showError(form: HTMLFormElement, message: string, field?: string) {
	let slot = form.querySelector<HTMLElement>(':scope > .form-error');
	if (!slot) {
		slot = document.createElement('p');
		slot.className = 'form-error';
		slot.id = `form-error-${++confirmCount}`;
		slot.tabIndex = -1;
		slot.setAttribute('role', 'alert');
		const actions = form.querySelector(':scope > .form-actions');
		if (actions) actions.before(slot);
		else form.append(slot);
	}
	slot.textContent = message;
	const control = field ? controlFor(form, field) : null;
	if (control) {
		control.setAttribute('aria-invalid', 'true');
		toggleToken(control, 'aria-describedby', slot.id, true);
	}
	slot.scrollIntoView({ block: 'nearest' });
	slot.focus({ preventScroll: true });
	form.dispatchEvent(new CustomEvent('formerror'));
}

function clearError(form: HTMLFormElement) {
	const slot = form.querySelector<HTMLElement>(':scope > .form-error');
	for (const control of form.querySelectorAll<HTMLElement>('[aria-invalid]')) {
		control.removeAttribute('aria-invalid');
		if (slot) toggleToken(control, 'aria-describedby', slot.id, false);
	}
	slot?.remove();
}

const submitterOf = (submitter: HTMLElement | null) => submitter instanceof HTMLButtonElement ? submitter : null;

/** `use:submit` for SvelteKit form actions on the same page. */
export function submit(form: HTMLFormElement, options: SubmitOptions = {}) {
	let current = options;
	const handle = enhance(form, async ({ cancel, submitter }) => {
		if (form.getAttribute('aria-busy') === 'true') {
			cancel();
			return;
		}
		if (current.confirm && !await askConfirm(form, submitter, current.confirm, current.confirmLabel)) {
			cancel();
			return;
		}
		clearError(form);
		form.setAttribute('aria-busy', 'true');
		const button = submitterOf(submitter);
		if (button) button.disabled = true;
		return async ({ result, update }) => {
			form.removeAttribute('aria-busy');
			if (button) button.disabled = false;
			if (result.type === 'redirect') {
				if (current.reset) form.reset();
				await goto(result.location, { refreshAll: true, reset: false });
			} else if (result.type === 'error') {
				const status = result.status ?? 500;
				if (status >= 500) return applyAction(result);
				showError(form, (result.error as { message?: string } | undefined)?.message ?? 'Not saved.');
			} else if (result.type === 'failure') {
				const data = result.data as { message?: unknown; field?: unknown } | undefined;
				showError(form, String(data?.message ?? 'Not saved.'), typeof data?.field === 'string' ? data.field : undefined);
			} else {
				await update({ reset: current.reset ?? false });
			}
		};
	});
	return {
		update(next: SubmitOptions = {}) {
			current = next;
		},
		destroy: handle.destroy
	};
}

/** `use:guard` for plain POSTs to endpoints (no form action). It posts with
 * fetch so a rejection can be shown inline exactly like `submit` does, and
 * follows the endpoint's redirect in place. Without JavaScript the browser
 * posts the form directly. */
export function guard(form: HTMLFormElement, options: SubmitOptions = {}) {
	let current = options;
	async function onsubmit(event: SubmitEvent) {
		event.preventDefault();
		if (form.getAttribute('aria-busy') === 'true') return;
		const button = submitterOf(event.submitter);
		if (current.confirm && !await askConfirm(form, button, current.confirm, current.confirmLabel)) return;
		clearError(form);
		form.setAttribute('aria-busy', 'true');
		if (button) button.disabled = true;
		try {
			const response = await fetch(form.action, {
				method: 'POST',
				body: new FormData(form, button),
				headers: { accept: 'application/json' }
			});
			if (response.ok) {
				if (current.reset) form.reset();
				await goto(response.url, { refreshAll: true, reset: false });
			} else {
				const body = await response.json().catch(() => null) as { message?: unknown; field?: unknown } | null;
				showError(form, String(body?.message ?? 'Not saved.'), typeof body?.field === 'string' ? body.field : undefined);
			}
		} catch {
			showError(form, 'Could not reach the server. Nothing was saved.');
		} finally {
			form.removeAttribute('aria-busy');
			if (button) button.disabled = false;
		}
	}
	form.addEventListener('submit', onsubmit);
	return {
		update(next: SubmitOptions = {}) {
			current = next;
		},
		destroy() {
			form.removeEventListener('submit', onsubmit);
		}
	};
}

// Forms with typed-in, unsent values. `LeaveGuard` (mounted once, in the root
// layout) consults this on in-app navigation; `beforeunload` covers leaving the
// site. Memory only: financial drafts are never stored.
const dirtyForms = new Map<HTMLFormElement, (leave: () => void) => void>();

/** Called once from the root layout: an in-app navigation away from a dirty
 * form is held and the form shows an inline "Keep editing / Leave" choice. */
export function leaveGuard() {
	beforeNavigate((navigation) => {
		if (navigation.shallow && navigation.type === 'goto') return;
		if (!navigation.to || navigation.willUnload || navigation.type === 'leave') return;
		const [form, prompt] = [...dirtyForms].find(([node]) => node.isConnected) ?? [];
		if (!form || !prompt) return;
		const target = navigation.to.url;
		navigation.cancel();
		prompt(() => {
			dirtyForms.delete(form);
			void goto(target);
		});
	});
}

/** `use:unsavedGuard` warns before a form with typed-in values is left: by
 * closing the tab (`beforeunload`) or by an in-app link (inline choice). It
 * clears on reset and when the form is submitted, and returns when a rejected
 * submit leaves the typed values on screen. Combine with `use:submit`. */
export function unsavedGuard(form: HTMLFormElement) {
	let dirty = false;
	let bar: HTMLElement | null = null;
	const closeBar = () => {
		bar?.remove();
		bar = null;
	};
	const set = (value: boolean) => {
		dirty = value;
		if (value) dirtyForms.set(form, prompt);
		else {
			dirtyForms.delete(form);
			closeBar();
		}
	};
	function prompt(leave: () => void) {
		closeBar();
		const box = document.createElement('div');
		box.className = 'confirm confirm--leave';
		box.setAttribute('role', 'group');
		const text = document.createElement('span');
		text.className = 'confirm__text';
		text.id = `leave-${++confirmCount}`;
		text.setAttribute('role', 'status');
		text.setAttribute('aria-live', 'polite');
		text.textContent = 'Unsaved changes will be lost.';
		box.setAttribute('aria-labelledby', text.id);
		const keep = document.createElement('button');
		keep.type = 'button';
		keep.className = 'btn btn--sm';
		keep.textContent = 'Keep editing';
		const go = document.createElement('button');
		go.type = 'button';
		go.className = 'btn btn--sm btn--danger btn--solid';
		go.textContent = 'Leave';
		box.append(text, keep, go);
		keep.addEventListener('click', () => {
			closeBar();
			form.querySelector<HTMLElement>('input, textarea, button')?.focus();
		});
		go.addEventListener('click', leave);
		box.addEventListener('keydown', (event) => {
			if (event.key === 'Escape') keep.click();
		});
		bar = box;
		form.append(box);
		box.scrollIntoView({ block: 'nearest' });
		keep.focus();
	}
	const mark = () => set(true);
	const clear = () => set(false);
	const warn = (event: BeforeUnloadEvent) => {
		if (dirty) event.preventDefault();
	};
	form.addEventListener('input', mark);
	form.addEventListener('change', mark);
	form.addEventListener('formerror', mark);
	form.addEventListener('reset', clear);
	form.addEventListener('submit', clear);
	window.addEventListener('beforeunload', warn);
	return {
		destroy() {
			dirtyForms.delete(form);
			form.removeEventListener('input', mark);
			form.removeEventListener('change', mark);
			form.removeEventListener('formerror', mark);
			form.removeEventListener('reset', clear);
			form.removeEventListener('submit', clear);
			window.removeEventListener('beforeunload', warn);
		}
	};
}
