// Domain decisions and runtime-string mapping, ported from
// crates/domain/src/transaction.rs and src/domain_map.rs.
//
// Status vocabulary: the runtime stores `pending | approved | changes_requested`.
// The domain distinguishes Draft (documentation incomplete) from Submitted
// (complete, awaiting review); both persist as `pending` and the domain state
// is derived from documentation completeness on every read.

export type Permission =
	| 'ViewTransactions'
	| 'CommentTransactions'
	| 'DocumentTransactions'
	| 'ApproveTransactions'
	| 'ImportStatements'
	| 'ManageRoles'
	| 'ManageMembers'
	| 'ManageNotifications'
	| 'SuppressNotifications'
	| 'UpdateStock';

export const PERMISSION_LABELS: Record<Permission, string> = {
	ViewTransactions: 'View transactions',
	CommentTransactions: 'Comment on transactions',
	DocumentTransactions: 'Document transactions',
	ApproveTransactions: 'Approve or request changes',
	ImportStatements: 'Import statements and manage actor mappings',
	ManageRoles: 'Manage roles',
	ManageMembers: 'Manage members',
	ManageNotifications: 'Manage notifications',
	SuppressNotifications: 'Suppress transaction notifications',
	UpdateStock: 'Update stock'
};

/** All permissions in the Rust enum order, for the roles editor. */
export const ALL_PERMISSIONS: Permission[] = [
	'ViewTransactions',
	'CommentTransactions',
	'DocumentTransactions',
	'ApproveTransactions',
	'ImportStatements',
	'ManageRoles',
	'ManageMembers',
	'ManageNotifications',
	'SuppressNotifications',
	'UpdateStock'
];

/** Domain documentation status; Draft and Submitted both persist as "pending". */
export type DocStatus = 'draft' | 'submitted' | 'changes_requested' | 'approved';

export interface Purpose {
	id: string;
	name: string;
	/** Positive integer minor units. */
	amount: number;
	responsibleUserId: string;
}

export interface Documentation {
	explanation: string;
	/** Opaque retained document references (nonblank). */
	evidence: string[];
	evidenceUnavailableReason: string | null;
}

/** One transaction as the domain rules see it. `amount` is the bank amount's
 * positive magnitude; direction supplies the sign. */
export interface DomTxn {
	id: string;
	direction: 'in' | 'out';
	amount: number;
	date: string;
	purposes: Purpose[];
	documentation: Documentation;
	status: DocStatus;
	/** Users ever responsible for any purpose (anti self-approval laundering). */
	approvalExclusions: ReadonlySet<string>;
}

/** Everything a domain decision can reject; user messages mirror
 * domain_map::user_message. */
export type DomainError =
	| { kind: 'NoMembership' }
	| { kind: 'InactiveMembership' }
	| { kind: 'NotAuthorized'; required: Permission }
	| { kind: 'WrongOrganization' }
	| { kind: 'IncompleteDocumentation'; what: string }
	| { kind: 'PurposeTotalMismatch'; bankAmount: number; purposeTotal: number }
	| { kind: 'InvalidStatus'; expected: DocStatus; actual: DocStatus }
	| { kind: 'SelfApprovalDenied' }
	| { kind: 'ResponsibleMemberInactive'; member: string }
	| { kind: 'InvalidAmount'; amount: number }
	| { kind: 'InvalidPurpose'; purpose: string; reason: string }
	| { kind: 'InvalidQuantity'; quantity: number }
	| { kind: 'MissingReason' };

/** Organizer-facing explanation of a domain rejection. Internal state names
 * (Draft/Submitted) never reach the page. */
