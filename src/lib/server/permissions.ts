// Organization-scoped permission evaluation, ported from
// crates/domain/src/org.rs and src/domain_map.rs.
//
// This module is the single authorization decision point for the migration
// slice: route code asks `authorize` and renders whatever it returns. UI
// visibility is not authorization — nothing here reads a cookie, a form field
// or a rendered flag.

export const PERMISSIONS = [
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
] as const;

export type Permission = (typeof PERMISSIONS)[number];
/** Alternative permissions for a surface shared by independent modules. */
export type PermissionRequirement = Permission | readonly [Permission, ...Permission[]];

import { PERMISSION_LABELS } from '$lib/domain';

export { PERMISSION_LABELS };

const KNOWN = new Set<string>(PERMISSIONS);

/** Parse a `roles.permissions` JSON array. Unknown or malformed entries are
 * dropped, never widened to a permission. */
export function parseRolePermissions(json: string): Set<Permission> {
	const granted = new Set<Permission>();
	let value: unknown;
	try {
		value = JSON.parse(json);
	} catch {
		return granted;
	}
	if (!Array.isArray(value)) return granted;
	for (const entry of value) {
		if (typeof entry === 'string' && KNOWN.has(entry)) granted.add(entry as Permission);
	}
	return granted;
}

/** One membership row as the permission rule needs it. */
export interface MemberRef {
	userId: string;
	roleId: number;
	/** Removed members stay recorded so attribution survives, but grant
	 * nothing. */
	active: boolean;
}

/** One role row as the permission rule needs it. */
export interface RoleRef {
	id: number;
	permissions: string;
}

/** Union of the permissions of every role of `userId`'s active membership. */
export function permissionsFor(
	members: readonly MemberRef[],
	roles: readonly RoleRef[],
	userId: string
): Set<Permission> {
	const granted = new Set<Permission>();
	const member = members.find((candidate) => candidate.userId === userId);
	if (!member || !member.active) return granted;
	for (const role of roles) {
		if (role.id !== member.roleId) continue;
		for (const permission of parseRolePermissions(role.permissions)) granted.add(permission);
	}
	return granted;
}

export function memberIsActive(members: readonly MemberRef[], userId: string): boolean {
	return members.some((member) => member.userId === userId && member.active);
}

/** Everything an authorization check can reject; the same three outcomes the
 * Rust `DomainError` surfaces to the workspace. */
export type AuthzFailure =
	| { kind: 'NoMembership' }
	| { kind: 'InactiveMembership' }
	| { kind: 'NotAuthorized'; required: Permission };

/** Grants or denies one permission; `null` means allowed. */
export function authorize(
	members: readonly MemberRef[],
	roles: readonly RoleRef[],
	userId: string,
	required: PermissionRequirement
): AuthzFailure | null {
	const member = members.find((candidate) => candidate.userId === userId);
	if (!member) return { kind: 'NoMembership' };
	if (!member.active) return { kind: 'InactiveMembership' };
	const alternatives = typeof required === 'string' ? [required] : required;
	const granted = permissionsFor(members, roles, userId);
	if (alternatives.some((permission) => granted.has(permission))) return null;
	return { kind: 'NotAuthorized', required: alternatives[0]! };
}

/** Organizer-facing denial text; mirrors user_message in src/domain_map.rs. */
export function authzMessage(failure: AuthzFailure): string {
	switch (failure.kind) {
		case 'NoMembership':
		case 'InactiveMembership':
			return 'you are not an active member of this organization';
		case 'NotAuthorized':
			return `your role does not include “${PERMISSION_LABELS[failure.required]}”`;
	}
}
