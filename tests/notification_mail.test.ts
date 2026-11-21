import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { testDatabase } from './helpers/sqlite';
import {
	ASSIGNMENT_LIST_CAP,
	assignmentMessage,
	deliverOutbox,
	digestTxnIds,
	MAX_ATTEMPTS,
	scheduleDelivery
} from '#lib/server/notification_mail.ts';
import { sendSmtp } from '#lib/server/smtp.ts';

vi.mock('cloudflare:sockets', () => ({ connect: vi.fn() }));
vi.mock('#lib/server/smtp.ts', async (original) => {
	const real = await original<typeof import('#lib/server/smtp.ts')>();
	return { ...real, sendSmtp: vi.fn() };
});

const env = {
	EMAIL_DELIVERY_ENABLED: 'true',
	SMTP_HOST: 'mail.example.test', SMTP_PORT: '587', SMTP_USERNAME: 'sender@example.test',
	SMTP_PASSWORD: 'synthetic-password', SMTP_FROM: 'sender@example.test'
};
const base = 'https://pocket.example.test';
let database: ReturnType<typeof testDatabase>;

beforeEach(() => {
	vi.mocked(sendSmtp).mockReset().mockResolvedValue();
	database = testDatabase();
	database.sqlite.exec(`
		INSERT INTO users(id,email,name,google_sub,created_at) VALUES('alice','alice@example.test','Alice','g-alice',0),('bob','bob@example.test','Bob','g-bob',0);
		INSERT INTO users(id,email,name,created_at) VALUES('invite:abc','guest@example.test','guest@example.test',0);
		INSERT INTO organizations(id,slug,name,notifications_enabled,notification_cutoff_date,created_at) VALUES(1,'synthetic','Synthetic Org',1,'2025-01-01',0);
		INSERT INTO roles(id,org_id,name,permissions) VALUES(1,1,'Member','["ViewTransactions"]');
		INSERT INTO memberships(id,org_id,user_id,role_id,handle,created_at,invited) VALUES(1,1,'alice',1,'alice',0,0),(2,1,'bob',1,'bob',0,0),(3,1,'invite:abc',1,'invite:abc',0,1);
		INSERT INTO pockets(id,org_id,name,owner_membership_id) VALUES(1,1,'Main',1);
	`);
});
afterEach(() => database.sqlite.close());

function txn(id: number, amountMinor = -1_500_000, date = '2025-03-04', counterparty = 'Toko Maju / Jago 123') {
	database.sqlite.prepare('INSERT INTO transactions(id,org_id,pocket_id,txn_date,counterparty,amount_minor,created_at,updated_at) VALUES(?,1,1,?,?,?,0,0)')
		.run(id, date, counterparty, amountMinor);
}
function outbox(kind: string, to: number, txnId: number | null, body = 'stored body') {
	return Number(database.sqlite.prepare('INSERT INTO notification_outbox(org_id,kind,to_membership_id,transaction_id,subject,body,created_at) VALUES(1,?,?,?,?,?,?)')
		.run(kind, to, txnId, `Subject ${kind}`, body, Date.now()).lastInsertRowid);
}
const rows = () => database.sqlite.prepare('SELECT id,sent_at,attempts,last_error FROM notification_outbox ORDER BY id').all() as Array<{ id: number; sent_at: number | null; attempts: number; last_error: string | null }>;
const sentMessages = () => vi.mocked(sendSmtp).mock.calls.map((call) => call[1]);

