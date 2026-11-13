# Cloudflare deployment preparation

## Current rollout boundary

This repository is a **local validation release**. Nothing here authorizes
deploying to production, applying remote migrations, enabling email delivery, or
publishing community financial data. Deployment requires explicit authorization
from the organization that owns the Cloudflare account, and every step below is
a reference for that approved operation rather than an instruction to run now.

`wrangler.toml` deliberately contains:

- no `account_id`,
- no `[[routes]]` (so it cannot claim `pocket.awscommunity.id`),
- a placeholder D1 `database_id` (`00000000-0000-4000-8000-000000000000`),
- a non-production R2 bucket name.

With those values, `wrangler deploy` and any `--remote` command fail rather than
touching live resources. Replacing them is the first step of an approved
deployment, and belongs in that operation's own change review.

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

If the project uses Cloudflare Workers Builds instead of a local deployment, the
build command is `npm ci && npm run build` and the deploy command is
`npx wrangler deploy` (after review). The dry-run check is:

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

1. Replace the placeholder `database_id` with the real D1 database id, and the
   R2 `bucket_name` with the real bucket, in `wrangler.toml`.
2. Provide secrets out of band: `SECRET_SESSION_KEY` (32+ chars) and, if Google
   sign-in is enabled, `GOOGLE_CLIENT_ID`. Never commit them.
3. Apply migrations with review: `npx wrangler d1 migrations apply DB --remote`.
   Do **not** run `db:seed:local` against remote data.
4. `npx wrangler deploy`, then confirm the Worker's health endpoint and that the
   deployed assets/bindings match the reviewed commit.
5. Enable Google OAuth authorized origins for the deployed hostname before
   relying on Google sign-in.
6. Leave `EMAIL_DELIVERY_ENABLED` unset/false. Invitation delivery and
   notification transport remain outbox-only in this rewrite; connecting the
   existing mail server is a separate integration gate.

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
- Local outbox capture is not email/SMTP delivery and has no scheduler.
- Rendered checks used a system Chrome over synthetic fixtures; they are not a
  full accessibility audit.

## Primary sources

- SvelteKit adapter-cloudflare documentation: <https://svelte.dev/docs/kit/adapter-cloudflare>
- Cloudflare Workers Builds documentation: <https://developers.cloudflare.com/workers/ci-cd/builds/>
- Wrangler configuration reference: <https://developers.cloudflare.com/workers/wrangler/configuration/>
