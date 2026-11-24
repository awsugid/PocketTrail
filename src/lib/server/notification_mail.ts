// Email delivery for notification_outbox rows (assignment, mention, digest).
//
// Routes call ONE helper after queueing rows:
//
//   await scheduleDelivery(event, db, orgId);   // -> Promise<boolean>
//
// It resolves the Worker env (`event.platform.env`) and the link base URL
// (`event.url.origin`), then runs `deliverOutbox` via
// `event.platform.ctx.waitUntil` (off the response path) or, without an
// execution context, awaits it. It never throws; the result is whether email
// delivery is enabled (EMAIL_DELIVERY_ENABLED === 'true') so callers can word
// their flash message.
//
// Delivery rules: rows are sent only while the recipient membership is active
// (removed_at NULL; invited members included), org notifications are on, the
// row is neither cancelled nor sent, and a transaction-bound row's transaction
// is unsuppressed (and at/after the cutoff, mentions excepted). Assignment rows
// are batched into one email per recipient; mention and digest rows are one
// email each. Each row is claimed by bumping `attempts` (max 3) before
// sending; failures record `last_error`, successes stamp `sent_at`. Emails
// never carry invitation tokens. Assignment emails may carry each
// transaction's date, counterparty and signed IDR amount; mention and digest
// emails carry links only.

import type { D1Database } from '#lib/d1.ts';
import { fmtDate } from '#lib/fmt.ts';
import { fmtMoney } from '#lib/money.ts';
import { nowMs, qAll } from './db';
import { recordEmail } from './email_log';
import { parseRolePermissions } from './permissions';
import { counterpartyDisplay } from './ledger';
import { sendSmtp, smtpConfig, SmtpError, type SmtpConnect, type SmtpMessage } from './smtp';
import { usableBaseUrl, workerConnect, type MailEnv } from './invitation_mail';

/** Delivery attempts per row before it is left for good. */
export const MAX_ATTEMPTS = 3;
/** Emails sent per delivery call (bounds Worker time and SMTP sessions). */
export const MAX_EMAILS_PER_CALL = 20;
/** Transactions listed in one batched assignment email. */
export const ASSIGNMENT_LIST_CAP = 50;
/** Rows older than this are never emailed (pre-email backlog, stale notices). */
export const MAX_ROW_AGE_MS = 7 * 24 * 3600 * 1000;
/** A claimed row is skipped by concurrent deliveries for this long. */
const LEASE_MS = 5 * 60 * 1000;
const LEASE_PREFIX = 'sending:';
const SCAN_LIMIT = 200;

export interface DeliveryResult {
	sent: number;
	failed: number;
	disabled: boolean;
}

// ------------------------------------------------------------ message model

export interface Recipient {
	email: string;
	name: string;
	/** Invited (not yet accepted) member: the email adds a sign-in note. */
	invited: boolean;
}

export interface AssignmentItem {
	txnId: number;
	/** ISO `YYYY-MM-DD`. */
	date: string;
	counterparty: string;
	/** Signed minor units (100 = 1 IDR). */
	amountMinor: number;
}

interface OrgRef {
	name: string;
	slug: string;
}

function escapeHtml(value: string): string {
	return value.replace(/[&<>"']/g, (character) => ({
		'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
	})[character]!);
}

const txnUrl = (baseUrl: string, slug: string, txnId: number) =>
	`${baseUrl}/org/${encodeURIComponent(slug)}/transactions/${txnId}`;

function inviteText(org: OrgRef, recipient: Recipient, baseUrl: string): string {
	return `You've been invited to ${org.name} on PocketTrail. To accept the invitation and add details, sign in with Google using ${recipient.email} at ${baseUrl}/login`;
}

function inviteHtml(org: OrgRef, recipient: Recipient, baseUrl: string): string {
	const login = escapeHtml(`${baseUrl}/login`);
	return `<tr><td style="padding:0 24px 24px;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#fdf6ec;border:1px solid #f1d9b8;border-radius:8px;"><tr><td style="padding:16px;font-size:14px;line-height:22px;color:#18181b;">You've been invited to <strong>${escapeHtml(org.name)}</strong> on PocketTrail. To accept the invitation and add details, sign in with Google using <strong style="word-break:break-all;">${escapeHtml(recipient.email)}</strong> at <a href="${login}" style="color:#9a4614;text-decoration:underline;">${login}</a>.</td></tr></table></td></tr>`;
}

