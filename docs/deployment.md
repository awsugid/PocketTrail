# Cloudflare deployment preparation

## Current rollout boundary

The sections below record the initial deployment and its historical checks;
they are not current production-state assertions or permission to redeploy.
Local configuration now targets `https://pocket.awscommunity.id`. The operator
reported connecting Cloudflare Workers Builds to GitHub `awsugid/PocketTrail`,
branch `main`; current rollout/version has not been rechecked here. Ship future
code through that Git/CI/CD connection, not manual `wrangler deploy`.

Administration/invitation migrations `0006`–`0009` were applied to production
with explicit approval; remote listing confirmed none pending. Old Worker
rollback does not undo migrations. See [administration rollout](admin-rollout.md).

### Cloudflare Builds commands

- Build command: `npm run ci:build`
- Deploy command: `npm run ci:deploy`
- Root: `/`; production branch: `main`; nonproduction builds disabled.
- Build token needs Worker deployment and D1 write access.

`scripts/cloudflare-ci.sh` installs Rust stable and portable WASI SDK 25 Clang
under `$HOME`, without root or sudo, then installs worker-build 0.8.7, runs tests,
and performs a dry-run WASM build. Deploy reloads both toolchain paths in its
separate shell and runs migration-first `npm run deploy`. The Rust target stays
`wasm32-unknown-unknown`; WASI SDK supplies only its C compiler. Cached toolchains
are reused. Bootstrap needs outbound HTTPS to GitHub and Rust distribution hosts.
Shell regression uses mocked commands; fresh bootstrap on Cloudflare remains
unverified until its first successful hosted build.

Keep `EMAIL_DELIVERY_ENABLED=false`. SMTP secrets were configured separately;
rotated credentials have not been authenticated from a Worker and no real
email has been sent. Existing Google origin and first administrator setup were
subsequently completed by authorized operators; do not repeat bootstrap SQL.

## Historical initial deployment record

**Status: production deployed with explicit user approval.**
Live origin: https://pockettrail.awscommunity.id. Dedicated D1 `pockettrail` and
private R2 `pockettrail-documents` are bound to Worker `pockettrail`. Migrations
`0001` through `0005` are applied; remote migration listing reports none pending.
`GOOGLE_CLIENT_ID` reuses the existing client; `SECRET_SESSION_KEY` was freshly
generated in memory and uploaded with only those two keys, never written to disk.
Active version after secret configuration: `026b5ae5-4ea4-447b-8e56-99e89998bad6`.
No Git push, GitHub build integration, demo seed, or notification delivery.

Production checks completed:
- HTTPS `/login`: 200, Google sign-in script present, fixture login absent.
- Unauthenticated `/orgs`: 303 to `/login`.
- POST `/login/dev`: 403, explicitly reports `LOCAL_DEV` not set.
- `/static/app.css` and `/static/app.js`: 200.
- D1 counts: zero users, organizations, transactions, or enabled notification orgs.
- R2 public `r2.dev` access remains disabled.

Not yet verified: Google's authorized JavaScript origin, real Google sign-in,
first administrator bootstrap, authenticated workflows, or private evidence
upload/download. The first administrator grant still requires a designated,
verified identity and separate approval; see below. Page availability does not
prove Google OAuth authorization.

## Recommendation and known state

