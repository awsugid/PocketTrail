# Administration rollout — migrations applied, CI/CD rollout pending

Implementation integrated and locally validated. With explicit operator approval,
production migrations `0006`–`0009` applied successfully; remote migration listing
reports none pending. Worker rollout and real SMTP/Google acceptance remain
unverified; email stays disabled.

`npm run deploy` now applies pending remote D1 migrations before deploying;
`&&` stops deployment on migration failure. Cloudflare Builds must use
`npm run deploy` (not bare `npx wrangler deploy`) and its token needs D1 write
access. Dashboard command/token configuration has not been verified here.
Migrations remain additive; Worker rollback does not undo schema changes.

Implemented:
- Google profile picture from verified ID token, HTTPS Google image-host allowlist,
  account/sidebar display and fallback. Existing users need a fresh Google login.
- Pending invitations created before a user exists, seven-day expiry, revoke and
  replacement by email. Signed-in matching Google account explicitly accepts from
  Organizations. Acceptance and membership update run in a D1 batch; replay cannot
  restore a subsequently removed membership. Expired, revoked, already-accepted,
  wrong-recipient, and replayed acceptance attempts return an explicit 4xx, not a
  silent redirect.
- SMTP/STARTTLS invitation mail over Workers platform sockets
  (`src/web/invitation_mail.rs`): plaintext only up to STARTTLS, upgrade via
  platform TLS (`Socket::start_tls`), no plaintext fallback (missing STARTTLS
  advertisement aborts the send); implicit TLS on port 465; every read/write
  races a 30 s session deadline; AUTH PLAIN/LOGIN only as advertised by EHLO;
  RFC 5322/2047 composition with dot-stuffing and header-injection guards
  (`src/smtp.rs`); configuration validated from SMTP_HOST/PORT/USERNAME/PASSWORD/
  FROM and gated on EMAIL_DELIVERY_ENABLED. The password never enters error
  strings, redirects, or the database.
- Single-use emailed acceptance links: 32-byte base64url token in the link,
  only the SHA-256 hash stored (`invitations.token_hash`, migration 0009
  `invitation_mail`). Resend supersedes older links, so exactly one live token
  exists per invitation; only `sent` rows on a still-open invitation can
  redeem. Durable delivery rows keep status/error/attempts; create/resend
  record the outcome and the settings page query exposes it
  (`mail_status`, `mail_error`, `mail_attempts`). Link acceptance page and
  POST reuse the same atomic grant/accept SQL as in-app acceptance, with a
  conditional committed audit row written only when the transition actually
  happened (`audit_rules::success_owned` marks invitation routes handler-owned,
  so the HTTP layer cannot claim a commit it did not observe).
- Platform-only `/platform` for user admin grants and reusable organization role
  templates. Copying a template creates a separate organization role; template edits
  do not change existing roles. No cross-organization financial access is granted.
- Append-only audit storage, POST attempts/outcomes, document download requests,
  organization-scoped audit view for member managers, separate platform event view.
  Platform-admin access changes record target user atomically with the change.

Not complete:
- End-to-end emailed-link acceptance with a real verified Google account and
  Worker SMTP transport remain unverified. Registered routes, SQL checks, and
  fixture browser workflows do not establish those external integrations.
- Live SMTP delivery has never been exercised (EMAIL_DELIVERY_ENABLED=false;
  no real emails sent, no real server contacted). Session grammar is tested
  against unit fixtures only, not against mail.awscommunity.id. AUTH uses only
  mechanisms the server advertises; servers offering neither PLAIN nor LOGIN
  fail with a recorded error. Port 25 is not supported; 465 (implicit TLS) and
  587 (STARTTLS) are.
- Domain-level audit details (changed fields, old/new values, correlated event
  IDs), verified Google actor on first login, pagination of the invitation
  delivery log (latest delivery only is shown), and transactional coupling for
  every mutation. Request HTTP status alone is not proof of a data change.
- Organization list and richer global user lifecycle administration.
- Production migrations and CI/CD rollout. Do not push schema-dependent code
  into the connected auto-deploy branch before the migration plan is approved.
