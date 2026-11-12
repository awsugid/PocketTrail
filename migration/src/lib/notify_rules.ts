// Notification gating rules, ported from src/notify_rules.rs.
//
// Org-level disablement blocks ALL outbound notifications (mentions included).
// Transaction suppression likewise blocks every notification about that
// transaction, including explicit mentions. Removed members never receive
// anything. Assignment and digest notifications additionally respect the
// organization's transaction-date cutoff; mentions are explicit and skip it.

export type NotifyKind = 'assignment' | 'digest' | 'mention';

export const DIGEST_WEEK_MS = 7 * 24 * 3600 * 1000;

export function shouldNotify(
	kind: NotifyKind,
	orgEnabled: boolean,
	suppressed: boolean,
	memberActive: boolean,
	txnDate: string | null,
	cutoff: string | null
): boolean {
	if (!orgEnabled || suppressed || !memberActive) return false;
	if (kind === 'mention') return true;
	if (txnDate === null || cutoff === null) return true;
	return txnDate >= cutoff;
}

/** True when no digest went to this member within the last week. Durable
 * cadence key = existing outbox timestamps (kind='digest'). */
export function digestDue(last: number | null, nowMs: number): boolean {
	if (last === null) return true;
	return nowMs - last >= DIGEST_WEEK_MS;
}

/** Digest body: counts, dates, links only — no amounts, balances, notes,
 * counterparties, or attachments. */
export function digestBody(orgName: string, slug: string, items: ReadonlyArray<{ txnId: number }>): string {
	let b = `Weekly digest — ${orgName}: ${items.length} item(s) still await your documentation.\n\n`;
	for (const item of items) {
		b += `Documentation task — /org/${slug}/transactions/${item.txnId}\n`;
	}
	b += '\nFinancial details stay in PocketTrail; this email carries none.';
	return b;
}