export function userMessage(e: DomainError): string {
	switch (e.kind) {
		case 'NoMembership':
		case 'InactiveMembership':
			return 'you are not an active member of this organization';
		case 'NotAuthorized':
			return `your role does not include “${PERMISSION_LABELS[e.required]}”`;
		case 'WrongOrganization':
			return 'this record belongs to a different organization';
		case 'IncompleteDocumentation':
			return `documentation is incomplete: ${e.what}`;
		case 'PurposeTotalMismatch':
			return 'purpose allocations must add up to the bank amount';
		case 'InvalidStatus':
			return invalidStatusMessage(e.actual);
		case 'SelfApprovalDenied':
			return 'a member responsible for any part of a transaction cannot approve it';
		case 'ResponsibleMemberInactive':
			return 'a responsible member is no longer active; reassign first';
		case 'InvalidAmount':
			return 'amount must be a positive IDR value';
		case 'InvalidPurpose':
			return `a purpose is invalid: ${e.reason}`;
		case 'InvalidQuantity':
			return 'stock cannot go below zero';
		case 'MissingReason':
			return 'a reason is required';
	}
}

/** Domain status for a persisted transaction. `complete` means documentation
 * would pass validateDocumentation. */
export function runtimeStatus(statusRow: string, complete: boolean): DocStatus {
	if (statusRow === 'approved') return 'approved';
	if (statusRow === 'changes_requested') return 'changes_requested';
	return complete ? 'submitted' : 'draft';
}

/** Badge wording for a persisted status string. */
export function statusLabel(statusRow: string): string {
	switch (statusRow) {
		case 'approved': return 'Approved';
		case 'changes_requested': return 'Changes requested';
		case 'pending':
		case 'submitted': return 'Pending review';
		default: return 'Unknown';
	}
}

/** Transactions still owing documentation (reminders/digest chase these);
 * Submitted items await review by somebody else and are not chased. */
export function documentationOwed(statusRow: string, complete: boolean): boolean {
	const status = runtimeStatus(statusRow, complete);
	return status === 'draft' || status === 'changes_requested';
}

/** Income needs member-authored notes only; bank notes and attachments are
 * context. */
export function incomeComplete(explanation: string): boolean {
	return explanation.trim() !== '';
}

/** Current income explanation routing: active members holding the configured
 * income-responsibility role, else the pocket's active owner. Resolve against
 * current membership on every request, never stored assignments. */
export function incomeRecipients(
	role: number | null,
	owner: number | null,
	members: ReadonlyArray<{ id: number; roleId: number; active: boolean }>
): number[] {
	const recipients = members.filter((m) => m.active && m.roleId === role).map((m) => m.id);
	if (recipients.length > 0) return recipients;
	return members.filter((m) => m.active && m.id === owner).map((m) => m.id);
}

function invalidStatusMessage(actual: DocStatus): string {
	switch (actual) {
		case 'draft': return 'the explanation, purposes, and evidence must be completed before it can be reviewed';
		case 'approved': return 'it is already approved; edit details or evidence to reopen review';
		case 'changes_requested': return 'changes were requested; the responsible member must save details before review';
		case 'submitted': return 'it is already awaiting review';
	}
}

const trimEmpty = (s: string) => s.trim() === '';

/** Validates one transaction's split and documentation without touching it:
 * purposes exist and are well formed, their sum equals the bank amount, and
 * explanation plus evidence (or an explicit evidence-unavailable reason) are
 * present. Membership checks live in the workflow decisions. */
export function validateDocumentation(txn: DomTxn): DomainError | null {
	if (txn.direction === 'in') {
		if (txn.amount <= 0) return { kind: 'InvalidAmount', amount: txn.amount };
		return trimEmpty(txn.documentation.explanation) ? { kind: 'IncompleteDocumentation', what: 'explanation' } : null;
	}
	return validateParts(txn.amount, txn.purposes, txn.documentation);
}

