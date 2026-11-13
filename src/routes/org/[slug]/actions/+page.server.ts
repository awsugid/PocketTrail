import type { D1Database } from '$lib/d1';
import { requireMember, shellContext } from '$lib/server/auth';
import { qAll, qOne } from '$lib/server/db';
import { incomeRecipients } from '$lib/domain';
import type { PageServerLoad } from './$types';

// The in-app action list: the member's own documentation tasks, the reviews
// they are eligible to decide, and in-flight imports. Empty groups must not
// imply an empty ledger, and members without import permission are never
// pointed at importing.

interface TaskRow {
	id: number;
	txn_date: string;
	counterparty: string;
	pocket_name: string;
	amount_minor: number;
	explanation: string;
	evidence_unavailable_reason: string;
	status: string;
	responsible_membership_id: number | null;
}

const OWED_SQL = `SELECT t.id, t.txn_date, t.counterparty, p.name AS pocket_name, t.amount_minor,
		t.explanation, t.evidence_unavailable_reason, t.status, t.responsible_membership_id,
		(EXISTS(SELECT 1 FROM documents d WHERE d.transaction_id = t.id AND d.kind = 'evidence' AND d.superseded = 0)) AS has_evidence
	FROM transactions t JOIN pockets p ON p.id = t.pocket_id AND p.org_id = t.org_id
	WHERE t.org_id = ?1 AND t.suppressed = 0
	ORDER BY t.txn_date ASC, t.id ASC LIMIT 500`;

function isOwed(row: TaskRow & { has_evidence: number }): boolean {
	if (row.amount_minor > 0) return row.explanation.trim() === '';
	const complete = row.explanation.trim() !== '' && (row.has_evidence !== 0 || row.evidence_unavailable_reason.trim() !== '');
	if (row.status === 'approved') return false;
	if (row.status === 'changes_requested') return true;
	return !complete;
}

export const load: PageServerLoad = async (event) => {
	const ctx = await requireMember(event, event.params.slug, 'ViewTransactions');
	const rows = await qAll<TaskRow & { has_evidence: number }>(ctx.db, OWED_SQL, [ctx.org.id]);
	const me = ctx.memberRows.find((m) => m.user_id === ctx.user.id) ?? null;
	const myMembership = me && me.removed_at === null ? me : null;

	// Income routing follows current membership, never stored assignments.
	const incomeMine = new Set<number>();
	if (myMembership) {
		for (const row of rows) {
			if (row.amount_minor > 0) {
				const pocketOwner = await pocketOwnerOf(ctx.db, ctx.org.id, row.id);
				const members: Array<{ id: number; roleId: number; active: boolean }> = ctx.memberRows.map((m) => ({
					id: m.id,
					roleId: m.role_id,
					active: m.removed_at === null
				}));
				if (incomeRecipients(ctx.org.income_explanation_role_id, pocketOwner, members).includes(myMembership.id)) {
					incomeMine.add(row.id);
				}
			}
		}
	}

	const explain: TaskRow[] = [];
	const review: TaskRow[] = [];
	const canApprove = ctx.can('ApproveTransactions');
	const exclusions = await responsibleExclusions(ctx.db, ctx.org.id);
	for (const row of rows) {
		if (!isOwed(row)) continue;
		if (row.amount_minor > 0) {
			if (incomeMine.has(row.id)) explain.push(row);
			continue;
		}
		if (myMembership && row.responsible_membership_id === myMembership.id) {
			explain.push(row);
			continue;
		}
	}
	// Split-level responsibility also routes explanations.
	if (myMembership) {
		const splitMine = await splitResponsibleIds(ctx.db, ctx.org.id, myMembership.id);
		for (const row of rows) {
			if (row.amount_minor <= 0 && isOwed(row) && splitMine.has(row.id) && !explain.some((task) => task.id === row.id)) {
				explain.push(row);
			}
		}
	}
	if (canApprove && myMembership) {
		for (const row of rows) {
			if (row.amount_minor > 0 || !isOwed(row)) continue;
			if (row.status !== 'submitted') continue;
			// Domain gate: reviewers currently or historically responsible for
			// any part cannot decide it.
			if (row.responsible_membership_id === myMembership.id) continue;
			if (exclusions.get(row.id)?.includes(myMembership.id)) continue;
			if (!explain.some((task) => task.id === row.id)) review.push(row);
		}
	}

	let imports: Array<{ id: number; filename: string; status: string }> = [];
	if (ctx.can('ImportStatements')) {
		imports = await qAll<{ id: number; filename: string; status: string }>(
			ctx.db,
			'SELECT id, filename, status FROM import_batches WHERE org_id = ?1 AND status != ?2 ORDER BY id DESC LIMIT 20',
			[ctx.org.id, 'committed']
		);
	}

	const task = (row: TaskRow) => ({
		id: row.id,
		date: row.txn_date,
		counterparty: row.counterparty,
		pocketName: row.pocket_name,
		income: row.amount_minor > 0,
		status: row.status
	});

	return {
		shell: await shellContext(ctx),
		explain: explain.map(task),
		review: review.map(task),
		imports: imports.map((batch) => ({ id: batch.id, filename: batch.filename, status: batch.status })),
		canImport: ctx.can('ImportStatements')
	};
};

async function pocketOwnerOf(db: D1Database, orgId: number, txnId: number): Promise<number | null> {
	const row = await qOne<{ owner_membership_id: number | null }>(
		db,
		'SELECT p.owner_membership_id FROM transactions t JOIN pockets p ON p.id = t.pocket_id AND p.org_id = t.org_id WHERE t.id = ?1 AND t.org_id = ?2',
		[txnId, orgId]
	);
	return row?.owner_membership_id ?? null;
}

async function responsibleExclusions(db: D1Database, orgId: number): Promise<Map<number, number[]>> {
	const rows = await qAll<{ transaction_id: number; membership_id: number }>(
		db,
		`SELECT rh.transaction_id, rh.membership_id FROM responsible_history rh
		 JOIN transactions t ON t.id = rh.transaction_id AND t.org_id = ?1`,
		[orgId]
	);
	const map = new Map<number, number[]>();
	for (const row of rows) {
		const list = map.get(row.transaction_id) ?? [];
		list.push(row.membership_id);
		map.set(row.transaction_id, list);
	}
	return map;
}

async function splitResponsibleIds(db: D1Database, orgId: number, membershipId: number): Promise<Set<number>> {
	const rows = await qAll<{ transaction_id: number }>(
		db,
		`SELECT s.transaction_id FROM transaction_splits s
		 JOIN transactions t ON t.id = s.transaction_id AND t.org_id = ?1
		 WHERE s.responsible_membership_id = ?2`,
		[orgId, membershipId]
	);
	return new Set(rows.map((row) => row.transaction_id));
}