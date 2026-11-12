// Ledger queries and view models, ported from src/web/aggregate.rs
// (txn_list_page) and src/web/txns.rs (list/detail handlers).
//
// The filter SQL is carried over verbatim so status semantics — including the
// draft-versus-submitted split that both persist as 'pending' — stay identical
// to the Rust application. Every read is scoped by org_id in SQL; a row from
// another organization is indistinguishable from a missing row.

import type { D1Database } from '$lib/d1';
import { assertSafeMinor, fmtMoney } from '$lib/money';
import { qAll, qOne } from './db';

/** Only the filters the UI offers; anything else means "all". */
export type LedgerFilter = 'needs_details' | 'pending' | 'approved' | 'changes_requested';

export const LEDGER_FILTERS: ReadonlyArray<{ value: 'all' | LedgerFilter; label: string }> = [
	{ value: 'all', label: 'All statuses' },
	{ value: 'needs_details', label: 'Needs details' },
	{ value: 'pending', label: 'Pending review' },
	{ value: 'approved', label: 'Approved' },
	{ value: 'changes_requested', label: 'Changes requested' }
];

export const PAGE_SIZE = 50;
const MAX_PAGE = 1_000_000;

export function parseFilter(value: string | null): LedgerFilter | null {
	if (value === 'needs_details' || value === 'pending' || value === 'approved') return value;
	if (value === 'changes_requested') return value;
	return null;
}

export function parsePage(value: string | null): number {
	if (value === null) return 1;
	if (!/^[0-9]{1,7}$/.test(value)) return 1;
	const page = Number(value);
	return page >= 1 && page <= MAX_PAGE ? page : 1;
}

interface LedgerRow extends Record<string, unknown> {
	id: number;
	pocket_name: string;
	txn_date: string;
	txn_time: string | null;
	counterparty: string;
	transaction_type: string;
	amount_minor: number;
	balance_minor: number | null;
	explanation: string;
	evidence_unavailable_reason: string;
	status: string;
	suppressed: number | null;
	responsible_membership_id: number | null;
	responsible_name: string | null;
	evidence_count: number | null;
}

/** Documentation still owed by the responsible member. Ports
 * TxnListRow::needs_details: income needs notes only, expenses need notes plus
 * either evidence or a stated reason. */
export function needsDetails(amountMinor: number, explanation: string, evidenceCount: number, evidenceUnavailableReason: string, status: string): boolean {
	if (documentationOwed(status, documentationComplete(amountMinor, explanation, evidenceCount, evidenceUnavailableReason))) {
		return true;
	}
	return false;
}

function documentationComplete(
	amountMinor: number,
	explanation: string,
	evidenceCount: number,
	evidenceUnavailableReason: string
): boolean {
	if (amountMinor > 0) return explanation.trim() !== '';
	const hasNotes = explanation.trim() !== '';
	return hasNotes && (evidenceCount > 0 || evidenceUnavailableReason.trim() !== '');
}

/** Ports runtime_status/documentation_owed from src/domain_map.rs: a row stored
 * as 'pending' is a draft until its documentation is complete. */
function documentationOwed(status: string, complete: boolean): boolean {
	if (status === 'approved') return false;
	if (status === 'changes_requested') return true;
	return !complete;
}

export function statusLabel(status: string, owed: boolean): string {
	if (status === 'approved') return 'Approved';
	if (status === 'changes_requested') return 'Changes requested';
	return owed ? 'Needs details' : 'Pending review';
}

export function statusTone(status: string, owed: boolean): 'needs' | 'review' | 'approved' | 'changes' {
	if (status === 'approved') return 'approved';
	if (status === 'changes_requested') return 'changes';
	return owed ? 'needs' : 'review';
}

export interface CounterpartyDisplay {
	name: string;
	bankAccount: string | null;
}

/** Ports counterparty_display from crates/jago-parser: split a trailing
 * ` / Jago <digits>` account suffix off the statement label. */
export function counterpartyDisplay(counterparty: string): CounterpartyDisplay {
	const index = counterparty.lastIndexOf(' / ');
	if (index > 0) {
		const name = counterparty.slice(0, index);
		const suffix = counterparty.slice(index + 3);
		const account = suffix.startsWith('Jago ') ? suffix.slice('Jago '.length) : null;
		if (name.trim() !== '' && account !== null && account !== '' && /^[0-9]+$/.test(account)) {
			return { name, bankAccount: account };
		}
	}
	return { name: counterparty, bankAccount: null };
}

