-- Organization-scoped reusable purposes and their many-to-many monetary
-- allocations to bank transactions. A purpose is strictly income or expense;
-- allocations are positive magnitudes (the bank record carries the sign).
--
-- Additive migration: existing transaction_splits each become one purpose
-- (labels are never auto-merged) plus one allocation; transactions without
-- splits stay unallocated. Existing explanations, evidence, comments,
-- approvals and history are preserved untouched.

CREATE TABLE purposes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES organizations(id),
  name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 300),
  kind TEXT NOT NULL CHECK(kind IN ('income','expense')),
  -- Single Notes field: explanation and, when evidence is missing, the
  -- missing-evidence outcome. No separate justification field.
  notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending', -- pending|submitted|approved|changes_requested
  approved_by_membership_id INTEGER REFERENCES memberships(id),
  approved_at INTEGER,
  approval_note TEXT NOT NULL DEFAULT '',
  suppressed INTEGER NOT NULL DEFAULT 0,
  suppressed_by_membership_id INTEGER REFERENCES memberships(id),
  suppressed_reason TEXT NOT NULL DEFAULT '',
  suppressed_at INTEGER,
  created_by_membership_id INTEGER NOT NULL REFERENCES memberships(id),
  -- Set only by this migration: the split this purpose was born from.
  source_split_id INTEGER REFERENCES transaction_splits(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  mutation_token TEXT NOT NULL DEFAULT ''
);

CREATE INDEX purpose_org_kind ON purposes(org_id, kind);
CREATE INDEX purpose_source_split ON purposes(source_split_id);

-- Many-to-many: one transaction covers several purposes, one purpose is fed
-- by several transactions. Draft partial allocations are allowed; the sum per
-- transaction may not exceed the bank magnitude (enforced by the application
-- alongside the exact-allocation submission gate).
CREATE TABLE allocations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES organizations(id),
  purpose_id INTEGER NOT NULL REFERENCES purposes(id),
  transaction_id INTEGER NOT NULL REFERENCES transactions(id),
  amount_minor INTEGER NOT NULL CHECK(amount_minor > 0),
  -- Explicit allocation-specific responsible member; NULL inherits the
  -- purpose's responsible members, then the transaction's.
  responsible_membership_id INTEGER REFERENCES memberships(id),
  created_at INTEGER NOT NULL,
  UNIQUE (purpose_id, transaction_id)
);

CREATE INDEX allocation_txn ON allocations(transaction_id);
CREATE INDEX allocation_purpose ON allocations(purpose_id);

-- Multiple responsible members per purpose; any one of them can document.
-- Removed members may remain here (historical attribution is preserved and
-- flagged by the application).
CREATE TABLE purpose_responsibles (
  purpose_id INTEGER NOT NULL REFERENCES purposes(id),
  membership_id INTEGER NOT NULL REFERENCES memberships(id),
  since INTEGER NOT NULL,
  PRIMARY KEY (purpose_id, membership_id)
);

-- Every member ever responsible for a purpose; approval is denied to current
-- AND historical responsibles so reassignment cannot launder self-approval.
CREATE TABLE purpose_responsible_history (
  purpose_id INTEGER NOT NULL REFERENCES purposes(id),
  membership_id INTEGER NOT NULL REFERENCES memberships(id),
  since INTEGER NOT NULL,
  PRIMARY KEY (purpose_id, membership_id)
);

-- One chronological discussion per purpose. Bodies are restricted Markdown
-- (see src/lib/markdown.ts); rows are never edited or deleted. Responsibility
-- reassignment justifications are recorded here permanently as messages.
CREATE TABLE purpose_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES organizations(id),
  purpose_id INTEGER NOT NULL REFERENCES purposes(id),
  author_membership_id INTEGER NOT NULL REFERENCES memberships(id),
  body_md TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX purpose_messages_of ON purpose_messages(purpose_id, id);

