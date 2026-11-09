# PocketTrail templates — context and route contract

Templates are embedded by the Rust renderer (minijinja, autoescape ON). All
user-authored content is autoescaped; `|safe` is never used on bank data or
comments (it is not used at all in these templates).

## Conventions

- Every `<form>` posts `csrf_token` as a hidden field: `<input type="hidden"
  name="csrf_token" value="{{ csrf_token }}">`.
- Amounts are integers in **minor units** (100 minor = 1 IDR) and are rendered
  with the server-side `money` filter: `{{ x | money }}` → `Rp 15.000.000`.
- Templates guard optional context with `{% if %}` before access, so partial
  contexts degrade gracefully instead of erroring.
- `hx-boost` is enabled on `<body>`. The server only needs to return full HTML
  pages and redirects; there are no partial-swap endpoints.
- Signed-out visitors get a bare centered shell; pages must never assume a
  non-empty list (empty states are rendered).

## Global context (base.html)

| Key | Type | Required | Notes |
|---|---|---|---|
| `user` | `{name, email}` | no | Absent on login page; hides chrome |
| `org` | `{slug, name, notifications_enabled?}` | no | `notifications_enabled == false` shows sidebar note |
| `csrf_token` | string | yes | Hidden field on every form |
| `flash` | string | no | Success notice (`role="status"`) |
| `error` | string | no | Error notice (`role="alert"`) |
| `is_synthetic` | bool | no | "Synthetic demo data" banner |
| `local_mode` | bool | no | "Local testing / outbox" banner |
| `organizations` | `[{slug, name}]` | no | Topbar switcher |
| `active_nav` | string | no | `transactions\|imports\|inventory\|settings` |

Blocks: base.html defines `title` and `content`; `content` holds each page's h1.

## Templates and routes

### login.html — GET /login

Context: `dev_login_enabled` (bool), `google_configured` (bool),
`google_client_id` (string, public audience, when configured), `users`
`[{id, name, email}]` (fixture identities, dev only).

Forms:
- Google GIS button posts `credential` (ID token) to **POST /login/google**.
- Dev switch posts `user_id` to **POST /login/dev** (only rendered when
  `dev_login_enabled`).

### orgs.html — GET /orgs

Context: `orgs [{slug, name}]`, `can_create` (bool).

- Organization links go to `/org/{slug}/transactions`.
- Create posts `name`, `slug` to **POST /orgs** (platform admin only).

### transactions.html — GET /org/{org}/transactions

Query: `status` ∈ `all|pending|approved|changes_requested`.
Context: `txns [{id, date, time, counterparty, transaction_type, amount_minor,
balance_minor, status, responsible_name, needs_details, suppressed}]`,
`filters {status}`.

### transaction_new.html — GET /org/{org}/transactions/new

Context: `pockets [{id, name}]`, `members [{id, name}]`.
POST **/org/{org}/transactions/new**: `pocket_id`, `date`, `time`,
`counterparty`, `transaction_type`, `notes`, `amount_minor`, `balance_minor`,
`explanation`, `responsible_member_id`.

### transaction.html — GET /org/{org}/transactions/{id}

Context: `txn {id, date, time, counterparty, transaction_type, amount_minor,
balance_minor?, pocket_name?, bank_id?, notes?, status, explanation,
responsible_member_id?, responsible_name, suppressed, suppressed_reason?,
needs_details}`,
`splits [{label, amount_minor, responsible_member_id?, responsible_name}]`,
`totals {split_total_minor, amount_minor, balanced}` (optional),
`evidence [{filename, url?, size?, size_display?, note}]` (when `url` is
present the filename links to an authenticated download route),
`comments [{author_name, body, created_at}]`,
`members [{id, name}]`,
`approval {eligible, ineligible_reason}` (optional),
`review_decision {status, author_name, created_at, note}` (optional, latest
review decision from retained audit history),
`can {edit, approve, request_changes?, comment, suppress, upload}`.

Bank facts, explanation, purposes, documents, review context, and chronological
discussion are visible read-only, regardless of edit permission. Only action
forms and history carry `data-dialog-panel`; native sections and anchor links
remain usable without JavaScript. The shared dialog enhancement retains dirty
form guards and native validation.

POST endpoints (org prefix + `/transactions/{id}/…`):

