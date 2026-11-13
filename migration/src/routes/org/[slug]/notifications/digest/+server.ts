import type { RequestHandler } from './$types';

import { requireMember } from '$lib/server/auth';
import { sendDigest, type SettingsCtx } from '$lib/server/settings';

// POST /org/:slug/notifications/digest — the weekly digest capture, kept at
// its own path so the audit trail records the same target as the Rust app.
export const POST: RequestHandler = async (event) => {
	const ctx = await requireMember(event, event.params.slug, 'ManageNotifications');
	const settingsCtx: SettingsCtx = {
		db: ctx.db,
		user: ctx.user,
		org: ctx.org,
		memberRows: ctx.memberRows,
		secret: ctx.config.secret
	};
	return sendDigest(settingsCtx);
};