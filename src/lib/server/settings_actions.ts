// Shared plumbing for the focused settings routes. Each route re-checks its own
// permission and verifies the session-bound CSRF token before reading the form.

import type { RequestEvent } from '@sveltejs/kit';
import { requireMember, verifiedForm } from './auth';
import type { Permission } from './permissions';
import type { SettingsCtx } from './settings';

export async function settingsForm(
	event: RequestEvent,
	permission: Permission,
	section: string
): Promise<{ ctx: SettingsCtx; form: FormData }> {
	const member = await requireMember(event, event.params.slug as string, permission);
	const form = await verifiedForm(event, member.session);
	return {
		ctx: {
			db: member.db,
			user: member.user,
			org: member.org,
			memberRows: member.memberRows,
			secret: member.config.secret,
			section
		},
		form
	};
}

/** Row ids arrive as form fields (page actions have no sub-path params). */
export function intField(form: FormData, name: string): number {
	const raw = form.get(name);
	const value = typeof raw === 'string' ? Number(raw) : NaN;
	return Number.isSafeInteger(value) && /^[0-9]{1,15}$/.test(raw as string) ? value : 0;
}