describe('notification outbox email delivery', () => {
	it('batches assignment rows into one email per recipient with financial details and links', async () => {
		for (const id of [1, 2, 3]) { txn(id, id === 2 ? 2_500_000 : -1_500_000); outbox('assignment', 1, id); }
		txn(4); outbox('assignment', 2, 4);
		expect(await deliverOutbox(env, database.db, 1, base)).toEqual({ sent: 2, failed: 0, disabled: false });
		const messages = sentMessages();
		expect(messages.map((m) => m.to).sort()).toEqual(['alice@example.test', 'bob@example.test']);
		const alice = messages.find((m) => m.to === 'alice@example.test')!;
		expect(alice.subject).toBe('3 transactions need your documentation — Synthetic Org');
		expect(alice.body).toContain(`${base}/org/synthetic/transactions/1`);
		expect(alice.body).toContain(`${base}/org/synthetic/transactions/3`);
		expect(alice.body).toContain('4 Mar 2025 · Toko Maju · -Rp 15.000');
		expect(alice.body).toContain('Rp 25.000');
		expect(alice.html).toContain('-Rp 15.000');
		expect(alice.body).not.toContain('invited');
		expect(rows().every((r) => r.sent_at !== null && r.attempts === 1 && r.last_error === null)).toBe(true);
		// Already-sent rows are never resent.
		expect(await deliverOutbox(env, database.db, 1, base)).toEqual({ sent: 0, failed: 0, disabled: false });
		expect(sendSmtp).toHaveBeenCalledTimes(2);
	});

	it('caps the listed assignments with an "and N more" line', () => {
		const items = Array.from({ length: ASSIGNMENT_LIST_CAP + 7 }, (_, i) => ({ txnId: i + 1, date: '2025-01-02', counterparty: 'X', amountMinor: -100 }));
		const message = assignmentMessage({ name: 'Org', slug: 'org' }, { email: 'a@example.test', name: 'A', invited: false }, items, base);
		expect(message.body).toContain('and 7 more');
		expect(message.body).toContain(`${base}/org/org/transactions/${ASSIGNMENT_LIST_CAP}\n`);
		expect(message.body).not.toContain(`/transactions/${ASSIGNMENT_LIST_CAP + 1}\n`);
	});

	it('adds the sign-in note for invited members without any invitation token', async () => {
		txn(1); outbox('assignment', 3, 1);
		outbox('mention', 3, 1);
		outbox('digest', 3, null, 'Weekly digest\nDocumentation task — /org/synthetic/transactions/1\n');
		database.sqlite.exec("INSERT INTO invitations(id,org_id,email,role_id,invited_by,created_at,expires_at) VALUES('inv',1,'guest@example.test',1,'alice',0,9999999999999)");
		expect((await deliverOutbox(env, database.db, 1, base)).sent).toBe(3);
		for (const message of sentMessages()) {
			expect(message.to).toBe('guest@example.test');
			expect(message.body).toContain("You've been invited to Synthetic Org");
			expect(message.body).toContain(`sign in with Google using guest@example.test at ${base}/login`);
			expect(message.html).toContain(`${base}/login`);
			expect(message.body).not.toMatch(/token|invitations\/accept/i);
			expect(message.html).not.toMatch(/token=|invitations\/accept/i);
		}
		const digest = sentMessages().find((m) => m.subject.startsWith('Documentation digest'))!;
		expect(digest.body).toContain(`Documentation task — ${base}/org/synthetic/transactions/1`);
		expect(digest.body).not.toContain('Rp');
		const mention = sentMessages().find((m) => m.subject.startsWith('You were mentioned'))!;
		expect(mention.body).not.toContain('Rp');
	});

	it('sends one email per mention and per digest row', async () => {
		txn(1);
		outbox('mention', 1, 1); outbox('mention', 1, 1);
		outbox('digest', 1, null, 'x /org/synthetic/transactions/1\n'); outbox('digest', 2, null, '');
		expect((await deliverOutbox(env, database.db, 1, base)).sent).toBe(4);
	});

	it('sends nothing and records nothing while EMAIL_DELIVERY_ENABLED is not true', async () => {
		txn(1); outbox('assignment', 1, 1);
		for (const flag of [undefined, 'false', 'TRUE']) {
			expect(await deliverOutbox({ ...env, EMAIL_DELIVERY_ENABLED: flag }, database.db, 1, base))
				.toEqual({ sent: 0, failed: 0, disabled: true });
		}
		expect(sendSmtp).not.toHaveBeenCalled();
		expect(rows()).toEqual([expect.objectContaining({ sent_at: null, attempts: 0, last_error: null })]);
	});

	it('records failures, retries on the next call, and stops at the attempt cap', async () => {
		txn(1); outbox('assignment', 1, 1);
		vi.mocked(sendSmtp).mockRejectedValue(new Error(`hostile echo ${env.SMTP_PASSWORD}`));
		for (let i = 1; i <= MAX_ATTEMPTS; i += 1) {
			expect(await deliverOutbox(env, database.db, 1, base)).toEqual({ sent: 0, failed: 1, disabled: false });
			expect(rows()[0]).toMatchObject({ sent_at: null, attempts: i, last_error: 'SMTP delivery failed.' });
		}
		expect(await deliverOutbox(env, database.db, 1, base)).toEqual({ sent: 0, failed: 0, disabled: false });
		expect(sendSmtp).toHaveBeenCalledTimes(MAX_ATTEMPTS);
	});

	it('succeeds on retry after a failure', async () => {
		txn(1); outbox('assignment', 1, 1);
		vi.mocked(sendSmtp).mockRejectedValueOnce(new Error('down'));
		await deliverOutbox(env, database.db, 1, base);
		expect((await deliverOutbox(env, database.db, 1, base)).sent).toBe(1);
		expect(rows()[0]).toMatchObject({ attempts: 2, last_error: null, sent_at: expect.any(Number) });
	});

	it('records invalid SMTP configuration without spending attempts', async () => {
		txn(1); outbox('assignment', 1, 1);
		expect((await deliverOutbox({ ...env, SMTP_HOST: '' }, database.db, 1, base)).failed).toBe(1);
		expect(rows()[0]).toMatchObject({ attempts: 0, last_error: 'SMTP_HOST is missing or invalid.', sent_at: null });
		expect(sendSmtp).not.toHaveBeenCalled();
	});

	it('skips cancelled, suppressed, removed-member, pre-cutoff and notifications-off rows', async () => {
		txn(1); const cancelled = outbox('assignment', 1, 1);
		database.sqlite.prepare('UPDATE notification_outbox SET cancelled_at=1 WHERE id=?').run(cancelled);
		txn(2); database.sqlite.exec('UPDATE transactions SET suppressed=1 WHERE id=2'); outbox('assignment', 1, 2);
		txn(3, -100, '2024-12-31'); outbox('assignment', 1, 3);
		txn(4); outbox('assignment', 2, 4);
		database.sqlite.exec('UPDATE memberships SET removed_at=1 WHERE id=2');
		expect(await deliverOutbox(env, database.db, 1, base)).toEqual({ sent: 0, failed: 0, disabled: false });
		// A pre-cutoff mention is still deliverable; notifications-off stops it.
		outbox('mention', 1, 3);
		database.sqlite.exec('UPDATE organizations SET notifications_enabled=0');
		expect((await deliverOutbox(env, database.db, 1, base)).sent).toBe(0);
		database.sqlite.exec('UPDATE organizations SET notifications_enabled=1');
		expect((await deliverOutbox(env, database.db, 1, base)).sent).toBe(1);
		expect(sendSmtp).toHaveBeenCalledTimes(1);
	});

	it('does not resend a row claimed by a concurrent delivery', async () => {
		txn(1); outbox('assignment', 1, 1);
		vi.mocked(sendSmtp).mockImplementation(async () => {
			expect(await deliverOutbox(env, database.db, 1, base)).toEqual({ sent: 0, failed: 0, disabled: false });
		});
		expect((await deliverOutbox(env, database.db, 1, base)).sent).toBe(1);
		expect(sendSmtp).toHaveBeenCalledTimes(1);
	});

	it('extracts digest transaction links', () => {
		expect(digestTxnIds('a\nDocumentation task — /org/s/transactions/12\nDocumentation task — /org/s/transactions/3\n', 's')).toEqual([12, 3]);
	});
});

