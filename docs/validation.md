# Validation evidence

This file records checks actually run, not implementation promises.

## Parser and workflow foundations

- `cargo test --manifest-path crates/domain/Cargo.toml`: 15 tests passed.
- `cargo test --manifest-path crates/jago-parser/Cargo.toml`: 20 tests passed.
- `node static/extraction.test.js`: passed, including absolute column alignment,
  continuation indentation, synthetic whitespace items, and italic-note baselines.

## Actual community statement samples

Ten ignored, user-authorized community PDFs were inspected locally. Unrelated
personal-pocket statements were excluded.

- Native extraction: `pdftotext -layout`.
- Browser extraction: vendored PDF.js in a local Chromium browser, using
  `scripts/validate-browser-extraction.cjs`.
- Independent comparison:
  `python3 scripts/validate-private-statements.py --text-directory local-data/browser-statements --compare-native`.

Both extraction paths produced the same 552 rows across cumulative exports:
106 unique pocket transactions and 446 overlapping occurrences. Complete IDs,
dates, times, counterparties, transaction types, notes, signed amounts, and
running balances matched. All rows reconciled in their statement sequence, with
zero parser warnings and no conflicting bank snapshots across the exports.
These counts are aggregate test evidence, not demonstration ledger contents.

The browser test used an already installed Chromium executable selected through
`POCKETTRAIL_CHROMIUM`; it did not download another browser. Raw extracted text
was retained only in ignored `local-data/`, not committed or printed.

## Integrated local checks

The following commands passed against the local application:

- `cargo test --workspace`
- `cargo check --target wasm32-unknown-unknown --lib`
- `cargo clippy --manifest-path crates/domain/Cargo.toml --all-targets -- -D warnings`
- `cargo clippy --manifest-path crates/jago-parser/Cargo.toml --all-targets -- -D warnings`
- `node --check static/app.js`
- `node static/extraction.test.js`
- `python3 -m py_compile scripts/configure-local.py scripts/local-smoke.py scripts/local-import-smoke.py scripts/validate-private-statements.py`
- `printf 'n\n' | CI=1 WRANGLER_SEND_METRICS=false npm run build` (dry run only)
- `python3 scripts/local-smoke.py`
- `python3 scripts/local-import-smoke.py`
- `python3 scripts/validate-private-statements.py`

HTTP smoke checks covered anonymous, organization, permission and CSRF boundaries;
independent approval, comment stability and substantive-change re-review; private
R2 evidence retrieval; disabled notifications, local mention capture and
transaction-wide suppression; stock nonnegativity and immediate offboarding.
Import smoke checks covered preview-before-commit, cumulative deduplication,
preservation of documentation/approval/discussion, idempotent confirmation and
bank-fact conflict protection. These checks changed synthetic fixtures only.

The WASM check and dry-run build report an unused `AppliedRow.id` field warning
in `src/web/inventory.rs`. No deployment or real email was performed.

## UI refinement checks

After multi-model UI review, `scripts/ui-smoke.cjs` passed in Chromium against
local synthetic fixtures at 1440px, 390px, and 320px widths. It checks stacked,
left-aligned organization fields, evidence before approval, and absence of
page-level horizontal overflow on transactions, transaction detail, imports,
inventory, and settings. Run with `POCKETTRAIL_CHROMIUM` pointing to installed
Chromium and `NODE_PATH` pointing to installed Playwright if needed.

Workspace tests, dry-run build, and both HTTP smoke scripts also passed after
these UI changes. Browser layout assertions do not certify full accessibility.

## Latest regression rerun

- `cargo test --workspace` and `cargo check --target wasm32-unknown-unknown --lib` passed; the existing unused inventory field warning remains.
- `scripts/components-smoke.cjs` passed against the running local app: actual HTMX settling at desktop/mobile sizes, native source controls hidden from hit testing, focus and accessibility tree, enhanced clones, missing/failed CSS fallback, keyboard selection, date constraints, form values, reset and reduced motion.
- `scripts/ui-smoke.cjs` passed using custom login controls at 1440, 390 and 320px, including busy/error feedback and preserved organization input.
- Both Python HTTP smoke scripts and `node static/extraction.test.js` passed again. Only synthetic fixtures changed; no real email was sent.