interface Layout {
	title: string;
	preheader: string;
	heading: string;
	introHtml: string;
	contentHtml: string;
	button: { url: string; label: string } | null;
	inviteHtml: string;
	footer: string;
}

/** Same self-contained styling as invitation_email.ts: inline styles,
 * presentation tables, no remote images/fonts/tracking. */
function layoutHtml(l: Layout): string {
	const button = l.button
		? `<table role="presentation" align="center" cellspacing="0" cellpadding="0" border="0" style="margin:24px auto 0;">
<tr><td align="center" bgcolor="#27272a" style="border-radius:6px;mso-padding-alt:14px 24px;">
<a href="${escapeHtml(l.button.url)}" style="display:inline-block;padding:14px 24px;border:1px solid #27272a;border-radius:6px;font-size:16px;line-height:22px;font-weight:700;color:#ffffff;text-decoration:none;">${escapeHtml(l.button.label)}</a>
</td></tr>
</table>`
		: '';
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(l.title)}</title>
</head>
<body style="margin:0;padding:0;background-color:#fafafa;color:#18181b;font-family:Arial,Helvetica,sans-serif;-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${escapeHtml(l.preheader)}</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#fafafa;table-layout:fixed;">
<tr><td align="center" style="padding:32px 16px;">
<!--[if mso]><table role="presentation" width="560" cellspacing="0" cellpadding="0" border="0"><tr><td><![endif]-->
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:560px;table-layout:fixed;background-color:#ffffff;border:1px solid #e4e4e7;border-radius:12px;">
<tr><td align="center" style="padding:24px;border-bottom:1px solid #e4e4e7;font-size:18px;line-height:24px;font-weight:700;color:#27272a;text-align:center;">PocketTrail</td></tr>
<tr><td style="padding:32px 24px;">
<h1 style="margin:0 0 16px;font-size:24px;line-height:32px;font-weight:700;letter-spacing:-0.4px;color:#18181b;text-align:center;">${escapeHtml(l.heading)}</h1>
<p style="margin:0 0 16px;font-size:16px;line-height:26px;color:#62626b;text-align:center;">${l.introHtml}</p>
${l.contentHtml}
${button}
</td></tr>
${l.inviteHtml}
</table>
<!--[if mso]></td></tr></table><![endif]-->
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:560px;table-layout:fixed;">
<tr><td align="center" style="padding:20px 24px 0;font-size:12px;line-height:20px;color:#62626b;text-align:center;">
<p style="margin:0;">${escapeHtml(l.footer)}</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

const linkStyle = 'color:#9a4614;text-decoration:underline;word-break:break-all;overflow-wrap:anywhere;';

/** One email listing a recipient's newly assigned transactions (date,
 * counterparty, signed amount, absolute link), capped at ASSIGNMENT_LIST_CAP
 * with an "and N more" line. */