describe('scheduleDelivery', () => {
	const event = (flag: string, waitUntil?: (p: Promise<unknown>) => void) => ({
		url: new URL(`${base}/org/synthetic/imports/1`),
		platform: { env: { ...env, EMAIL_DELIVERY_ENABLED: flag, DB: database.db }, ctx: waitUntil ? { waitUntil } : undefined }
	}) as unknown as Parameters<typeof scheduleDelivery>[0];

	it('hands delivery to waitUntil when available', async () => {
		txn(1); outbox('assignment', 1, 1);
		const pending: Promise<unknown>[] = [];
		expect(await scheduleDelivery(event('true', (p) => pending.push(p)), database.db, 1)).toBe(true);
		expect(pending).toHaveLength(1);
		await Promise.all(pending);
		expect(sendSmtp).toHaveBeenCalledTimes(1);
	});

	it('awaits inline without an execution context, and reports disabled delivery', async () => {
		txn(1); outbox('assignment', 1, 1);
		expect(await scheduleDelivery(event('false'), database.db, 1)).toBe(false);
		expect(sendSmtp).not.toHaveBeenCalled();
		expect(await scheduleDelivery(event('true'), database.db, 1)).toBe(true);
		expect(sendSmtp).toHaveBeenCalledTimes(1);
	});

	it('never throws when delivery itself fails', async () => {
		const broken = { prepare: () => { throw new Error('db down'); }, batch: async () => [] } as never;
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
		await expect(scheduleDelivery(event('true'), broken, 1)).resolves.toBe(true);
		spy.mockRestore();
	});
});
