import type { D1Database } from '#lib/d1.ts';
import { nowMs } from './db';
import type { SmtpMessage } from './smtp';

export function redactInvitation(text: string, token: string): string {
	return text.replaceAll(encodeURIComponent(token), '••••••').replaceAll(token, '••••••');
}

export async function recordEmail(db: D1Database, entry: {
	orgId: number; kind: string; membershipId: number | null; from: string;
	message: SmtpMessage; messageId: string | null; failure: string | null;
	outboxIds?: number[]; invitationId?: string; token?: string;
}): Promise<void> {
	try {
		const clean = (text: string) => entry.token ? redactInvitation(text, entry.token) : text;
		await db.prepare(`INSERT INTO email_log
			(org_id, kind, to_membership_id, to_address, from_address, subject, text_body,
			 html_body, message_id, status, error, outbox_ids, invitation_id, created_at)
			VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)`)
			.bind(entry.orgId, entry.kind, entry.membershipId, entry.message.to, entry.from,
				entry.message.subject, clean(entry.message.body), clean(entry.message.html ?? ''),
				entry.messageId, entry.failure === null ? 'sent' : 'failed',
				entry.failure === null ? null : clean(entry.failure),
				entry.outboxIds ? JSON.stringify(entry.outboxIds) : null, entry.invitationId ?? null, nowMs()).run();
	} catch {
		console.error('Email history write failed.');
	}
}
