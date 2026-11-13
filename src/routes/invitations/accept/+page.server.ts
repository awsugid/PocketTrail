import { error } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

import { bindings } from '$lib/server/auth';
import {
	acceptByLink,
	pendingFor,
	tokenTarget,
	viewerOf
} from '$lib/server/invitations';
import { nowMs } from '$lib/server/db';

// GET /invitations/accept?token=... — the emailed-link page. Viewing needs no
// login; accepting requires a verified Google sign-in whose email matches.
// The token never appears in logs, audit rows, or redirects.

export const load: PageServerLoad = async (event) => {
	const token = event.url.searchParams.get('token') ?? '';
	if (token === '') throw error(404, 'This invitation link is not valid.');
	const db = bindings(event.platform).DB;
	const now = nowMs();
	const target = await tokenTarget(db, token, now);
	if (!target) throw error(404, 'This invitation link is no longer valid.');
	const invitation = await pendingFor(db, target.invitationId, now);
	if (!invitation) throw error(404, 'This invitation link is no longer valid.');
	return {
		invitation,
		token,
		viewer: await viewerOf(event)
	};
};

export const actions: Actions = {
	accept: async (event) => {
		const form = await event.request.formData();
		return acceptByLink(event, form);
	}
};