function validateParts(bankAmount: number, purposes: Purpose[], documentation: Documentation): DomainError | null {
	if (bankAmount <= 0) return { kind: 'InvalidAmount', amount: bankAmount };
	if (purposes.length === 0) return { kind: 'IncompleteDocumentation', what: 'purposes' };
	const seen = new Set<string>();
	let total = 0;
	for (const purpose of purposes) {
		if (trimEmpty(purpose.name)) return { kind: 'InvalidPurpose', purpose: purpose.id, reason: 'blank name' };
		if (purpose.amount <= 0) return { kind: 'InvalidPurpose', purpose: purpose.id, reason: 'amount must be positive' };
		if (seen.has(purpose.id)) return { kind: 'InvalidPurpose', purpose: purpose.id, reason: 'duplicate id' };
		seen.add(purpose.id);
		total += purpose.amount;
	}
	if (total !== bankAmount) return { kind: 'PurposeTotalMismatch', bankAmount, purposeTotal: total };
	if (trimEmpty(documentation.explanation)) return { kind: 'IncompleteDocumentation', what: 'explanation' };
	if (documentation.evidence.some((e) => trimEmpty(e))) return { kind: 'IncompleteDocumentation', what: 'evidence' };
	const hasEvidence = documentation.evidence.length > 0;
	const hasReason = documentation.evidenceUnavailableReason !== null && !trimEmpty(documentation.evidenceUnavailableReason);
	if (!hasEvidence && !hasReason) return { kind: 'IncompleteDocumentation', what: 'evidence' };
	return null;
}

/** Access to the organization facts a decision needs. The web layer feeds
 * freshly read rows; no decision may reach for global state. */
export interface DecisionOrg {
	/** Permission set for the acting user (empty for non/removed members). */
	permissionsOf(userId: string): ReadonlySet<Permission>;
	memberIsActive(userId: string): boolean;
	memberExists(userId: string): boolean;
}

function authorize(org: DecisionOrg, actor: string, required: Permission): DomainError | null {
	if (!org.memberExists(actor)) return { kind: 'NoMembership' };
	if (!org.memberIsActive(actor)) return { kind: 'InactiveMembership' };
	if (!org.permissionsOf(actor).has(required)) return { kind: 'NotAuthorized', required };
	return null;
}

function validateResponsible(org: DecisionOrg, purposes: Purpose[]): DomainError | null {
	for (const purpose of purposes) {
		if (!org.memberIsActive(purpose.responsibleUserId)) {
			return { kind: 'ResponsibleMemberInactive', member: purpose.responsibleUserId };
		}
	}
	return null;
}

/** Submits documentation for review. Requires DocumentTransactions. Allowed
 * from draft or changes_requested. */
export function submitTransaction(org: DecisionOrg, txn: DomTxn, actor: string): DomainError | null {
	const denied = authorize(org, actor, 'DocumentTransactions');
	if (denied) return denied;
	if (txn.status !== 'draft' && txn.status !== 'changes_requested') {
		return { kind: 'InvalidStatus', expected: 'draft', actual: txn.status };
	}
	const invalid = validateDocumentation(txn);
	if (invalid) return invalid;
	return validateResponsible(org, txn.purposes);
}

/** Records a reviewer's request for changes. Requires ApproveTransactions;
 * allowed only from submitted. */
export function requestChanges(org: DecisionOrg, txn: DomTxn, actor: string): DomainError | null {
	const denied = authorize(org, actor, 'ApproveTransactions');
	if (denied) return denied;
	if (txn.status !== 'submitted') return { kind: 'InvalidStatus', expected: 'submitted', actual: txn.status };
	return null;
}

/** Approves the whole transaction. Denied for anyone currently or
 * historically responsible for a purpose; only allowed from submitted. */
export function approveTransaction(org: DecisionOrg, txn: DomTxn, actor: string): DomainError | null {
	const denied = authorize(org, actor, 'ApproveTransactions');
	if (denied) return denied;
	if (txn.status !== 'submitted') return { kind: 'InvalidStatus', expected: 'submitted', actual: txn.status };
	const invalid = validateDocumentation(txn);
	if (invalid) return invalid;
	const inactive = validateResponsible(org, txn.purposes);
	if (inactive) return inactive;
	if (txn.purposes.some((p) => p.responsibleUserId === actor) || txn.approvalExclusions.has(actor)) {
		return { kind: 'SelfApprovalDenied' };
	}
	return null;
}