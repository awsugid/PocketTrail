// Shared domain rules for organization-scoped purposes and their allocations
// to bank transactions. Pure functions only: the server feeds freshly read
// rows, pages feed drafts, tests feed fixtures.

export type PurposeKind = 'income' | 'expense';

/** A purpose's kind is fixed by the direction of money it records. */
export function purposeKindOf(amountMinor: number): PurposeKind {
	return amountMinor > 0 ? 'income' : 'expense';
}

export const PURPOSE_KIND_LABELS: Record<PurposeKind, string> = {
	income: 'Income',
	expense: 'Expense'
};

/** Persisted purpose status. Draft and Submitted are both explicit here
 * (unlike transactions, which persist both as 'pending'). */
export type PurposeStatus = 'pending' | 'submitted' | 'approved' | 'changes_requested';

export const PURPOSE_STATUSES: readonly PurposeStatus[] = ['pending', 'submitted', 'approved', 'changes_requested'];

export function purposeStatusLabel(status: string, ready: boolean): string {
	switch (status) {
		case 'approved':
			return 'Approved';
		case 'changes_requested':
			return 'Changes requested';
		case 'submitted':
			return 'Pending review';
		default:
			return ready ? 'Ready to submit' : 'Needs details';
	}
}

export function purposeStatusTone(status: string, ready: boolean): 'needs' | 'review' | 'approved' | 'changes' {
	if (status === 'approved') return 'approved';
	if (status === 'changes_requested') return 'changes';
	if (status === 'submitted') return 'review';
	return 'needs';
}

/** Documentation gate for one purpose. Expense purposes need evidence OR
 * nonempty Notes (the Notes field also records the missing-evidence
 * outcome); a reviewer may still approve without evidence. Income purposes
 * need nonempty Notes, like income explanations. */
export function purposeReady(kind: PurposeKind, notes: string, evidenceCount: number): boolean {
	if (kind === 'income') return notes.trim() !== '';
	return notes.trim() !== '' || evidenceCount > 0;
}

/** One allocation row as the allocation editor and validator see it. */
export interface AllocationInput {
	purposeId: number;
	amountMinor: number;
	responsibleMembershipId: number | null;
}

export const MAX_ALLOCATIONS = 100;

/** Validates draft allocations against the bank magnitude. Partial sums are
 * allowed (visible remainder); overallocation and per-row problems are
 * rejected with an organizer-facing message. Nonpositive purpose ids stand
 * for not-yet-created purposes and are validated again once created. */
export function validateAllocations(bankMagnitude: number, rows: readonly AllocationInput[]): string | null {
	if (rows.length === 0) return null; // unallocated is a valid draft state
	if (rows.length > MAX_ALLOCATIONS) return `At most ${MAX_ALLOCATIONS} purposes can be allocated on one transaction.`;
	const seen = new Set<number>();
	let total = 0n;
	for (const row of rows) {
		if (row.purposeId > 0) {
			if (seen.has(row.purposeId)) return 'Each purpose can appear once per transaction.';
			seen.add(row.purposeId);
		} else if (!Number.isInteger(row.purposeId)) {
			return 'A purpose row is invalid.';
		}
		if (!Number.isSafeInteger(row.amountMinor) || row.amountMinor <= 0) {
			return 'Every purpose allocation must be a positive IDR amount.';
		}
		total += BigInt(row.amountMinor);
	}
	if (total > BigInt(bankMagnitude)) return 'Purpose allocations exceed the bank amount.';
	return null;
}

/** Minor units not yet allocated (visible remainder while drafting). */
export function allocationRemainder(bankMagnitude: number, amounts: readonly number[]): number {
	let total = 0n;
	for (const amount of amounts) total += BigInt(amount);
	return bankMagnitude - Number(total);
}

/** Submission gate for an expense transaction: the allocation must be exact. */
export function allocationExact(bankMagnitude: number, amounts: readonly number[]): boolean {
	let total = 0n;
	for (const amount of amounts) total += BigInt(amount);
	return amounts.length > 0 && total === BigInt(bankMagnitude);
}

/** Effective responsible members for one allocation: an explicit allocation
 * override wins; otherwise the purpose's own responsible members; a purpose
 * without any inherits the transaction-level responsible member. */
export function effectiveResponsibles(
	allocationResponsible: number | null,
	purposeResponsibles: readonly number[],
	txnResponsible: number | null
): number[] {
	if (allocationResponsible !== null) return [allocationResponsible];
	if (purposeResponsibles.length > 0) return [...purposeResponsibles];
	return txnResponsible !== null ? [txnResponsible] : [];
}

/** Aggregated status of a transaction's purposes, for the transaction view:
 * approved only when every allocated purpose is approved. */
export function aggregatePurposeStatuses(
	statuses: readonly string[]
): { status: string; label: string; tone: 'needs' | 'review' | 'approved' | 'changes' } {
	if (statuses.length === 0) return { status: 'unallocated', label: 'Unallocated', tone: 'needs' };
	if (statuses.every((s) => s === 'approved')) return { status: 'approved', label: 'Approved', tone: 'approved' };
	if (statuses.some((s) => s === 'changes_requested')) return { status: 'changes_requested', label: 'Changes requested', tone: 'changes' };
	if (statuses.some((s) => s === 'submitted')) return { status: 'submitted', label: 'Pending review', tone: 'review' };
	return { status: 'pending', label: 'Needs details', tone: 'needs' };
}

/** Whether a member may approve a purpose: never a current or historical
 * responsible member of that purpose. */
export function mayApprovePurpose(currentResponsible: readonly number[], historyResponsible: readonly number[], actorMembershipId: number): boolean {
	return !currentResponsible.includes(actorMembershipId) && !historyResponsible.includes(actorMembershipId);
}
