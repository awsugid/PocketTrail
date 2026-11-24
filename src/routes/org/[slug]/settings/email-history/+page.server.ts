import { error } from '@sveltejs/kit';
import { requireMember, shellContext } from '#lib/server/auth.ts';
import { qAll, qOne } from '#lib/server/db.ts';
import { validDate } from '#lib/fmt.ts';
import type { PageServerLoad } from './$types';

type EmailRow = { id: number; kind: string; name: string | null; to_address: string; subject: string; status: string; created_at: number };
type Preview = EmailRow & { from_address: string; message_id: string | null; error: string | null; outbox_ids: string | null; text_body: string; html_body: string };
const columns = 'e.id, e.kind, u.name, e.to_address, e.subject, e.status, e.created_at';
const source = `FROM email_log e LEFT JOIN memberships m ON m.id=e.to_membership_id AND m.org_id=e.org_id
	LEFT JOIN users u ON u.id=m.user_id`;

export const load: PageServerLoad = async (event) => {
	const ctx = await requireMember(event, event.params.slug, 'ViewEmailHistory');
	event.setHeaders({ 'cache-control': 'private, no-store' });
	const params = event.url.searchParams;
	const filters = { kind: params.get('kind') ?? '', status: params.get('status') ?? '',
		q: (params.get('q') ?? '').trim().slice(0, 200), from: params.get('from') ?? '', to: params.get('to') ?? '' };
	const clauses = ['e.org_id=?'];
	const args: (string | number)[] = [ctx.org.id];
	if (filters.kind) { clauses.push('e.kind=?'); args.push(filters.kind); }
	if (filters.status) { clauses.push('e.status=?'); args.push(filters.status); }
	if (filters.q) {
		clauses.push('(instr(lower(e.to_address),lower(?))>0 OR instr(lower(u.name),lower(?))>0)');
		args.push(filters.q, filters.q);
	}
	if (validDate(filters.from)) { clauses.push('e.created_at>=?'); args.push(Date.parse(`${filters.from}T00:00:00+07:00`)); }
	if (validDate(filters.to)) { clauses.push('e.created_at<?'); args.push(Date.parse(`${filters.to}T00:00:00+07:00`) + 86_400_000); }
	let parameter = 0;
		const where = `WHERE ${clauses.join(' AND ').replaceAll('?', () => `?${++parameter}`)}`;
	const count = await qOne<{ total: number }>(ctx.db, `SELECT count(*) AS total ${source} ${where}`, args);
	const pages = Math.max(1, Math.ceil((count?.total ?? 0) / 50));
	const page = Math.min(pages, Math.max(1, parseInt(params.get('page') ?? '1', 10) || 1));
	const id = params.get('id');
	const preview = id === null ? null : await qOne<Preview>(ctx.db,
		`SELECT ${columns}, e.from_address, e.message_id, e.error, e.outbox_ids, e.text_body, e.html_body ${source} WHERE e.org_id=?1 AND e.id=?2`,
		[ctx.org.id, id]);
	if (id !== null && !preview) error(404, 'Email not found.');
	return {
		shell: await shellContext(ctx), filters, page, pages, preview,
		can: { roles: ctx.can('ManageRoles'), members: ctx.can('ManageMembers'), mappings: ctx.can('ImportStatements'),
			notifications: ctx.can('ManageNotifications'), aiClients: ctx.can('DocumentTransactions'), emailHistory: true },
		rows: await qAll<EmailRow>(ctx.db, `SELECT ${columns} ${source} ${where} ORDER BY e.created_at DESC, e.id DESC LIMIT 50 OFFSET ?${parameter + 1}`, [...args, (page - 1) * 50]),
		kinds: await qAll<{ kind: string }>(ctx.db, 'SELECT DISTINCT kind FROM email_log WHERE org_id=?1 ORDER BY kind', [ctx.org.id])
	};
};
