# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Rust + HTMX on Cloudflare is the current proposed direction, not an irrevocable
choice. The user permits a different stack if implementation constraints warrant
it. Cloudflare Workers, D1, and R2 are proposed components, pending validation.

## Users

AWS User Group Jakarta organizers. Access is internal, not public.
The product supports independent organization workspaces, including Jakarta and
Indonesia. Each organization has separate financial records, events, assets,
memberships, and roles, and can track multiple pockets. A user can belong to
multiple organizations. Combined cross-organization reporting is deferred.

Google Sign-in is the chosen authentication method. Invitation policy,
organization creation, and initial administrator setup use invite-only
membership and explicitly authorized platform administrators for organization
creation. Google Sign-in alone grants no organization access. The first
administrator's bootstrap mechanism remains an open decision.

Reuse the existing Google Sign-in configuration from the user's Jakarta website
projects rather than requesting new credentials. Local discovery found
`jakarta-website` (singular), with `PUBLIC_GOOGLE_CLIENT_ID`, and the related
`jakarta-backend`, with `GOOGLE_CLIENT_ID`. Values were not displayed or copied.
The existing integration and allowed origins still need compatibility validation;
do not assume an OAuth client secret is required or present.

Removing membership immediately revokes that organization's access and stops
notifications to the former member. Preserve historical attribution and flag
unresolved expense assignments for reassignment or authorized notification
suppression; do not transfer expense responsibility automatically. Open income
explanation requests follow current role membership and pocket-owner fallback.

## Product Purpose

Replace the existing Google Sheets financial ledger with a website that provides
simple financial information, supporting-document tracking, reminders, and
community asset tracking. Statistical dashboards are not needed for now.

## Language

English only. Do not build Indonesian translations or a language selector.
User-authored explanations and comments are not automatically translated.

## Operating Context

The community currently records income and expenses in a spreadsheet.
The supplied screenshot shows transaction date, description, type, amount,
payment method, paid by, account balance, reference, remarks, and invoice links.
Entries include event-related income, fees, refunds, and cloud expenses.

The user supplied a screenshot of a Jago Syariah pocket transaction history.
It visibly includes date/time, source/destination, transaction type, transaction
ID, notes, signed amount, and running balance.
Ten user-authorized community PDFs are now available as ignored local samples.
Local `pdftotext -layout` successfully extracted text from all ten, covering
one to seven pages, without passwords. Browser PDF.js extraction and complete
parser accuracy still require validation.

Statement-label mappings belong to a pocket. A searchable, editable dropdown
suggests labels from that pocket's imported transactions and accepts new labels
before the first import. Multiple labels can map to the same active responsible
member; matching trims surrounding whitespace and ignores case. Conflicting
mappings for the same label within a pocket are rejected.

Each pocket has an active owner responsible for unmapped expenses. New pockets
default to the organization creator when that member is active; otherwise an
active owner must be selected explicitly. Ownership is application responsibility,
not legal Jago account ownership. Import confirmation requires an active owner;
owner deactivation requires transferring pocket ownership first. Explicit expense
mappings take precedence over owner fallback. Changes affect future imports,
not existing expense assignments; no transaction backfill is required.

Income does not use expense mappings. An organization-configured income role's
active members share an explanation request; any one can resolve it. Without a
configured role or active recipients, the current pocket owner handles it. Open
requests follow current routing and membership. Routing grants only the access
needed to add income explanations and optional supporting documents, not unrelated
transaction edits or approval. Former recipients lose routing-derived access.

Income requires nonblank member-authored notes identifying sender/source, or
explaining why unknown. Bank notes and attachments alone do not satisfy this
requirement. Documents are encouraged but optional; income requires no approval.
Missing notes never block import. Existing notification controls and reminder
schedule apply until explained, preserving suppression and completed history.
External recipients are not emailed automatically.

Events can collect participant commitment fees. The exact attendance and refund
policy remains to be clarified. Pretix is the ticketing system, and Midtrans is
the payment gateway. Payment processing fees affect the amount received.
Commitment-fee calculations will be manual for now because historical payment
verification is inconsistent. A newer attendance standard uses both check-in
and check-out; participants can be missing check-out or both records.
Do not infer refund eligibility from check-in alone. Automated attendance-based
calculations are deferred, and no automatic refund execution is authorized.

One pocket transaction can cover multiple purposes, such as an IDR 15 million
payment covering two purposes. Do not assume one transaction equals one purpose
or one invoice. Store transaction details within PocketTrail and retain the
extracted Jago transaction ID as a reference to the bank movement. Monthly events
usually incur food costs only. Supporting-document rules and missing/duplicate
bank-reference handling remain open decisions.

Jago exports statements as PDF only, according to the user. Sample references
include numeric, hyphenated alphanumeric, and underscore-separated forms.
Preserve complete IDs as opaque strings, never numeric values or prefixes.

## Capabilities and Constraints

- Replace Google Sheets rather than synchronize with it.
- Start financial records with Jago PDF import, followed by review and transaction
  enrichment. Include manual opening-balance setup. Manual-first transaction
  entry and statement matching can be reconsidered later.
