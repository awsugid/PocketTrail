# PocketTrail

Community financial records, transaction accountability, and merchandise stock
for AWS User Group organizers.

PocketTrail is an **English-only, organization-scoped web application** built as
one full-stack [SvelteKit](https://svelte.dev/docs/kit) app in TypeScript on
Cloudflare Workers, D1, and private R2 storage. Server rendering, form actions,
and server-only modules keep authorization and financial rules out of the
browser. The interface follows Cloudscape-informed operating patterns; it is not
an official AWS service or a React Cloudscape implementation.

**Current release boundary: local development and validation.** Nothing in this
repository authorizes deployment, real notification delivery, or publication of
community financial data. See [validation evidence](docs/validation.md) for the
checks actually performed and remaining limitations.

## Local setup

Prerequisites: Node.js 22 or later (developed against 22.20) and npm. Nothing
else is required — there is no Rust toolchain, no Wasm build step, and no
separate frontend.

```sh
npm ci
cp .dev.vars.example .dev.vars       # then set SECRET_SESSION_KEY (32+ chars)
npm run db:migrate:local             # applies migrations/*.sql to local D1
npm run db:seed:local                # synthetic fixtures only
npm run dev                          # http://127.0.0.1:5173
```

`npm run db:seed:local` is **only for a fresh local database**. It does not erase
or reset an existing database. Do not rerun it after importing real records.
Synthetic fixtures are separate from deployment migrations.

### Local identities

Fixture sign-in is offered only when `LOCAL_DEV=true`, a signing key exists, and
the request uses a loopback hostname.

- **Alice:** administrator of the synthetic Jakarta organization.
- **Bob:** Jakarta approver and administrator of the separate synthetic
  Indonesia organization.
- **Admin:** platform administrator with no initial organization memberships.

Use Alice and Bob to test independent approval. A platform administrator is not
automatically allowed to read every organization's finances.

Google Sign-in requires an OAuth client whose authorized JavaScript origins
include the local URL in use. Locating a client ID does not prove that origin is
registered. Fixture login tests the local workflow without a live Google login.

## Core workflow

1. Choose an organization and pocket.
2. Select a Jago PDF. Browser-local PDF.js extracts its text; no statement goes
   to an external document-processing or AI service.
3. Review the import before confirming it.
4. Match full Jago references within the pocket. Repeated cumulative exports
   must not replace existing explanations, assignments, evidence, discussions,
   or approval. Conflicting bank facts require review.
5. Assign responsibility through explicit actor mappings or transaction details.
6. Supply a purpose and evidence, with multiple allocations when one transfer
   covers several purposes.
7. Discuss the transaction and request independent approval.

Bank facts remain separate from the spender's explanation. Responsible members,
including historical responsible members retained after reassignment, cannot
approve their own transactions. Substantive edits invalidate approval; discussion
does not.

Merchandise inventory records an item, optional variant, quantity by location or
holder, and an attributed change history. It is not an equipment-lending system.

## Notification safety

- Organization notifications start **off**.
- Local work captures notification intentions in an **outbox**; it does not
  send email to organizers.
- Mentions do not override organization disablement or transaction suppression.
- A transaction's suppression excludes every notification and summary concerning
  it; suppression does not mean evidence exists or approval was granted.
- Historical reminders use a chosen transaction-date cutoff, and enabling
  notifications requires previewing recipients for that cutoff first.
- Departed members retain attribution but lose organization access and stop
  receiving notifications.

Connecting the existing email server and scheduled delivery is a separate
integration gate, not something the local outbox proves.

## Checks

```sh
npm run check             # svelte-check: generated types + TypeScript
npm run test:unit         # pure server rules, parser, money, permissions
npm run test:extraction   # browser extraction helper (plain Node)
npm run test:e2e          # builds the Worker, migrates + seeds local D1, HTTP checks
npm run test:journeys     # inventory, transactions, imports, settings, races
npm run test:ui           # rendered desktop/mobile/accessibility checks (Chrome)
printf 'n\n' | CI=1 npx wrangler deploy --dry-run --outdir /tmp/pt-dry
```

`test:e2e`, `test:journeys`, and `test:ui` are not mocks: they rebuild the local
D1 database from `migrations/`, seed `tests/fixtures/seed.sql`, build the Worker
with `@sveltejs/adapter-cloudflare`, run it under `wrangler dev` on loopback, and
drive it over HTTP and a real browser. The UI check uses a system Chrome
(`/usr/bin/google-chrome` by default, override with `CHROME_PATH`).

For local private statement samples, `scripts/validate-browser-extraction.cjs`
drives the shipped browser extraction path against `Jago*.pdf` files and writes
only ignored `local-data/browser-statements` text. It reports counts, never names,
IDs, notes, or balances. Install `npx playwright install chromium` if no Chrome
is available, or point `POCKETTRAIL_CHROMIUM` at one.

## Architecture

```
src/
  app.css  app.html  app.d.ts  hooks.server.ts
  lib/                     shared browser-safe helpers (money, fmt, domain types)
  lib/server/              server-only: session, permissions, D1/R2 access, parser,
                           financial rules, audit, notifications
  lib/components/          shared page chrome
  routes/                  pages, form actions, endpoints
static/                    browser assets: vendored PDF.js, extraction helper
migrations/                the existing SQL schema and history (unchanged)
tests/                     unit tests (vitest) and synthetic fixtures
e2e/                       runtime harness, journeys, rendered-UI checks
docs/                      decisions, deployment notes, validation evidence
```

`$lib/server/*` is server-only: SvelteKit refuses to bundle it into the browser,
so signing keys and permission logic cannot reach a client module. There is no
client-side copy of permission authority; hiding a control is never the gate.

## Privacy and deployment boundary

- Root `Jago*.pdf` samples, `.dev.vars`, `.env`, local database/R2 state,
  extracted records, and browser captures are Git-ignored.
- Static assets are served from `static/`, not the project root.
- Real statements and invoices must never be committed to the public repository.
- Use synthetic workspaces for screenshots. Create a separate organization
  before working with real community records.
- `wrangler.toml` has no `account_id` and no `[[routes]]`, and its D1 identifier
  is a local placeholder, so `wrangler deploy` and `--remote` commands cannot
  reach the live PocketTrail service or data. Provisioning Cloudflare resources
  and deployment require separate configuration and explicit authorization.
- Free-tier allowances are not a promise of permanently free operation.

## Project context

- [Product decisions](PRODUCT.md)
- [Domain glossary](CONTEXT.md)
- [Design system](DESIGN.md)
- [SvelteKit migration record](docs/sveltekit-migration.md)
- [Deployment notes](docs/deployment.md)
- [Validation evidence](docs/validation.md)
