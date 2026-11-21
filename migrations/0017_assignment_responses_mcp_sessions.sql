CREATE TABLE action_responses (
 org_id INTEGER NOT NULL REFERENCES organizations(id),
 transaction_id INTEGER NOT NULL REFERENCES transactions(id),
 membership_id INTEGER NOT NULL REFERENCES memberships(id),
 explanation TEXT NOT NULL,
 transaction_revision INTEGER NOT NULL,
 created_at INTEGER NOT NULL,
 mutation_token TEXT NOT NULL UNIQUE,
 PRIMARY KEY(org_id,transaction_id,membership_id,transaction_revision)
);
CREATE TABLE mcp_sessions (
 id TEXT PRIMARY KEY,
 credential_hash TEXT NOT NULL,
 expires_at INTEGER NOT NULL,
 initialized INTEGER NOT NULL DEFAULT 0
);
