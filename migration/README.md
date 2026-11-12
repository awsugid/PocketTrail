# PocketTrail SvelteKit migration slice

A runnable full-stack SvelteKit foundation for the rewrite described in
[`../docs/sveltekit-migration.md`](../docs/sveltekit-migration.md). This is
phase 1 — *prove one full-stack vertical slice* — not a rewrite claim. The Rust
application in the repository root is untouched, still builds, and remains the
behavioral reference until each journey is verified.

Nothing here deploys, applies remote migrations, sends notifications, or reads
private data.

## What this slice actually does

| Capability | State |
| --- | --- |
| Session cookie verification compatible with the Rust codec | Done — byte-identical encoding, verified against `node:crypto` in tests |
| Local fixture sign-in | Done — requires `LOCAL_DEV`, a loopback host and a signing key |
| Organization selection | Done — active memberships only |
| Permission-protected ledger read | Done — `ViewTransactions` re-checked per request |
| Per-entry read with cross-organization isolation | Done — foreign IDs are indistinguishable from missing ones |
| Exact money rendering and parsing | Done — integer minor units, 100 per IDR, unsafe ranges refused |
| Google sign-in | **Not ported** — reports itself as unconfigured; no token verification is invented |
| Any write, import, evidence download, notification | **Not ported** |

## Layout

```
migration/
  wrangler.toml            local-only bindings; no account_id, no routes
  svelte.config.js         adapter-cloudflare, cross-origin form check on
  src/lib/money.ts         shared money helpers (minor units, no floats)
  src/lib/server/          server-only: session, permissions, auth guards,
                           D1 access, ledger queries
  src/lib/components/      shared page chrome
  src/routes/              login, logout, orgs, ledger list, ledger detail
  tests/                   unit tests (vitest, plain Node)
  e2e/                     runtime harness, security checks, UI checks
```

`$lib/server/*` is server-only: SvelteKit refuses to bundle it into the browser,
so session secrets and permission logic cannot reach a client module.

## Setup

Requires Node 22+.

```sh
cd migration
npm install
cp .dev.vars.example .dev.vars      # then fill in SECRET_SESSION_KEY (32+ chars)
npm run db:migrate:local            # applies ../migrations/*.sql to local D1
npm run db:seed:local               # synthetic fixtures only
npm run dev                         # http://127.0.0.1:5173
```

Sign in with a fixture identity on the login page. Fixture sign-in is refused
unless all three gates hold: `LOCAL_DEV=true`, a loopback host, and a
`SECRET_SESSION_KEY` of at least 32 characters.

### Why the local state cannot collide with the Rust app

The Worker has its own `wrangler.toml`, its own `.wrangler/` state directory,
its own build output (`.svelte-kit/cloudflare`), and its own static assets. It
declares a **placeholder** D1 `database_id` and an R2 bucket name that is not
the production bucket, so `--remote` commands cannot reach live data even by
mistake. There is also no `account_id` and no `[[routes]]`, so `wrangler deploy`
cannot publish over `pocket.awscommunity.id`.

SQL is shared, not forked: `wrangler.toml` points `migrations_dir` at the
repository's existing `../migrations`, and the fixtures are the existing
`../tests/fixtures/seed.sql`. No schema redesign happens during the migration.

## Validation

```sh
npm run check        # svelte-check + generated types
npm run test:unit    # 40 unit tests, plain Node
npm run test:e2e     # 46 runtime checks against the built Worker
npm run test:ui      # 17 rendered-UI checks (needs Chrome; see below)
```

`test:e2e` and `test:ui` are not mocks: they rebuild the local D1 database from
the real migration files, seed the synthetic fixtures, build the Worker with
`@sveltejs/adapter-cloudflare`, run it under `wrangler dev` on loopback, and
drive it over HTTP (and, for the UI checks, a real browser). Screenshots land in
`.wrangler/ui/`.

The UI check uses a system Chrome (`/usr/bin/google-chrome` by default, override
with `CHROME_PATH`) instead of downloading a Playwright browser.

Recorded results and the exact command output are in
[`../docs/validation.md`](../docs/validation.md).

## Security model in this slice

- `requireLogin` fails closed with 503 when `SECRET_SESSION_KEY` is missing or
too short, and redirects to `/login` for any absent, tampered, expired or
foreign-signed cookie.
- `requireMember` re-reads membership and role rows for the current request and
runs the permission check there. There is deliberately **no org layout load**
acting as a gate: SvelteKit parent loads can run concurrently or be reused
during navigation, so each protected load authorizes itself.
- Every ledger query is scoped by `org_id` in SQL. A row from another
organization is reported as missing (404), not forbidden.
- Mutations check `Origin`/`Sec-Fetch-Site` explicitly in addition to
SvelteKit's own form-origin check and the session-bound CSRF token.
- Responses are `private, no-store`, `nosniff`, `DENY` framed, `same-origin`
referrer.

## Deliberate limitations

- No writes, so no transaction edit, approval, import, evidence upload/download,
settings, invitations or platform administration.
- Google sign-in is not implemented. The slice never verifies a Google token and
never falls back to trusting an unverified credential.
- No audit rows are written yet (`src/audit_rules.rs` parity is phase 2).
- Sessions remain stateless signed cookies, exactly as in Rust; there is no
revocation list beyond key rotation and the 12-hour expiry.
- The R2 binding is proven wired (`/healthz` reports it locally) but no object is
read or written, so R2 authorization and key handling are unverified.
- Adapter choice is pinned to the SvelteKit 2 line: `@sveltejs/adapter-cloudflare`
8.x requires a SvelteKit 3 pre-release, so this slice uses adapter 7.2.10 with
kit 2.70.4. Revisit when kit 3 is stable.
- Large-viewport layout and task hierarchy are demonstrated on the ledger only;
the other journeys still need their own hierarchy decisions with User Group
leaders before they are replicated.
