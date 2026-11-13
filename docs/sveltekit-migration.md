# SvelteKit rewrite plan

## Decision and scope

Rewrite PocketTrail as one full-stack SvelteKit application in TypeScript. Keep
server-side authorization and business rules inside that application; do not
introduce a permanent Rust API or separately deployed frontend/backend pair.
No Vercel service or Next.js dependency is required.

This document authorizes planning, not production deployment, notification
sending, data deletion, or a claim that migration is complete. The current Rust
application remains the behavioral reference until replacement is verified.
Final migration state contains no Rust source, Cargo manifests/lockfile, Rust
build tooling, or HTMX/template runtime. Preserve business behavior, not old UI.

## Target architecture

- SvelteKit server rendering, server loads and form actions; progressive form
  enhancement for pending states, validation and navigation continuity.
- Cloudflare Workers through `@sveltejs/adapter-cloudflare`, retaining D1 and
  private R2 bindings. Validate adapter/runtime compatibility in phase 1 before
  committing to implementation-specific APIs. Use a pinned stable release.
- Server-only modules for sessions, permissions, persistence, parser, financial
  rules and notification eligibility. Browser modules never receive secrets.
- Keep existing SQL schema and migration history initially. Avoid simultaneous
  framework and database redesign. Use prepared SQL and existing constraints;
  no ORM required solely for this migration.
- Use shadcn-svelte/Bits UI selectively for accessible interactive controls,
  subject to a small compatibility spike. Prefer native controls when sufficient.
  Share a small set of page patterns rather than recreating every control.
- Keep PDF extraction browser-local. Port the Rust text parser to TypeScript;
  reuse coordinate-aware extraction behavior and private-sample checks.
- One app deployment. No client-side copy of permission authority; UI visibility
  is not authorization. Do not add separate services for deferred integrations.

Official adapter reference: https://svelte.dev/docs/kit/adapter-cloudflare.
Confirm version-specific configuration from installed release documentation.

## UX outcome: redesign workflows, not template syntax

All current screens are in scope. Existing templates are a capability inventory,
not a visual specification. No statistical dashboard or decorative metric cards.

| Journey | Replacement direction | Required behavior |
| --- | --- | --- |
| Sign in and choose organization | Short, explicit entry flow; visible organization context | Google sign-in grants no membership; local identities remain loopback-only |
| Find work and browse ledger | Clear next actions and compact ledger filters, not a wall of panels | Preserve authorized record visibility and complete financial facts |
| Import statements | Guided choose pocket, extract, review, confirm, result flow | Unchanged duplicates skipped; conflicts and missing IDs reviewed; active owner required |
| Explain spending | Readable transaction context with one prominent next action; focused editing | Responsibility, split purposes, documents or unavailable reason, revision conflicts |
| Explain income | Notes-first flow distinct from expense approval | Member-authored notes required; documents optional; no approval |
| Review spending | Bank facts, explanations and evidence together; explicit approve/request changes | Independent reviewer; substantive edits invalidate approval, comments do not |
| Discuss and attach evidence | Chronological discussion and retained authenticated evidence | Mention/suppression rules and access checks preserved |
| Manage stock | Item/location quantities first; focused adjustments and history | Positive quantities, nonnegative resulting stock, attributed changes |
| Configure workspace | Separate focused settings routes for pockets, routing, people, roles and notifications | Preserve permission boundaries; avoid one giant form page |
| Administer platform | Distinct restricted management surface | Platform admin does not imply access to organization finances |

Before building each journey, state user goal, primary action, required facts,
error recovery and completion signal. Validate with User Group leaders before
replicating its layout across other journeys. Do not require leaders to choose
CSS values or individually design controls.

Wide-screen layouts must use width deliberately: bounded forms and reading
columns, full-width financial tables where useful, optional contextual detail
only where it supports the task. Space and typography group content; borders
around every section are not the default. Mobile must retain usable financial
facts, visible organization context and keyboard/touch access. Motion explains
state changes; reduced-motion users receive equivalent visible feedback.

## Non-negotiable parity

- Organization isolation and current membership checks on every protected read,
  mutation and document download. Offboarding revokes access immediately while
  preserving attribution. Platform administration is not financial access.
- Preserve session security, Google token verification, CSRF/origin protections,
  input validation, escaped user content and private cache behavior. Framework
  defaults do not replace a route-by-route security check.
- Amounts remain integer minor units, explicit currency, 100 minor units per
  IDR. Reject unsafe integer ranges at TypeScript/D1 boundaries; choose an exact
  representation before porting arithmetic. Never silently use floating money.
- Full opaque Jago references identify transactions within a pocket. Cumulative
  imports never overwrite explanations, assignments, evidence or approvals.
- Pocket-scoped normalized label mappings, active owner fallback and current
  income-role routing remain distinct. Owner changes do not backfill expenses.
- Preserve historical responsible-member exclusion from approval, revision
  checks and all-or-nothing mutations. Retain audit and superseded evidence.
