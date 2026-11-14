import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { ORIGIN, ROOT, withWorker } from './harness.mjs';
const pages = {
  actions: '/org/demo-jakarta/actions', ledger: '/org/demo-jakarta/transactions', detail: '/org/demo-jakarta/transactions/1',
  new: '/org/demo-jakarta/transactions/new', settings: '/org/demo-jakarta/settings', pockets: '/org/demo-jakarta/settings/pockets',
  routing: '/org/demo-jakarta/settings/routing', people: '/org/demo-jakarta/settings/people', roles: '/org/demo-jakarta/settings/roles',
  notifications: '/org/demo-jakarta/settings/notifications', imports: '/org/demo-jakarta/imports', inventory: '/org/demo-jakarta/inventory',
  item: '/org/demo-jakarta/inventory/1', platform: '/platform', orgs: '/orgs'
};
mkdirSync(`${ROOT}/.wrangler/shots`, { recursive: true });
await withWorker(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  await p.goto(`${ORIGIN}/login`); await p.screenshot({ path: `${ROOT}/.wrangler/shots/login-1440.png` });
  await p.getByRole('button', { name: /Alice/ }).click(); await p.waitForURL(`${ORIGIN}/orgs`);
  for (const w of [1440, 1100, 800, 375]) {
    await p.setViewportSize({ width: w, height: 900 });
    for (const [name, path] of Object.entries(pages)) {
      await p.goto(`${ORIGIN}${path}`); await p.waitForLoadState('networkidle');
      const over = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (over > 1) console.log('OVERFLOW', w, name, over);
      await p.screenshot({ path: `${ROOT}/.wrangler/shots/${name}-${w}.png`, fullPage: true });
    }
  }
  await b.close();
});