export function assignmentMessage(org: OrgRef, recipient: Recipient, items: readonly AssignmentItem[], baseUrl: string): SmtpMessage {
	if (items.length === 0) throw new Error('No assignments to send.');
	const shown = items.slice(0, ASSIGNMENT_LIST_CAP);
	const more = items.length - shown.length;
	const count = items.length;
	const noun = count === 1 ? 'transaction needs' : 'transactions need';
	const subject = count === 1
		? `Documentation assignment — ${org.name}`
		: `${count} transactions need your documentation — ${org.name}`;
	const lines = shown.map((item) => {
		const who = counterpartyDisplay(item.counterparty).name.trim() || 'Unknown counterparty';
		return { item, who, amount: fmtMoney(item.amountMinor), date: fmtDate(item.date), url: txnUrl(baseUrl, org.slug, item.txnId) };
	});
	let text = `${count} ${noun} your documentation in ${org.name}.\n\n`;
	for (const line of lines) text += `- ${line.date} · ${line.who} · ${line.amount}\n  ${line.url}\n`;
	if (more > 0) text += `\n...and ${more} more. See all in PocketTrail: ${baseUrl}/org/${encodeURIComponent(org.slug)}\n`;
	if (recipient.invited) text += `\n${inviteText(org, recipient, baseUrl)}\n`;
	text += '\nYou receive this because transactions were assigned to you in PocketTrail.\n';
	const rows = lines.map((line) => `<tr>
<td style="padding:10px 8px 10px 0;border-top:1px solid #e4e4e7;font-size:13px;line-height:20px;color:#62626b;white-space:nowrap;vertical-align:top;">${escapeHtml(line.date)}</td>
<td style="padding:10px 8px;border-top:1px solid #e4e4e7;font-size:14px;line-height:20px;color:#18181b;vertical-align:top;overflow-wrap:anywhere;"><a href="${escapeHtml(line.url)}" style="${linkStyle}">${escapeHtml(line.who)}</a></td>
<td align="right" style="padding:10px 0 10px 8px;border-top:1px solid #e4e4e7;font-size:14px;line-height:20px;color:#18181b;white-space:nowrap;text-align:right;vertical-align:top;font-weight:700;">${escapeHtml(line.amount)}</td>
</tr>`).join('\n');
	const moreHtml = more > 0
		? `<p style="margin:12px 0 0;font-size:14px;line-height:22px;color:#62626b;text-align:center;">…and ${more} more.</p>`
		: '';
	return {
		to: recipient.email,
		subject,
		body: text,
		html: layoutHtml({
			title: subject,
			preheader: `${count} ${noun} your documentation in ${org.name}.`,
			heading: count === 1 ? 'A transaction needs your documentation' : `${count} transactions need your documentation`,
			introHtml: `Assigned to you in <strong style="color:#18181b;">${escapeHtml(org.name)}</strong>.`,
			contentHtml: `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="table-layout:auto;">\n${rows}\n</table>${moreHtml}`,
			button: { url: count === 1 ? lines[0]!.url : `${baseUrl}/org/${encodeURIComponent(org.slug)}`, label: count === 1 ? 'Open transaction' : 'Open PocketTrail' },
			inviteHtml: recipient.invited ? inviteHtml(org, recipient, baseUrl) : '',
			footer: 'You receive this because transactions were assigned to you in PocketTrail.'
		})
	};
}

/** One mention: the fact and the link only (no comment text, no amounts). */
export function mentionMessage(org: OrgRef, recipient: Recipient, txnId: number, baseUrl: string): SmtpMessage {
	const url = txnUrl(baseUrl, org.slug, txnId);
	const subject = `You were mentioned — ${org.name}`;
	let text = `You were mentioned in a discussion in ${org.name}. Sign in to read it:\n${url}\n`;
	if (recipient.invited) text += `\n${inviteText(org, recipient, baseUrl)}\n`;
	text += '\nThe discussion stays in PocketTrail; this email does not include it.\n';
	return {
		to: recipient.email,
		subject,
		body: text,
		html: layoutHtml({
			title: subject,
			preheader: `You were mentioned in ${org.name}.`,
			heading: 'You were mentioned',
			introHtml: `Someone mentioned you in a discussion in <strong style="color:#18181b;">${escapeHtml(org.name)}</strong>.`,
			contentHtml: `<p style="margin:0;font-size:12px;line-height:20px;text-align:center;"><a href="${escapeHtml(url)}" style="${linkStyle}">${escapeHtml(url)}</a></p>`,
			button: { url, label: 'Read the discussion' },
			inviteHtml: recipient.invited ? inviteHtml(org, recipient, baseUrl) : '',
			footer: 'The discussion stays in PocketTrail; this email does not include it.'
		})
	};
}

/** One purpose notice: the fact and the link only (discussion message or
 * assignment). No amounts, notes, or message text leave the app. */
export function purposeMessage(org: OrgRef, recipient: Recipient, purposeId: number, baseUrl: string, assigned: boolean): SmtpMessage {
	const url = `${baseUrl}/org/${encodeURIComponent(org.slug)}/purposes/${purposeId}`;
	const subject = assigned ? `Purpose assigned to you — ${org.name}` : `New discussion message — ${org.name}`;
	const fact = assigned ? 'You are now responsible for a purpose' : 'A purpose discussion has a new message';
	let text = `${fact} in ${org.name}. Sign in to open it:\n${url}\n`;
	if (recipient.invited) text += `\n${inviteText(org, recipient, baseUrl)}\n`;
	text += '\nThe details stay in PocketTrail; this email does not include them.\n';
	return {
		to: recipient.email,
		subject,
		body: text,
		html: layoutHtml({
			title: subject,
			preheader: `${fact} in ${org.name}.`,
			heading: assigned ? 'A purpose needs you' : 'New discussion message',
			introHtml: `${escapeHtml(fact)} in <strong style="color:#18181b;">${escapeHtml(org.name)}</strong>.`,
			contentHtml: `<p style="margin:0;font-size:12px;line-height:20px;text-align:center;"><a href="${escapeHtml(url)}" style="${linkStyle}">${escapeHtml(url)}</a></p>`,
			button: { url, label: assigned ? 'Open the purpose' : 'Read the discussion' },
			inviteHtml: recipient.invited ? inviteHtml(org, recipient, baseUrl) : '',
			footer: 'The details stay in PocketTrail; this email does not include them.'
		})
	};
}