- Notifications remain disabled by default and local delivery stays an outbox.
  Transaction suppression includes mentions and summaries, requires a reason,
  and never implies completion or approval. Enabling notifications must not
  release an old queued flood. No email or scheduler launch in this rewrite.
- Keep English-only UI, private statement handling and zero-charge constraint.
  Deferred payment/refund, attendance and email integrations remain deferred.

## Delivery sequence and exit gates

### 0. Freeze behavioral contract

Inventory actual routes and authorization checks, domain/parser tests, SQL
constraints and scripts. Reconcile implementation against PRODUCT.md; record
known gaps rather than copying accidental behavior. Map each capability to a
replacement route and runnable acceptance check. Use synthetic fixtures only in
committed tests; private samples stay ignored.

Exit: reviewed parity checklist with no unowned route, permission or data flow.

Inventory findings from independent workflow review:

- The required in-app action list is absent. Add a task queue grouping authorized
  explanation requests, eligible reviews, income notes and pending imports. Make
  it the default for task-bearing members; read-only members retain the ledger.
  Empty actions must not imply an empty ledger or suggest importing to a user
  without import permission.
- Route documentation is incomplete: inventory the router itself, including
  invitations, platform administration, import confirmation, review submission,
  member restoration and role templates. Do not treat templates/README.md as
  the complete contract.
- Manual transaction entry is exposed despite statement-first product guidance.
  Resolve whether to retain it before implementing that route; do not silently
  expand scope or silently remove existing data capabilities.
- Replace equal-weight detail cards with a dominant task column and a narrower
  reference rail when useful. Primary explanation/review tasks belong inline;
  secondary actions may use accessible dialogs. Settings become focused routes.
- Parent layout loads alone are not a security gate: SvelteKit loads can run
  concurrently or be reused during navigation. Every protected server load,
  action and endpoint must invoke shared authorization against current state.
- Rust-source SQL inspection tests need behavioral replacements that still
  exercise real D1 statements, constraints and audit records.

### 1. Prove one full-stack vertical slice

Create SvelteKit setup in an isolated migration location while Rust remains
runnable. Establish distinct build outputs/configuration so `src/`, static
assets and local database state cannot collide. Prove local D1/R2 access, signed
session, organization-scoped ledger read, one validated write, authorized file
retrieval and dry-run Worker build. Do not access remote bindings during tests.

Build a representative transaction workflow using proposed components and layout
patterns. Inspect 320px, tablet, 1440px and 1920px viewports, keyboard operation,
empty/loading/error states and reduced motion. Leader feedback evaluates task
clarity, not merely screenshots.

Exit: runtime compatibility, one-app deployment shape, security boundary and UX
approach demonstrated before broad porting.

### 2. Port shared rules and persistence

Port pure domain and parser behavior into server-only TypeScript modules. Turn
existing Rust unit cases into shared synthetic input/expected-output cases where
practical and run both implementations against them. Validate exact money,
dates, references, permissions, approval invalidation, routing, stock and import
idempotence. Preserve schema and R2 object identifiers.

Exit: parity tests pass; private parser validation reports aggregate mismatches
only. No real statement content enters source control or external AI services.

Backend review adds these explicit phase-2 acceptance gates:

- Preserve D1 batch atomicity, revision/mutation-token winner probes and
  token-gated success audits. Trigger-inflated affected-row counts cannot prove
  a transaction mutation won. Test concurrent losers write no child/audit rows.
- Keep append-only audit, notification cancellation/snapshot, invitation and
  active pocket-owner/mapping triggers. Inventory-level scope comes through
  item/location joins, not an org_id column on the level itself.
- Persisted pending status derives draft versus submitted from documentation
  completeness. Keep domain decisions, ledger filters and outbox eligibility in
  agreement; exercise all three against the same cases.
- Quarantine every occurrence of a repeated bank ID within one statement. Keep
  import confirmation idempotent and stage/confirm winner checks atomic. Retain
  payload pointers, original PDFs, existing R2 keys and bounded import chunking.
- Exercise income-recipient exceptions separately: scoped notes/documents access
  must not become general ledger access, expense editing or approval authority.
- Preserve notification cancellation and read-time eligibility checks, not only
  enqueue-time gates. Date cutoff applies to assignment/digest, not mentions;
  organization disablement and transaction suppression still block mentions.
- Choose session-cookie compatibility or explicit forced re-login. Preserve
  verified Google claims, login nonce, session-bound CSRF and invitation token
  hashing/redaction. Invitation email is distinct from financial notifications:
  keep delivery disabled locally and document any deferred transport replacement.
- Carry over Jakarta date/time semantics, exact decimal parsing and existing
  safe monetary limits; check intermediate sums as well as individual values.
- Existing validation records a 10-PDF/552-row comparison. Reproduce its aggregate
  result if those authorized private fixtures remain available; otherwise mark
  that gate unverified, never replace it with synthetic evidence.

### 3. Deliver complete journeys

