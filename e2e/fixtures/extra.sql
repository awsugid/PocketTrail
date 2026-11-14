-- Local-only extra fixtures for the migration slice's runtime checks. Applied
-- after tests/fixtures/seed.sql, on the synthetic local database only.

-- A role with no ledger permission, so the permission gate can be exercised
-- against a real active membership rather than a missing one.
INSERT INTO roles (id, org_id, name, permissions) VALUES (6, 1, 'NoLedger (fixture)', '[]');
INSERT INTO users (id, email, name, is_platform_admin, created_at)
  VALUES ('dana', 'dana@example.test', 'Dana (fixture)', 0, 0);
INSERT INTO memberships (id, org_id, user_id, role_id, handle, created_at)
  VALUES (4, 1, 'dana', 6, 'dana', 0);

-- One movement that belongs to the OTHER organization. Requesting it through
-- demo-jakarta must look like a missing record, never like a forbidden one.
INSERT INTO transactions
  (id, org_id, pocket_id, bank_id, txn_date, txn_time, counterparty, transaction_type,
   bank_notes, amount_minor, balance_minor, explanation, evidence_unavailable_reason,
   responsible_membership_id, status, created_at, updated_at)
VALUES
  (900, 2, 2, 'JPXDEMO0900', '2025-06-09', '08:15', 'Indonesia Vendor', 'Bank Transfer',
   'DEMO: belongs to demo-indonesia only', -7000000, 993000000,
   'DEMO: other-organization movement', '', 3, 'pending', 0, 0);

-- Statement labels already seen on Main Pocket: one is mapped (seed), one is not,
-- so the routing label picker has something to offer and something to exclude.
INSERT INTO import_batches (id, org_id, pocket_id, filename, created_by_membership_id, created_at)
  VALUES (9001, 1, 1, 'DEMO-labels.pdf', 1, 0);
INSERT INTO import_items (batch_id, status, counterparty, message) VALUES
  (9001, 'imported', 'Demo Coffee Supplier', ''),
  (9001, 'imported', 'Demo Print Shop', '');