/** Transaction ids linked from a stored digest body (`/org/<slug>/transactions/<id>`). */
export function digestTxnIds(body: string, slug: string): number[] {
	const ids: number[] = [];
	const prefix = `/org/${slug}/transactions/`;
	for (const line of body.split('\n')) {
		const at = line.indexOf(prefix);
		if (at < 0) continue;
		const match = /^(\d+)/.exec(line.slice(at + prefix.length));
		if (match) ids.push(Number(match[1]));
	}
	return ids;
}

/** One digest: counts and links only, as captured. */
export function digestMessage(org: OrgRef, recipient: Recipient, txnIds: readonly number[], baseUrl: string): SmtpMessage {
	const subject = `Documentation digest — ${org.name}`;
	const urls = txnIds.map((id) => txnUrl(baseUrl, org.slug, id));
	let text = `Weekly digest — ${org.name}: ${txnIds.length} item(s) still await your documentation.\n\n`;
	for (const url of urls) text += `Documentation task — ${url}\n`;
	if (recipient.invited) text += `\n${inviteText(org, recipient, baseUrl)}\n`;
	text += '\nFinancial details stay in PocketTrail; this email carries none.\n';
	const list = urls
		.map((url) => `<li style="margin:0 0 8px;font-size:13px;line-height:20px;"><a href="${escapeHtml(url)}" style="${linkStyle}">${escapeHtml(url)}</a></li>`)
		.join('\n');
	return {
		to: recipient.email,
		subject,
		body: text,
		html: layoutHtml({
			title: subject,
			preheader: `${txnIds.length} item(s) still await your documentation in ${org.name}.`,
			heading: 'Weekly documentation digest',
			introHtml: `<strong style="color:#18181b;">${txnIds.length}</strong> item(s) still await your documentation in <strong style="color:#18181b;">${escapeHtml(org.name)}</strong>.`,
			contentHtml: list ? `<ul style="margin:0;padding:0 0 0 20px;color:#62626b;">\n${list}\n</ul>` : '',
			button: { url: `${baseUrl}/org/${encodeURIComponent(org.slug)}`, label: 'Open PocketTrail' },
			inviteHtml: recipient.invited ? inviteHtml(org, recipient, baseUrl) : '',
			footer: 'Financial details stay in PocketTrail; this email carries none.'
		})
	};
}

// ------------------------------------------------------------------ outbox

/** Deliverable outbox row joined with its recipient and transaction. */
export interface OutboxMailRow {
	role_permissions?: string;
	id: number;
	kind: string;
	to_membership_id: number;
	transaction_id: number | null;
	/** Purpose-bound rows (kind 'mention'): the link opens the purpose page. */
	purpose_id: number | null;
	body: string;
	attempts: number;
	email: string;
	name: string;
	invited: number;
	org_name: string;
	org_slug: string;
	txn_date: string | null;
	counterparty: string | null;
	amount_minor: number | null;
}

export interface EmailJob {
	rows: OutboxMailRow[];
	kind: 'assignment' | 'mention' | 'digest' | 'purpose';
}

/** Group deliverable rows into emails: assignment rows -> one email per
 * recipient (input order of first row); mention/digest/purpose -> one per row.
 * Capped at `maxEmails`. Unknown kinds are skipped. */
export function planEmails(rows: readonly OutboxMailRow[], maxEmails = MAX_EMAILS_PER_CALL): EmailJob[] {
	const jobs: EmailJob[] = [];
	const byRecipient = new Map<number, EmailJob>();
	for (const row of rows) {
		if (row.kind === 'assignment') {
			const existing = byRecipient.get(row.to_membership_id);
			if (existing) {
				existing.rows.push(row);
				continue;
			}
			if (jobs.length >= maxEmails) continue;
			const job: EmailJob = { kind: 'assignment', rows: [row] };
			byRecipient.set(row.to_membership_id, job);
			jobs.push(job);
		} else if (row.kind === 'mention' || row.kind === 'digest' || row.kind === 'purpose') {
			if (jobs.length >= maxEmails) continue;
			jobs.push({ kind: row.kind, rows: [row] });
		}
	}
	return jobs;
}

