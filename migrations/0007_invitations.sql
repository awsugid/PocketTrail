CREATE TABLE invitations (
  id TEXT PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES organizations(id),
  email TEXT NOT NULL COLLATE NOCASE,
  role_id INTEGER NOT NULL REFERENCES roles(id),
  invited_by TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  accepted_at INTEGER,
  accepted_by TEXT REFERENCES users(id)
);
CREATE UNIQUE INDEX one_pending_invitation ON invitations(org_id,email)
  WHERE revoked_at IS NULL AND accepted_at IS NULL;
CREATE TRIGGER invitation_role_scope BEFORE INSERT ON invitations
WHEN NOT EXISTS (SELECT 1 FROM roles WHERE id=NEW.role_id AND org_id=NEW.org_id)
BEGIN SELECT RAISE(ABORT,'Invitation role belongs to another organization'); END;
