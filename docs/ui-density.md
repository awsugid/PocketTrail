# UI density polish: rendered evidence

This refinement preserves the shipped navy/orange, shadcn-inspired HTMX UI.
It reduces spacing and repeated scaffolding, not text size, financial content,
permission checks, safety explanations, or the visibility of editable sections.
There are no new dependencies or application features.

## Implementation

- Shared layout: smaller main insets, panel/section gaps, field gaps and table
  padding. Settings panels no longer add a bottom margin inside an already
  spaced section or stretch to match their introduction's height.
- Transactions: inline filter label; less card padding; date and time share a
  line on phones. Counterparty and status keep their content without redundant
  generated headings. Amount and balance labels remain. Desktop title/actions
  and description occupy distinct rows rather than competing across one line.
- Bank facts: semantic label/value groups, paired across desktop columns.
  Phones retain label/value alignment for short facts and give reference,
  bank note and status the full width. Opaque bank references are not truncated.
- Documents and stock changes: related fields share two columns at 640px and
  above, within the existing 640px form measure; phones remain linear.
- Evidence links have at least 44px touch height on phones. Existing input,
  button, menu and chip target heights and font sizes remain unchanged.

## Before/after measurements

Compiled native MiniJinja fixtures, Chromium, viewport height 700px. Same
synthetic content before and after. Numbers are CSS pixels, rounded; `y` is
the document offset from the top, including both safety banners and navigation.
These are observations, not optimization scores or limits on real content length.

| Measurement | 320px before → after | 390px before → after | 800px before → after | 1440px before → after |
|---|---:|---:|---:|---:|
| First transaction `y` | 606 → 567 | 585 → 546 | 486 → 418 | 440 → 409 |
| Transaction row/card height | 397 → 284 | 368 → 255 | 257 → 196 | 99 → 91 |
| Bank facts section height | 725 → 504 | 700 → 479 | 441 → 393 | 441 → 296 |
| Documents section height, editor | 580 → 555 | 559 → 535 | 511 → 374 | 511 → 374 |
| Stock form height | 443 → 411 | 443 → 411 | 418 → 224 | 418 → 224 |
| Inventory page height | 1647 → 1506 | 1628 → 1486 | 1394 → 1117 | 1370 → 1073 |
| Settings page height | 2236 → 2112 | 2112 → 1988 | 1866 → 1672 | 1687 → 1395 |
| Transaction editor page height | 4857 → 4436 | 4601 → 4180 | 3782 → 3371 | 3653 → 3130 |

The transaction fixture intentionally includes needs-details and suppression
notices, an opaque bank reference, allocation, retained evidence, an ineligible
approver and discussion. Read-only and missing-document variants are also
rendered. Real records with longer text or more evidence should grow naturally.

## Screenshots inspected

Live `127.0.0.1:8787` transactions, transaction detail, inventory and settings
were inspected at 390px and 1440px with a local fixture identity. Fixture login
only creates a signed session cookie; application reads were then GET-only.
No database changes, emails, deployment or publication were performed.

After edits, the isolated checkout's compiled fixtures and assets—not the
shared running server—were rendered at 320/390/800/1440px. Full pages,
viewport captures and readable bank/document crops were inspected through
OpenAI image rendering. Representative comparisons below have **before on the
left and after on the right**, at identical source scale:

![390px transaction viewport comparison](ui-density/transactions-phone.png)

![320px bank facts comparison](ui-density/bank-facts-phone.png)

![1440px transaction viewport comparison](ui-density/transactions-desktop.png)

## Reproduce and regression checks

With the existing development dependencies installed:

```sh
mkdir -p test-results/ui-density
POCKETTRAIL_SCREENSHOTS=test-results/ui-density node scripts/ui-polish-smoke.cjs
cargo test --workspace
node static/extraction.test.js
node scripts/components-smoke.cjs
rustfmt --check --edition 2021 examples/ui-polish-fixtures.rs
```

The density smoke test compiles this checkout's fixture templates, intercepts
all browser traffic, and does not use a database. It writes `measurements.json`
and full-page/viewport screenshots when `POCKETTRAIL_SCREENSHOTS` is supplied.
`components-smoke.cjs` additionally uses the existing local server for read-only
widget/fallback checks. On the implementation machine Playwright was resolved
through the already installed `/tmp/pt-tools/node_modules` using `NODE_PATH`;
no package or lockfile changes were made.

Checks passed:

- Density budgets for fixed-content transaction cards, bank facts, settings
  section offsets and stock forms at all four widths.
- All nine bank facts and the complete reference preserved; evidence precedes
  review; missing-document and suppression safety messages remain.
- Read-only fixtures have no mutation forms; editable forms preserve revision
  and CSRF fields; new roles do not automatically check any permission.
- No page-level horizontal overflow; overflowing tables retain visible cues,
  keyboard scrolling and accessible descriptions, including after HTMX/resizing.
- Body type stays at least 14px; controls stay at least 13px desktop / 16px
  phone; tested phone buttons, enhanced inputs, chips and evidence links remain
  at least 44px high; keyboard focus retains its visible outline.
- Rust workspace tests (52), extraction tests and components browser smoke.
- Fixture Rust formatting check.

`cargo fmt --all -- --check` also identified existing formatting in
`src/web/txns.rs`; that unrelated file was not changed.

The Impeccable detector was run once. Its warning labels the existing HTMX
top-of-viewport loading indicator as a side accent; it is functional feedback,
not a decorative card border, and was preserved. Palette/type/radius advisories
reflect the existing implementation and stale design documentation, not newly
introduced typography or branding changes. No detector score was pursued.

Not run: database-mutating integration scripts, deployments, outbound email,
cross-browser or assistive-technology certification. Actual post-merge app
behavior still depends on building/running the updated templates and assets.