export interface LedgerEntry {
	id: number;
	date: string;
	time: string;
	counterparty: CounterpartyDisplay;
	transactionType: string;
	pocketName: string;
	amountMinor: number;
	amount: string;
	balance: string;
	status: string;
	statusLabel: string;
	statusTone: 'needs' | 'review' | 'approved' | 'changes';
	needsDetails: boolean;
	suppressed: boolean;
	responsibleName: string | null;
}

const LIST_SQL = `SELECT t.id, p.name AS pocket_name, t.txn_date, t.txn_time, t.counterparty,
		t.transaction_type, t.amount_minor, t.balance_minor, t.explanation,
		t.evidence_unavailable_reason, t.status, t.suppressed, t.responsible_membership_id,
		u.name AS responsible_name,
		(SELECT COUNT(*) FROM documents d
		 WHERE d.transaction_id = t.id AND d.kind = 'evidence' AND d.superseded = 0) AS evidence_count
	FROM transactions t
	JOIN pockets p ON p.id = t.pocket_id AND p.org_id = t.org_id
	LEFT JOIN memberships m ON m.id = t.responsible_membership_id
	LEFT JOIN users u ON u.id = m.user_id
	WHERE t.org_id = ?1
	  AND (
	    ?2 = ''
	    OR (?2='pending' AND t.status IN ('pending','submitted')
	        AND (trim(t.explanation) <> '' AND (trim(t.evidence_unavailable_reason) <> ''
	             OR EXISTS (SELECT 1 FROM documents d2 WHERE d2.transaction_id = t.id AND d2.kind = 'evidence' AND d2.superseded = 0))))
	    OR (?2='needs_details' AND t.status IN ('pending','submitted','changes_requested')
	        AND NOT (trim(t.explanation) <> '' AND (trim(t.evidence_unavailable_reason) <> ''
	             OR EXISTS (SELECT 1 FROM documents d2 WHERE d2.transaction_id = t.id AND d2.kind = 'evidence' AND d2.superseded = 0))))
	    OR (?2 NOT IN ('pending','needs_details') AND t.status = ?2)
	  )
	ORDER BY t.txn_date DESC, t.id DESC
	LIMIT ?3 OFFSET ?4`;

function toEntry(row: LedgerRow): LedgerEntry {
	const amountMinor = assertSafeMinor(row.amount_minor, 'ledger amount');
	const evidenceCount = row.evidence_count ?? 0;
	const owed = needsDetails(
		amountMinor,
		row.explanation,
		evidenceCount,
		row.evidence_unavailable_reason,
		row.status
	);
	return {
		id: row.id,
		date: row.txn_date,
		time: row.txn_time ?? '',
		counterparty: counterpartyDisplay(row.counterparty),
		transactionType: row.transaction_type,
		pocketName: row.pocket_name,
		amountMinor,
		amount: fmtMoney(amountMinor),
		balance: fmtMoney(assertSafeMinor(row.balance_minor ?? 0, 'ledger balance')),
		status: row.status,
		statusLabel: statusLabel(row.status, owed),
		statusTone: statusTone(row.status, owed),
		needsDetails: owed,
		suppressed: (row.suppressed ?? 0) !== 0,
		responsibleName: row.responsible_name
	};
}

export interface LedgerPage {
	entries: LedgerEntry[];
	page: number;
	hasNext: boolean;
	owedCount: number;
}

export async function ledgerPage(
	db: D1Database,
	orgId: number,
	filter: LedgerFilter | null,
	page: number
): Promise<LedgerPage> {
	const rows = await qAll<LedgerRow>(db, LIST_SQL, [
		orgId,
		filter ?? '',
		PAGE_SIZE + 1,
		(page - 1) * PAGE_SIZE
	]);
	const hasNext = rows.length > PAGE_SIZE;
	const entries = rows.slice(0, PAGE_SIZE).map(toEntry);
	return { entries, page, hasNext, owedCount: entries.filter((entry) => entry.needsDetails).length };
}

interface EntryRow extends Record<string, unknown> {
	id: number;
	bank_id: string | null;
	txn_date: string;
	txn_time: string | null;
	counterparty: string;
	transaction_type: string;
	bank_notes: string;
	amount_minor: number;
	balance_minor: number | null;
	explanation: string;
	evidence_unavailable_reason: string;
	status: string;
	suppressed: number | null;
	pocket_name: string;
	responsible_name: string | null;
	approved_by_name: string | null;
	approval_note: string;
	evidence_count: number | null;
}