Use **one Cloudflare Worker with static assets**, deployed directly with Wrangler.
PocketTrail renders HTML in Rust/Wasm; uploading `static/` to Pages alone would
not run the application. The existing configuration already builds
`build/worker/shim.mjs`, binds `ASSETS` to `static/`, and runs the Worker first.
The fetch handler maps `/static/*` into the assets binding
([implementation](../src/web/mod.rs#L403)). Cloudflare deploys Worker code and
assets together [1]. No separate Pages project, Pages build directory, or Pages
Functions adapter is needed.

Prior operator verification supplied for this preparation (not re-run here):

| Item | Known state / required action |
| --- | --- |
| Cloudflare account | `AWS User Group Indonesia`, `26422c9ad224a7618c8670b6c7037bf6`, verified via `wrangler whoami`; pinned in `wrangler.toml`. Account ID is not a credential. |
| Worker | `pockettrail` deployed; custom domain HTTPS smoke checks pass. |
| D1 | Dedicated `pockettrail` created in APAC with approval; binding `DB` now uses `c0192e27-2795-4f65-94f9-56166b239aa0`. Production migrations `0001` through `0005` applied. |
| R2 | Dedicated `pockettrail-documents` created in APAC with approval. Empty; public `r2.dev` access verified disabled. Binding remains `DOCUMENTS`. |
| Other projects | Existing `jakarta-backend` database and other buckets are unrelated. Do not bind, migrate, seed, modify, or reuse them. |
| GitHub | `origin` is public `awsugid/PocketTrail`; CLI reports ADMIN. `defaultBranchRef` was empty, so no production branch is established by that result. No Actions secrets or variables were present. |

Direct deployment does not require GitHub Actions, Actions environments,
`CLOUDFLARE_API_TOKEN`, or repository secrets. Use the authorized operator's
Wrangler login. Do not copy a login token into this public repository.

### Cost and activation gate

Do not assume a Workers Paid plan or approve billing implicitly. R2 requires an
R2 subscription/activation checkout even though it includes free monthly usage
[6]. If the dashboard requests payment details or acceptance of metered billing,
stop for the account owner's explicit approval. Bucket absence alone does not
prove R2 is inactive.

R2 Standard currently includes 10 GB-month storage, 1 million Class A operations,
and 10 million Class B operations per month; overages are billed. The free tier
does not apply to Infrequent Access [7]. Review account-wide usage and current
Workers/D1/build limits before launch; included allowances are not a spending
cap or a guarantee of free operation. If activation is declined, private document
storage remains a deployment blocker; do not substitute another project's bucket.

## Read-only preflight — before asking to create or deploy

These checks inspect state; they do not authorize the next section. Keep output
private where it contains account metadata. Never print credential files or
secret values.

```sh
git --no-optional-locks status --short
git remote -v
git ls-files
npx wrangler --version
npx wrangler whoami
npx wrangler d1 list
npx wrangler r2 bucket list
gh repo view awsugid/PocketTrail --json nameWithOwner,visibility,viewerPermission,defaultBranchRef
gh secret list --repo awsugid/PocketTrail
gh variable list --repo awsugid/PocketTrail
```

- Confirm account ID exactly matches the pinned ID; stop on a mismatch.
- In the Cloudflare dashboard, inspect whether Worker `pockettrail` already
  exists. Do not overwrite an unknown existing Worker. Inspect current runtime
  variable/secret **names**, bindings, deployment exposure, and build connections
  without revealing values.
- Confirm dedicated D1/R2 names are available or demonstrably owned by
  PocketTrail. Treat a name collision as a blocker, not permission to reuse.
- Inspect R2 activation, plan, account usage, and billing requirements without
  completing checkout. Verify private access settings if the bucket exists.
- Review tracked files and `static/` contents. `.gitignore` is not an upload
  access-control mechanism: a PDF inside `static/` would be published.
  Exclude all real statements/invoices, extracted records, local databases/R2
  state, `.dev.vars`, `.env`, screenshots, and `local-data/` from publication.
  Do not use the repository root as the assets directory.
- Review `migrations/0001_init.sql` through `0005_notification_snapshots.sql`.
  Production gets migrations, **never** `tests/fixtures/seed.sql` or exported
  local state. Do not run `db:seed:local` against production.
- Select the final HTTPS origin before configuring Google. Confirm the existing
  Google client's **authorized JavaScript origins** includes that exact
  scheme/hostname/port. A discovered client ID is not proof of authorization.
  No new OAuth client or Google client secret is required by this code.
- Confirm the intended first platform administrator and separately approve
  the bootstrap grant described below.
- Keep notifications off; no mail integration, scheduled sender, or new
  notification credentials are part of this deployment.

Local preparation/validation (writes only local dependencies/build artifacts):

```sh
rustup target add wasm32-unknown-unknown
cargo install --locked worker-build
npm ci
npm test
npm run check:wasm
npm run build
```

Use Rust stable, Node.js 22 or later, npm, and `worker-build` on `PATH`, as in
the README. `npm run build` is exactly `wrangler deploy --dry-run`: it invokes
the configured Rust build but does not publish. It is not evidence that remote
bindings, quotas, Google login, or secrets are ready. No `cargo-generate` is
needed for this existing project; that tool in the Rust tutorial scaffolds a
new project [2].

**Stop here and request explicit confirmation** of: target account and Worker,
dedicated D1/R2 creation, any R2 billing activation, migration application,
runtime secret setup, public HTTPS deployment origin, and the named admin grant.
GitHub push/app installation/build linkage requires separate approval if chosen.

## Deployment runbook — reference for approved operations

Run from the repository root, using the checked-in top-level configuration.
There is no `[env.production]`; do not invent a `--env production` target.
Do not paste this entire section into a shell unattended.

1. If needed, the account owner activates R2 through its dashboard checkout [6].
   Stop if the terms/costs exceed the approval.
2. Create only the dedicated resources [4][8]:

   ```sh
   npx wrangler d1 create pockettrail
   npx wrangler r2 bucket create pockettrail-documents
   ```

   Review any automatic config edit. Replace only the placeholder D1 UUID with
   the newly created `pockettrail` database ID; preserve binding `DB`. Preserve
   R2 binding `DOCUMENTS`. Leave bucket `r2.dev` public access disabled and do
   not attach a public bucket domain [9]. Worker bindings need no S3 access key.
3. Apply reviewed migrations, not fixtures [5]:

   ```sh
   npx wrangler d1 migrations apply DB --remote
   npx wrangler d1 migrations list DB --remote
   ```

   Confirm the account/database target before accepting the migration prompt.
   On later upgrades review a backup/recovery plan first; a Worker code rollback
   does not undo schema/data changes. Successful earlier migrations can remain
   applied if a later migration fails [5].
4. Configure production runtime bindings securely [10]:

   | Name | Production requirement |
   | --- | --- |
   | `SECRET_SESSION_KEY` | Fresh cryptographically random signing key, at least 32 characters (code rejects shorter keys); use a password manager to generate/store it. Never reuse the local key. |
   | `GOOGLE_CLIENT_ID` | Existing approved public Google client ID, whose authorized origin was verified. It is rendered into the sign-in page, not a Google client secret. |
   | `LOCAL_DEV` | **Absent**, including dashboard/runtime settings. Do not upload `.dev.vars` or run the local configuration script as production setup. |

   Set the values through Wrangler's hidden interactive prompts, not command-line
   literals, log output, checked-in files, or bulk-uploading `.dev.vars`:

   ```sh
   npx wrangler secret put SECRET_SESSION_KEY
   npx wrangler secret put GOOGLE_CLIENT_ID
   npx wrangler secret list
   ```

   `secret put` is itself a remote mutation: it creates a version and deploys
   immediately; if the Worker does not exist Wrangler may prompt to create it.
   Treat those prompts as part of the approved publication scope, not preflight.
   Until code/bindings/secrets are all ready the Worker may not be usable.
   Runtime secrets and build-only secrets are different; builds do not need
   either application value. Rotating the signing key invalidates sessions.
5. Re-run local validation, review the actual config diff and public assets, then:

   ```sh
   npm run deploy
   ```

   This is `wrangler deploy`, not a dry run. Record the actual deployed HTTPS URL,
   version ID, database ID, migration status, and operator privately. Do not
   guess a `workers.dev` account subdomain or change DNS without approval.

## First administrator and acceptance

There is **no first-login administrator bootstrap**. Google sign-in inserts a
user with ID `g:<verified Google subject>` and `is_platform_admin=0`; subsequent
login updates name/email only
([auth route](../src/web/auth_routes.rs#L144)). No environment variable grants
administrator access.

After the designated person signs in using Google, an authorized D1 operator
must privately verify the exact stored `id`, `google_sub`, and email against that
person's identity. Do not grant by email alone, create a fixture identity, or
copy a seeded administrator. The separately approved bootstrap operation is:

```sql
-- Replace both placeholders privately with the verified existing row's values.
UPDATE users SET is_platform_admin = 1
WHERE id = '<verified existing g:subject ID>'
  AND google_sub = '<verified Google subject>'
  AND is_platform_admin = 0;
```

Execute in the dedicated PocketTrail D1 dashboard console only after reviewing
the target; verify exactly one row changed and read back its admin flag. If zero
or unexpected rows match, stop rather than broadening the predicate. Do not
commit identity-bearing SQL/output. This is a data mutation, not a migration.

The administrator can then create the real organization through `/orgs`; the
route creates its Admin role, creator membership, and Main Pocket, with
notifications **off**
([organization creation](../src/web/orgs.rs#L41)). Platform admin status does not
by itself grant membership/access to every organization's finances.

Before importing real records, manually verify on the deployed origin:

- HTTPS sign-in works with the existing Google client; fixture choices are absent
  and the development login endpoint is rejected.
- The intended admin can create an organization; an ordinary signed-in user
  cannot. Unauthenticated and other-organization users cannot read its records
  or `/org/:org/documents/:id`.
- CSS/JS/PDF.js under `/static/` load. No statement, invoice, credential, or local
  export is publicly retrievable as a static asset or public R2 object.
- A harmless synthetic evidence upload/download exercises the private bucket and
  organization authorization before any real upload. Keep financial pages and
  authenticated document responses out of shared cache rules.
- Notifications remain disabled; the local outbox is not proof of email delivery.
  Do not enable mail delivery or reminders in this task.

Do not run `scripts/local-smoke.py` against production: it is a loopback-only,
seeded-fixture workflow that mutates synthetic data. Production smoke checks
above remain acceptance work except the unauthenticated HTTP checks recorded at the top.

## Optional later: Cloudflare Workers Builds, not Actions

Direct Wrangler deployment is the simplest initial path. If automatic deployment
is later requested, Workers Builds can connect GitHub directly [3][11]. No
GitHub Actions environment or workflow is needed. Repository ADMIN does not
prove permission to install the Cloudflare GitHub App for the organization;
an organization owner or GitHub Apps Manager may need to authorize it [11].

Do not connect the public repository yet: its empty `defaultBranchRef` does not
establish a deployable branch. Publishing source and establishing a production
branch require separate approval. Then restrict the app installation to
`awsugid/PocketTrail`, choose the actual approved production branch, root
directory `/`, and Worker name `pockettrail`.

Cloudflare's documented build image lists Node/npm and Ubuntu build tools, but
does **not** promise Rust, rustup, the Wasm target, or `worker-build` [12]. An
`npm ci` alone cannot satisfy `worker-build --release`. A future build command
must explicitly install Rust stable via the official rustup installer [13],
load `$HOME/.cargo/env`, add `wasm32-unknown-unknown`, and install
`cargo install --locked worker-build` before deployment. Persist PATH explicitly
into the deploy command (for example, `. "$HOME/.cargo/env" && npm run deploy`);
do not assume shell exports survive between build/deploy phases.

Use `npm ci` for locked JS dependencies; select Node 22 or later with the
documented `NODE_VERSION` build setting. Wrangler's `[build]` then performs the
Rust compilation during deployment, so do not duplicate it with a separate
`npm run build`. Pin tested Rust and worker-build versions once a clean hosted
build is validated. No hosted build command has been validated here; do not
enable auto-deploy on this preparation alone.

Build settings use their own build/deploy commands; Workers Builds does not
honor Wrangler custom-build configuration as its *build settings* [3].
The deploy command still runs Wrangler and its configured project build.
Runtime `SECRET_SESSION_KEY` and `GOOGLE_CLIENT_ID` belong on the Worker, not in
build variables or GitHub. Cloudflare can generate a deployment API token for
its integration; review its scope before authorization [3]. Disable nonproduction
automatic builds until isolated resources/secrets and preview access have been
designed—never let branch previews mutate production D1/R2.

## Primary sources and evidence boundary

Sources consulted directly for this preparation:

1. [Workers static assets and Worker-first routing](https://developers.cloudflare.com/workers/static-assets/)
2. [Cloudflare Rust Workers and worker-build](https://developers.cloudflare.com/workers/languages/rust/)
3. [Workers Builds configuration, commands, tokens, and build/runtime variables](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/)
4. [D1 creation and binding configuration](https://developers.cloudflare.com/d1/get-started/)
5. [D1 Wrangler commands and migration behavior](https://developers.cloudflare.com/d1/wrangler-commands/)
6. [R2 activation/subscription requirement](https://developers.cloudflare.com/r2/get-started/)
7. [R2 pricing and Standard free allowance](https://developers.cloudflare.com/r2/pricing/)
8. [R2 bucket creation and private defaults](https://developers.cloudflare.com/r2/buckets/create-buckets/)
9. [R2 public access controls](https://developers.cloudflare.com/r2/buckets/public-buckets/)
10. [Worker secrets and immediate deployment behavior](https://developers.cloudflare.com/workers/configuration/secrets/)
11. [Workers Builds GitHub integration and organization permissions](https://developers.cloudflare.com/workers/ci-cd/builds/git-integration/github-integration/)
12. [Workers Builds supported image/tooling](https://developers.cloudflare.com/workers/ci-cd/builds/build-image/)
13. [Official Rust installation / rustup](https://www.rust-lang.org/tools/install)

Repository evidence: `README.md`, `package.json`, `wrangler.toml`,
`scripts/configure-local.py`, `src/web/mod.rs`, `src/web/auth_routes.rs`,
`src/web/orgs.rs`, and the D1 migrations. No application secrets were read or
printed for this preparation. No cloud provisioning, production migration,
Google console change, secret upload, hosted build, deployment, billing change,
GitHub app installation, Actions configuration, or push was performed.
