# PocketTrail

PocketTrail records community finances and assets for AWS User Group organizers.

## Language

**Organization**:
A community unit whose financial records and features are separated from other
organizations in PocketTrail.

**Membership**:
A user's participation in a particular organization, with roles assigned within
that organization. One user can hold memberships in multiple organizations.

**Invited member**:
A person invited to an organization who has not accepted yet. They hold a
membership with a role but no access; they can be mapped, made responsible, and
reminded by email. Accepting with a matching verified Google sign-in turns the
same membership into a full one, keeping every assignment. An invitation's
expiry does not remove an invited member.
_Avoid_: Pending user or guest, which suggest an account or partial access.

**Role**:
A configurable bundle of application permissions assigned to an organization's
members.
_Avoid_: Global role, when describing access granted within one organization.

**Pocket**:
A bank pocket holding community funds tracked for an organization.
_Avoid_: Organization, when referring to the bank-held funds rather than the
community unit.

**Bank transaction**:
A movement of money recorded in a pocket; one movement can cover more than one
purpose.
_Avoid_: Invoice or purpose, when referring to the movement of money itself.

**Jago transaction ID**:
A bank-provided reference extracted from a Jago statement and retained alongside
the corresponding transaction details in PocketTrail.

**Actor**:
A person associated with a transaction through a user-configured mapping from
the statement's source/destination. An actor is not necessarily a login user.
_Avoid_: User, when the person has not been established as an application member.

**Responsible member**:
The organization member (including an invited member) assigned to supply a
transaction's explanation and supporting evidence. A mapping can assign this
member automatically without requiring the bank counterparty to have an
application account.
_Avoid_: Actor, when referring specifically to the person accountable for details.

**Reviewer**:
An organization member permitted to approve or request changes to a transaction's
or purpose's explanation and evidence. A member can be both a reviewer and a
responsible member.

**Needs your action**:
From the viewing member's perspective, a transaction or purpose waiting on them:
as responsible member when details are needed or changes were requested, or as
reviewer when it is pending review.

**Waiting**:
From the viewing member's perspective, a transaction or purpose pending review by
someone else; no action is required from the viewer.

**Transaction notification suppression**:
An authorized decision to stop all notifications and summaries concerning a
transaction, including mention notifications. It does not supply missing evidence
or constitute approval.
_Avoid_: Reminder-only suppression, completion, or approval.

**Pocket owner**:
An active organization member responsible for a pocket's unmapped expenses,
its internal pocket movements, and income explanations when no active
income-responsibility role members exist. An invited member cannot own a pocket.
_Avoid_: Bank account owner or organization owner; neither defines this responsibility.

**Actor mapping**:
A pocket-specific association between a statement source/destination label and
an expense's responsible member. Multiple labels can identify the same member.
Saving a mapping also moves that pocket's matching expenses that still need
details and were never reassigned by hand.

**Internal pocket movement**:
Money moved between the organization's own pockets ("Pocket Money Out",
"Movement between Pockets"). Its responsible member is always the pocket owner;
actor mappings never apply to it.
_Avoid_: Bank account identity, which a label mapping does not establish.

**Income-responsibility role**:
The organization role whose active members share responsibility for explaining
income; any one of those members can supply the explanation.

**Income explanation**:
Member-authored notes identifying incoming funds' sender or source, including an
explanation when unknown. Supporting documents are optional; approval is not required.

**Commitment fee**:
A participant payment associated with an event ticket; its refund eligibility
is governed by the event's policy, which has not yet been established here.
_Avoid_: Processing fee, which is a payment gateway charge.

**Processing fee**:
A payment gateway charge that affects the net funds received from participant
payments.
_Avoid_: Commitment fee.

**Organizer**:
A community team member within the intended internal audience for PocketTrail.
This term does not by itself grant a particular permission level.

**Financial ledger**:
The community's record of income and expenses, currently maintained in Google
Sheets and intended to move into PocketTrail.
_Avoid_: Balance sheet, when referring to the income-and-expense record rather
than a formal statement of assets, liabilities, and equity.

**Allocation**:
The portion of a bank transaction's amount assigned to one purpose; a bank
transaction may be split across several purposes.

**Purpose**:
A named income or expense reason that one or more allocations are assigned to.

**Supporting document**:
A document associated with a financial entry to explain or substantiate it, such
as an invoice or receipt.
_Avoid_: Invoice, when referring generically to all supporting evidence.

**Merchandise**:
Community-owned event goods, such as shirts and tumblers, whose remaining
quantities and current locations need to be tracked.
_Avoid_: Fixed asset, when referring to event merchandise stock.

**Stock location**:
A storage place or organizer holding merchandise, against which a current
quantity is recorded.
