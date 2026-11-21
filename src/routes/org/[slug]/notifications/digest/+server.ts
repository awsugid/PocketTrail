import type { RequestHandler } from './$types';

import { requireMember, verifiedForm } from '#lib/server/auth.ts';
import { sendDigest, type SettingsCtx } from '#lib/server/settings.ts';
import { scheduleDelivery } from '#lib/server/notification_mail.ts';

// POST /org/:slug/notifications/digest — the weekly digest (queued, then
// emailed when EMAIL_DELIVERY_ENABLED), kept at
// its own path so the audit trail records the same target as the Rust app.
export const POST: RequestHandler = async (event) => {
	const ctx = await requireMember(event, event.params.slug, 'ManageNotifications');
	await verifiedForm(event, ctx.session);
	const settingsCtx: SettingsCtx = {
		db: ctx.db,
		user: ctx.user,
		org: ctx.org,
		memberRows: ctx.memberRows,
		secret: ctx.config.secret,
		deliverMail: () => scheduleDelivery(event, ctx.db, ctx.org.id)
	};
	return sendDigest(settingsCtx);
};
