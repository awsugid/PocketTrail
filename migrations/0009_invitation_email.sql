-- Invitation email delivery: durable rows for single-use link tokens.
-- Raw tokens are never stored; token_hash is the SHA-256 of the token
-- embedded in the emailed link, and invitation_mail is the single source of
-- token state (no token column on invitations).
-- One row per emailed link. Resend supersedes older rows so only
-- the newest token can ever be redeemed. status: pending (queued/not sent),
-- sent (link live), failed (transport error recorded), superseded.
CREATE TABLE invitation_mail (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invitation_id TEXT NOT NULL REFERENCES invitations(id),
  token_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sent', 'failed', 'superseded')),
  error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  sent_at INTEGER
);
CREATE INDEX invitation_mail_token ON invitation_mail(token_hash, status);
CREATE INDEX invitation_mail_invitation ON invitation_mail(invitation_id, status);
