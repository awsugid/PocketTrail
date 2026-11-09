CREATE TABLE role_templates (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 name TEXT NOT NULL UNIQUE COLLATE NOCASE,
 permissions TEXT NOT NULL CHECK(json_valid(permissions))
);
CREATE TABLE audit_events (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 actor_id TEXT REFERENCES users(id),
 org_id INTEGER REFERENCES organizations(id),
 action TEXT NOT NULL,
 target TEXT NOT NULL,
 outcome TEXT NOT NULL,
 created_at INTEGER NOT NULL
);
CREATE INDEX audit_scope ON audit_events(org_id,id DESC);
CREATE TRIGGER audit_no_update BEFORE UPDATE ON audit_events
BEGIN SELECT RAISE(ABORT,'Audit events are append-only'); END;
CREATE TRIGGER audit_no_delete BEFORE DELETE ON audit_events
BEGIN SELECT RAISE(ABORT,'Audit events are append-only'); END;
