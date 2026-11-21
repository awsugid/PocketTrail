CREATE TABLE mcp_refresh_tokens (
 token_hash TEXT PRIMARY KEY,
 grant_id TEXT NOT NULL REFERENCES mcp_grants(id),
 resource TEXT NOT NULL,
 expires_at INTEGER NOT NULL,
 used_at INTEGER
);
CREATE INDEX mcp_refresh_grant ON mcp_refresh_tokens(grant_id);