These browser checks used the already-running local worker. A subsequent `printf 'n\n' | CI=1 WRANGLER_SEND_METRICS=false npm run build` dry run passed; no deployment occurred. Domain/parser Clippy checks passed with `-D warnings`. Native private-statement validation passed for all ten samples: 106 unique pocket transactions, 446 overlaps, zero conflicting snapshots or balance errors. A fresh worker restart is not established by these checks.

The Codex reviewer withdrew its provisional numeric scores: incomplete coverage is not evidence of a defect or a defensible category score. Keyboard login/filter and HTMX focus checks passed; PNG presentation was unreadable. The GLM review failed with provider `413 FUNCTION_PAYLOAD_TOO_LARGE`. Independent rendered visual scores remain unverified. DOM assertions alone do not establish visual quality or the requested 9.5/10 acceptance target.

## Discussion navigation and review limitations

Transaction navigation now includes a permission-gated Add comment jump. Older comments use a native disclosure while the latest three remain visible; chronological ordering and historical content remain intact. Render regression covers 0/1/3/4/7 comments, both permission states, escaping and disclosure boundaries. Workspace tests and dry-run build passed after merging this change. A live browser probe confirmed both the composer jump and older-comments disclosure in the running worker; component and responsive smoke scripts passed again.

Browser extraction and independent native comparison were rerun on all ten private community PDFs: all 552 rows matched, including all bank fields; no OCR fallback was needed.

A fresh GLM context could read bounded JPEG screenshots, unlike Codex contexts, including a browser-independent image control. GLM's corrected scores were 8.5 visual appeal, 8.5 layout, 9 typography, 9 components, 8.5 consistency, 8.5 feedback, 8.5 motion, 9.5 accessibility, 9 responsiveness and 8.5 task flow. Several original findings were retracted after source verification (filter controls, badge variants, transition rules, native file inputs). Treat these subjective scores cautiously; accessibility is not certified. Codex still cannot provide visual scores because image presentation is corrupted. The requested two-reviewer 9.5 minimum remains unmet; no scores were forced upward.

## Alternate-provider rendered review and mobile polish

OpenAI-subscription Codex successfully viewed screenshots; the earlier image corruption was provider-path-specific. Its rendered review identified and then verified fixes for conditional accessible table overflow cues, inventory panel padding, mobile settings spacing, navigation Escape/focus return, transaction card density, status/responsibility typography, and narrow inventory grouping. The Worker was explicitly restarted after rebuilding embedded templates. Served markers were checked before final review.

`node scripts/ui-polish-smoke.cjs` passed compiled-template checks at 320/390/800/1440px. The latest workspace tests and WASM check passed (existing unused inventory field warning remains). Live UI/component smoke and both HTTP workflow scripts passed again after restart; only synthetic business fixtures changed.

Final OpenAI-provider Codex rendered review: all ten criteria 9/10, no further confirmed functional/responsive defect. GLM's corrected review: nine criteria 9.5/10, task flow 9/10; its stated overall 9.5 is not evidence that every criterion met the threshold. Several GLM defect claims were again withdrawn after checking live/source evidence. A successful-filter result announcement remains an accessibility improvement candidate. The requested 9.5 minimum from both reviewers remains unmet; do not interpret these changes as acceptance of that target.

## Dialog-first interaction redesign

User requested replacing long stacked forms with icon-and-label actions opening focused dialogs. Transaction detail now exposes six actions; Settings five; Inventory permission-gated stock/item/location actions. Essential safety guidance remains inside relevant panels. Sections remain accessible without JavaScript.

