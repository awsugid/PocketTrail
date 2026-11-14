// Progressive form behaviour shared by every page. Without JavaScript each
// form is an ordinary POST; with it, `use:submit` adds:
// - an optional native <dialog> confirmation for destructive actions;
// - a pending state (aria-busy form, disabled submitter);
// - redirects followed in place, keeping scroll position;
// - server rejections shown inline, keeping what the user typed, instead of
//   replacing the page with the error screen.
import { applyAction, enhance } from '$app/forms';
import { goto } from '$app/navigation';

export interface SubmitOptions {
	/** Consequence sentence; when set, the user confirms before posting. */
	confirm?: string;
	/** Label of the confirming button, e.g. "Revoke access". */
	confirmLabel?: string;
	/** Clear the fields after a successful create. */
	reset?: boolean;
}

let dialog: HTMLDialogElement | null = null;

/** Native modal confirmation. Escape and the cancel button resolve false. */
export function confirmDialog(message: string, confirmLabel = 'Confirm'): Promise<boolean> {
	if (!dialog) {
		dialog = document.createElement('dialog');
		dialog.className = 'pt-dialog pt-dialog--confirm';
		dialog.setAttribute('aria-labelledby', 'pt-dialog-message');
		dialog.innerHTML =
			'<form method="dialog"><p class="pt-dialog__message" id="pt-dialog-message"></p><div class="form-actions">' +
			'<button class="btn" value="cancel" autofocus>Cancel</button>' +
			'<button class="btn btn--danger btn--solid" value="ok"></button></div></form>';
		// A click on the backdrop (outside the dialog box) cancels.
		dialog.addEventListener('click', (event) => {
			if (event.target === dialog) dialog?.close('cancel');
		});
		document.body.append(dialog);
	}
	const box = dialog;
	box.querySelector('.pt-dialog__message')!.textContent = message;
	box.querySelector('button[value=ok]')!.textContent = confirmLabel;
	box.returnValue = '';
	box.showModal();
	return new Promise((resolve) => {
		box.addEventListener('close', () => resolve(box.returnValue === 'ok'), { once: true });
	});
}

function showError(form: HTMLFormElement, message: string) {
	let slot = form.querySelector<HTMLElement>(':scope > .form-error');
	if (!slot) {
		slot = document.createElement('p');
		slot.className = 'form-error';
		slot.setAttribute('role', 'alert');
		form.append(slot);
	}
	slot.textContent = message;
}

function clearError(form: HTMLFormElement) {
	form.querySelector(':scope > .form-error')?.remove();
}

/** `use:submit` for SvelteKit form actions on the same page. */
export function submit(form: HTMLFormElement, options: SubmitOptions = {}) {
	let current = options;
	const handle = enhance(form, async ({ cancel, submitter }) => {
		if (form.getAttribute('aria-busy') === 'true') {
			cancel();
			return;
		}
		if (current.confirm && !(await confirmDialog(current.confirm, current.confirmLabel))) {
			cancel();
			return;
		}
		clearError(form);
		form.setAttribute('aria-busy', 'true');
		const button = submitter instanceof HTMLButtonElement ? submitter : null;
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
				showError(form, String((result.data as { message?: unknown } | undefined)?.message ?? 'Not saved.'));
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

/** `use:guard` for plain POSTs to endpoints (no form action): confirmation
 * and pending state only; the browser performs the navigation. */
export function guard(form: HTMLFormElement, options: SubmitOptions = {}) {
	let current = options;
	let confirmed = false;
	async function onsubmit(event: SubmitEvent) {
		if (form.getAttribute('aria-busy') === 'true') {
			event.preventDefault();
			return;
		}
		if (confirmed || !current.confirm) {
			form.setAttribute('aria-busy', 'true');
			return;
		}
		event.preventDefault();
		if (await confirmDialog(current.confirm, current.confirmLabel)) {
			confirmed = true;
			form.requestSubmit(event.submitter as HTMLElement | null);
		}
	}
	// A page restored from the back/forward cache must not stay "busy".
	const onshow = () => {
		confirmed = false;
		form.removeAttribute('aria-busy');
	};
	form.addEventListener('submit', onsubmit);
	window.addEventListener('pageshow', onshow);
	return {
		update(next: SubmitOptions = {}) {
			current = next;
		},
		destroy() {
			form.removeEventListener('submit', onsubmit);
			window.removeEventListener('pageshow', onshow);
		}
	};
}
