// Pure audit-trail decisions, ported from src/audit_rules.rs. Shared by the
// request-level audit hook and mutation handlers; free of framework types so
// plain Node tests exercise them.

export const PAGE_SIZE = 50;

export interface ObserveDecision {
	action: 'http.post' | 'http.get' | 'document.download';
	/** true: write an attempt row before the handler runs; false: watch only,
	 * recording explicit denials. */
	intent: boolean;
}

/** What the request layer does with a request. `null` = unscoped (login
 * pages, hubs, static assets). */
export function observe(path: string, post: boolean): ObserveDecision | null {
	if (post) return { action: 'http.post', intent: true };
	const seg = path.split('/');
	if (seg[1] === 'org' && seg[3] === 'documents') return { action: 'document.download', intent: true };
	if ((seg[1] === 'org' && seg.length > 2) || path === '/platform' || path.startsWith('/platform/')) {
		return { action: 'http.get', intent: false };
	}
	return null;
}

/** Org slug for /org/:slug/... paths. */
export function orgSlug(path: string): string | null {
	const seg = path.split('/');
	if (seg[1] === 'org') {
		const slug = seg[2];
		return slug ? slug : null;
	}
	return null;
}

/** The bounded set of non-org routes whose targets may persist verbatim.
 * Exact-shape matches, like the Rust patterns: extra trailing segments fail. */
function knownShape(seg: string[]): boolean {
	const [empty, a, b, c, d] = seg;
	if (empty !== '' || (d !== undefined && d !== '')) return false;
	if (a === 'login' && (b === 'dev' || b === 'google') && c === undefined) return true;
	if (a === 'logout' && b === undefined) return true;
	if (a === 'orgs' && b === undefined) return true;
	if (a === 'platform' && b === undefined) return true;
	if (a === 'platform' && b === 'users' && c === 'admin') return true;
	if (a === 'platform' && b === 'role-templates' && c === undefined) return true;
	if (a === 'invitations' && b === 'accept' && c === undefined) return true;
	return false;
}

/** Resource ids are row identifiers: digits only, short enough for i64. */
function numeric(seg: string | undefined): boolean {
	return seg !== undefined && seg !== '' && seg.length <= 18 && seg.split('').every((c) => c >= '0' && c <= '9');
}

/** Invitation ids are opaque random hex; they reduce to a placeholder. */
function opaqueHex(seg: string | undefined): boolean {
	return seg !== undefined && seg !== '' && seg.length <= 128 && /^[0-9a-fA-F]+$/.test(seg);
}

const TXN_VERBS = ['details', 'submit', 'approve', 'request-changes', 'comments', 'documents', 'suppress', 'unsuppress'];
const SETTINGS_HEADS = ['mappings', 'pockets', 'members', 'roles', 'notifications', 'role-templates', 'invitations', 'income-role'];

/** The bounded set of org route shapes after the slug segment. Every dynamic
 * resource id must be numeric; the slug itself is redacted by the caller. */
