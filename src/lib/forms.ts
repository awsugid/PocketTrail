// Progressive form behaviour shared by every page. Without JavaScript each
// form is an ordinary POST; with it, `use:submit` (form actions) and
// `use:guard` (plain endpoints) add one coherent rule:
// - an optional inline two-step confirmation for destructive actions;
// - a pending state (aria-busy form, disabled submitter);
// - a redirect is followed in place, keeping scroll position;
// - a rejection renders inline in a focused alert and keeps what was typed,
//   instead of replacing the page with the error screen.
import { applyAction, enhance } from '$app/forms';
import { goto } from '$app/navigation';

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
 * Two-step confirmation in place: the destructive button is swapped for
 * "message [Confirm] [Cancel]". Focus moves to Confirm; Escape or Cancel
 * restores the button and its focus; a prompt left alone for ~5s reverts, but
 * never while focus is inside it. Interaction restarts the wait.
 */
function askConfirm(form: HTMLFormElement, trigger: HTMLElement | null, message: string, label = 'Confirm'): Promise<boolean> {
	const anchor = trigger ?? form.querySelector<HTMLElement>('button[type=submit], button:not([type])');
	if (!anchor) return Promise.resolve(true);
	return new Promise((resolve) => {
		const box = document.createElement('span');
		box.className = 'confirm';
		box.setAttribute('role', 'group');
		const text = document.createElement('span');
		text.className = 'confirm__text';
		text.id = `confirm-${++confirmCount}`;
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
		box.append(text, yes, no);

		let timer: ReturnType<typeof setTimeout>;
		const done = (ok: boolean, refocus: boolean) => {
			clearTimeout(timer);
			box.remove();
			anchor.hidden = false;
			if (refocus) anchor.focus();
			resolve(ok);
		};
		const arm = () => {
			clearTimeout(timer);
			timer = setTimeout(() => (box.contains(document.activeElement) ? arm() : done(false, false)), 5000);
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

		anchor.hidden = true;
		anchor.after(box);
		yes.focus();
		arm();
	});
}

/** Shows `message` in the form's alert, focuses it and scrolls it into view.
 * `field` (when the server names it) is marked invalid and described by it. */
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
	const control = field ? form.elements.namedItem(field) : null;
	if (control instanceof HTMLElement) {
		control.setAttribute('aria-invalid', 'true');
		control.setAttribute('aria-describedby', slot.id);
	}
	slot.scrollIntoView({ block: 'nearest' });
	slot.focus({ preventScroll: true });
}

function clearError(form: HTMLFormElement) {
	form.querySelector(':scope > .form-error')?.remove();
	for (const control of form.querySelectorAll('[aria-invalid]')) {
		control.removeAttribute('aria-invalid');
		control.removeAttribute('aria-describedby');
	}
}

const submitterOf = (submitter: HTMLElement | null) => (submitter instanceof HTMLButtonElement ? submitter : null);

/** `use:submit` for SvelteKit form actions on the same page. */
export function submit(form: HTMLFormElement, options: SubmitOptions = {}) {
	let current = options;
	const handle = enhance(form, async ({ cancel, submitter }) => {
		if (form.getAttribute('aria-busy') === 'true') {
			cancel();
			return;
		}
		if (current.confirm && !(await askConfirm(form, submitter, current.confirm, current.confirmLabel))) {
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
				await goto(result.location, { invalidateAll: true, noScroll: true, keepFocus: true });
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
		if (current.confirm && !(await askConfirm(form, button, current.confirm, current.confirmLabel))) return;
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
				await goto(response.url, { invalidateAll: true, noScroll: true, keepFocus: true });
			} else {
				const body = (await response.json().catch(() => null)) as { message?: string } | null;
				showError(form, body?.message ?? 'Not saved.');
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

/** `use:unsavedGuard` warns before leaving a form with typed-in values. It is
 * in-memory only (financial drafts are never persisted) and clears when the
 * form is reset, which `use:submit={{ reset: true }}` does after a success. Combine with `use:submit` on the same form. */
export function unsavedGuard(form: HTMLFormElement) {
	let dirty = false;
	const mark = () => (dirty = true);
	const clear = () => (dirty = false);
	const warn = (event: BeforeUnloadEvent) => {
		if (dirty) event.preventDefault();
	};
	form.addEventListener('input', mark);
	form.addEventListener('change', mark);
	form.addEventListener('reset', clear);
	window.addEventListener('beforeunload', warn);
	return {
		destroy() {
			form.removeEventListener('input', mark);
			form.removeEventListener('change', mark);
			form.removeEventListener('reset', clear);
			window.removeEventListener('beforeunload', warn);
		}
	};
}
