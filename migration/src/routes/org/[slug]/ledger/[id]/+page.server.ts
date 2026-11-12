import { error } from '@sveltejs/kit';
import { orgsOfUser, requireMember } from '$lib/server/auth';
import { ledgerDetail } from '$lib/server/ledger';
import type { PageServerLoad } from './$types';

// Per-entry authorization: the row is looked up by (id, org_id) together, so a
// transaction belonging to another organization is reported as missing rather
// than as forbidden. The permission check runs before the lookup.
export const load: PageServerLoad = async (event) => {
	const ctx = await requireMember(event, event.params.slug, 'ViewTransactions');
	const id = /^[0-9]{1,15}$/.test(event.params.id) ? Number(event.params.id) : null;
	if (id === null) throw error(404, 'That transaction does not exist in this organization.');
	const entry = await ledgerDetail(ctx.db, ctx.org.id, id);
	if (!entry) throw error(404, 'That transaction does not exist in this organization.');
	return {
		org: { slug: ctx.org.slug, name: ctx.org.name, isSynthetic: ctx.org.is_synthetic !== 0 },
		user: { name: ctx.user.name },
		organizations: await orgsOfUser(ctx.db, ctx.user.id),
		csrfToken: ctx.session.csrf,
		entry
	};
};
