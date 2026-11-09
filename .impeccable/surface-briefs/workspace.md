# Organizer workspace

## Scope

Mode: Operate. Authenticated organizers review pocket movements, supply evidence,
discuss and approve transactions, and maintain merchandise stock. Desktop supports
dense review; mobile supports reading, explanation, and discussion.

## Direction contract

**THESIS:** Show the transaction and its accountability state together. Reject
the chart-heavy finance dashboard: the ledger and the work needing attention
are the product.

**OWN-WORLD:** User-pinned shadcn-inspired components, without React: zinc and
white surfaces, charcoal navigation and primary controls, restrained warm Jakarta
brand accents, precise borders, strong typography, semantic status labels and
tabular amounts. Custom selects and calendars replace browser-specific dropdowns
while preserving keyboard access, typed dates and server-side form validation.

**STORY:** Choose the organization, find a transaction, explain its purposes,
attach evidence, discuss uncertainty, and hand it to another member for approval.
The bank facts remain visible while the explanation changes.

**FIRST VIEWPORT:** Compact global header, organization switcher and navigation,
page title and one primary action, notification-disabled/local status, then the
actual ledger or transaction details. On mobile, navigation collapses without
hiding the active organization or the task.

**FORM:** Code-led operational workspace, replacing the rejected Cloudscape visual
world with the user's shadcn reference. No React migration or decorative dashboard.
seed: none (user-pinned direction).

**SIGNATURE INTERACTION:** A substantive edit visibly returns an approved
transaction to review; conversation updates do not disturb its bank record or
approval. Coordinated popover disclosure, focus transitions, loading feedback and
save/error states make interactions informative. Respect reduced motion.

**FINISH:** unreviewed and undocumented is unfinished; this build ends with the
finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

Codex and GLM independently review rendered desktop and mobile results, scoring
visual appeal, layout, typography, components, consistency, feedback, motion,
accessibility, responsiveness and task flow from 1–10. Target: every criterion
at least 9 from both reviewers. Scores remain evidence-based; unmet targets are
reported, never rounded into approval.