| Path | Fields | Notes |
|---|---|---|
| `/details` | `explanation`, `responsible_member_id`, `split_label[]`, `split_amount[]` (minor, parallel), `split_member[]`, `evidence_unavailable_reason` | Editing returns an approved txn to review. `evidence_unavailable_reason` is expected when spending has no documents; the server validates |
| `/approve` | `note` (optional) | Only when `can.approve` and `approval.eligible` |
| `/request-changes` | `note` (required) | Rendered for approvers; gated on `can.request_changes` falling back to `can.approve` |
| `/comments` | `body` | Mentions parsed from `@` text; do not override suppression |
| `/documents` | multipart `file`, `note` | Evidence retained; superseded never deleted |
| `/suppress` | `reason` (required) | Stops all notifications incl. mentions |
| `/unsuppress` | — | Lifts suppression |

### import.html — GET /org/{org}/imports

Context: `pockets [{id, name}]`, `batches [{id, created_at, by_name, counts
{imported, duplicate_unchanged, conflict, needs_review}}]`.

POST **/org/{org}/imports** (multipart): `pocket_id`, `statement_text`
(required; browser-extracted by pdf.js or pasted), `file` (original PDF,
retained). Server parses, matches by Jago transaction ID (skip unchanged,
flag conflicts), then redirects to the batch page.

### import_batch.html — GET /org/{org}/imports/{id}

Context: `batch {id, created_at, by_name, counts{...}}`, `items [{bank_id,
status, counterparty, counterparty_display?, amount_minor, message?, transaction_id?}]` with `status`
∈ `imported|duplicate_unchanged|conflict|needs_review`.

### inventory.html — GET /org/{org}/inventory

Context: `items [{id, name, variant?, levels [{location_name, qty}],
total_qty}]`, `locations [{id, name}]`.

POST endpoints:
- **/org/{org}/inventory/stock**: `item_id`, `location_id`, `delta` (signed), `reason`.
- **/org/{org}/inventory/items**: `name`, `variant`.
- **/org/{org}/inventory/locations**: `name`.

### inventory_item.html — GET /org/{org}/inventory/items/{id}

Context: `item {name, variant?}`, `movements [{created_at, member_name,
location_name, delta, result_qty, reason?}]`.

### settings.html — GET /org/{org}/settings

Context: `mappings [{id, pattern, member_id, member_name}]`, `members [{id,
name, email, role_id}]`, `roles [{id, name, permissions[]}]`, `permissions
[{id, label}]`, `notifications {enabled, cutoff_date?}`, `outbox [{kind,
to_name, subject, created_at}]`, `can {manage}`, `candidates [{id, name,
email}]` (optional — add-member select; text input fallback when absent).

POST endpoints (all under `/org/{org}/…`, forms rendered only when
`can.manage`):

| Path | Fields |
|---|---|
| `/settings/roles` | `name`, `perm` (repeated) |
| `/settings/roles/{id}` | `name`, `perm` (repeated) |
| `/settings/members` | `user_id`, `role_id` |
| `/settings/members/{id}/role` | `role_id` |
| `/settings/members/{id}/remove` | — |
| `/settings/mappings` | `pattern`, `member_id` |
| `/settings/mappings/{id}/delete` | — |
| `/settings/notifications` | `enabled` (checkbox; absent = off), `cutoff_date` |
| `/notifications/digest` | — |

### Auth / logout

- **POST /logout** — sign out (topbar account menu).
- **POST /login/google** — GIS `credential` callback.
- **POST /login/dev** — `user_id` fixture identity (dev only).

### Static assets

- `/static/app.css`, `/static/app.js`, `/static/extraction.js` — the UI.
- `/static/vendor/htmx.min.js` (htmx 1.9.12), `/static/vendor/pdf.min.mjs` +
  `pdf.worker.min.mjs` (pdfjs-dist **4.10.38** ESM, Apache-2.0, patched for
  CVE-2024-4367; always loaded with `isEvalSupported: false`) — pinned local
  assets. Extraction reconstructs rows from text-item coordinates
  (`static/extraction.js`, tested by `static/extraction.test.js`): items are
  grouped by transform-y (2-unit tolerance), sorted by x, and column gaps are
  padded with ≥ 2 spaces, so parsers can split columns on whitespace. Run in
  the browser only; statements are not uploaded to third parties — the
  extracted text and the retained original PDF go to PocketTrail itself.
