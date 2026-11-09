ALTER TABLE organizations ADD COLUMN notification_revision INTEGER NOT NULL DEFAULT 0;

-- A digest may only be queued against the same organization snapshot it read.
-- These triggers execute within the caller's D1 transaction.
CREATE TRIGGER transaction_notification_revision AFTER UPDATE OF revision ON transactions
WHEN NEW.revision <> OLD.revision
BEGIN
  UPDATE organizations SET notification_revision=notification_revision+1 WHERE id=NEW.org_id;
  UPDATE notification_outbox SET cancelled_at=NEW.updated_at
    WHERE org_id=NEW.org_id AND cancelled_at IS NULL
      AND (kind='digest' OR (kind='assignment' AND transaction_id=NEW.id));
END;

CREATE TRIGGER transaction_insert_notification_revision AFTER INSERT ON transactions
BEGIN
  UPDATE organizations SET notification_revision=notification_revision+1 WHERE id=NEW.org_id;
END;

CREATE TRIGGER membership_notification_revision AFTER UPDATE ON memberships
BEGIN
  UPDATE organizations SET notification_revision=notification_revision+1 WHERE id=NEW.org_id;
  UPDATE notification_outbox SET cancelled_at=0
    WHERE org_id=NEW.org_id AND kind='digest' AND cancelled_at IS NULL;
END;

CREATE TRIGGER role_notification_revision AFTER UPDATE ON roles
BEGIN
  UPDATE organizations SET notification_revision=notification_revision+1 WHERE id=NEW.org_id;
  UPDATE notification_outbox SET cancelled_at=0
    WHERE org_id=NEW.org_id AND kind='digest' AND cancelled_at IS NULL;
END;

CREATE TRIGGER configuration_notification_revision
AFTER UPDATE OF notifications_enabled, notification_cutoff_date ON organizations
BEGIN
  UPDATE organizations SET notification_revision=notification_revision+1 WHERE id=NEW.id;
  UPDATE notification_outbox SET cancelled_at=0
    WHERE org_id=NEW.id AND kind='digest' AND cancelled_at IS NULL;
END;
