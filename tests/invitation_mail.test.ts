import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { testDatabase } from './helpers/sqlite';
import { hashToken } from '#lib/server/tokens.ts';
import { deliverMail, usableBaseUrl } from '#lib/server/invitation_mail.ts';
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
const args = { invitationId: 'invitation', token: 'synthetic-single-use-token', baseUrl: 'https://pocket.example.test' };
let database: ReturnType<typeof testDatabase>;
beforeEach(() => {
	vi.mocked(sendSmtp).mockReset().mockResolvedValue();
	database = testDatabase();
	database.sqlite.exec(`
		INSERT INTO users(id,email,name,created_at) VALUES('actor','actor@example.test','Actor',0);
		INSERT INTO organizations(id,slug,name,created_at) VALUES(1,'synthetic','Synthetic Org',0);
		INSERT INTO roles(id,org_id,name,permissions) VALUES(1,1,'Inventory Maintainer','["UpdateStock"]');
	`);
	database.sqlite.prepare('INSERT INTO invitations(id,org_id,email,role_id,invited_by,created_at,expires_at) VALUES(?,1,?,1,?,0,?)')
		.run(args.invitationId, 'guest@example.test', 'actor', Date.now() + 86400000);
	database.sqlite.prepare("INSERT INTO invitation_mail(invitation_id,token_hash,status,created_at) VALUES(?,?,'pending',0)")
		.run(args.invitationId, hashToken(args.token));
});
afterEach(() => database.sqlite.close());
const row = () => database.sqlite.prepare('SELECT status,error,attempts,sent_at FROM invitation_mail').get();

describe('durable invitation SMTP delivery', () => {
	it('sends the correct recipient, role, expiry and token link, then records acceptance', async () => {
		expect(await deliverMail(env, database.db, args)).toEqual({ sent: true, disabled: false, error: null });
		expect(sendSmtp).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
			to: 'guest@example.test', subject: 'Join Synthetic Org on PocketTrail',
			body: expect.stringContaining(`${args.baseUrl}/invitations/accept?token=${args.token}`)
		}), expect.anything(), undefined, expect.any(Function));
				const log = database.sqlite.prepare('SELECT text_body, html_body FROM email_log').get();
				expect(log).toMatchObject({ text_body: expect.stringContaining('token=••••••'), html_body: expect.stringContaining('token=••••••') });
				expect(JSON.stringify(log)).not.toContain(args.token);
		const message = vi.mocked(sendSmtp).mock.calls[0]![1];
		expect(message.body).toContain('Inventory Maintainer');
		expect(message.body).toContain('expires');
		expect(message.html).toContain('Accept invitation</a>');
		expect(message.html).toContain(`${args.baseUrl}/invitations/accept?token=${args.token}`);
		expect(row()).toEqual({ status: 'sent', error: null, attempts: 1, sent_at: expect.any(Number) });
		expect(JSON.stringify(database.sqlite.prepare('SELECT * FROM invitation_mail').all())).not.toContain(args.token);
	});

	it('leaves local delivery disabled and does not open a socket', async () => {
		expect((await deliverMail({ EMAIL_DELIVERY_ENABLED: 'false' }, database.db, args)).disabled).toBe(true);
		expect(sendSmtp).not.toHaveBeenCalled();
		expect(row()).toMatchObject({ status: 'pending', attempts: 0 });
	});

	it('records invalid configuration without leaking a credential', async () => {
		const outcome = await deliverMail({ ...env, SMTP_HOST: '' }, database.db, args);
		expect(outcome.error).toBe('SMTP_HOST is missing or invalid.');
		expect(sendSmtp).not.toHaveBeenCalled();
		expect(row()).toMatchObject({ status: 'failed', attempts: 1, sent_at: null });
	});

	it('records transport failures with safe text and retains the invitation', async () => {
		vi.mocked(sendSmtp).mockRejectedValue(new Error(`hostile echo ${env.SMTP_PASSWORD} ${args.token}`));
		expect((await deliverMail(env, database.db, args)).error).toBe('SMTP delivery failed.');
		expect(row()).toMatchObject({ status: 'failed', error: 'SMTP delivery failed.', sent_at: null });
		expect(database.sqlite.prepare('SELECT revoked_at,accepted_at FROM invitations').get())
			.toEqual({ revoked_at: null, accepted_at: null });
	});

	it('does not resurrect a token superseded while its email was being sent', async () => {
		vi.mocked(sendSmtp).mockImplementation(async () => {
			database.sqlite.exec("UPDATE invitation_mail SET status='superseded'");
		});
		expect((await deliverMail(env, database.db, args)).sent).toBe(false);
		expect(row()).toMatchObject({ status: 'superseded', sent_at: null });
	});

	it('does not send revoked, expired, accepted or superseded invitations', async () => {
		for (const update of [
			'UPDATE invitations SET revoked_at=1',
			'UPDATE invitations SET expires_at=1',
			"UPDATE invitations SET accepted_at=1,accepted_by='actor'",
			"UPDATE invitation_mail SET status='superseded'"
		]) {
			database.sqlite.prepare('UPDATE invitations SET revoked_at=NULL,accepted_at=NULL,accepted_by=NULL,expires_at=?')
				.run(Date.now() + 86400000);
			database.sqlite.exec("UPDATE invitation_mail SET status='pending'");
			database.sqlite.exec(update);
			expect((await deliverMail(env, database.db, args)).sent).toBe(false);
		}
		expect(sendSmtp).not.toHaveBeenCalled();
	});

	it('requires a real origin rather than a credentialed URL or injected path', () => {
		expect(usableBaseUrl(args.baseUrl)).toBe(true);
		for (const bad of ['https://user:password@example.test', 'https://example.test/path', 'https://example.test\n', 'https://', 'javascript:evil']) {
			expect(usableBaseUrl(bad)).toBe(false);
		}
	});
});
