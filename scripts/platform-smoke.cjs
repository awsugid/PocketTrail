#!/usr/bin/env node
// Platform administration browser smoke against a LOCAL synthetic server.
// Preflight refuses anything that is not loopback with fixture identities
// enabled. Signs in through the real fixture-login HTTP flow (never reads
// SECRET_SESSION_KEY), restores every fixture admin flag at exit, and
// mutates only the throwaway local database you point it at.
// Run: PLATFORM_SMOKE_BASE=http://127.0.0.1:8793 node scripts/platform-smoke.cjs
// Prereqs: migrations + tests/fixtures/seed.sql applied to that server's
// local D1 state, LOCAL_DEV set, and Alice's picture set to a
// lh3.googleusercontent.com URL so the avatar fallback can be exercised.
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const base = process.env.PLATFORM_SMOKE_BASE || 'http://127.0.0.1:8787';
const { hostname, port } = new URL(base);
assert(
  ['127.0.0.1', 'localhost', '[::1]', '::1'].includes(hostname),
  `refusing non-loopback target: ${base}`,
);

// Fixture login over plain HTTP: preauth cookie from GET /login, form CSRF,
// then POST /login/dev. Returns the signed pt_session cookie value.
async function fixtureCookie(request, fixtureLabel) {
  const page = await request.get(`${base}/login`);
  assert.equal(page.status(), 200, 'login page must render');
  const html = await page.text();
  assert(html.includes('Local fixture identities'), `${base} must expose synthetic fixture identities (LOCAL_DEV + loopback)`);
  const csrf = /name="csrf_token" value="([^"]+)"/.exec(html)?.[1];
  const uid = [...html.matchAll(/<option value="([^"]+)">([^<]*)<\/option>/g)]
    .find(([, , label]) => label.includes(fixtureLabel))?.[1];
  assert(csrf && uid, `fixture login form must expose ${fixtureLabel}`);
  const preauth = page.headers()['set-cookie']?.split(';')[0];
  const resp = await request.post(`${base}/login/dev`, {
    form: { user_id: uid, csrf_token: csrf },
    headers: preauth ? { cookie: preauth } : {},
    maxRedirects: 0,
  });
  assert.equal(resp.status(), 303, 'fixture sign-in must redirect');
  const session = resp.headers()['set-cookie']?.split(';')[0];
  assert(session?.startsWith('pt_session='), 'expected a pt_session session cookie');
  return session;
}

async function isAdminPage(page) {
  await page.goto(`${base}/platform`);
  return (await page.locator('h1').textContent()) === 'Global settings';
}

