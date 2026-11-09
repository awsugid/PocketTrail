ALTER TABLE transactions ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE transactions ADD COLUMN mutation_token TEXT NOT NULL DEFAULT '';

CREATE TABLE transaction_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES organizations(id),
  transaction_id INTEGER NOT NULL REFERENCES transactions(id),
  actor_membership_id INTEGER NOT NULL REFERENCES memberships(id),
  action TEXT NOT NULL,
  previous_status TEXT NOT NULL,
  new_status TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);
CREATE INDEX transaction_audit_lookup ON transaction_audit(org_id, transaction_id, id);
CREATE INDEX transaction_list_lookup ON transactions(org_id, txn_date, id);
CREATE INDEX comments_transaction_lookup ON comments(transaction_id, id);
