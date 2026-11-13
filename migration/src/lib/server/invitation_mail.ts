// Invitation email delivery rows, ported from the durable half of
// src/smtp.rs and src/web/invitation_mail.rs. The SMTP transport itself is not
// ported: rows are written to D1 and shown on the settings page; nothing is
// ever sent. Raw tokens live in links only; D1 stores the SHA-256 hash.

import type { D1Database } from '$lib/d1';
import { hashToken } from './tokens';

export interface MailEnv {
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
	if (outcome.disabled) return 'Invitation created. Email delivery is not connected.';
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
	if (origin === '') return false;
	for (const ch of origin) {
		const code = ch.charCodeAt(0);
		if (code < 32 || code === 127) return false; // control
		if (code === 32 || code === 9 || code === 10 || code === 11 || code === 12 || code === 13) return false;
	}
	return origin.startsWith('https://') || origin.startsWith('http://');
}

export interface DeliverArgs {
	invitationId: string;
	token: string;
	baseUrl: string;
}

/** Store the invitation email durably (the pending row already exists), then
 * record the delivery attempt's outcome on the row. Failures are recorded,
 * never thrown: the invitation itself was already accepted into D1.
 *
 * The SMTP transport is not ported: when delivery is enabled, the attempt is
 * recorded as failed rather than sending anything, and SMTP_PASSWORD is never
 * read. */
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
	// No SMTP transport in this port: bump attempts, record an honest failure.
	await db
		.prepare('UPDATE invitation_mail SET attempts=attempts+1 WHERE invitation_id=?1 AND token_hash=?2')
		.bind(args.invitationId, tokenHash)
		.run();
	const msg = 'SMTP transport is not available in this deployment.';
	const changed = await mark(db, args.invitationId, tokenHash, 'failed', msg, null);
	if (changed === 0) {
		return {
			sent: false,
			disabled: false,
			error: 'Result discarded; the link was superseded by a newer resend.'
		};
	}
	return { sent: false, disabled: false, error: msg };
}

/** Percent-encoded `?msg=` query value for settings redirects. */
export function msgQuery(msg: string): string {
	return new URLSearchParams({ msg }).toString();
}