# Validation evidence

This file records checks actually run, not implementation promises. All results
below are from a clean checkout of this commit: `rm -rf node_modules .svelte-kit`
followed by `npm ci`, then the commands listed.

Environment: Node 22.20.0, npm 10.9.3, Linux. Pinned versions: `svelte` 5.57.3,
`@sveltejs/kit` 2.70.4, `@sveltejs/adapter-cloudflare` 7.2.10, `vite` 8.3.8,
`vitest` 5.1.0, `wrangler` 4.160.1, `typescript` 6.0.3, `playwright` 1.61.1.

## Commands and results

| Command | Result |
| --- | --- |
| `npm ci` | clean install, no errors |
| `npm run check` | **0 errors, 0 warnings** (`svelte-check`, generated types) |
| `npm run test:unit` | **135 passed** across 14 files |
| `npm run test:extraction` | all assertions passed (browser extraction helper) |
| `npm run test:e2e` | **46 runtime checks passed** |
| `npm run test:journeys` | **134 checks passed**, 0 failures |
| `npm run test:ui` | **25 rendered-UI checks passed** |
| `printf 'n\n' \| CI=1 npx wrangler deploy --dry-run --outdir /tmp/pt-dry` | succeeded; 788.35 KiB upload (171.34 KiB gzip); bindings resolved as `env.DB` (D1), `env.DOCUMENTS` (R2), `env.ASSETS` |

The runtime suites are not mocks. They apply `migrations/*.sql` to a fresh local
D1 database with `wrangler d1 migrations apply --local`, seed
`tests/fixtures/seed.sql` plus `e2e/fixtures/extra.sql`, build the Worker with
`@sveltejs/adapter-cloudflare`, run it under `wrangler dev` on loopback, and
drive it over HTTP (and, for the UI suite, a real Chrome). No remote binding is
touched: `wrangler.toml` has no `account_id`, no routes, a placeholder D1 id, and
a non-production bucket name.

## Unit coverage (135)

- `session.test.ts` — HMAC session codec: byte-identical encoding against an
  independent re-implementation, tampered signatures, foreign keys, expiry.
- `permissions.test.ts` — per-entry permission sets, inactive memberships,
  role-scope parsing.
- `money.test.ts`, `fmt.test.ts` — integer minor units, 100 per IDR, unsafe range
  rejection, Jakarta date/time labels, rupiah input round-trips.
- `parser.test.ts` — the ported Jago parser against every case from the Rust
  crate's unit and synthetic suites: column geometry, continuation rows,
  ID/date/time recognition, balance chain, IDR minor parsing.
- `domain.test.ts` — documentation validation, purpose totals, submit/review
  decisions, self- and historical-self approval denial, stock rules.
- `mentions.test.ts`, `notify_rules.test.ts` — mention resolution, digest cadence.
- `audit_rules.test.ts`, `audit_sql.test.ts`, `notify_sql.test.ts`,
  `inventory.test.ts`, `tokens_profile.test.ts`, `google.test.ts` — SQL-level
  behavior against the real migrations through Node's SQLite (append-only audit
  triggers, `changes()` gating, notification cancellation/snapshot SQL, losing
  confirmer writes nothing, stock level updates, invitation token hashing,
  Google ID-token verification against synthetic JWKS material).

The SQL tests run the actual statements and triggers from `migrations/`, not
copies; this replaces the earlier Rust-source inspection tests.

## Runtime checks (46) — `e2e/run.mjs`

Signed-session compatibility and rejection (tampered, foreign key, expired,
substituted CSRF), fixture sign-in gates (`LOCAL_DEV`, loopback host, signing
key), CSRF/origin enforcement, organization isolation (foreign ids reported as
missing, non-members denied), permission-named denials, exact money rendering,
response hygiene (`private, no-store`, `nosniff`, `DENY`), and logout.

## Journey checks (134) — `e2e/journeys/*.mjs`

- **transactions** — documentation save with revision CAS, stale-revision
  rejection leaving no trace, historical responsible member denied approval,
  independent reviewer approval, comments leaving approval intact, substantive
  edits reopening review, exact money, stored `<script>` payload escaped, evidence
  upload and authorized/unauthorized download (including income-only access
  paths), foreign-organization lookups reported as missing, suppression requiring
  a reason and never implying completion, resume, income notes without approval,
  and income refusing an approval step.
- **imports** — staging from browser-extracted text plus the original PDF,
  preview classification (`Will import` / `Skip (unchanged)` / `Conflict` /
  `Needs review`), confirmation, cumulative re-import creating no duplicate row,
  changed bank fields retained rather than overwritten, missing-ID batches
  blocking confirmation with a 409, repeated bank IDs quarantined in one
  statement, and organization/permission scoping of the staging page.
- **settings** — per-section permissions, role validation requiring
  `ViewTransactions`, duplicate role/pocket/mapping rejection, active-owner
  rules, member grant/revoke/restore with immediate access loss, self-removal
  refusal, invitation create/revoke, notification enable gated on a fresh
  recipient preview, digest capture into the local outbox, and permission-gated
  notification changes.
- **platform** — administrator-only access, no organization finance access,
  self-access change refusal, grant/revoke with the in-batch probes, and role
  template saving.
- **races** — two concurrent revision writes (exactly one 303, one 409, one whole
  surviving version, no duplicate child rows) and two concurrent import
  confirmations (one row inserted, one result set).

## Rendered UI checks (25) — `e2e/ui.mjs`

JavaScript-disabled sign-in, ledger at 320/768/1440/1920px with exact money and
no horizontal overflow, stacked mobile cells keeping labels and table roles,
keyboard focus order with visible outlines, reduced-motion rendering, transaction
detail (purposes, owed-documentation notice, labelled controls, single `h1`),
foreign-organization denial page, settings sections at desktop and 320px, import
staging form labels, platform administration sections, an accessible-name audit
of every visible control, and the mobile navigation toggle. Screenshots are
written to `.wrangler/ui/` (git-ignored).

## Not verified here

- **Production deployment, remote migrations, and real email/SMTP delivery were
  not performed.** Invitation and notification transport is outbox-only by
  design; `EMAIL_DELIVERY_ENABLED` is disabled.
- **Live Google sign-in was not exercised.** Token verification is unit-tested
  against synthetic JWKS material, and the login page loads Google Identity
  Services on demand, but no real credential was exchanged in this environment.
- **The 10-PDF / 552-row private-sample comparison is unverified in this
  rewrite.** The comparison tooling depended on the removed Rust parser, and the
  authorized private fixtures are not available here. Do not replace it with
  synthetic evidence. The ported parser is covered by the synthetic suite, and
  `scripts/validate-browser-extraction.cjs` still drives the shipped browser
  extraction path for an operator who has the samples locally.
- **Rendered checks used system Chrome, not Playwright's pinned Chromium**, and
  the accessible-name audit is not a full WCAG audit.
- **Race checks run against one local Worker instance.** They prove the CAS and
  token-gated batches reject losers at the HTTP boundary; D1 batch atomicity and
  trigger interactions are covered at the SQL level, not under real multi-region
  concurrency.
- Session cookies remain stateless signed cookies with a 12-hour expiry; there is
  no revocation list beyond key rotation.