`node scripts/dialog-smoke.cjs` passed native modal focus/Escape/backdrop handling, unsaved-edit protection, cross-dialog guards, validation, select/calendar top-layer interaction, real HTMX 422 preservation and 200 navigation cleanup, reduced motion and no-JS fallback. It also checked 26 panels from compiled real templates. Updated `node scripts/ui-polish-smoke.cjs` passed overview/panel checks at 320/390/800/1440px; live UI/component smoke passed after rebuilding and restarting the Worker. Workspace tests and dry-run build passed. Existing unused inventory field warning remains.

Synthetic transaction overview content now measures 375px at 320px width and 232px at 1440px; previously the editor was a 4436px/3129px stacked page. Dialogs containing long purpose forms still scroll internally; overview no longer requires traversing those forms to reach other information. No new post-change 9.5 review scores are claimed.

## Local fixture database selection fix

`scripts/local-smoke.py` now resolves the seeded local D1 file from the
`wrangler.toml` database id (the miniflare Durable Object id derivation) instead
of scanning `.wrangler/state` for the first synthetic-looking database, which
silently read a stale sibling whenever a second local database existed.
`scripts/local-import-smoke.py` shares the helper unchanged.

- `python3 scripts/local-smoke.test.py`: passed. A decoy database with identical
  synthetic content is ignored, and an unseeded configured database fails
  loudly instead of reading the decoy.
- `python3 -m py_compile scripts/local-smoke.py scripts/local-import-smoke.py
  scripts/local-smoke.test.py`: passed.
- With the package-lock-pinned wrangler 4.158.0 (miniflare 5.20261104.0-beta),
  `npm run db:migrate:local` plus `npm run db:seed:local` created exactly
  `.wrangler/state/v3/d1/miniflare-D1DatabaseObject/c39df11d115a63b5a1fb4d4e3d043486bac6b4837d60e71b772a967a59f0bba3.sqlite`,
  matching `configured_database_path`; the helper then read the seeded
  `demo-jakarta` fixture (`is_synthetic=1`, `transactions.id=3` bank id
  `JPXDEMO0003`) and ignored a same-content decoy placed beside it. Local state
  only; no production database, email, push, or deployment.
- HTTP smoke and import smoke reruns against a running local app are not
  included here; the parent thread runs them after merging.

## SvelteKit migration slice (phase 1)

A SvelteKit + TypeScript application now exists in `migration/` alongside the
untouched Rust app, per `docs/sveltekit-migration.md` phase 1. It is not the
default app and does not replace anything yet.

Environment: Node 22.20.0, npm 10.9.3. Pinned versions: `svelte` 5.57.3,
`@sveltejs/kit` 2.70.4, `@sveltejs/adapter-cloudflare` 7.2.10, `vite` 8.3.8,
`@sveltejs/vite-plugin-svelte` 7.3.1, `wrangler` 4.160.1, `vitest` 5.1.0,
`svelte-check` 4.7.8, `typescript` 6.0.3, `playwright` 1.61.1. Adapter 8.x was
not usable: it requires a SvelteKit 3 pre-release.

### Commands run

```sh
cd migration && npm install            # 112 packages, no install errors
npm run check                          # svelte-kit sync + svelte-check
npm run test:unit                      # vitest
npm run test:e2e                        # builds, migrates local D1, seeds, wrangler dev
npm run test:ui                         # same, plus Chrome
npx wrangler deploy --dry-run --outdir /tmp/pt-dry3
```

### Results

- `npm run check`: **0 errors, 0 warnings**.
- `npm run test:unit`: **40 passed** across 3 files — session codec (13),
  permissions (10), money/ledger helpers (17).
- `npm run test:e2e`: **46 runtime checks passed**.
- `npm run test:ui`: **17 rendered-UI checks passed**.
- `wrangler deploy --dry-run`: succeeded, read 25 asset files, uploaded
  464.47 KiB (104.65 KiB gzip), bindings resolved as `env.DB` (D1),
  `env.DOCUMENTS` (R2), `env.ASSETS`.
