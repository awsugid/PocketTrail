import { describe, expect, it } from 'vitest';

import {
	approveTransaction,
	documentationOwed,
	incomeComplete,
	incomeRecipients,
	requestChanges,
	runtimeStatus,
	statusLabel,
	submitTransaction,
	userMessage,
	validateDocumentation,
	type DecisionOrg,
	type DomTxn
} from '$lib/domain';

function org(grants: ReadonlySet<string>): DecisionOrg {
	return {
		memberExists: () => true,
		memberIsActive: () => true,
		permissionsOf: () => grants as ReadonlySet<never>
	};
}

const ACTIVE = org(new Set(['ViewTransactions', 'DocumentTransactions', 'ApproveTransactions']));

function expenseTxn(overrides: Partial<DomTxn> = {}): DomTxn {
	return {
		id: '1',
		direction: 'out',
		amount: 1_500_000,
		date: '2025-06-01',
		purposes: [
			{ id: '1', name: 'Workshop supplies', amount: 900_000, responsibleUserId: 'alice' },
			{ id: '2', name: 'Attendee coffee', amount: 600_000, responsibleUserId: 'bob' }
		],
		documentation: { explanation: 'June meetup', evidence: ['org/1/transactions/1/tok'], evidenceUnavailableReason: null },
		status: 'draft',
		approvalExclusions: new Set<string>(),
		...overrides
	};
}

describe('validateDocumentation', () => {
	it('accepts a complete expense', () => {
		expect(validateDocumentation(expenseTxn())).toBeNull();
	});
	it('income needs notes only', () => {
		const income: DomTxn = { ...expenseTxn(), direction: 'in', purposes: [], documentation: { explanation: 'Ticket sales', evidence: [], evidenceUnavailableReason: null } };
		expect(validateDocumentation(income)).toBeNull();
		expect(validateDocumentation({ ...income, documentation: { explanation: '  ', evidence: [], evidenceUnavailableReason: null } })).toMatchObject({ kind: 'IncompleteDocumentation' });
	});
	it('rejects blank names, nonpositive amounts, duplicate ids, and mismatched totals', () => {
		expect(validateDocumentation(expenseTxn({ purposes: [{ id: '1', name: '  ', amount: 100, responsibleUserId: 'a' }] }))).toMatchObject({ kind: 'InvalidPurpose', reason: 'blank name' });
		expect(validateDocumentation(expenseTxn({ purposes: [{ id: '1', name: 'x', amount: 0, responsibleUserId: 'a' }] }))).toMatchObject({ kind: 'InvalidPurpose', reason: 'amount must be positive' });
		expect(validateDocumentation(expenseTxn({ purposes: [
			{ id: '1', name: 'x', amount: 750_000, responsibleUserId: 'a' },
			{ id: '1', name: 'y', amount: 750_000, responsibleUserId: 'a' }
		] }))).toMatchObject({ kind: 'InvalidPurpose', reason: 'duplicate id' });
		expect(validateDocumentation(expenseTxn({ amount: 1_000 }))).toMatchObject({ kind: 'PurposeTotalMismatch' });
	});
	it('requires empty purposes list to be reported as missing purposes', () => {
		expect(validateDocumentation(expenseTxn({ purposes: [] }))).toMatchObject({ kind: 'IncompleteDocumentation', what: 'purposes' });
	});
	it('requires evidence or an explicit unavailable reason', () => {
		expect(validateDocumentation(expenseTxn({ documentation: { explanation: 'x', evidence: [], evidenceUnavailableReason: null } }))).toMatchObject({ kind: 'IncompleteDocumentation', what: 'evidence' });
		expect(validateDocumentation(expenseTxn({ documentation: { explanation: 'x', evidence: [], evidenceUnavailableReason: 'No receipt issued' } }))).toBeNull();
		expect(validateDocumentation(expenseTxn({ documentation: { explanation: 'x', evidence: ['  '], evidenceUnavailableReason: null } }))).toMatchObject({ kind: 'IncompleteDocumentation', what: 'evidence' });
	});
});

