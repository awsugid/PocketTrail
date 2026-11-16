// Durable invitation email delivery. Raw tokens live in emailed links only;
// D1 stores the SHA-256 hash. SMTP is explicitly enabled per environment.

import type { D1Database } from '$lib/d1';
import { hashToken } from './tokens';
import { nowMs, qOne } from './db';
import { sendSmtp, smtpConfig, SmtpError, type SmtpEnv } from './smtp';

export interface MailEnv extends SmtpEnv {
	EMAIL_DELIVERY_ENABLED?: string;
}

export interface MailOutcome {
	sent: boolean;
	disabled: boolean;
	error: string | null;
}

/** Flash message shown after create/resend. Never carries credentials. */
export function outcomeMessage(outcome: MailOutcome): string {
	if (outcome.sent) return 'Invitation created. Email sent.';
	if (outcome.disabled) return 'Invitation created. Email delivery is disabled.';
	return `Invitation created. Email delivery failed - use Resend. (${outcome.error ?? 'unknown error'})`;
}

/** Mark the row for `token_hash` sent/failed/pending+error and return the
 * number of affected rows (SQLite `changes`). Keyed by invitation+hash AND
 * status='pending': a concurrent resend supersedes the row, and a late
 * completion of the superseded send must never flip it to `sent`. */
async function mark(
	db: D1Database,
	invitationId: string,
	tokenHash: string,
	status: string,
	error: string | null,
	sentAt: number | null
): Promise<number> {
	const result = await db
		.prepare(
			'UPDATE invitation_mail SET status=?3,error=?4,sent_at=?5 WHERE invitation_id=?1 AND token_hash=?2 AND status=\'pending\''
		)
		.bind(invitationId, tokenHash, status, error, sentAt)
		.run();
	return result.meta?.changes ?? 0;
}

/** Request origin that may appear in an emailed link: http(s) only, no
 * whitespace or control characters. */
export function usableBaseUrl(origin: string): boolean {
	try {
		const url = new URL(origin);
		return ['https:', 'http:'].includes(url.protocol) && url.origin === origin;
	} catch {
		return false;
	}
}

export interface DeliverArgs {
	invitationId: string;
	token: string;
	baseUrl: string;
}

/** Store the invitation email durably (the pending row already exists), then
 * record the delivery attempt's outcome on the row. Failures are recorded,
 * never thrown for SMTP failures: the invitation is already committed to D1. */
export async function deliverMail(
	env: MailEnv,
	db: D1Database,
	args: DeliverArgs
): Promise<MailOutcome> {
	const tokenHash = hashToken(args.token);
	if (!usableBaseUrl(args.baseUrl)) {
		const msg = 'Request origin is not a usable link base URL.';
		await mark(db, args.invitationId, tokenHash, 'failed', msg, null);
		return { sent: false, disabled: false, error: msg };
	}
	if (env.EMAIL_DELIVERY_ENABLED !== 'true') {
		const discarded =
			(await mark(
				db,
				args.invitationId,
				tokenHash,
				'pending',
				'Email delivery is disabled (EMAIL_DELIVERY_ENABLED).',
				null
			)) === 0;
		return {
			sent: false,
			disabled: true,
			error: discarded
				? 'Result discarded; the link was superseded by a newer resend.'
				: null
		};
	}
	const invitation = await qOne<{ email: string; org_name: string; role_name: string; expires_at: number }>(
		db,
		"SELECT i.email,o.name AS org_name,r.name AS role_name,i.expires_at FROM invitations i JOIN organizations o ON o.id=i.org_id JOIN roles r ON r.id=i.role_id AND r.org_id=i.org_id JOIN invitation_mail im ON im.invitation_id=i.id WHERE i.id=?1 AND im.token_hash=?2 AND im.status='pending' AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at>?3",
		[args.invitationId, tokenHash, nowMs()]
	);
	if (!invitation) return { sent: false, disabled: false, error: 'This invitation is no longer available.' };
	const attempt = await db
		.prepare("UPDATE invitation_mail SET attempts=attempts+1 WHERE invitation_id=?1 AND token_hash=?2 AND status='pending' AND EXISTS(SELECT 1 FROM invitations i WHERE i.id=?1 AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at>?3)")
		.bind(args.invitationId, tokenHash, nowMs())
		.run();
	if (attempt.meta?.changes !== 1) return { sent: false, disabled: false, error: 'This invitation is no longer available.' };
	let failure: string | null = null;
	try {
		const config = smtpConfig(env);
		const { connect } = await import('cloudflare:sockets');
		await sendSmtp(config, {
			to: invitation.email,
			subject: `Join ${invitation.org_name} on PocketTrail`,
			body: `You have been invited to join ${invitation.org_name} on PocketTrail as ${invitation.role_name}.\n\nOpen this single-use link and sign in with the Google account for ${invitation.email}:\n\n${args.baseUrl}/invitations/accept?token=${encodeURIComponent(args.token)}\n\nThe link expires ${new Date(invitation.expires_at).toUTCString()}.\nIf you were not expecting this invitation, you can ignore it.\n\nFinancial details stay in PocketTrail; this email carries none.\n`
		}, connect);
	} catch (cause) {
		failure = cause instanceof SmtpError ? cause.message : 'SMTP delivery failed.';
	}
	const changed = await mark(db, args.invitationId, tokenHash, failure ? 'failed' : 'sent', failure, failure ? null : nowMs());
	if (changed === 0) {
		return {
			sent: false,
			disabled: false,
			error: 'Result discarded; the link was superseded by a newer resend.'
		};
	}
	return { sent: failure === null, disabled: false, error: failure };
}

/** Percent-encoded `?msg=` query value for settings redirects. */
export function msgQuery(msg: string): string {
	return new URLSearchParams({ msg }).toString();
}