function knownOrgShape(rest: string[]): boolean {
	// Length checks precede each indexed read, so the fallback keeps the
	// reads total without changing semantics.
	const at = (i: number) => rest[i] ?? '';
	if (rest.length === 1 && rest[0] === 'transactions') return true;
	if (rest.length === 2 && rest[0] === 'transactions' && numeric(at(1))) return true;
	if (rest.length === 3 && rest[0] === 'transactions' && numeric(at(1)) && TXN_VERBS.includes(at(2))) return true;
	if (rest.length === 2 && rest[0] === 'documents' && numeric(at(1))) return true;
	if (rest.length === 1 && rest[0] === 'imports') return true;
	if (rest.length === 2 && rest[0] === 'imports' && numeric(at(1))) return true;
	if (rest.length === 3 && rest[0] === 'imports' && numeric(at(1)) && at(2) === 'confirm') return true;
	if (rest.length === 1 && rest[0] === 'inventory') return true;
	if (rest.length === 2 && rest[0] === 'inventory' && ['items', 'locations', 'stock'].includes(at(1))) return true;
	if (rest.length === 3 && rest[0] === 'inventory' && at(1) === 'items' && numeric(at(2))) return true;
	if (rest.length === 1 && rest[0] === 'settings') return true;
	if (rest.length === 2 && at(0) === 'settings' && SETTINGS_HEADS.includes(at(1))) return true;
	if (rest.length === 4 && at(0) === 'settings' && at(1) === 'mappings' && numeric(at(2)) && at(3) === 'delete') return true;
	if (rest.length === 4 && at(0) === 'settings' && at(1) === 'pockets' && numeric(at(2)) && at(3) === 'owner') return true;
	if (rest.length === 4 && at(0) === 'settings' && at(1) === 'members' && numeric(at(2)) && ['role', 'remove', 'restore'].includes(at(3))) return true;
	if (rest.length === 3 && at(0) === 'settings' && at(1) === 'roles' && numeric(at(2))) return true;
	if (rest.length === 4 && at(0) === 'settings' && at(1) === 'invitations' && opaqueHex(at(2)) && ['revoke', 'resend'].includes(at(3))) return true;
	if (rest.length === 2 && at(0) === 'notifications' && at(1) === 'digest') return true;
	return false;
}

/** Bounded target normalization: only known route shapes persist, resource
 * ids must be numeric, and the org slug is redacted to ":org" — the row's
 * org_id column already carries the scope. Invitation ids never persist. */
export function normalizeTarget(path: string): string {
	if (path.startsWith('/invitations/')) return '/invitations/accept';
	const seg = path.split('/');
	if (seg[0] === '' && seg[1] === 'org' && seg[2] !== undefined && seg[2] !== '') {
		const rest = seg.slice(3);
		if (knownOrgShape(rest)) {
			const copy = [...rest];
			if (copy[0] === 'settings' && copy[1] === 'invitations' && copy.length >= 3) {
				copy[2] = ':invitation';
			}
			return `/org/:org/${copy.join('/')}`;
		}
		return '/unrecognized';
	}
	return knownShape(seg) ? path : '/unrecognized';
}

/** Organizer-facing label for an audit action code. Codes are the stored
 * truth; unknown codes fall back to themselves. */
export function actionLabel(action: string): string {
	switch (action) {
		case 'details_updated': return 'Details saved';
		case 'documentation_submitted': return 'Submitted for review';
		case 'approved': return 'Approved';
		case 'changes_requested': return 'Changes requested';
		case 'evidence_attached': return 'Document attached';
		case 'notifications_suppressed': return 'Notifications suppressed';
		case 'notifications_resumed': return 'Notifications resumed';
		case 'commented': return 'Comment posted';
		case 'auth.login': return 'Signed in';
		case 'auth.logout': return 'Signed out';
		case 'http.post': return 'Form submission';
		case 'http.get': return 'Page viewed';
		case 'document.download': return 'Document downloaded';
		case 'import.staged': return 'Import previewed';
		case 'import.committed': return 'Import confirmed';
		case 'invitation.created': return 'Invitation created';
		case 'invitation.resent': return 'Invitation email resent';
		case 'invitation.revoked': return 'Invitation revoked';
		case 'invitation.accepted': return 'Invitation accepted';
		case 'mapping.created': return 'Actor mapping added';
		case 'mapping.deleted': return 'Actor mapping deleted';
		case 'member.added': return 'Member added';
		case 'member.removed': return 'Member removed';
		case 'member.restored': return 'Member restored';
		case 'member.role_changed': return 'Member role changed';
		case 'notifications.settings_changed': return 'Notification settings changed';
		case 'org.created': return 'Organization created';
		case 'org.roles': return 'Roles changed';
		case 'role.created': return 'Role created';
		case 'role.updated': return 'Role updated';
		case 'pocket.created': return 'Pocket added';
		case 'item.added': return 'Inventory item added';
		case 'location.added': return 'Inventory location added';
		case 'stock.changed': return 'Stock changed';
		case 'transaction.commented': return 'Comment posted';
		case 'transaction.details_updated': return 'Transaction details saved';
		case 'transaction.evidence_attached': return 'Document attached';
		case 'transaction.submitted': return 'Submitted for review';
		case 'transaction.approved': return 'Transaction approved';
		case 'transaction.changes_requested': return 'Changes requested';
		case 'transaction.notifications_suppressed': return 'Transaction notifications suppressed';
		case 'transaction.notifications_resumed': return 'Transaction notifications resumed';
		case 'transaction.created': return 'Transaction recorded manually';
		case 'platform.admin': return 'Platform access changed';
		case 'platform.template': return 'Role template saved';
		default: return action;
	}
}

