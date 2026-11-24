import { expect, it, vi } from 'vitest';
import { membersOfOrg, requireMember } from '#lib/server/auth.ts';
import { qAll } from '#lib/server/db.ts';
import { deliverOutbox } from '#lib/server/notification_mail.ts';
import { queueDigest } from '#lib/server/settings.ts';
import { runScheduled } from '#lib/server/scheduled.ts';
import { load } from '../src/routes/org/[slug]/settings/email-history/+page.server';

vi.mock('#lib/server/auth.ts', () => ({ membersOfOrg: vi.fn(), requireMember: vi.fn(), shellContext: vi.fn() }));
vi.mock('#lib/server/db.ts', () => ({ qAll: vi.fn(), qOne: vi.fn() }));
vi.mock('#lib/server/settings.ts', () => ({ queueDigest: vi.fn() }));
vi.mock('#lib/server/notification_mail.ts', () => ({ deliverOutbox: vi.fn() }));

it('checks history permission before touching D1', async () => {
	const denied = { status: 403 };
	vi.mocked(requireMember).mockRejectedValueOnce(denied);
	const event = { params: { slug: 'demo' } } as Parameters<typeof load>[0];
	await expect(load(event)).rejects.toBe(denied);
	expect(requireMember).toHaveBeenCalledWith(event, 'demo', 'ViewEmailHistory');
	expect(qAll).not.toHaveBeenCalled();
});

it('queues digests then drains outbox for enabled organizations', async () => {
	const org = { id: 1 };
	vi.mocked(qAll).mockResolvedValueOnce([org]);
	vi.mocked(membersOfOrg).mockResolvedValueOnce([]);
	vi.mocked(queueDigest).mockResolvedValueOnce(2);
	vi.mocked(deliverOutbox).mockResolvedValueOnce({ sent: 1, failed: 1, disabled: false });
	const env = { DB: {} as Parameters<typeof runScheduled>[0]['DB'], APP_ORIGIN: 'https://example.test' };
	await runScheduled(env);
	expect(queueDigest).toHaveBeenCalledWith(env.DB, org, []);
	expect(deliverOutbox).toHaveBeenCalledWith(env, env.DB, org.id, env.APP_ORIGIN);
	expect(queueDigest).toHaveBeenCalledBefore(vi.mocked(deliverOutbox));
});