interface SplitRow extends Record<string, unknown> {
	id: number;
	label: string;
	amount_minor: number;
	responsible_name: string | null;
}

export interface LedgerDetail {
	id: number;
	bankId: string | null;
	date: string;
	time: string;
	counterparty: CounterpartyDisplay;
	transactionType: string;
	bankNotes: string;
	pocketName: string;
	amountMinor: number;
	amount: string;
	balance: string;
	explanation: string;
	evidenceUnavailableReason: string;
	evidenceCount: number;
	status: string;
	statusLabel: string;
	statusTone: 'needs' | 'review' | 'approved' | 'changes';
	needsDetails: boolean;
	suppressed: boolean;
	responsibleName: string | null;
	approvedByName: string | null;
	approvalNote: string;
	purposes: Array<{ id: number; label: string; amount: string; responsibleName: string | null }>;
}

const DETAIL_SQL = `SELECT t.id, t.bank_id, t.txn_date, t.txn_time, t.counterparty, t.transaction_type,
		t.bank_notes, t.amount_minor, t.balance_minor, t.explanation, t.evidence_unavailable_reason,
		t.status, t.suppressed, p.name AS pocket_name,
		u.name AS responsible_name, a.name AS approved_by_name, t.approval_note,
		(SELECT COUNT(*) FROM documents d
		 WHERE d.transaction_id = t.id AND d.kind = 'evidence' AND d.superseded = 0) AS evidence_count
	FROM transactions t
	JOIN pockets p ON p.id = t.pocket_id AND p.org_id = t.org_id
	LEFT JOIN memberships m ON m.id = t.responsible_membership_id
	LEFT JOIN users u ON u.id = m.user_id
	LEFT JOIN memberships am ON am.id = t.approved_by_membership_id
	LEFT JOIN users a ON a.id = am.user_id
	WHERE t.id = ?1 AND t.org_id = ?2`;

/** One transaction of this organization. `null` when it does not exist *in this
 * organization*, so a foreign ID cannot be probed. */
export async function ledgerDetail(
	db: D1Database,
	orgId: number,
	id: number
): Promise<LedgerDetail | null> {
	const row = await qOne<EntryRow>(db, DETAIL_SQL, [id, orgId]);
	if (!row) return null;
	const amountMinor = assertSafeMinor(row.amount_minor, 'transaction amount');
	const evidenceCount = row.evidence_count ?? 0;
	const owed = needsDetails(
		amountMinor,
		row.explanation,
		evidenceCount,
		row.evidence_unavailable_reason,
		row.status
	);
	const purposes = await qAll<SplitRow>(
		db,
		`SELECT s.id, s.label, s.amount_minor, u.name AS responsible_name
		 FROM transaction_splits s
		 LEFT JOIN memberships m ON m.id = s.responsible_membership_id
		 LEFT JOIN users u ON u.id = m.user_id
		 WHERE s.transaction_id = ?1 ORDER BY s.id`,
		[id]
	);
	return {
		id: row.id,
		bankId: row.bank_id,
		date: row.txn_date,
		time: row.txn_time ?? '',
		counterparty: counterpartyDisplay(row.counterparty),
		transactionType: row.transaction_type,
		bankNotes: row.bank_notes,
		pocketName: row.pocket_name,
		amountMinor,
		amount: fmtMoney(amountMinor),
		balance: fmtMoney(assertSafeMinor(row.balance_minor ?? 0, 'balance after')),
		explanation: row.explanation,
		evidenceUnavailableReason: row.evidence_unavailable_reason,
		evidenceCount,
		status: row.status,
		statusLabel: statusLabel(row.status, owed),
		statusTone: statusTone(row.status, owed),
		needsDetails: owed,
		suppressed: (row.suppressed ?? 0) !== 0,
		responsibleName: row.responsible_name,
		approvedByName: row.approved_by_name,
		approvalNote: row.approval_note,
		purposes: purposes.map((split) => ({
			id: split.id,
			label: split.label,
			amount: fmtMoney(assertSafeMinor(split.amount_minor, 'purpose amount')),
			responsibleName: split.responsible_name
		}))
	};
}
