# Cloudflare deployment preparation

## Current rollout boundary

This repository is a **local validation release**. Nothing here authorizes
deploying to production, applying remote migrations, enabling email delivery, or
publishing community financial data. Deployment requires explicit authorization
from the organization that owns the Cloudflare account, and every step below is
a reference for that approved operation rather than an instruction to run now.

`wrangler.toml` contains a configured D1 database identifier and R2 bucket.
Do not assume that omitting `account_id` or `[[routes]]` prevents remote changes:
Wrangler can resolve the account from its credentials. Local checks must use
`--local`; remote commands require an approved deployment.

## Application shape

One SvelteKit app (`@sveltejs/kit` 2.x, `@sveltejs/adapter-cloudflare` 7.x)
builds to a single Worker:

- `npm run build` writes `.svelte-kit/cloudflare/_worker.js` plus assets.
- `wrangler.toml` binds `DB` (D1), `DOCUMENTS` (private R2) and `ASSETS`.
- `migrations_dir = "migrations"` keeps the existing SQL history; schema and
  migration files are unchanged by the rewrite.
- `nodejs_compat` is required by the adapter's server runtime.

There is no Rust toolchain, Wasm target, `worker-build`, static-site split, or
separate frontend build. `npm ci && npm run build` is the whole build.

## Cloudflare Builds commands

This project uses Cloudflare Workers Builds directly. Configure the production
branch's commands in the Worker's **Settings → Build**:

- Build command: `npm ci && npm run check && npm run test:unit && npm run build`
- Deploy command: `npm run deploy`

The deploy script runs `wrangler d1 migrations apply DB --remote` before
`wrangler deploy`. Wrangler records applied migrations and skips them on later
builds; `&&` prevents deploying the Worker if a migration fails. Do not use bare
`npx wrangler deploy`, which does not apply D1 migrations. Never run this
production deploy command for preview branches; they need separate resources.

The Cloudflare Builds API token needs permission to deploy this Worker and its
assets and write to the configured D1 database. Store credentials
in Cloudflare's build configuration, not this repository. The dashboard command
and token permissions have not been verified here.

Keep schema changes backward-compatible: the currently deployed Worker continues
serving requests while migrations run, and a failed Worker deployment does not
undo a successful migration. Do not seed remote databases with local fixtures.

For an approved initial rollout, update the deploy command and retry the build
for the intended production commit. The dry-run check is:

```sh
printf 'n\n' | CI=1 npx wrangler deploy --dry-run --outdir /tmp/pt-dry
```

A dry run proves bundling and binding resolution only. It does not prove remote
bindings, quotas, Google login, secrets, or delivery readiness.

## Read-only preflight — before asking to create or deploy

1. Install Node.js 22+ and run `npm ci`.
2. `npm run check`, `npm run test:unit`, `npm run test:e2e`,
   `npm run test:journeys`, `npm run test:ui` locally.
3. `npm run build` and the dry run above.
4. Confirm `git status` is clean and no `Jago*.pdf`, `.dev.vars`, `.env`,
   `.wrangler/` state, or `local-data/` content is staged.
5. Record the commit SHA under review.

## Deployment runbook — reference for approved operations

Only after the owning organization authorizes a specific deployment:

1. Verify the D1 database id and R2 bucket in `wrangler.toml` belong to the
   intended Cloudflare account and environment.
2. Provide secrets out of band: `SECRET_SESSION_KEY` (32+ chars) and, if Google
   sign-in is enabled, `GOOGLE_CLIENT_ID`. Never commit them.
3. Use the Cloudflare Builds commands above so pending migrations run before
   deployment. For an approved manual deployment, build first with
   `npm ci && npm run build`, then run `npm run deploy`.
4. Confirm the Worker's health endpoint and that the deployed assets/bindings
   match the reviewed commit. Verify the remote migration history in the build
   logs; do **not** run `db:seed:local` against remote data.
5. Enable Google OAuth authorized origins for the deployed hostname before
   relying on Google sign-in.
6. Invitation SMTP uses the existing Worker settings `SMTP_HOST`, `SMTP_PORT`,
   `SMTP_USERNAME`, `SMTP_PASSWORD`, and `SMTP_FROM`, gated by
   `EMAIL_DELIVERY_ENABLED=true`. Preserve existing production settings;
   `keep_vars = true` in `wrangler.toml` retains dashboard-managed variables
   during deployment. Keep local delivery disabled. Use port 465 (implicit TLS) or 587 (mandatory
   STARTTLS), not port 25 (blocked by Workers). The host must resolve to a
   reachable mail server, not a Cloudflare-proxied or private address.
   Set credentials as Worker secrets, never in committed files. See
   [Cloudflare TCP restrictions](https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/#considerations).
   After deployment, an operator can Resend an existing invitation to a
   consenting recipient and check its mail status. No live SMTP delivery was
   performed during local validation.
   Notification emails (assignment, mention, and the manual weekly digest)
   use the same SMTP variables and the same `EMAIL_DELIVERY_ENABLED=true`
   gate. Each queued `notification_outbox` row records `sent_at`, `attempts`
   (at most 3) and `last_error`; unsent rows are retried on the organization's
   next delivery. With delivery disabled, rows stay queued and unsent. Rows
   older than 7 days are never emailed. There is no reminder scheduler.

Rollback: redeploy the previous commit's build. D1 migrations are append-only
history; this repository does not ship a down-migration.

## First administrator

A fresh database has no users. The first platform administrator is created by
signing in with Google once (which upserts the user row) and then granting
`is_platform_admin` through an approved SQL statement executed by an operator.
There is no public bootstrap endpoint, by design. Acceptance then proceeds with
synthetic fixtures in a staging organization before real records are handled.

## What the checks do not establish

- No production deployment, remote migration, or real email has been performed
  from this repository.
- Google ID-token verification is implemented and unit-tested against synthetic
  JWKS material, but a live Google sign-in has not been exercised here.
- Scripted SMTP tests do not establish real mail-server connectivity, credential
  validity, or inbox delivery. Transaction notifications have no email scheduler.
- Rendered checks used a system Chrome over synthetic fixtures; they are not a
  full accessibility audit.

## Primary sources

- SvelteKit adapter-cloudflare documentation: <https://svelte.dev/docs/kit/adapter-cloudflare>
- Cloudflare Workers Builds documentation: <https://developers.cloudflare.com/workers/ci-cd/builds/>
- Wrangler configuration reference: <https://developers.cloudflare.com/workers/wrangler/configuration/>