export function messageFor(job: EmailJob, baseUrl: string): SmtpMessage {
	const first = job.rows[0]!;
	const org = { name: first.org_name, slug: first.org_slug };
	const recipient = { email: first.email, name: first.name, invited: first.invited !== 0 };
	if (parseRolePermissions(first.role_permissions ?? '[]').has('ExplainOwnActions')) {
		const url = `${baseUrl}/org/${encodeURIComponent(first.org_slug)}/actions`;
		return { to: recipient.email, subject: `Please explain your assigned expenses — ${org.name}`, body: `Why did these expenses happen? Please explain their purpose in your assigned Actions: ${url}\n${recipient.invited ? inviteText(org, recipient, baseUrl) : ''}`, html: `<p>Why did these expenses happen? Please explain their purpose.</p><p><a href="${escapeHtml(url)}">Open assigned Actions</a></p>${recipient.invited ? `<p>${escapeHtml(inviteText(org,recipient,baseUrl))}</p>` : ''}` };
	}
	if (job.kind === 'assignment') {
		return assignmentMessage(org, recipient, job.rows.map((row) => ({
			txnId: row.transaction_id ?? 0,
			date: row.txn_date ?? '',
			counterparty: row.counterparty ?? '',
			amountMinor: row.amount_minor ?? 0
		})), baseUrl);
	}
	if (job.kind === 'mention') {
		if (first.purpose_id !== null && first.purpose_id !== undefined) {
			return purposeMessage(org, recipient, first.purpose_id, baseUrl, false);
		}
		return mentionMessage(org, recipient, first.transaction_id ?? 0, baseUrl);
	}
	if (job.kind === 'purpose') {
		return purposeMessage(org, recipient, first.purpose_id ?? 0, baseUrl, true);
	}
	return digestMessage(org, recipient, digestTxnIds(first.body, first.org_slug), baseUrl);
}

const DELIVERABLE_SQL = `SELECT n.id,n.kind,n.to_membership_id,n.transaction_id,n.purpose_id,n.body,n.attempts,u.email,u.name,m.invited,r.permissions AS role_permissions,o.name AS org_name,o.slug AS org_slug,t.txn_date,t.counterparty,t.amount_minor
FROM notification_outbox n
JOIN organizations o ON o.id=n.org_id
JOIN memberships m ON m.id=n.to_membership_id AND m.org_id=o.id
JOIN users u ON u.id=m.user_id
JOIN roles r ON r.id=m.role_id AND r.org_id=o.id
LEFT JOIN transactions t ON t.id=n.transaction_id AND t.org_id=o.id
LEFT JOIN purposes pu ON pu.id=n.purpose_id AND pu.org_id=o.id
WHERE n.org_id=?1 AND o.notifications_enabled=1 AND n.cancelled_at IS NULL AND n.sent_at IS NULL
  AND n.attempts<?2 AND n.created_at>=?3 AND m.removed_at IS NULL
  AND (n.last_error IS NULL OR substr(n.last_error,1,${LEASE_PREFIX.length})<>'${LEASE_PREFIX}' OR CAST(substr(n.last_error,${LEASE_PREFIX.length + 1}) AS INTEGER)<?4)
  AND (n.purpose_id IS NULL OR (pu.id IS NOT NULL AND pu.suppressed=0))
  AND (n.transaction_id IS NULL OR (t.id IS NOT NULL AND t.suppressed=0 AND (n.kind='mention' OR o.notification_cutoff_date IS NULL OR t.txn_date>=o.notification_cutoff_date)))
ORDER BY n.id LIMIT ${SCAN_LIMIT}`;

/** Claim each row (attempts CAS + lease) so a concurrent delivery cannot pick
 * it up; returns the rows this call won. */
async function claim(db: D1Database, rows: readonly OutboxMailRow[], now: number): Promise<OutboxMailRow[]> {
	const lease = `${LEASE_PREFIX}${now + LEASE_MS}`;
	const results = await db.batch(rows.map((row) =>
		db.prepare('UPDATE notification_outbox SET attempts=attempts+1,last_error=?1 WHERE id=?2 AND attempts=?3 AND sent_at IS NULL AND cancelled_at IS NULL')
			.bind(lease, row.id, row.attempts)
	));
	return rows.filter((_, index) => (results[index]?.meta?.changes ?? 0) === 1);
}