- Platform administration and commit-time admin authorization guards are
  integrated. Current-actor checks protect admin changes/template saves inside
  their batches; in-batch probes distinguish revoked authorization from no-op
  success. Source-SQL regressions, integrated native/WASM checks, dry-run build,
  admin HTTP, workflow HTTP, and import HTTP passed. Final GPT source review
  found no concrete blockers; corrected platform/general browser smokes passed
  against the integrated local server.
  Audit privacy fixes passed integrated `npm test` and WASM checks: mapping
  targets omit bank actor labels; request targets redact organization slugs/opaque
  invitation IDs and reject unrecognized route shapes before append-only storage.

Schema migrations `0006`–`0009` must precede this Worker version. Existing code
creates invitations with `token_hash`, so running the Worker against a database
without 0009 fails closed (insert error). Do not push to auto-deploy until
remaining integration and migration rollout are reviewed.

Checks run:
```sh
cargo test --workspace
cargo check --target wasm32-unknown-unknown --lib
python3 scripts/admin-self-check.py
npm test
```

SQLite check exercises actual acceptance SQL extracted from handler source:
organization role isolation, wrong recipient, expiry, revocation, successful
acceptance, replay after removal, emailed-token lifecycle (hash-only storage,
superseded links, sent-only redemption, status CHECK), conditional committed
audit rows, append-only audit. Native unit tests cover SMTP reply parsing,
EHLO capability/AUTH selection, RFC 5322 date, RFC 2047 subject encoding,
dot-stuffing, header-injection rejection, config validation, and token
hash/encoding. These checks do not establish live Google claims, platform socket/timer behavior,
or SMTP delivery against a real server.

Integrated validation before final administration integration:
- `npm test`, WASM check, both domain/parser Clippy commands with `-D warnings`,
  JavaScript syntax checks, and `CI=1 WRANGLER_SEND_METRICS=false npm run build`
  passed. Build was dry-run only; existing `inventory.rs` unused-field warning remains.
- `settings-smoke.cjs`, `dialog-smoke.cjs`, `ui-polish-smoke.cjs`, and
  `components-smoke.cjs` passed with cached Chromium 1254. These use synthetic
  compiled templates and do not establish production Google or SMTP behavior.
- `local-smoke.test.py`, `local-smoke.py`, and `local-import-smoke.py` passed
  after deterministic Wrangler-configured database selection replaced the stale
  first-match SQLite scan. Live loopback HTTP verified permissions/CSRF,
  independent approval, comment stability, evidence privacy/invalidation,
  notification suppression, stock bounds, immediate offboarding, import dedup,
  history preservation, confirmation idempotence, and bank-conflict protection.
  Only synthetic local fixtures changed.
- `admin-http-smoke.py` passed after a fresh dry-run build and local hot reload.
  Its preflight requires explicit delivery-disabled status from loopback-only
  fixture `/healthz` before any mutations, and checks forged Host hides status.
  Verified platform/org isolation, invitation create/resend/revoke, disabled
  delivery, denied mutations, zero-row audit suppression, and fixture-account
  acceptance rejection. Verified-Google acceptance remains SQL-tested only;
  sole verified-admin SQL regressions now pass. After the later platform merge,
  this HTTP smoke's obsolete fixture-demotion assumption was corrected; the
  integrated script now passes and restores Alice's platform flag in `finally`.
  A local reseed attempt failed `UNIQUE constraint failed: users.email`; no
  destructive reset was attempted. Admin HTTP, workflow HTTP, and import HTTP
  passed again after commit-time authorization guards were integrated.
- Final `platform-smoke.cjs` and `ui-smoke.cjs` passed (exit 0) after correcting
  fixture-label parsing and the empty-string `open` attribute check. Verified
  platform org-list isolation, admin mutation audit, bounded race outcomes,
  avatar fallback, role-template copy isolation, fixture-flag restoration,
  stacked organization form, evidence-before-review, and 1440/390/320px bounds.
  Platform smoke leaves unique synthetic template/copied-role rows locally.
- Independent GPT and Sonnet re-reviews found no remaining concrete blockers in
  the hardened invitation/SMTP lifecycle. Independent audit review found the
  privacy issues listed above. Full feature completion remains unclaimed.
