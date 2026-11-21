CREATE TABLE tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES organizations(id),
  name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 80),
  UNIQUE(org_id, name COLLATE NOCASE),
  UNIQUE(org_id, id)
);

CREATE TABLE transaction_tags (
  org_id INTEGER NOT NULL REFERENCES organizations(id),
  transaction_id INTEGER NOT NULL REFERENCES transactions(id),
  tag_id INTEGER NOT NULL,
  PRIMARY KEY(transaction_id, tag_id),
  FOREIGN KEY(org_id, tag_id) REFERENCES tags(org_id, id)
);
CREATE INDEX transaction_tags_filter ON transaction_tags(org_id, tag_id, transaction_id);