async function finish(db: D1Database, rows: readonly OutboxMailRow[], failure: string | null, now: number): Promise<void> {
	await db.batch(rows.map((row) =>
		failure === null
			? db.prepare('UPDATE notification_outbox SET sent_at=?1,last_error=NULL WHERE id=?2').bind(now, row.id)
			: db.prepare('UPDATE notification_outbox SET last_error=?1 WHERE id=?2').bind(failure, row.id)
	));
}

const safeError = (cause: unknown) => (cause instanceof SmtpError ? cause.message : 'SMTP delivery failed.');

/** Send this org's deliverable outbox rows (bounded per call). Never throws
 * for SMTP problems: failures are recorded on the rows and retried by a later
 * call until MAX_ATTEMPTS. With EMAIL_DELIVERY_ENABLED !== 'true' nothing is
 * read or written. `connect` is injectable for tests. */
export async function deliverOutbox(
	env: MailEnv,
	db: D1Database,
	orgId: number,
	baseUrl: string,
	connect?: SmtpConnect
): Promise<DeliveryResult> {
	if (env.EMAIL_DELIVERY_ENABLED !== 'true') return { sent: 0, failed: 0, disabled: true };
	if (!usableBaseUrl(baseUrl)) return { sent: 0, failed: 0, disabled: false };
	const now = nowMs();
	const rows = await qAll<OutboxMailRow>(db, DELIVERABLE_SQL, [orgId, MAX_ATTEMPTS, now - MAX_ROW_AGE_MS, now]);
	const jobs = planEmails(rows);
	if (jobs.length === 0) return { sent: 0, failed: 0, disabled: false };
	let config;
	try {
		config = smtpConfig(env);
	} catch (cause) {
		// Configuration is not a delivery attempt: surface it on the rows without
		// spending their retries.
		const all = jobs.flatMap((job) => job.rows);
		await finish(db, all, safeError(cause), now);
		return { sent: 0, failed: jobs.length, disabled: false };
	}
	let open = connect;
	if (!open) {
		open = await workerConnect();
	}
	let sent = 0;
	let failed = 0;
	for (const job of jobs) {
		const claimed = await claim(db, job.rows, now);
		if (claimed.length === 0) continue;
		let failure: string | null = null;
		let messageId: string | null = null;
		const message = messageFor({ ...job, rows: claimed }, baseUrl);
		try {
			await sendSmtp(config, message, open, undefined, (parts) => { messageId = parts.messageId; });
		} catch (cause) {
			failure = safeError(cause);
		}
		await recordEmail(db, { orgId, kind: claimed[0]!.kind, membershipId: claimed[0]!.to_membership_id,
			from: config.from, message, messageId, failure, outboxIds: claimed.map((row) => row.id) });
		await finish(db, claimed, failure, nowMs());
		if (failure === null) sent += 1;
		else failed += 1;
	}
	return { sent, failed, disabled: false };
}

/** The request surface scheduleDelivery needs (a SvelteKit RequestEvent fits). */
export interface DeliveryEvent {
	platform?: App.Platform;
	url: URL;
}

/** Whether this Worker sends email at all. */
export function emailDeliveryEnabled(env: MailEnv | undefined): boolean {
	return env?.EMAIL_DELIVERY_ENABLED === 'true';
}

/** Deliver `orgId`'s pending outbox email after the response when the
 * platform offers `ctx.waitUntil`, otherwise inline. Never throws; resolves to
 * whether email delivery is enabled. */
export async function scheduleDelivery(event: DeliveryEvent, db: D1Database, orgId: number): Promise<boolean> {
	const env = event.platform?.env;
	if (!env || !emailDeliveryEnabled(env)) return false;
	const baseUrl = event.url.origin;
	if (!usableBaseUrl(baseUrl)) {
		console.error('Notification email skipped: request origin is not a usable link base URL.');
		return true;
	}
	const task = deliverOutbox(env, db, orgId, baseUrl).then(
		() => undefined,
		(cause: unknown) => {
			console.error('Notification email delivery failed:', safeError(cause));
		}
	);
	const ctx = event.platform?.ctx;
	if (ctx) ctx.waitUntil(task);
	else await task;
	return true;
}
