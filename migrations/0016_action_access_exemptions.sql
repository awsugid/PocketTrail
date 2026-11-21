INSERT INTO roles(org_id,name,permissions)
SELECT id,'Assigned Actions only','["ExplainOwnActions"]' FROM organizations o
WHERE NOT EXISTS (SELECT 1 FROM roles r WHERE r.org_id=o.id AND r.name='Assigned Actions only');

CREATE TABLE historical_approval_exemptions (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 org_id INTEGER NOT NULL REFERENCES organizations(id),
 purpose_id INTEGER NOT NULL REFERENCES purposes(id),
 source_reference TEXT NOT NULL CHECK(length(trim(source_reference))>0),
 reason TEXT NOT NULL CHECK(length(trim(reason))>0),
 actor_id TEXT NOT NULL REFERENCES users(id),
 created_at INTEGER NOT NULL,
 revoked_at INTEGER,
 revoked_by TEXT REFERENCES users(id)
);
CREATE UNIQUE INDEX historical_exemption_active ON historical_approval_exemptions(org_id,purpose_id) WHERE revoked_at IS NULL;
CREATE TRIGGER historical_exemption_scope BEFORE INSERT ON historical_approval_exemptions
WHEN NOT EXISTS(SELECT 1 FROM purposes p WHERE p.id=NEW.purpose_id AND p.org_id=NEW.org_id)
BEGIN SELECT RAISE(ABORT,'Wrong exemption organization'); END;