Order: authentication/organization context; pockets and assignment setup; import
review/confirmation; ledger and expense/income details; evidence/discussion and
review; inventory; remaining organization/platform administration and outbox.

Parallel work may cover independent journeys after shared data, permission and
component contracts exist. One owner integrates each slice end to end; agents
must not independently invent overlapping session or permission systems.

Exit per slice: server validation, permission matrix, failure recovery, browser
workflow and responsive/accessibility checks pass. No working-looking dead ends.

### 4. Rehearse cutover locally

Run old and new implementations against separate copies of synthetic data, not
concurrent writers to one database. Compare persisted facts, decisions and audit
results. Test restore from local database/R2 backup and interrupted operations.
Adapt existing HTTP/browser checks to stable user behavior; replace Rust-source
inspection checks with behavioral checks, not weakened assertions.

Exit: all supported journeys pass; retained data readable; rollback rehearsal
passes; remaining live Google/email/private-sample gaps explicitly listed.
Production deployment still requires separate authorization.

### 5. Switch default and remove Rust

Make SvelteKit the root app and default development/build/test commands only
after phase 4. Remove Rust source and crates, Cargo files, build.rs,
worker-build/Wasm build steps, obsolete templates, HTMX and superseded custom
control code. Preserve SQL migrations, fixtures, private-data ignores, applicable
scripts and PDF assets until replacements cover their use. Update README,
PRODUCT.md stack section, DESIGN.md and deployment/validation documentation to
actual shipped behavior. Remove legacy claims, not historical migration evidence.

Exit: clean checkout installs, checks, tests and builds without Rust or Cargo;
repository search finds no active Rust runtime/build dependency. No permanent
compatibility API. Git history retains rollback reference; do not keep obsolete
Rust implementation in the final tree.

## Verification and rollout boundary

Record actual commands and results in docs/validation.md during implementation.
Target checks: Svelte/TypeScript checking, pure-rule/parser tests, local D1/R2
integration tests, existing adapted HTTP smoke workflows, Playwright journeys,
and Cloudflare dry-run build. Build must never deploy or apply remote migrations.
Validate a fresh install and existing-data upgrade independently.

Required negative cases include cross-organization IDs, removed membership,
self/historical-self approval, stale revisions, duplicate/conflicting imports,
unsafe monetary inputs, unauthorized evidence, suppression bypass attempts,
invalid stock and stored HTML/script payloads. Check database/object consistency
when upload or transaction processing fails; do not silently lose evidence.

No production cutover, force push, destructive database reset or real message
delivery is part of this plan. Existing local-validation release boundary holds.

## Pending decisions before implementation

- Confirm component spike and visual direction with one representative journey.
- Resolve manual-entry scope against statement-first guidance; inventory all
  actual router endpoints rather than relying on incomplete template docs.
- Choose supported SvelteKit/adapter versions and verify local binding state paths.
- Resolve pre-existing product gaps from inventory rather than adding features:
  bootstrap policy, notification transport and unresolved import-correction rules.
- If existing data cannot fit safe integer arithmetic, settle exact storage and
  serialization representation before financial-rule porting.

## Final status (executed)

Phases 0–5 of this plan are complete in this repository; this section is the
record, and the plan text above is retained as the decision history.

- **One app, no split.** The SvelteKit application is the root project. There is
  no Rust source, `Cargo.toml`/`Cargo.lock`, `build.rs`, Wasm target,
  `worker-build` step, HTMX runtime, Minijinja templates, or separate frontend
  build. `npm ci && npm run build` builds the Worker.
- **Schema untouched.** `migrations/0001…0010` and `tests/fixtures/seed.sql` are
  the same files the previous implementation used; no framework-coupled database
  redesign happened.
- **Server-only authority.** `$lib/server/*` holds sessions, permission
  evaluation, D1/R2 access, the parser, financial rules, audit and notification
  eligibility. Every protected load, action and endpoint re-authorizes against
  rows read for that request; no layout load acts as a gate.
- **Journeys.** Authentication and organization context, per-pocket ledger and
  filters, imports (stage → preview → confirm), expense/income detail, review,
  discussion, evidence, inventory, settings (pockets, mappings, people, roles,
  notifications, audit), platform administration, invitations, and the local
  notification outbox are all present as SvelteKit routes.
- **Parity mechanisms.** Revision CAS with token-gated audit rows, import
  status-token CAS, append-only audit triggers, quarantine of repeated bank IDs,
  `duplicate_unchanged`/`conflict` classification, historical responsible-member
  approval denial, income-only routing, suppression cancelling outbox rows, and
  exact integer money are all exercised by the suites in
  [validation.md](validation.md).
- **Verification replaced, not weakened.** Rust-source inspection tests became
  SQL tests over the real migrations plus HTTP/browser journeys against a built
  Worker; see validation.md for the exact counts and the remaining unverified
  items (live Google sign-in, private-sample comparison, real email delivery,
  production deployment).

The Rust implementation remains available in Git history for rollback reference;
it is not kept in the working tree.
