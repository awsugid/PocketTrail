# PocketTrail

PocketTrail records community finances and assets for AWS User Group organizers.

## Language

**Organization**:
A community unit whose financial records and features are separated from other
organizations in PocketTrail.

**Membership**:
A user's participation in a particular organization, with roles assigned within
that organization. One user can hold memberships in multiple organizations.

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
The organization member assigned to supply a transaction's explanation and
supporting evidence. A mapping can assign this member automatically without
requiring the bank counterparty to have an application account.
_Avoid_: Actor, when referring specifically to the person accountable for details.

**Transaction notification suppression**:
An authorized decision to stop all notifications and summaries concerning a
transaction, including mention notifications. It does not supply missing evidence
or constitute approval.
_Avoid_: Reminder-only suppression, completion, or approval.

**Pocket owner**:
The person to whom pocket-label counterparties, such as Main Pocket, are mapped.
_Avoid_: Organization owner, which implies a separate administrative role.

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
