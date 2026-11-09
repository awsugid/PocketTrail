#!/usr/bin/env node
// Run against local synthetic fixtures; never upload private statements.
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.POCKETTRAIL_CHROMIUM || undefined,
    headless: true,
  });
  try {
    const page = await browser.newPage();
    const base = process.env.POCKETTRAIL_BASE || 'http://127.0.0.1:8787';
    await page.goto(`${base}/login`);
    await page.locator('.pt-trigger').click();
    await page.getByRole('option').filter({ hasText: 'Admin (fixture)' }).click();
    await Promise.all([
      page.waitForURL('**/orgs'),
      page.locator('form[action="/login/dev"] button[type="submit"]').click(),
    ]);
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(`${base}/orgs`);
      // The accordion auto-opens for users with no memberships; only click
      // the summary when it is still closed, or this toggles it shut.
      // getAttribute returns "" when present, so compare against null.
      const create = page.locator('details.accordion').filter({ hasText: 'Create organization' });
      if ((await create.getAttribute('open')) === null) await create.locator('summary').click();
      const name = await page.locator('#org-name').boundingBox();
      const slug = await page.locator('#org-slug').boundingBox();
      assert(Math.abs(name.x - slug.x) < 1, 'Organization fields must share left edge');
      assert(slug.y >= name.y + name.height, 'Organization fields must stack');
    }
    await page.locator('#org-name').fill('Synthetic duplicate test');
    await page.locator('#org-slug').fill('demo-jakarta');
    await page.route('**/orgs', async route => {
      if (route.request().method() === 'POST') await new Promise(resolve => setTimeout(resolve, 300));
      await route.continue();
    });
    await page.locator('form[action="/orgs"] button').click();
    await page.locator('form[action="/orgs"][aria-busy="true"] button:disabled').waitFor();
    await page.locator('#request-error').waitFor();
    await page.locator('form[action="/orgs"] button:enabled').waitFor();
    assert(await page.locator('#request-error').textContent(), 'Failed request must show error');
    assert.equal(await page.locator('#org-name').inputValue(), 'Synthetic duplicate test');
    // Separate context avoids changing existing signed-in identity.
    const member = await browser.newPage();
    await member.goto(`${base}/login`);
    await member.locator('.pt-trigger').click();
    await member.getByRole('option').filter({ hasText: 'Alice (fixture)' }).click();
    await Promise.all([
      member.waitForURL('**/orgs'),
      member.locator('form[action="/login/dev"] button[type="submit"]').click(),
    ]);
    for (const width of [1440, 390, 320]) {
      await member.setViewportSize({ width, height: 1000 });
      for (const route of ['transactions', 'transactions/3', 'imports', 'inventory', 'settings']) {
        await member.goto(`${base}/org/demo-jakarta/${route}`);
        assert(await member.locator('h1').count(), `${route}: missing page heading`);
        const overflow = await member.evaluate(() => document.documentElement.scrollWidth > innerWidth);
        assert(!overflow, `${route}: page overflow at ${width}px`);
        assert(await member.locator('.menu--org:visible .menu__summary-value').isVisible(), 'Current organization must remain visible');
        if (route === 'transactions/3') {
          assert(await member.locator('#documents').isVisible(), 'Evidence details must be visible without opening a dialog');
          assert(await member.locator('#review').isVisible(), 'Review context must be visible without opening a dialog');
          assert(await member.locator('#documents').evaluate(el => Boolean(el.compareDocumentPosition(document.querySelector('#review')) & Node.DOCUMENT_POSITION_FOLLOWING)), 'Evidence must precede review');
        }
      }
    }
    console.log('PASS: linear organization form, evidence-before-approval, no page overflow at 1440/390/320px');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
