import type { D1Database } from '#lib/d1.ts';
import { membersOfOrg, type OrgRow } from './auth';
import { qAll } from './db';
import { usableBaseUrl, type MailEnv } from './invitation_mail';
import { deliverOutbox } from './notification_mail';
import { queueDigest } from './settings';

export async function runScheduled(env: MailEnv & { DB: D1Database; APP_ORIGIN?: string }) {
	const origin = env.APP_ORIGIN;
	if (!origin || !usableBaseUrl(origin)) {
		console.error('Scheduled email skipped: APP_ORIGIN must be an HTTP(S) origin.');
		return;
	}
	const orgs = await qAll<OrgRow>(env.DB, 'SELECT * FROM organizations WHERE notifications_enabled = 1');
	const summary = { orgs: orgs.length, queued: 0, sent: 0, failed: 0, orgErrors: 0 };
	for (const org of orgs) {
		try {
			summary.queued += await queueDigest(env.DB, org, await membersOfOrg(env.DB, org.id));
		} catch {
			summary.orgErrors++;
		}
		try {
			const result = await deliverOutbox(env, env.DB, org.id, origin);
			summary.sent += result.sent;
			summary.failed += result.failed;
		} catch {
			summary.orgErrors++;
		}
	}
	console.info('Scheduled email summary', summary);
}
