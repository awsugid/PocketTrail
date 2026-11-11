# PocketTrail

Community financial records, transaction accountability, and merchandise stock
for AWS User Group organizers.

PocketTrail is an **English-only, organization-scoped web application** built
with Rust, server-rendered HTML, and HTMX for Cloudflare Workers, D1, and private
R2 storage. The interface follows Cloudscape-informed operating patterns; it is
not an official AWS service or a React Cloudscape component implementation.

**Current release boundary: local development and validation.** Nothing in this
repository authorizes deployment, real notification delivery, or publication of
community financial data. See [validation evidence](docs/validation.md) for the
checks actually performed and remaining limitations.

## Local setup

Prerequisites:

- Rust stable and `wasm32-unknown-unknown`.
- `worker-build` available on `PATH`.
- Node.js 22 or later and npm.
- Python 3 for local configuration and HTTP checks.
- Poppler's `pdftotext` for independent PDF validation (not for normal browser
  uploads).

```sh
rustup target add wasm32-unknown-unknown
cargo install --locked worker-build
npm ci
python3 scripts/configure-local.py
npm run db:migrate:local
npm run db:seed:local
npm run dev
```

Open <http://127.0.0.1:8787>.

`configure-local.py` reuses the existing Google client ID from
`~/GithubRepo/playground/aws/jakarta-website/.env` or the related
`jakarta-backend/.env`. It writes an ignored, owner-readable `.dev.vars` with a
random session signing key. It never prints credentials, and does not request a
new Google OAuth client or modify either existing project.

The seed command is **only for a fresh local database**. It does not erase or
reset an existing database. Do not rerun it after importing real records.
Synthetic fixtures are separate from deployment migrations.

### Local identities

The sign-in page offers fixture identities only when `LOCAL_DEV=true`, a signing
key exists, and the request uses a loopback hostname.

- **Alice:** administrator of the synthetic Jakarta organization.
- **Bob:** Jakarta approver and administrator of the separate synthetic
  Indonesia organization.
- **Admin:** platform administrator with no initial organization memberships.

Use Alice and Bob to test independent approval. A platform administrator is not
automatically allowed to read every organization's finances.

Google Sign-in requires the existing OAuth client's authorized JavaScript origins
to include the local URL being used. Locating the existing client ID does not
prove that origin is registered. Fixture login tests the local workflow without
requiring a live Google login.

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
- Historical reminders use a chosen transaction-date cutoff.
- Departed members retain attribution but lose organization access and stop
  receiving notifications.

Connecting the existing email server and scheduled delivery is a separate
integration gate, not something the local outbox proves.

## Checks

```sh
npm test
npm run check:wasm
npm run build
python3 scripts/local-smoke.py
```

The HTTP smoke check requires the seeded app to be running on loopback. It
changes only identified synthetic fixtures and exercises permissions, CSRF,
approval, evidence retrieval, suppression, offboarding, and stock validation.

For local private statement samples:

```sh
node scripts/validate-browser-extraction.cjs
python3 scripts/validate-private-statements.py
python3 scripts/validate-private-statements.py \
  --text-directory local-data/browser-statements --compare-native
```

Install a Playwright Chromium browser with `npx playwright install chromium` if
none is available, or set `POCKETTRAIL_CHROMIUM` to an existing compatible
executable. Extracted data stays under ignored `local-data/`; the validation
scripts output counts and mismatch counts, not names, IDs, notes, or balances.

## Privacy and deployment boundary

- Root `Jago*.pdf` samples, `.dev.vars`, `.env`, local database/R2 state,
  extracted records, and browser captures are Git-ignored.
- Static asset serving is restricted to `static/`, not the project root.
- Real statements and invoices must never be committed to the public repository.
- Use synthetic workspaces for screenshots. Create a separate organization
  before working with real community records.
- The checked-in D1 identifier is a local placeholder. Provisioning Cloudflare
  resources, administering production access, and deployment require separate
  configuration and explicit authorization.
- Free-tier allowances are not a promise of permanently free operation.

## Project context

- [Product decisions](PRODUCT.md)
- [Domain glossary](CONTEXT.md)
- [Design system](DESIGN.md)
- [SvelteKit rewrite plan](docs/sveltekit-migration.md)
- [Original local implementation plan](docs/implementation-plan.md)
- [Validation evidence](docs/validation.md)
- [Template and route contract](templates/README.md)