- Import all available historical Jago PDFs as the source of bank movements.
  The user will manually add context based on the existing Google Sheet later;
  automatic spreadsheet migration is not required.
- Jago exports are cumulative. Identify existing transactions by Jago transaction
  ID within the pocket, skip unchanged existing records, and preserve their
  explanations, evidence, discussions, assignments, and approvals. Conflicting
  bank fields or missing IDs require review, not silent replacement.
- Retain original statements and evidence privately for historical traceability.
  Preserve superseded evidence; permanent deletion is not an ordinary edit action.
- Present simple financial information, without a statistical dashboard for now.
- Separate records and features by organization.
- Support explanations and supporting documents for spending.
- Support organization-scoped configurable roles that bundle application
  permissions and can be assigned to members. Enforce access on the server.
  Full IAM-style conditional policies, explicit denies, and inheritance are
  outside the initial scope. The initial permission list remains undecided.
- Remind responsible organizers about missing details or documents.
- Identify missing transaction details during statement ingestion and remind the
  responsible person using user-configured actor mappings.
- Start with an in-app action list and email notifications: an initial notice
  after confirmed import/assignment and a weekly digest while incomplete.
  Notifications must initially be disabled while historical records and actor
  mappings are prepared. Enable notifications per organization using a chosen
  transaction-date cutoff and a preview of recipients and pending items.
  Older items remain visible without generating reminders unless included.
  Importing or mapping alone must not enable delivery.
  A dedicated organization-scoped permission can suppress notifications for a
  transaction, including historical items involving departed members.
  Suppression covers all notifications and summaries related to that transaction,
  including explicit mentions; it does not merely stop automatic reminders.
  Require a reason, record the author, visibly mark the suppression, and retain it
  until an authorized member changes it. Suppression must not imply that proof
  exists or that the transaction is approved.
  Organization-level notification disablement blocks all outbound notifications;
  enabling it must not release a queued flood of earlier notifications.
  Keep financial details and attachments out of notification emails.
  The user has an existing email server; its Workers-compatible delivery
  interface and cost constraints still require validation. Email is an accepted
  starting channel even though some organizers do not check it regularly.
- Require a purpose and responsible organizer, plus supporting documents for
  spending or an explicit document-unavailable explanation. Imported bank notes
  provide context, not a substitute for the spender's explanation.
- Require expense approval and support discussion of invoices and money within
  the platform. Income explanations require no approval. Approval authority is
  granted through organization-scoped
  permissions. Approve the whole transaction, including all its purposes.
  Members responsible for any part cannot approve it themselves; without another
  eligible approver, the transaction remains pending. Changes to explanations,
  purpose allocations, or supporting evidence require review again. Discussion
  comments alone do not invalidate approval.
  Test these rules locally before any deployment.
- Validate the first release locally, including imports, actor mappings, split
  purposes, evidence, discussions and mentions, separate-member approval,
  re-review after substantive edits, notification suppression, and stock by
  location. Use a local notification outbox rather than email real organizers.
  Synthetic fixtures cannot establish actual Jago PDF extraction compatibility.
- Provide one chronological discussion per transaction, visible to members
  permitted to view that transaction, with participation controlled by a comment
  permission. Comments support mentions that trigger notifications.
  Formal explanations, evidence, and approval remain separate from discussion.
  Private threads, real-time chat, and threaded replies are deferred.
  Mentions do not override organization or transaction notification suppression.
- Track leftover event merchandise, such as shirts and tumblers, including
  current quantity per location and optional item variants, such as shirt size.
  Locations can be storage places or organizers holding stock. Authorized
  members can update stock with a basic who/what/when change history.
  Checkout, return deadlines, and event distribution workflows are not required
  initially.
- No service charges are permitted under the current budget decision. Features
  that cannot operate within free allowances must be deferred or reconsidered.
- A public source repository does not imply public access to financial records.
- Approval rules, statement-import authority, historical import corrections,
  additional notification channels, and Pretix/Midtrans integration scope remain
  open decisions.

## Brand Commitments

The project is named PocketTrail. Its website should match the AWS User Group
style requested by the user. The existing Jakarta community website is an
acceptable brand reference; the user also permits AWS design guidance.
Cloudscape is an official, open-source design system built for and used by AWS.
Its shipped component library is React-based; using its guidance with Rust +
HTMX does not imply using those components or inheriting their accessibility
guarantees. The specific adaptation and brand assets have not yet been established.

## Evidence on Hand

A user-supplied screenshot in the project conversation shows the existing
spreadsheet structure. Another shows a page of the Jago Syariah statement.
Neither screenshot is committed as a repository asset.
Actual community PDFs exist only as ignored local samples; do not publish them.
No supplied logo files are committed.
Do not fabricate financial records or treat screenshot values as imported data.
Do not commit names, bank identifiers, or transaction details from the screenshots
to the public source repository.

## Product Principles

- Preserve financial traceability while making the existing ledger easier to
  understand.
- Keep financial records and supporting documents internal to organizers.
- Distinguish confirmed needs from proposed accounting workflows.
- Respect the zero-charge constraint when selecting features and services.
