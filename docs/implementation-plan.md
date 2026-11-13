# Local implementation plan

> **Status:** superseded. This plan describes the first (Rust) implementation.
> The running application is now the SvelteKit rewrite recorded in
> [sveltekit-migration.md](sveltekit-migration.md); treat the Rust-specific
> delivery items below as history.


## Scope and release boundary

The first build is a local validation release, not an authorization to deploy,
publish financial records, or send messages to organizers. PRODUCT.md records the
agreed product scope. Incomplete release capabilities must be documented rather
than represented by working-looking controls.

## Parallel implementation

- Rust parser crate: layout-aware Jago text parsing, full string references,
  amount/date validation, synthetic regression cases, private sample validation.
- Rust domain crate: organization authorization, approval and documentation
  invariants, notification eligibility, and stock validation.
- Workers application: local D1 and R2, sessions and CSRF, server-rendered routes,
  imports, documentation and discussions, approval, inventory, local outbox.
- Interface: English-only, Cloudscape-informed operating screens, responsive
  tables and forms, explicit local and notification states.
- Existing integration research: reuse Jakarta Google authentication and brand
  evidence without moving credentials into source control.
- Integration and review: exact build/test commands, local workflow automation,
  privacy checks, independent security/correctness review, bounded visual review.

## Validation gates

1. Pure Rust unit tests for parser and workflow rules.
2. Actual community PDF extraction and cumulative-import checks with aggregate
   output only. No real names, references, balances, or notes in test fixtures.
3. Wasm build for Cloudflare Workers and local D1 schema initialization.
4. Local HTTP workflow: membership isolation, import review/deduplication,
   mappings, split explanations, approval, re-review, comments, notification
   suppression, and stock.
5. Desktop and mobile inspection of the integrated application.
6. Independent review and an explicit list of verified and unverified features.

## Technical constraints

Use integer minor units with an explicit currency. For IDR, one rupiah is 100
minor units; do not silently mix whole-rupiah PDF amounts with the stored scale.
Treat Jago references as opaque strings: samples include numeric, alphanumeric,
hyphenated, and underscore-separated forms.

Bank transaction facts are distinct from editable explanations and approvals.
Do not deduplicate on amount/date alone. Notification suppression covers all
transaction-related channels and summary inclusion.
