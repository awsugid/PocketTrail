import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { ORIGIN, ROOT, withWorker } from './harness.mjs';

const screenshots = new URL('../.playwright-mcp/', import.meta.url);
await withWorker(async () => {
	execFileSync('npx', ['wrangler', 'd1', 'execute', 'DB', '--local', '--command',
		`INSERT INTO email_log (org_id,kind,to_membership_id,to_address,from_address,subject,text_body,html_body,status,created_at)
		VALUES (1,'digest',1,'alice@example.test','sender@example.test','Synthetic digest','Documentation due','<h1>Documentation due</h1>','sent',${Date.now()})`], { cwd: ROOT });
	mkdirSync(screenshots, { recursive: true });
	const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome', args: ['--no-sandbox'] });
	try {
		const url = `${ORIGIN}/org/demo-jakarta/settings/email-history`;
		async function signIn(identity) {
			const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
			await page.goto(`${ORIGIN}/login`);
			await page.getByRole('button', { name: new RegExp(identity) }).click();
			await page.waitForURL((url) => url.pathname !== '/login');
			return page;
		}
		const admin = await signIn('Alice');
		assert.equal((await admin.goto(url)).status(), 200);
		const message = admin.getByRole('link', { name: 'Synthetic digest' });
		await message.waitFor();
		await admin.screenshot({ path: new URL('v10-email-history-list.png', screenshots).pathname });
		await message.click();
		await admin.frameLocator('iframe[title="HTML email"]').getByText('Documentation due').waitFor();
		assert.equal(await admin.locator('iframe').getAttribute('sandbox'), '');
		await admin.screenshot({ path: new URL('v10-email-preview.png', screenshots).pathname });
		await admin.getByRole('button', { name: 'Plain text' }).click();
		assert.equal(await admin.locator('pre').textContent(), 'Documentation due');
		const member = await signIn('Bob');
		assert.equal((await member.goto(url)).status(), 403);
	} finally {
		await browser.close();
	}
});
