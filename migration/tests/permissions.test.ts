import { describe, expect, it } from 'vitest';
import {
	authorize,
	authzMessage,
	memberIsActive,
	parseRolePermissions,
	permissionsFor,
	type MemberRef,
	type RoleRef
} from '../src/lib/server/permissions';

// A membership holds exactly one role_id in the schema (migrations/0001_init.sql),
// so these fixtures keep that invariant.
const roles: RoleRef[] = [
	{ id: 1, permissions: '["ViewTransactions","DocumentTransactions"]' },
	{ id: 2, permissions: '["ViewTransactions"]' },
	{ id: 3, permissions: '[]' }
];

const members: MemberRef[] = [
	{ userId: 'alice', roleId: 1, active: true },
	{ userId: 'bob', roleId: 2, active: true },
	{ userId: 'carol', roleId: 3, active: true },
	{ userId: 'dave', roleId: 1, active: false },
	{ userId: 'erin', roleId: 99, active: true }
];

describe('role permission parsing', () => {
	it('reads the stored JSON array', () => {
		expect([...parseRolePermissions('["ManageRoles","UpdateStock"]')]).toEqual([
			'ManageRoles',
			'UpdateStock'
		]);
	});

	it('drops unknown and malformed entries instead of widening access', () => {
		expect([...parseRolePermissions('["ViewTransactions","Superuser",7,null]')]).toEqual([
			'ViewTransactions'
		]);
		expect(parseRolePermissions('not json').size).toBe(0);
		expect(parseRolePermissions('{"ViewTransactions":true}').size).toBe(0);
		expect(parseRolePermissions('').size).toBe(0);
	});
});

describe('permission evaluation', () => {
	it('unions the roles of an active membership', () => {
		expect([...permissionsFor(members, roles, 'alice')]).toEqual([
			'ViewTransactions',
			'DocumentTransactions'
		]);
	});

	it('grants nothing to a removed member', () => {
		expect(permissionsFor(members, roles, 'dave').size).toBe(0);
		expect(memberIsActive(members, 'dave')).toBe(false);
	});

	it('grants nothing to a non-member', () => {
		expect(permissionsFor(members, roles, 'nobody').size).toBe(0);
	});

	it('grants nothing when the role row is missing', () => {
		expect(permissionsFor(members, roles, 'erin').size).toBe(0);
	});

	it('distinguishes the three denial reasons', () => {
		expect(authorize(members, roles, 'nobody', 'ViewTransactions')).toEqual({
			kind: 'NoMembership'
		});
		expect(authorize(members, roles, 'dave', 'ViewTransactions')).toEqual({
			kind: 'InactiveMembership'
		});
		expect(authorize(members, roles, 'bob', 'DocumentTransactions')).toEqual({
			kind: 'NotAuthorized',
			required: 'DocumentTransactions'
		});
		expect(authorize(members, roles, 'carol', 'ViewTransactions')).toEqual({
			kind: 'NotAuthorized',
			required: 'ViewTransactions'
		});
	});

	it('grants a held permission', () => {
		expect(authorize(members, roles, 'alice', 'DocumentTransactions')).toBeNull();
		expect(authorize(members, roles, 'bob', 'ViewTransactions')).toBeNull();
	});

	it('never treats a removed member as authorized even with a valid role', () => {
		expect(authorize(members, roles, 'dave', 'ViewTransactions')).not.toBeNull();
	});
});

describe('denial wording', () => {
	it('matches the organizer-facing messages without leaking internals', () => {
		expect(authzMessage({ kind: 'NoMembership' })).toBe(
			'you are not an active member of this organization'
		);
		expect(authzMessage({ kind: 'InactiveMembership' })).toBe(
			'you are not an active member of this organization'
		);
		expect(authzMessage({ kind: 'NotAuthorized', required: 'ViewTransactions' })).toBe(
			'your role does not include “View transactions”'
		);
	});
});