- `cargo check --workspace`: unchanged and still clean; no Rust file was
  modified (`git status` reports only the new `migration/` directory).

### What the runtime checks establish

The suite applies the repository's own migrations to a local D1 database, seeds
`tests/fixtures/seed.sql` plus `migration/e2e/fixtures/extra.sql`, builds the
Worker with the Cloudflare adapter, runs it under `wrangler dev` on loopback,
and drives it over HTTP. It proves:

- Signed-session compatibility: a cookie encoded by the TypeScript codec is
  byte-identical to one produced by an independent re-implementation of
  `src/auth.rs` using `node:crypto`, and a Rust-shaped cookie verifies here.
  Tampered signatures, a foreign signing key, an expired-but-correctly-signed
  session and a substituted CSRF token are all rejected as unauthenticated
  (303 to `/login`, not 500).
- Fixture sign-in requires all three gates. The same POST succeeds on a
  loopback `Host` and is refused (403, "restricted to loopback hostnames") when
  the `Host` header claims `pockettrail.example`. A public `Host` also gets a
  login page with no fixture identities, and `/healthz` returns only `ok`.
- CSRF and origin: sign-in without a challenge cookie, with a wrong token, with
  a cross-site `Origin`, or with an unknown identity is refused.
- Organization isolation: a non-member gets 403 on another organization's
  ledger; a transaction owned by another organization returns 404 through the
  owning organization's path and 403 through a foreign path, before lookup; a
  multi-organization member sees exactly their own organizations; a member
  whose role lacks `ViewTransactions` is denied with the permission named,
  while still seeing their organization list.
- Money: the seeded `-150000000` minor units render as `-Rp 1.500.000` and
  `850000000` as `Rp 8.500.000`, and unsafe integer ranges are refused rather
  than rounded.
- Response hygiene: `private, no-store`, `x-frame-options: DENY`,
  `x-content-type-options: nosniff` on rendered pages.

### What the UI checks establish

Driven with system Chrome against the same Worker:

- Sign-in and ledger navigation work with **JavaScript disabled**, so the
  flows are progressively enhanced rather than script-gated.
- The ledger renders 3 seeded rows with the exact money strings at 320, 768,
  1440 and 1920 px, with no horizontal page overflow at any of them.
- Keyboard tabbing reaches the status filter and its submit button, and focused
  controls keep a visible outline.
- The page still renders fully with `prefers-reduced-motion: reduce`.
- At 320 px the stacked rows keep visible per-fact labels ("Amount:",
  "Balance after:", …) and keep `role="table"/"row"/"cell"`, so the mobile
  layout does not silently drop financial facts or table semantics.
- A foreign organization renders the readable 403 page.

Screenshots: `.wrangler/ui/{ledger-320,ledger-768,ledger-1440,ledger-1920,detail-320,detail-1440,login-320,login-1440,orgs-1440-nojs,forbidden-1440}.png`
(git-ignored, regenerate with `npm run test:ui`).

### Not verified

- Google ID-token verification is not ported. The slice reports Google sign-in
  as unconfigured and never accepts an unverified credential.
- No write path exists, so peer-request semantics, atomicity, revision/mutation
  token winners and audit rows are untested here.
- The R2 binding is proven wired only; no object is read or written, so private
  document authorization and key handling remain unverified.
- Real-browser checks used system Chrome, not Playwright's pinned Chromium, and
  covered the ledger journeys only.
- `scripts/local-smoke.py`, the admin/platform smoke scripts and their playground
  are untouched and were not re-run against the SvelteKit app.

## Remaining acceptance checks

Real Google sign-in and responsive rendered application workflows still need
browser acceptance checks. Local outbox capture does not establish production
email-server integration. HTTP smoke success does not establish race safety or
full accessibility compliance.
