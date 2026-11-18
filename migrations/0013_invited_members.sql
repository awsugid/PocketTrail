-- Invited members: an invitation creates the membership immediately so the
-- invitee can be mapped, made responsible, and emailed before accepting.
-- invited=1 grants no access; acceptance clears it. Invitees without an
-- account get a placeholder user ('invite:' id, no Google subject) that the
-- matching verified Google sign-in later claims.
ALTER TABLE memberships ADD COLUMN invited INTEGER NOT NULL DEFAULT 0;

-- Backfill open invitations (expired ones included: expiry does not remove an
-- invited member). One placeholder per email lacking any user row.
INSERT INTO users(id,email,name,created_at)
SELECT 'invite:' || lower(hex(randomblob(16))), lower(i.email), lower(i.email), MIN(i.created_at)
FROM invitations i
WHERE i.accepted_at IS NULL AND i.revoked_at IS NULL
  AND NOT EXISTS(SELECT 1 FROM users u WHERE u.email=i.email COLLATE NOCASE)
GROUP BY lower(i.email);

INSERT INTO memberships(org_id,user_id,role_id,handle,created_at,invited)
SELECT i.org_id,u.id,i.role_id,u.id,i.created_at,1
FROM invitations i JOIN users u ON u.email=i.email COLLATE NOCASE
WHERE i.accepted_at IS NULL AND i.revoked_at IS NULL
  AND NOT EXISTS(SELECT 1 FROM memberships m WHERE m.org_id=i.org_id AND m.user_id=u.id);

-- Outbox rows become real email deliveries.
ALTER TABLE notification_outbox ADD COLUMN sent_at INTEGER;
ALTER TABLE notification_outbox ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE notification_outbox ADD COLUMN last_error TEXT;
CREATE INDEX notification_outbox_unsent ON notification_outbox(org_id, sent_at, cancelled_at);
-- Rows queued before email existed were preview-only: retire them (no
-- retries left) instead of emailing the whole backlog on first delivery.
UPDATE notification_outbox SET attempts=3, last_error='Queued before email delivery existed; not sent.'
WHERE sent_at IS NULL;
