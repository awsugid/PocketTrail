-- PocketTrail initial schema (D1/SQLite).
-- Money is stored as integer minor units: 100 minor = 1 IDR.
-- Timestamps are epoch milliseconds. Dates are YYYY-MM-DD strings (Jakarta),
-- times are HH:MM strings as printed on the bank statement.
-- Synthetic local data lives separately in tests/fixtures/seed.sql.

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  google_sub TEXT UNIQUE,
  is_platform_admin INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE organizations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  is_synthetic INTEGER NOT NULL DEFAULT 0,
  notifications_enabled INTEGER NOT NULL DEFAULT 0,
  notification_cutoff_date TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE roles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES organizations(id),
  name TEXT NOT NULL,
  permissions TEXT NOT NULL DEFAULT '[]', -- JSON array of permission strings
  UNIQUE (org_id, name)
);

-- Memberships persist after removal (removed_at set) so historical attribution
-- stays resolvable; access checks require removed_at IS NULL.
CREATE TABLE memberships (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES organizations(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  role_id INTEGER NOT NULL REFERENCES roles(id),
  handle TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  removed_at INTEGER,
  UNIQUE (org_id, user_id),
  UNIQUE (org_id, handle)
);

CREATE TABLE pockets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES organizations(id),
  name TEXT NOT NULL,
  opening_balance_minor INTEGER NOT NULL DEFAULT 0,
  UNIQUE (org_id, name)
);

CREATE TABLE transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES organizations(id),
  pocket_id INTEGER NOT NULL REFERENCES pockets(id),
  bank_id TEXT, -- Jago transaction ID; NULL for manual entries
  txn_date TEXT NOT NULL,
  txn_time TEXT,
  counterparty TEXT NOT NULL DEFAULT '',
  transaction_type TEXT NOT NULL DEFAULT '',
  bank_notes TEXT NOT NULL DEFAULT '',
  amount_minor INTEGER NOT NULL,
  balance_minor INTEGER,
  explanation TEXT NOT NULL DEFAULT '',
  evidence_unavailable_reason TEXT NOT NULL DEFAULT '',
  responsible_membership_id INTEGER REFERENCES memberships(id),
  status TEXT NOT NULL DEFAULT 'pending', -- pending|approved|changes_requested
  approved_by_membership_id INTEGER REFERENCES memberships(id),
  approved_at INTEGER,
  approval_note TEXT NOT NULL DEFAULT '',
  suppressed INTEGER NOT NULL DEFAULT 0,
  suppressed_by_membership_id REFERENCES memberships(id),
  suppressed_reason TEXT NOT NULL DEFAULT '',
  suppressed_at INTEGER,
  import_batch_id INTEGER,
  comment_cursor INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (org_id, pocket_id, bank_id)
);

CREATE TABLE transaction_splits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transaction_id INTEGER NOT NULL REFERENCES transactions(id),
  label TEXT NOT NULL,
  amount_minor INTEGER NOT NULL,
  responsible_membership_id REFERENCES memberships(id), -- NULL inherits txn-level
  created_at INTEGER NOT NULL
);

CREATE TABLE comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL,
  transaction_id INTEGER NOT NULL REFERENCES transactions(id),
  author_membership_id INTEGER NOT NULL REFERENCES memberships(id),
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE import_batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL,
  pocket_id INTEGER NOT NULL REFERENCES pockets(id),
  filename TEXT NOT NULL DEFAULT '',
  created_by_membership_id INTEGER NOT NULL REFERENCES memberships(id),
  created_at INTEGER NOT NULL
);

CREATE TABLE import_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id INTEGER NOT NULL REFERENCES import_batches(id),
  transaction_id INTEGER REFERENCES transactions(id),
  bank_id TEXT,
  status TEXT NOT NULL, -- imported|duplicate_unchanged|conflict|needs_review
  counterparty TEXT NOT NULL DEFAULT '',
  amount_minor INTEGER,
  message TEXT NOT NULL DEFAULT ''
);

-- Original statements and evidence live in R2 (DOCUMENTS binding); this table
-- only tracks metadata. Superseded evidence stays (superseded=1), never deleted.
CREATE TABLE documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL,
  transaction_id INTEGER REFERENCES transactions(id),
  import_batch_id INTEGER REFERENCES import_batches(id),
  kind TEXT NOT NULL, -- statement|evidence
  r2_key TEXT NOT NULL UNIQUE,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL DEFAULT 'application/octet-stream',
  size_bytes INTEGER NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  superseded INTEGER NOT NULL DEFAULT 0,
  uploaded_by_membership_id INTEGER NOT NULL REFERENCES memberships(id),
  created_at INTEGER NOT NULL
);

CREATE TABLE actor_mappings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL,
  pattern TEXT NOT NULL,
  membership_id INTEGER NOT NULL REFERENCES memberships(id),
  created_by_membership_id INTEGER NOT NULL REFERENCES memberships(id),
  created_at INTEGER NOT NULL,
  UNIQUE (org_id, pattern)
);

CREATE TABLE inventory_locations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  UNIQUE (org_id, name)
);

CREATE TABLE inventory_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  variant TEXT NOT NULL DEFAULT '',
  UNIQUE (org_id, name, variant)
);

CREATE TABLE inventory_levels (
  item_id INTEGER NOT NULL REFERENCES inventory_items(id),
  location_id INTEGER NOT NULL REFERENCES inventory_locations(id),
  qty INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (item_id, location_id)
);

CREATE TABLE stock_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL,
  item_id INTEGER NOT NULL REFERENCES inventory_items(id),
  location_id INTEGER NOT NULL REFERENCES inventory_locations(id),
  delta INTEGER NOT NULL,
  from_qty INTEGER NOT NULL DEFAULT 0,
  to_qty INTEGER NOT NULL DEFAULT 0,
  reason TEXT NOT NULL DEFAULT '',
  by_membership_id INTEGER NOT NULL REFERENCES memberships(id),
  created_at INTEGER NOT NULL
);

-- Local notification outbox stands in for the future email integration.
-- Bodies carry no financial details or attachments (product policy).
CREATE TABLE notification_outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL,
  kind TEXT NOT NULL, -- assignment|mention|digest
  to_membership_id INTEGER NOT NULL REFERENCES memberships(id),
  transaction_id INTEGER REFERENCES transactions(id),
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- Every member ever responsible for a transaction; approval is denied to
-- current AND historical responsibles so reassignment cannot launder
-- self-approval.
CREATE TABLE responsible_history (
  transaction_id INTEGER NOT NULL REFERENCES transactions(id),
  membership_id INTEGER NOT NULL REFERENCES memberships(id),
  since INTEGER NOT NULL,
  PRIMARY KEY (transaction_id, membership_id)
);