describe('workflow decisions', () => {
	it('submit moves draft to submitted and enforces documentation', () => {
		expect(submitTransaction(ACTIVE, expenseTxn(), 'carol')).toBeNull();
		expect(submitTransaction(ACTIVE, expenseTxn({ documentation: { explanation: '', evidence: [], evidenceUnavailableReason: null } }), 'carol')).toMatchObject({ kind: 'IncompleteDocumentation' });
		expect(submitTransaction(ACTIVE, expenseTxn({ status: 'submitted' }), 'carol')).toMatchObject({ kind: 'InvalidStatus' });
		expect(submitTransaction(org(new Set(['ViewTransactions'])), expenseTxn(), 'carol')).toMatchObject({ kind: 'NotAuthorized', required: 'DocumentTransactions' });
	});
	it('income with notes needs no purposes, evidence, or approval', () => {
		const income = expenseTxn({ direction: 'in', purposes: [], documentation: { explanation: 'Member income notes', evidence: [], evidenceUnavailableReason: null } });
		expect(validateDocumentation(income)).toBeNull();
		expect(income.documentation.evidence.push('attachment')).toBe(1);
		expect(validateDocumentation({ ...income, documentation: { explanation: ' \n\t', evidence: ['attachment'], evidenceUnavailableReason: null } })).toMatchObject({ kind: 'IncompleteDocumentation', what: 'explanation' });
	});
	it('approval only from submitted, comments never revert it', () => {
		const draft = expenseTxn();
		expect(approveTransaction(ACTIVE, draft, 'carol')).toMatchObject({ kind: 'InvalidStatus', expected: 'submitted', actual: 'draft' });
	});
	it('approve requires submitted state and excludes any responsible member', () => {
		const submitted = expenseTxn({ status: 'submitted' });
		expect(approveTransaction(ACTIVE, submitted, 'carol')).toBeNull();
		expect(approveTransaction(ACTIVE, submitted, 'alice')).toMatchObject({ kind: 'SelfApprovalDenied' });
		expect(approveTransaction(ACTIVE, submitted, 'bob')).toMatchObject({ kind: 'SelfApprovalDenied' });
		const historical = expenseTxn({ status: 'submitted', approvalExclusions: new Set(['dana']) });
		expect(approveTransaction(ACTIVE, historical, 'dana')).toMatchObject({ kind: 'SelfApprovalDenied' });
	});
	it('approve denies inactive responsible members', () => {
		// alice is in the membership but removed; the purposes she is
		// responsible for block approval until reassigned.
		const realOrg: DecisionOrg = {
			memberExists: (u) => u === 'carol' || u === 'alice' || u === 'bob',
			memberIsActive: (u) => u === 'carol' || u === 'bob',
			permissionsOf: (u) => (u === 'carol' ? new Set(['ApproveTransactions']) : new Set())
		};
		const submitted = expenseTxn({
			status: 'submitted',
			purposes: [{ id: '1', name: 'All supplies', amount: 1_500_000, responsibleUserId: 'alice' }]
		});
		expect(approveTransaction(realOrg, submitted, 'carol')).toMatchObject({ kind: 'ResponsibleMemberInactive' });
	});

	it('review decisions require the approval permission and submitted state', () => {
		const submitted = expenseTxn({ status: 'submitted' });
		const viewer: DecisionOrg = { memberExists: () => true, memberIsActive: () => true, permissionsOf: () => new Set() };
		expect(requestChanges(viewer, submitted, 'carol')).toMatchObject({ kind: 'NotAuthorized' });
		expect(approveTransaction(viewer, submitted, 'carol')).toMatchObject({ kind: 'NotAuthorized' });
		const approver = org(new Set(['ApproveTransactions']));
		expect(requestChanges(approver, submitted, 'carol')).toBeNull();
		expect(requestChanges(approver, expenseTxn({ status: 'draft' }), 'carol')).toMatchObject({ kind: 'InvalidStatus' });
		const removedMember: DecisionOrg = { memberExists: () => true, memberIsActive: () => false, permissionsOf: () => new Set(['ApproveTransactions']) };
		expect(approveTransaction(removedMember, submitted, 'carol')).toMatchObject({ kind: 'InactiveMembership' });
		const outsider: DecisionOrg = { memberExists: () => false, memberIsActive: () => false, permissionsOf: () => new Set() };
		expect(approveTransaction(outsider, submitted, 'carol')).toMatchObject({ kind: 'NoMembership' });
	});
});

describe('status mapping', () => {
	it('draft and submitted both persist as pending', () => {
		expect(runtimeStatus('pending', true)).toBe('submitted');
		expect(runtimeStatus('pending', false)).toBe('draft');
		expect(runtimeStatus('approved', true)).toBe('approved');
		expect(runtimeStatus('changes_requested', false)).toBe('changes_requested');
		expect(documentationOwed('pending', false)).toBe(true);
		expect(documentationOwed('pending', true)).toBe(false);
		expect(documentationOwed('changes_requested', false)).toBe(true);
		expect(documentationOwed('approved', true)).toBe(false);
		expect(statusLabel('pending')).toBe('Pending review');
		expect(statusLabel('approved')).toBe('Approved');
	});
});

describe('income routing', () => {
	const members = [
		{ id: 1, roleId: 10, active: true },
		{ id: 2, roleId: 10, active: true },
		{ id: 3, roleId: 10, active: false },
		{ id: 4, roleId: 20, active: true }
	];
	it('follows current role membership with pocket-owner fallback', () => {
		expect(incomeRecipients(10, 4, members)).toEqual([1, 2]);
		expect(incomeRecipients(20, 1, members)).toEqual([4]);
		expect(incomeRecipients(30, 4, members)).toEqual([4]);
		expect(incomeRecipients(null, 4, members)).toEqual([4]);
		expect(incomeRecipients(null, 3, members)).toEqual([]);
		expect(incomeRecipients(null, null, members)).toEqual([]);
		expect(incomeComplete(' \n\t')).toBe(false);
		expect(incomeComplete('Member explanation')).toBe(true);
	});
});

describe('user messages hide internal states', () => {
	it('never names Draft or Submitted', () => {
		const m = userMessage({ kind: 'InvalidStatus', expected: 'submitted', actual: 'draft' });
		expect(m).not.toContain('Draft');
		expect(m).not.toContain('Submitted');
		expect(m).toContain('completed');
		expect(userMessage({ kind: 'SelfApprovalDenied' })).toContain('cannot approve');
		expect(userMessage({ kind: 'NotAuthorized', required: 'ViewTransactions' })).toContain('View transactions');
	});
});