-- Purpose history: approval decisions, substantive edits, reassignments.
CREATE TABLE purpose_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES organizations(id),
  purpose_id INTEGER NOT NULL REFERENCES purposes(id),
  actor_membership_id INTEGER NOT NULL REFERENCES memberships(id),
  action TEXT NOT NULL,
  previous_status TEXT,
  new_status TEXT,
  details TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);

CREATE INDEX purpose_audit_of ON purpose_audit(purpose_id, id);

-- Purpose-level evidence documents (kind='evidence', purpose_id set).
ALTER TABLE documents ADD COLUMN purpose_id INTEGER REFERENCES purposes(id);
CREATE INDEX documents_purpose ON documents(purpose_id) WHERE purpose_id IS NOT NULL;

-- Purpose-bound notification rows (kind 'mention': link-only private email).
ALTER TABLE notification_outbox ADD COLUMN purpose_id INTEGER REFERENCES purposes(id);
CREATE INDEX outbox_purpose ON notification_outbox(purpose_id) WHERE purpose_id IS NOT NULL;

-- One purpose per existing split; labels are never merged. Direction comes
-- from the transaction's signed amount, so a label used on both an income and
-- an expense transaction becomes two purposes of different kinds.
INSERT INTO purposes(org_id, name, kind, notes, status, approved_by_membership_id, approved_at,
                     suppressed, created_by_membership_id, source_split_id, created_at, updated_at)
SELECT t.org_id,
       s.label,
       CASE WHEN t.amount_minor > 0 THEN 'income' ELSE 'expense' END,
       CASE WHEN trim(t.explanation) = '' THEN ''
            WHEN trim(t.evidence_unavailable_reason) = '' THEN t.explanation
            ELSE t.explanation || char(10) || char(10) || 'No supporting document: ' || t.evidence_unavailable_reason
       END,
       CASE t.status WHEN 'approved' THEN 'approved' WHEN 'changes_requested' THEN 'changes_requested' ELSE 'pending' END,
       CASE t.status WHEN 'approved' THEN t.approved_by_membership_id ELSE NULL END,
       CASE t.status WHEN 'approved' THEN t.approved_at ELSE NULL END,
       0,
       COALESCE(s.responsible_membership_id, t.responsible_membership_id, o.creator_membership_id,
                (SELECT MIN(m2.id) FROM memberships m2 WHERE m2.org_id = t.org_id)),
       s.id,
       s.created_at,
       s.created_at
FROM transaction_splits s
JOIN transactions t ON t.id = s.transaction_id
JOIN organizations o ON o.id = t.org_id;

INSERT INTO purpose_responsibles(purpose_id, membership_id, since)
SELECT p.id, COALESCE(s.responsible_membership_id, t.responsible_membership_id), s.created_at
FROM transaction_splits s
JOIN transactions t ON t.id = s.transaction_id
JOIN purposes p ON p.source_split_id = s.id
WHERE COALESCE(s.responsible_membership_id, t.responsible_membership_id) IS NOT NULL;

INSERT INTO purpose_responsible_history(purpose_id, membership_id, since)
SELECT p.id, COALESCE(s.responsible_membership_id, t.responsible_membership_id), s.created_at
FROM transaction_splits s
JOIN transactions t ON t.id = s.transaction_id
JOIN purposes p ON p.source_split_id = s.id
WHERE COALESCE(s.responsible_membership_id, t.responsible_membership_id) IS NOT NULL;

-- Allocation override stays NULL for migrated rows: the split-level override
-- already became the purpose's responsible member.
INSERT INTO allocations(org_id, purpose_id, transaction_id, amount_minor, responsible_membership_id, created_at)
SELECT t.org_id, p.id, s.transaction_id, s.amount_minor, NULL, s.created_at
FROM transaction_splits s
JOIN transactions t ON t.id = s.transaction_id
JOIN purposes p ON p.source_split_id = s.id;