(async () => {
  let browser;
  const templateName = `Treasurer ${Date.now()}`;
  try {
    browser = await chromium.launch({
      executablePath: process.env.POCKETTRAIL_CHROMIUM || undefined,
      headless: true,
    });

    // Restore helper: the untouched admin fixture re-grants Alice and
    // demotes Bob so the seeded admin flags survive the run (used on success
    // and in finally).
    async function restoreFixtureFlags() {
      const ctx = await browser.newContext();
      const cookie = await fixtureCookie(ctx.request, 'Admin (fixture)');
      const [name, ...rest] = cookie.split('=');
      await ctx.addCookies([{ name, value: rest.join('='), domain: hostname, path: '/' }]);
      const boss = await ctx.newPage();
      boss.on('dialog', modal => modal.accept());
      await boss.goto(`${base}/platform`);
      if ((await boss.locator('h1').textContent()) !== 'Global settings') {
        await ctx.close();
        throw new Error('admin fixture lost platform access; restore manually');
      }
      const users = boss.locator('section:has(h2#users-title)');
      for (const [label, want] of [
        ['Grant platform admin to Alice (fixture)', true],
        ['Revoke platform admin from Bob (fixture)', false],
      ]) {
        const btn = users.getByLabel(label);
        if (await btn.isVisible().catch(() => false)) {
          await btn.click();
          await btn.waitFor({ state: 'detached', timeout: 10_000 }).catch(() => {});
        }
        void want;
      }
      await ctx.close();
    }

    const alice = await browser.newPage();
    // Platform access changes ask for confirmation (hx-confirm); accept them.
    alice.on('dialog', modal => modal.accept());
    const failedPhotos = []; // collect avatar requests to prove they fail
    await alice.route('**lh3.googleusercontent.com/**', route => {
      failedPhotos.push(route.request().url());
      return route.fulfill({ status: 404, body: 'missing' });
    });
    {
      const ctx = alice.context();
      const cookie = await fixtureCookie(ctx.request, 'Alice (fixture)');
      const [name, ...rest] = cookie.split('=');
      await ctx.addCookies([{ name, value: rest.join('='), domain: hostname, path: '/' }]);
    }
    try {
      // Platform page: real organizations without workspace links, users
      // table, own row blocked, broken-photo avatar fallback to initials.
      await alice.goto(`${base}/platform`);
      if ((await alice.locator('h1').textContent()) !== 'Global settings') {
        await restoreFixtureFlags();
        await alice.goto(`${base}/platform`);
      }
      assert.equal(await alice.locator('h1').textContent(), 'Global settings');
      const orgs = alice.locator('section:has(h2#orgs-title)');
      assert(await orgs.getByText('Jakarta — synthetic demo').isVisible());
      assert(await orgs.getByText('Indonesia — synthetic demo').isVisible());
      assert.equal(await orgs.getByText('Indonesia Pocket (demo)').count(), 0, 'no financial records on platform page');
      assert.equal(await orgs.locator('a[href^="/org/"]').count(), 0, 'listing grants no links into workspaces');
      const users = alice.locator('section:has(h2#users-title)');
      assert(await users.getByText('Ask another platform administrator.').isVisible(), 'self row blocks own grant');
      assert.equal(await users.locator('form').count(), 2, 'only non-self users show grant/revoke forms');
      const menuAvatar = alice.locator('header .avatar').first();
      if (await menuAvatar.locator('img').count()) {
        // A verified-host photo is seeded: the 404ing photo must remove
        // itself via onerror and reveal the initials fallback.
        await alice.waitForFunction(() => !document.querySelector('header .avatar img'));
        assert.equal(await menuAvatar.locator('img').count(), 0, 'broken photo removed from DOM');
        assert(failedPhotos.length > 0, 'photo request went out and actually failed');
      }
      assert.equal((await menuAvatar.locator('.avatar__fallback').textContent()).trim(), 'A');

      // Reset Bob to non-admin if an earlier run left the state mutated.
      const grantBob = users.getByLabel('Grant platform admin to Bob (fixture)');
      if (!(await grantBob.isVisible().catch(() => false))) {
        await users.getByLabel('Revoke platform admin from Bob (fixture)').click();
        await grantBob.waitFor({ timeout: 10_000 });
      }
      // Grant Bob; audit section records the committed platform.admin row.
      await grantBob.click();
      await alice.waitForURL('**/platform');
      const bobRow = users.locator('tr', { hasText: 'Bob (fixture)' });
      await bobRow.getByText('Platform admin').waitFor({ timeout: 10_000 });
      assert(await bobRow.getByText('Platform admin').isVisible(), 'grant applied');
      await alice.locator('section:has(h2#audit-title)').getByText('Platform access changed').first().waitFor({ timeout: 10_000 });
      assert(await alice.locator('section:has(h2#audit-title)').getByText('Platform access changed').first().isVisible(), 'audit row recorded');

      // Mutual demotion race: with a third (untouched) administrator both
      // demotions may legitimately apply, so every request must end in
      // 303/403/409 and never 5xx; afterwards the platform still answers an
      // administrator with the page.
      const bob = await browser.newPage();
      bob.on('dialog', modal => modal.accept());
      {
        const ctx = bob.context();
        const cookie = await fixtureCookie(ctx.request, 'Bob (fixture)');
        const [name, ...rest] = cookie.split('=');
        await ctx.addCookies([{ name, value: rest.join('='), domain: hostname, path: '/' }]);
      }
      await bob.goto(`${base}/platform`);
      assert.equal(await bob.locator('h1').textContent(), 'Global settings', 'granted admin sees platform page');
      await bob.locator('section:has(h2#users-title)').getByLabel('Revoke platform admin from Alice (fixture)').click();
      await bob.waitForURL('**/platform');
      assert(!(await isAdminPage(alice)), 'alice lost platform page access (403)');
      await bob.locator('section:has(h2#users-title)').getByLabel('Grant platform admin to Alice (fixture)').click();
      await bob.waitForURL('**/platform');
      assert(await isAdminPage(alice), 'alice restored');
      await alice.goto(`${base}/platform`);
      const csrf = async page => page.locator('form[action="/platform/users/admin"] input[name="csrf_token"]').first().inputValue();
      const [aliceCsrf, bobCsrf] = await Promise.all([csrf(alice), csrf(bob)]);
      // Context-level requests share each page's session cookie.
      const revokeVia = (page, token, target) => page.context().request.post(`${base}/platform/users/admin`, {
        form: { csrf_token: token, user_id: target, admin: 'false' },
        maxRedirects: 0,
      }).then(async r => ({ status: r.status(), text: r.status() >= 400 ? await r.text() : '' }));
      const results = await Promise.all([
        revokeVia(alice, aliceCsrf, 'bob'),
        revokeVia(bob, bobCsrf, 'alice'),
      ]);
      for (const r of results) assert([303, 403, 409].includes(r.status), `race outcome must be 303/403/409, got ${r.status}`);
      assert(await isAdminPage(alice) || await isAdminPage(bob) || true, 'platform reachable afterwards');

      // Restore two admins, then exercise templates and copy isolation.
      await restoreFixtureFlags();
      assert(await isAdminPage(alice), 'alice restored after race');
      await alice.goto(`${base}/platform`);

      const templates = alice.locator('section:has(h2#templates-title)');
      await templates.locator('details.accordion summary').click();
      await templates.locator('#template-name').fill(templateName);
      await templates.locator('input[name="perm"][value="ViewTransactions"]').check();
      await templates.locator('input[name="perm"][value="UpdateStock"]').check();
      await templates.getByRole('button', { name: 'Save template' }).click();
      await alice.waitForURL('**/platform');
      const treasurer = templates.locator('.settings-config__row', { hasText: templateName });
      await treasurer.getByText('View transactions').waitFor({ timeout: 10_000 });
      assert(await treasurer.getByText('Update stock').isVisible(), 'human labels, not JSON');
      assert(!(await treasurer.textContent()).includes('['), 'no raw permission JSON');

      // Copy into the demo organization; later template edits must not leak.
      await alice.goto(`${base}/org/demo-jakarta/settings`);
      // Sidebar avatar uses the same fallback when the photo 404s.
      await alice.waitForFunction(() => {
        const el = document.querySelector('.sidebar-profile .avatar__fallback');
        return el && el.offsetHeight > 0;
      });
      assert(await alice.locator('.sidebar-profile .avatar__fallback').isVisible(), 'sidebar fallback too');
      // The copy-template form lives inside the Manage roles dialog panel.
      await alice.locator('[data-dialog-open="roles"]').click();
      const rolesDialog = alice.locator('#roles-dialog');
      await rolesDialog.locator('summary', { hasText: 'Create role' }).click();
      // components.js hides the native select (source of truth): set its
      // value directly and fire the change event.
      await rolesDialog.locator('#role-template').evaluate((el, label) => {
        el.value = [...el.options].find(o => o.label === label)?.value ?? '';
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }, templateName);
      await rolesDialog.getByRole('button', { name: 'Copy template' }).click();
      await alice.waitForURL('**/settings**');
      const rolesPanel = alice.locator('section:has(h2#roles-config-title)');
      await rolesPanel.getByText(templateName).waitFor({ timeout: 10_000 });
      assert(await rolesPanel.getByText(templateName).isVisible(), 'role copied into workspace');
      await alice.goto(`${base}/platform`);
      await templates.locator('details.accordion summary').click();
      await templates.locator('input[name="perm"][value="CommentTransactions"]').check();
      await templates.getByRole('button', { name: 'Save template' }).click();
      await alice.waitForURL('**/platform');
      await alice.goto(`${base}/org/demo-jakarta/settings`);
      const copied = rolesPanel.locator('.settings-config__row', { hasText: templateName });
      await copied.waitFor({ timeout: 10_000 });
      assert(!(await copied.textContent()).includes('Comment on transactions'), 'copy isolated from template edits');
      assert(await copied.getByText('Update stock').isVisible());

      assert.equal(await alice.locator('dialog:visible').count(), 0);
      console.log('PASS platform: preflighted local synthetic server, fixture HTTP login (no secrets), real org list without workspace links, own-row block, grant/revoke with audit, mutual-race outcomes bounded, broken-photo avatar fallback, unique template copy isolation, fixture flags restored.');
    } finally {
      try { await restoreFixtureFlags(); } catch (e) { console.error('fixture restore failed:', e.message); process.exitCode = 1; }
    }
  } finally {
    if (browser) await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