const digitsOnly = (s: string) => /^[0-9]+$/.test(s);

/** Organizer-facing description of a normalized audit target. Handler-written
 * targets are "kind:identifier" pieces joined by spaces. */
export function targetLabel(target: string): string {
	if (!target.startsWith('/') && target.includes(':')) {
		const parts = target.split(' ').map((piece) => {
			const index = piece.indexOf(':');
			if (index < 0) return piece;
			const kind = piece.slice(0, index);
			const rest = piece.slice(index + 1);
			switch (kind) {
				case 'transaction': return `Transaction #${rest}`;
				case 'import_batch': return `Import batch #${rest}`;
				case 'document': return `Document #${rest}`;
				case 'membership': return `Member ${digitsOnly(rest) ? `#${rest}` : `@${rest}`}`;
				case 'organization': return `Organization /${rest}`;
				case 'item': return `Item ${rest.replaceAll(':', ' · ')}`;
				case 'location': return `Location ${rest}`;
				case 'delta': return `change ${rest}`;
				case 'role': return `Role ${digitsOnly(rest) ? `#${rest}` : rest}`;
				case 'mapping': return `Actor mapping ${rest}`;
				case 'pocket': return `Pocket ${rest}`;
				case 'session': return 'Session';
				default: return piece;
			}
		});
		return parts.join(' · ');
	}
	const seg = target.replace(/^\//, '').split('/');
	const rest = seg[0] === 'org' ? seg.slice(2) : seg;
	// Length checks precede each indexed read; the fallback keeps them total.
	const at = (i: number) => rest[i] ?? '';
	const id = (s: string) => `#${s}`;
	if (rest[0] === 'transactions') {
		if (rest.length === 1) return 'Transactions';
		if (at(1) === 'new') return 'New transaction';
		if (rest.length === 2) return `Transaction ${id(at(1))}`;
		if (rest.length === 3) return `Transaction ${id(at(1))} · ${at(2).replaceAll('-', ' ')}`;
	}
	if (rest[0] === 'documents' && rest.length === 2) return `Document ${id(at(1))}`;
	if (rest[0] === 'imports') {
		if (rest.length === 1) return 'Statement import';
		if (rest.length === 2) return `Import batch ${id(at(1))}`;
		if (rest.length === 3) return `Import batch ${id(at(1))} · confirm`;
	}
	if (rest[0] === 'inventory') {
		if (rest.length === 1) return 'Inventory';
		if (at(1) === 'items' && rest.length === 2) return 'Inventory items';
		if (at(1) === 'items' && rest.length === 3) return `Inventory item ${id(at(2))}`;
		if (at(1) === 'locations') return 'Inventory locations';
		if (at(1) === 'stock') return 'Stock levels';
	}
	if (rest[0] === 'settings') {
		if (rest.length === 1) return 'Settings';
		if (at(1) === 'roles' && rest.length === 2) return 'Roles';
		if (at(1) === 'roles' && rest.length === 3) return `Role ${id(at(2))}`;
		if (at(1) === 'role-templates') return 'Role templates';
		if (at(1) === 'members' && rest.length === 2) return 'Members';
		if (at(1) === 'members' && rest.length === 4) return `Member ${id(at(2))} · ${at(3)}`;
		if (at(1) === 'mappings' && rest.length === 2) return 'Actor mappings';
		if (at(1) === 'mappings' && rest.length === 4) return `Actor mapping ${id(at(2))} · delete`;
		if (at(1) === 'pockets' && rest.length === 2) return 'Pockets';
		if (at(1) === 'notifications') return 'Notification settings';
		if (at(1) === 'invitations' && rest.length === 2) return 'Invitations';
		if (at(1) === 'invitations' && rest.length === 4) return `Invitation · ${at(3)}`;
		if (at(1) === 'income-role') return 'Income explanation role';
	}
	if (rest[0] === 'notifications' && at(1) === 'digest') return 'Weekly digest';
	if ((rest[0] === 'login' && rest.length === 2) || (rest[0] === 'logout' && rest.length === 1) || (rest[0] === 'session' && rest.length === 1)) return 'Session';
	if (rest[0] === 'orgs') return 'Organizations';
	if (rest[0] === 'platform' && rest.length === 1) return 'Global settings';
	if (rest[0] === 'platform' && at(1) === 'users' && at(2) === 'admin') return 'Platform access';
	if (rest[0] === 'platform' && at(1) === 'role-templates') return 'Role templates';
	if (rest[0] === 'invitations' && at(1) === 'accept') return 'Invitation acceptance';
	if (rest[0] === 'unrecognized') return 'Unrecognized address';
	return target;
}

/** Plain-English outcome for the audit table. */
export function outcomeLabel(outcome: string): string {
	switch (outcome) {
		case 'committed': return 'Done';
		case 'denied': return 'Denied';
		case 'failed': return 'Failed';
		case 'attempt':
		case 'attempted': return 'Attempted';
		default: return outcome;
	}
}

/** Outcome for a finished request, or `null` to record nothing. Success on an
 * instrumented mutation returns null: the transaction that made the change
 * writes the committed row itself. */
export function classify(
	target: string,
	action: string,
	intent: boolean,
	actorPresent: boolean,
	status: number
): 'committed' | 'denied' | 'failed' | null {
	if (!intent) {
		// Watched page views record explicit rejections only; anonymous
		// redirects are ordinary browsing, not security events.
		return status === 401 || status === 403 ? 'denied' : null;
	}
	if (status === 401 || status === 403) return 'denied';
	if (status >= 300 && status < 400) {
		if (authOwned(target)) return null;
		if (!actorPresent) return 'denied';
		if (successOwned(target)) return null;
		return 'committed';
	}
	if (status < 400) {
		if (action === 'document.download') return 'committed';
		if (successOwned(target)) return null;
		return 'committed';
	}
	return 'failed';
}

/** Authentication routes record their own committed event (or are no-ops);
 * their redirects never imply a denied request. */
export function authOwned(target: string): boolean {
	return target === '/login/dev' || target === '/login/google' || target === '/logout';
}

/** Sign-in challenge sessions ("preauth:") are not user identities;
 * audit_events.actor_id references users(id). */
export function isRealActor(uid: string): boolean {
	return !uid.startsWith('preauth:');
}

/** Paths whose successful POSTs are recorded transactionally by their own
 * handler/transaction rather than by the request layer. */
export function successOwned(target: string): boolean {
	if (['/orgs', '/invitations/accept', '/platform/users/admin', '/platform/role-templates'].includes(target)) return true;
	const seg = target.split('/');
	if (seg[1] !== 'org') return false;
	return ['transactions', 'imports', 'inventory', 'settings'].includes(seg[3] ?? '');
}

/** 1-based page number from a raw query value (u32-bounded, like Rust). */
export function pageNumber(raw: string | null | undefined): number {
	const value = raw === null || raw === undefined ? NaN : Number(raw);
	return Number.isInteger(value) && value >= 1 && value <= 4_294_967_295 ? value : 1;
}

export function pageOffset(page: number): number {
	return (page - 1) * PAGE_SIZE;
}