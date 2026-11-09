-- Explicitly local SYNTHETIC fixtures. Never included in deployment migrations.
-- Run on a fresh local database after migrations; this is not a reset script.
INSERT INTO users (id, email, name, is_platform_admin, created_at) VALUES
  ('alice', 'alice@example.test', 'Alice (fixture)', 1, 0),
  ('bob', 'bob@example.test', 'Bob (fixture)', 0, 0),
  ('admin', 'admin@example.test', 'Admin (fixture)', 1, 0);

INSERT INTO organizations
  (id, slug, name, is_synthetic, notifications_enabled, notification_cutoff_date, created_at)
VALUES
  (1, 'demo-jakarta', 'Jakarta — synthetic demo', 1, 0, '2025-01-01', 0),
  (2, 'demo-indonesia', 'Indonesia — synthetic demo', 1, 0, '2025-01-01', 0);

INSERT INTO roles (id, org_id, name, permissions) VALUES
  (1, 1, 'Admin', '["ViewTransactions","CommentTransactions","DocumentTransactions","ApproveTransactions","ImportStatements","ManageRoles","ManageMembers","ManageNotifications","SuppressNotifications","UpdateStock"]'),
  (2, 1, 'Approver', '["ViewTransactions","CommentTransactions","ApproveTransactions"]'),
  (3, 1, 'Editor', '["ViewTransactions","CommentTransactions","DocumentTransactions","ImportStatements","UpdateStock"]'),
  (4, 1, 'Viewer', '["ViewTransactions"]'),
  (5, 2, 'Admin', '["ViewTransactions","CommentTransactions","DocumentTransactions","ApproveTransactions","ImportStatements","ManageRoles","ManageMembers","ManageNotifications","SuppressNotifications","UpdateStock"]');

INSERT INTO memberships (id, org_id, user_id, role_id, handle, created_at) VALUES
  (1, 1, 'alice', 1, 'alice', 0),
  (2, 1, 'bob', 2, 'bob', 0),
  (3, 2, 'bob', 5, 'bob', 0);

INSERT INTO pockets (id, org_id, name, opening_balance_minor) VALUES
  (1, 1, 'Main Pocket (demo)', 0),
  (2, 2, 'Indonesia Pocket (demo)', 0);

INSERT INTO actor_mappings (org_id, pattern, membership_id, created_by_membership_id, created_at) VALUES
  (1, 'Main Pocket (demo)', 1, 1, 0),
  (1, 'Demo Coffee Supplier', 2, 1, 0);

INSERT INTO transactions
  (id, org_id, pocket_id, bank_id, txn_date, txn_time, counterparty, transaction_type,
   bank_notes, amount_minor, balance_minor, explanation, evidence_unavailable_reason,
   responsible_membership_id, status, created_at, updated_at)
VALUES
  (1, 1, 1, 'JPXDEMO0001', '2025-06-01', '10:23', 'Demo Coffee Supplier', 'QR Payment',
   'DEMO: monthly meetup coffee order', -150000000, 850000000,
   'DEMO: coffee for June meetup (split across two purposes)', '', 2, 'pending', 0, 0),
  (2, 1, 1, 'JPXDEMO0002', '2025-06-02', '14:05', 'Demo Venue', 'Bank Transfer',
   'DEMO: venue refund', 25000000, 875000000,
   'DEMO: venue deposit refund after meetup', 'DEMO: venue confirmed no receipt issued',
   1, 'approved', 0, 0),
  (3, 1, 1, 'JPXDEMO0003', '2025-06-03', '09:00', 'Demo Cloud Provider', 'Auto Debit',
   'DEMO: cloud hosting', -12000000, 863000000, '', '', 1, 'pending', 0, 0);

UPDATE transactions SET approved_by_membership_id = 2, approved_at = 0 WHERE id = 2;

-- Positive split magnitudes sum to the absolute signed bank amount.
INSERT INTO transaction_splits
  (transaction_id, label, amount_minor, responsible_membership_id, created_at)
VALUES
  (1, 'DEMO: workshop supplies', 90000000, 2, 0),
  (1, 'DEMO: attendee coffee', 60000000, 1, 0);

INSERT INTO responsible_history (transaction_id, membership_id, since) VALUES
  (1, 2, 0), (1, 1, 0), (2, 1, 0), (3, 1, 0);

INSERT INTO inventory_locations (id, org_id, name) VALUES
  (1, 1, 'DEMO storage box'), (2, 1, 'Alice (fixture, held)');
INSERT INTO inventory_items (id, org_id, name, variant) VALUES
  (1, 1, 'DEMO T-shirt', 'M'), (2, 1, 'DEMO T-shirt', 'L'), (3, 1, 'DEMO Tumbler', '');
INSERT INTO inventory_levels (item_id, location_id, qty) VALUES
  (1, 1, 12), (2, 1, 5), (3, 1, 2), (3, 2, 1);
INSERT INTO stock_movements
  (org_id, item_id, location_id, delta, from_qty, to_qty, reason, by_membership_id, created_at)
VALUES
  (1, 1, 1, 12, 0, 12, 'DEMO: initial print run', 1, 0),
  (1, 2, 1, 5, 0, 5, 'DEMO: initial print run', 1, 0),
  (1, 3, 1, 2, 0, 2, 'DEMO: initial stock', 1, 0),
  (1, 3, 2, 1, 0, 1, 'DEMO: stock held by organizer', 1, 0);
