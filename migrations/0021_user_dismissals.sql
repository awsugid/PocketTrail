CREATE TABLE user_dismissals (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  dismissed_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, key)
);
