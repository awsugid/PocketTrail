CREATE TABLE email_log (
  id INTEGER PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES organizations(id),
  kind TEXT NOT NULL,
  to_membership_id INTEGER,
  to_address TEXT NOT NULL,
  from_address TEXT NOT NULL,
  subject TEXT NOT NULL,
  text_body TEXT NOT NULL,
  html_body TEXT NOT NULL,
  message_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('sent', 'failed')),
  error TEXT,
  outbox_ids TEXT,
  invitation_id TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX email_log_org_created ON email_log(org_id, created_at DESC);
CREATE INDEX email_log_org_kind ON email_log(org_id, kind);
CREATE INDEX email_log_org_status ON email_log(org_id, status);

UPDATE roles SET permissions = json_insert(permissions, '$[#]', 'ViewEmailHistory')
WHERE name = 'Admin' AND NOT EXISTS (
  SELECT 1 FROM json_each(roles.permissions) WHERE value = 'ViewEmailHistory'
);
