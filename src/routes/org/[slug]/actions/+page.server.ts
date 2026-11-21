import { requireMember, shellContext } from '#lib/server/auth.ts';
import { ownActions } from '#lib/server/own_actions.ts';
import { qAll, qOne } from '#lib/server/db.ts';
import { incomeRecipients } from '#lib/domain.ts';
import { owedPurposeState } from '#lib/server/purposes.ts';
import type { PageServerLoad } from './$types';

// The in-app action list: the member's own documentation tasks and in-flight imports. Expense work on
// allocated transactions is derived from purposes (Notes/evidence gates and
// purpose responsibility); the legacy explanation predicates apply only to
// income and unallocated pre-purpose records. Empty groups must not imply an
// empty ledger, and members without import permission are never pointed at
// importing.

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
	ORDER BY t.txn_date ASC, t.id ASC`;

function isOwed(row: TaskRow & { has_evidence: number }): boolean {
	if (row.amount_minor > 0) return row.explanation.trim() === '';
	const complete = row.explanation.trim() !== '' && (row.has_evidence !== 0 || row.evidence_unavailable_reason.trim() !== '');
	if (row.status === 'approved') return false;
	if (row.status === 'changes_requested') return true;
	return !complete;
}

export const load: PageServerLoad = async (event) => {
	const ctx = await requireMember(event, event.params.slug, ['ViewTransactions', 'ExplainOwnActions']);
		if (ctx.can('ExplainOwnActions')) {
			const tasks = await ownActions(ctx);
			return {
				shell: await shellContext(ctx), restricted: true,
				explain: tasks.map((t) => ({ id: t.id, date: t.txn_date, counterparty: t.counterparty, pocketName: '', income: false, purposeId: undefined as number | undefined, purposeName: undefined as string | undefined, badge: 'Why did this expense happen?' })),
				imports: [], canImport: false
			};
		}
	const rows = await qAll<TaskRow & { has_evidence: number }>(ctx.db, OWED_SQL, [ctx.org.id]);
	const me = ctx.memberRows.find((m) => m.user_id === ctx.user.id) ?? null;
	const myMembership = me && me.removed_at === null ? me : null;

	const purposeState = await owedPurposeState(ctx.db, ctx.org.id);
	const allocated = new Set(purposeState.allocatedTxnIds);

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

	interface Task {
		id: number;
		date: string;
		counterparty: string;
		pocketName: string;
		income: boolean;
		purposeId?: number;
		purposeName?: string;
		badge?: string;
	}
	const explain: Task[] = [];
	const seen = new Set<string>();
	const addExplain = (task: Task) => {
		const key = task.purposeId !== undefined ? `p${task.purposeId}` : `t${task.id}`;
		if (seen.has(key)) return;
		seen.add(key);
		explain.push(task);
	};

	for (const row of rows) {
		if (row.amount_minor > 0) {
			if (isOwed(row) && incomeMine.has(row.id)) {
				addExplain({ id: row.id, date: row.txn_date, counterparty: row.counterparty, pocketName: row.pocket_name, income: true });
			}
			continue;
		}
		// Purposes own documentation on allocated expenses; the legacy
		// predicates only route unallocated pre-purpose records.
		if (allocated.has(row.id)) continue;
		if (myMembership && isOwed(row) && row.responsible_membership_id === myMembership.id) {
			addExplain({ id: row.id, date: row.txn_date, counterparty: row.counterparty, pocketName: row.pocket_name, income: false });
		}
	}
	if (myMembership) {
		for (const owed of purposeState.owedPurposes) {
			if (!owed.effective.includes(myMembership.id)) continue;
			addExplain({
				id: owed.txnId,
				date: owed.txnDate,
				counterparty: owed.counterparty,
				pocketName: owed.pocketName,
				income: false,
				purposeId: owed.purposeId,
				purposeName: owed.purposeName,
				badge: owed.status === 'changes_requested' ? 'Changes requested' : 'Needs details'
			});
		}
		for (const remainder of purposeState.remainders) {
			if (remainder.responsibleId !== myMembership.id) continue;
			addExplain({
				id: remainder.txnId,
				date: remainder.txnDate,
				counterparty: remainder.counterparty,
				pocketName: remainder.pocketName,
				income: false,
				badge: 'Unallocated'
			});
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

	return {
		shell: await shellContext(ctx),
		explain,

		imports: imports.map((batch) => ({ id: batch.id, filename: batch.filename, status: batch.status })),
		restricted: false,
		canImport: ctx.can('ImportStatements')
	};
};

async function pocketOwnerOf(db: Parameters<typeof qOne>[0], orgId: number, txnId: number): Promise<number | null> {
	const row = await qOne<{ owner_membership_id: number | null }>(
		db,
		'SELECT p.owner_membership_id FROM transactions t JOIN pockets p ON p.id = t.pocket_id AND p.org_id = t.org_id WHERE t.id = ?1 AND t.org_id = ?2',
		[txnId, orgId]
	);
	return row?.owner_membership_id ?? null;
}
