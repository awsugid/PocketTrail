#!/usr/bin/env node
// npm ci && node scripts/ui-polish-smoke.cjs
// Uses this checkout's compiled templates and assets, never a live app or database.
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const pages = JSON.parse(execFileSync('cargo', ['run', '--quiet', '--example', 'ui-polish-fixtures'], {
  cwd: root, encoding: 'utf8',
}));

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.POCKETTRAIL_CHROMIUM || undefined, headless: true,
  });
  try {
    const page = await browser.newPage();
    const errors = [];
    const measurements = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', modal => {
      errors.push(`Unexpected confirmation in read-only smoke: ${modal.message()}`);
      return modal.dismiss();
    });
    await page.route('**/*', route => {
      assert.equal(route.request().method(), 'GET', 'Polish checks must never submit changes');
      const url = new URL(route.request().url());
      const asset = /^\/static\/(app|components)\.(css|js)$/.test(url.pathname);
      if (asset) return route.fulfill({
        body: readFileSync(path.join(root, url.pathname.slice(1))),
        contentType: url.pathname.endsWith('.css') ? 'text/css' : 'application/javascript',
      });
      const html = pages[url.pathname.slice(1)];
      return route.fulfill(html ? { body: html, contentType: 'text/html' } : { status: 404 });
    });
    async function checkVisibleContent(label) {
      // Opening a previously display:none dialog schedules ResizeObserver work.
      await page.waitForFunction(() => [...document.querySelectorAll('.table-scroll')]
        .filter(wrapper => wrapper.getBoundingClientRect().height > 0)
        .every(wrapper => !wrapper.previousElementSibling.hidden === (wrapper.scrollWidth > wrapper.clientWidth + 1)));
      const tables = await page.locator('.table-scroll:visible').evaluateAll(wrappers => wrappers.map(wrapper => {
        const cue = wrapper.previousElementSibling;
        return {
          overflowing: wrapper.scrollWidth > wrapper.clientWidth + 1,
          cue: cue.classList.contains('table-scroll-cue') && !cue.hidden,
          accessible: wrapper.getAttribute('aria-describedby')?.split(' ').includes(cue.id),
          focusable: wrapper.tabIndex === 0,
        };
      }));
      for (const table of tables) {
        assert.equal(table.cue, table.overflowing, `${label}: cue must match overflow`);
        if (table.overflowing) assert(table.accessible && table.focusable, `${label}: describe keyboard-scrollable wrapper`);
      }
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        `${label}: no page overflow`);
      const readability = await page.evaluate(() => {
        const visible = el => el.getBoundingClientRect().height > 0 && getComputedStyle(el).visibility !== 'hidden';
        const scope = document.querySelector('dialog[open]') || document.querySelector('main');
        return {
          body: parseFloat(getComputedStyle(document.body).fontSize),
          fields: [...scope.querySelectorAll('.input,.textarea,.pt-trigger')].filter(visible)
            .map(el => parseFloat(getComputedStyle(el).fontSize)),
          targets: [...scope.querySelectorAll('.btn,.pt-trigger,.chip,a.list-row__main')].filter(visible)
            .map(el => el.getBoundingClientRect().height),
        };
      });
      const width = page.viewportSize().width;
      assert(readability.body >= 14 && readability.fields.every(size => size >= (width <= 480 ? 16 : 13)),
        `${label}: density must not shrink readable text`);
      if (width <= 480) assert(readability.targets.every(height => height >= 44), `${label}: retain touch targets`);
      const scope = await page.locator('dialog[open]').count() ? page.locator('dialog[open]') : page.locator('main');
      const focusTarget = scope.locator('.btn:visible, .table-scroll[tabindex="0"]:visible, .section-nav a:visible').first();
      if (await focusTarget.count()) {
        // Establish keyboard modality after opening a panel with a pointer.
        await page.keyboard.press('Tab');
        await focusTarget.focus();
        assert(await focusTarget.evaluate(el => el === document.activeElement
          && getComputedStyle(el).outlineStyle !== 'none'
          && parseFloat(getComputedStyle(el).outlineWidth) >= 2), `${label}: visible keyboard focus survives compaction`);
      }
      return tables;
    }
    async function checkKeyboardScroll(label) {
      const wrapper = page.locator('.table-scroll:visible').filter({ has: page.locator('.table') }).last();
      await wrapper.focus();
      await page.keyboard.press('ArrowRight');
      await page.waitForFunction(() => [...document.querySelectorAll('.table-scroll')]
        .some(el => el.getBoundingClientRect().height > 0 && el.scrollLeft > 0));
      assert(await wrapper.evaluate(el => el.scrollLeft > 0), `${label}: keyboard reaches offscreen actions`);
    }
    for (const width of [320, 390, 800, 1440]) {
      await page.setViewportSize({ width, height: 700 });
      for (const name of Object.keys(pages)) {
        await page.goto(`http://pockettrail.test/${name}`);
        await page.waitForFunction(() => window.PocketTrailUIReady);
        // Enhancement after HTMX swaps must be idempotent.
        await page.evaluate(() => document.dispatchEvent(new Event('htmx:load')));
        const transaction = name.startsWith('transaction-') || name === 'transaction';
        const settings = name.startsWith('settings');
        const panelIds = await page.locator('section[data-dialog-panel]').evaluateAll(panels => panels.map(panel => panel.id));
        if (transaction || (settings && name !== 'settings-readonly') || name === 'inventory') {
          assert(panelIds.length, `${name}: expected action dialogs`);
          assert.equal(await page.locator('[data-dialog-panel]:visible').count(), 0, `${name}: no stacked panels initially`);
          assert.equal(await page.locator('main form:visible').count(), 0, `${name}: forms are deferred to dialogs`);
          for (const id of panelIds) {
            assert(await page.locator(`[data-dialog-open="${id}"]`).isVisible(), `${name}/${id}: overview action visible`);
          }
          const overview = transaction ? '.transaction-head__summary' : settings ? '.settings-config' : '.inventory-table';
          assert(await page.locator(overview).isVisible(), `${name}: summary remains on overview`);
          if (transaction) {
            const actions = await page.locator('.transaction-actions [data-dialog-open]').evaluateAll(els => els.map(el => el.dataset.dialogOpen));
            assert(!actions.some(id => ['bank-facts', 'purposes', 'documents', 'review', 'discussion'].includes(id)),
              'Read-only details are not dialog actions');
            for (const id of ['bank-facts', 'purposes', 'documents', 'review', 'discussion']) {
              assert(await page.locator(`#${id}`).isVisible(), `${id} is visible without a click`);
            }
            assert(await page.locator('#purposes').getByText('Synthetic venue and catering for the community meetup.', { exact: true }).isVisible());
            assert(await page.locator('#discussion').getByText('Synthetic discussion. Does not change financial details.', { exact: true }).isVisible());
            assert(await page.getByText('Synthetic review note: confirm the allocation.', { exact: true }).isVisible());
            assert.equal(await page.locator('form[action$="/approve"]').count(), 0, 'No self approval');
          }
        }
        const orgSwitcher = page.locator(width <= 800 ? '.topbar .menu--org' : '.sidenav .menu--org');
        assert(await orgSwitcher.isVisible(), 'Organization switcher remains visible in the correct shell region');
        assert.equal(await page.locator('.topbar .menu--org').isVisible(), width <= 800);
        await orgSwitcher.locator('summary').click();
        assert(await orgSwitcher.getByRole('link', { name: 'All organizations', exact: true }).isVisible());
        await orgSwitcher.locator('summary').click();
        if (name === 'import-preview') {
          assert.equal(await page.locator('td strong').textContent(), 'Synthetic name / Other name');
          assert(await page.getByText('Jago 000123456789', { exact: true }).isVisible());
          assert(await page.getByText('SYNTHETIC-REF_2026-01-01_COMPLETE', { exact: true }).isVisible());
        }
        if (name === 'import') {
          assert.equal(await page.locator('.page-head .page-head__sub').count(), 0, 'No long header intro');
          const help = page.locator('details').filter({ has: page.locator('summary', { hasText: 'Privacy & duplicate protection' }) });
          await help.locator('summary').focus();
          await page.keyboard.press('Enter');
          assert(await help.evaluate(el => el.open));
          assert(await help.getByText('Text is extracted in your browser.', { exact: false }).isVisible());
          assert(await help.getByText('Conflicting bank fields or missing IDs need review, never silent replacement.', { exact: false }).isVisible());
          await help.locator('summary').click();
        }
        const tables = await checkVisibleContent(`${name}/${width}/overview`);
        if (!transaction && !settings) {
          assert(tables.length, `${name}: missing fixture table`);
        }
        assert.equal(await page.locator('.table-scroll-cue').count(), await page.locator('.table-scroll').count());
        // Every fixture table card-stacks on phones now; prove the scroll fallback
        // with a synthetic wide table so the cue/tabindex rule stays exercised.
        if (width === 320 && name === 'import-preview') {
          await page.evaluate(() => {
            const wrap = document.createElement('div'); wrap.className = 'table-scroll';
            wrap.innerHTML = '<table class="table"><caption>Synthetic wide</caption><tr>' + '<td style="min-width:200px">wide</td>'.repeat(5) + '</tr></table>';
            document.querySelector('main').append(wrap);
            document.dispatchEvent(new Event('htmx:load'));
          });
          await page.locator('.table-scroll-cue:visible').first().waitFor();
          await checkKeyboardScroll(name);
        }
        if (name === 'inventory') {
          const inset = await page.getByRole('heading', { name: 'Stock by location' }).evaluate(heading => {
            const panel = heading.closest('.panel');
            const h = heading.getBoundingClientRect(), p = panel.getBoundingClientRect();
            return { left: h.left - p.left, right: p.right - h.right, top: h.top - p.top };
          });
          const actions = await page.locator('.inventory-actions .btn').evaluateAll(buttons =>
            buttons.map(button => ({ label: button.textContent.trim(), width: Math.round(button.getBoundingClientRect().width) })));
          assert(actions.every(action => action.width < 190), 'Inventory actions use content width, not stretched columns');
          console.log(`Inventory actions ${width}px: ${JSON.stringify(actions)}`);
          assert(inset.left >= 16 && inset.right >= 16 && inset.top >= 18, 'Inventory heading needs panel inset');
          if (width <= 390) {
            const layout = await page.locator('.inventory-table tbody tr').first().evaluate(row => {
              const [item, location, quantity] = [...row.cells].map(cell => cell.getBoundingClientRect());
              const link = row.querySelector('a').getBoundingClientRect();
              const total = row.querySelector('.inventory-table__total');
              return { itemWidth: item.width, locationWidth: location.width,
                sameLine: location.y === quantity.y, linkHeight: link.height,
                totalLines: total.getClientRects().length };
            });
            assert(layout.itemWidth > layout.locationWidth && layout.locationWidth >= 140,
              'Item spans the row; location has room for natural word wrapping');
            assert(layout.sameLine && layout.linkHeight === 44 && layout.totalLines === 1,
              'Location/quantity are grouped; item link fits one line with touch target; total cannot orphan');
            assert(await page.getByRole('link', { name: 'Stock change', exact: true }).isVisible());
          }
        }
        if (name === 'transactions') {
          // Cell order: counterparty, date, amount, balance, status, responsible (DOM = phone card order).
          const layout = await page.locator('.transaction-table tbody tr').first().evaluate(row => {
            const cells = [...row.cells].map(cell => cell.getBoundingClientRect());
            return { y: row.getBoundingClientRect().y, height: row.getBoundingClientRect().height,
              identityY: cells[0].y, dateY: cells[1].y, amountY: cells[2].y, balanceY: cells[3].y,
              badgeSize: parseFloat(getComputedStyle(row.querySelector('.badge')).fontSize),
              responsibleSize: parseFloat(getComputedStyle(row.querySelector('.transaction-table__responsible')).fontSize) };
          });
          assert(layout.badgeSize >= 12 && layout.responsibleSize >= 13, 'Readable status and responsibility');
          if (width === 320) {
            assert(layout.y <= 600, `Phone first record starts too low: ${layout.y}`);
            assert(await page.locator('.banner--synthetic').isVisible());
            assert(await page.locator('.banner--local').isVisible());
            assert(await page.getByRole('link', { name: 'Import statement', exact: true }).isVisible());
            // The filter submits on change; its Apply button is the no-JS fallback and stays hidden.
            assert.equal(await page.getByRole('button', { name: 'Apply', exact: true }).count(), 0);
            assert(await page.getByRole('button', { name: 'Status All statuses', exact: true }).isEnabled());
          }
          if (width === 800) {
            assert(layout.height <= 235, `Intermediate transaction row too tall: ${layout.height}`);
            assert.equal(layout.identityY, layout.dateY, 'Related identity/date share first row');
            assert.equal(layout.amountY, layout.balanceY, 'Amount and balance share second row');
            assert(layout.amountY - layout.identityY < 130, 'No empty grid rows before amounts');
          }
          if (width <= 390) assert(layout.height <= 320, `Phone transaction card too tall: ${layout.height}`);
          if (width === 1440) {
            assert(layout.y <= 430 && layout.height <= 100, 'Desktop records stay near filters and compact');
            const intro = await page.locator('.transactions-head').evaluate(head => {
              const title = head.querySelector('h1').getBoundingClientRect();
                const description = head.querySelector('.page-head__sub').getBoundingClientRect();
              return { titleBottom: title.bottom, descriptionTop: description.top };
            });
            assert(intro.descriptionTop >= intro.titleBottom, 'Description stays below the title/action row');
          }
          console.log(`Transactions ${width}px: first row y=${layout.y.toFixed(1)}, height=${layout.height.toFixed(1)}`);
        }
        if (name === 'settings' && width <= 800) {
          const trigger = page.locator('.navdrawer > summary');
          await trigger.focus();
          await page.keyboard.press('Enter');
          assert(await page.locator('.navdrawer').evaluate(el => el.open), 'Native Enter opens navigation');
          await page.keyboard.press('Tab');
          assert(await page.locator('.navdrawer__link').first().evaluate(el => el === document.activeElement));
          await page.keyboard.press('Escape');
          assert(!await page.locator('.navdrawer').evaluate(el => el.open));
          assert(await trigger.evaluate(el => el === document.activeElement), 'Escape restores trigger focus');
          await page.keyboard.press('Space');
          assert(await page.locator('.navdrawer').evaluate(el => el.open), 'Native Space still opens navigation');
          await page.locator('.navdrawer__link').last().focus();
          await page.keyboard.press('Tab');
          assert(await page.evaluate(() => !document.activeElement.closest('.navdrawer')), 'Tab is not trapped');
          await page.keyboard.press('Escape');
          await trigger.click();
          await trigger.click();
          assert(!await page.locator('.navdrawer').evaluate(el => el.open), 'Native pointer toggle still works');
        }
        const density = await page.evaluate(() => {
          const rect = selector => {
            const el = document.querySelector(selector);
            if (!el || !el.getBoundingClientRect().height) return null;
            const r = el.getBoundingClientRect();
            return { y: Math.round(r.y + scrollY), height: Math.round(r.height) };
          };
          // Shell min-height and closed dialogs do not describe overview density.
          const content = [...document.querySelectorAll('main .page-head, main > .panel, main > nav, .transaction-overview, .settings-config')]
            .filter(el => el.getBoundingClientRect().height > 0)
            .map(el => el.getBoundingClientRect());
          return { overviewHeight: content.length
              ? Math.round(Math.max(...content.map(r => r.bottom)) - Math.min(...content.map(r => r.top))) : null,
            stock: rect('.inventory-table'),
            firstRecord: rect('.transaction-table tbody tr') };
        });
        measurements.push({ name, width, ...density });
        console.log(JSON.stringify({ name, width, ...density }));
        const index = [320, 390, 800, 1440].indexOf(width);
        if (name === 'inventory') {
          assert(density.stock.height <= [360, 360, 255, 255][index], 'Compact stock rows');
        }
        if (name === 'transaction-readonly') {
          assert.equal(await page.locator('main form').count(), 0, 'No edit actions without permissions');
        }
        if (transaction) {
          // Status is shown once in the page header; bank facts hold the eight statement values.
          assert.equal(await page.locator('#bank-facts .bank-facts dt').count(), 8, 'Every bank fact stays on the overview');
          assert.equal(await page.locator('#bank-facts dd.cell--mono').textContent(), 'SYNTHETIC-REF_2026-01-01_COMPLETE');
        }
        if (process.env.POCKETTRAIL_SCREENSHOTS) {
          await page.evaluate(() => {
            document.activeElement.blur();
            window.scrollTo(0, 0);
            document.querySelectorAll('.table-scroll').forEach(wrapper => { wrapper.scrollLeft = 0; });
          });
          await page.screenshot({ path: path.join(process.env.POCKETTRAIL_SCREENSHOTS, `${name}-${width}.png`), fullPage: true });
          await page.screenshot({ path: path.join(process.env.POCKETTRAIL_SCREENSHOTS, `${name}-${width}-viewport.png`) });
        }
        for (const id of panelIds) {
          await page.locator(`[data-dialog-open="${id}"]`).click();
          const dialog = page.locator(`#${id}-dialog`);
          await dialog.waitFor({ state: 'visible' });
          // Measure the actual content, not hidden panels or cumulative page offsets.
          const panelDensity = await page.locator(`#${id}`).evaluate(section => {
            const body = section.closest('.pt-dialog__body');
            return {
              contentHeight: Math.round(section.getBoundingClientRect().height),
              bodyHeight: body.clientHeight, scrollHeight: body.scrollHeight,
              horizontalOverflow: body.scrollWidth > body.clientWidth + 1,
            };
          });
          measurements.push({ name, width, panel: id, ...panelDensity });
          console.log(JSON.stringify({ name, width, panel: id, ...panelDensity }));
          assert(!panelDensity.horizontalOverflow, `${name}/${id}/${width}: dialog content must fit horizontally`);
          const panelTables = await checkVisibleContent(`${name}/${width}/${id}`);
          if (id === 'edit-details') {
            assert.equal(await dialog.locator('input[name="revision"]').inputValue(), '1');
            assert.equal(await dialog.locator('input[name="csrf_token"]').inputValue(), 'test-only');
          }
          if (id === 'notification-settings') {
            assert(await dialog.getByText('it is not approval and does not mean evidence exists.', { exact: false }).isVisible());
          }
          if (id === 'stock-change') {
            const formHeight = await dialog.locator('form').evaluate(el => el.getBoundingClientRect().height);
            measurements.push({ name, width, panel: id, stockFormHeight: Math.round(formHeight) });
            // Direction + quantity + live preview add one paired row over the old signed field.
            assert(formHeight <= (width >= 640 ? 340 : 640), 'Stock form pairs fields only with room');
            assert(await dialog.getByRole('button', { name: 'Update stock', exact: true }).isVisible());
          }
          if (id === 'members') {
            assert(panelTables.length, 'Members table is available in its dialog');
            // Members became phone cards; controls are visible without horizontal scrolling.
            if (width === 320) {
              assert(!panelTables.some(table => table.overflowing), 'Members: controls fit without horizontal scroll');
            }
          }
          if (id === 'roles') {
            assert(await dialog.getByText('An empty role intentionally grants no access.', { exact: false }).isVisible());
            await dialog.locator('details').filter({ has: page.locator('summary', { hasText: 'Create role' }) }).locator('summary').click();
            assert.equal(await dialog.locator('form[action$="/settings/roles"] input[type="checkbox"]:checked').count(), 0,
              'Creating a role must not auto-grant baseline or other permissions');
            await checkVisibleContent(`${name}/${width}/create-role`);
          }
          await dialog.locator('.pt-dialog__close').click();
          await dialog.waitFor({ state: 'hidden' });
        }
      }
    }
    // Resize the same document: fitting tables must lose stale cues/tab stops.
    await page.setViewportSize({ width: 320, height: 1000 });
    await page.goto('http://pockettrail.test/import-preview');
    await page.evaluate(() => {
      const wrap = document.createElement('div'); wrap.className = 'table-scroll';
      wrap.innerHTML = '<table class="table"><tr>' + '<td style="min-width:200px">wide</td>'.repeat(5) + '</tr></table>';
      document.querySelector('main').prepend(wrap);
      document.dispatchEvent(new Event('htmx:load'));
    });
    await page.locator('.table-scroll-cue:visible').waitFor();
    // The page's own (card-stacked) table never overflows; only the synthetic ones cue.
    const baseCues = await page.locator('.table-scroll-cue').count();
    await page.evaluate(() => {
      const wrapper = document.querySelector('main > .table-scroll');
      const added = wrapper.cloneNode(true);
      added.removeAttribute('aria-describedby');
      added.removeAttribute('tabindex');
      wrapper.after(added);
      document.dispatchEvent(new Event('htmx:load'));
    });
    assert.equal(await page.locator('.table-scroll-cue:visible').count(), 2, 'New HTMX content gets its own cue');
    const cueIds = await page.locator('.table-scroll-cue').evaluateAll(cues => cues.map(cue => cue.id));
    assert.equal(new Set(cueIds).size, baseCues + 1, 'Cue descriptions have unique IDs');
    await page.locator('main > .table-scroll').last().evaluate(wrapper => {
      wrapper.previousElementSibling.remove();
      wrapper.remove();
    });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.locator('.table-scroll-cue:visible').waitFor({ state: 'hidden' });
    assert.equal(await page.locator('.table-scroll').first().getAttribute('tabindex'), null);
    assert.deepEqual(errors, []);
    if (process.env.POCKETTRAIL_SCREENSHOTS) {
      require('node:fs').writeFileSync(path.join(process.env.POCKETTRAIL_SCREENSHOTS, 'measurements.json'),
        JSON.stringify(measurements, null, 2) + '\n');
    }
    console.log('PASS: compiled synthetic templates at 320/390/800/1440px; visible transaction details and action-only dialogs, sidebar/mobile organization switching, preserved joint-name punctuation and bank metadata, facts/permissions, readable text/touch targets, transaction hierarchy, compact inventory actions, overflow cues, keyboard scrolling/focus, native navigation toggles, no Tab trap, resize cleanup');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
