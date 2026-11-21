ALTER TABLE transactions ADD COLUMN action_assignment_generation INTEGER NOT NULL DEFAULT 0;

-- Transaction-level Actions cover all allocations: any assignment topology change
-- deliberately reopens every assignee's response for that transaction. Notes,
-- evidence and unrelated purpose revisions do not advance this generation.
CREATE TRIGGER action_generation_txn AFTER UPDATE OF responsible_membership_id ON transactions
WHEN OLD.responsible_membership_id IS NOT NEW.responsible_membership_id
BEGIN UPDATE transactions SET action_assignment_generation=action_assignment_generation+1 WHERE id=NEW.id; END;
CREATE TRIGGER action_generation_alloc_insert AFTER INSERT ON allocations
BEGIN UPDATE transactions SET action_assignment_generation=action_assignment_generation+1 WHERE id=NEW.transaction_id AND org_id=NEW.org_id; END;
CREATE TRIGGER action_generation_alloc_delete AFTER DELETE ON allocations
BEGIN UPDATE transactions SET action_assignment_generation=action_assignment_generation+1 WHERE id=OLD.transaction_id AND org_id=OLD.org_id; END;
CREATE TRIGGER action_generation_alloc_update AFTER UPDATE OF responsible_membership_id,purpose_id,transaction_id,org_id ON allocations
WHEN OLD.responsible_membership_id IS NOT NEW.responsible_membership_id OR OLD.purpose_id IS NOT NEW.purpose_id OR OLD.transaction_id IS NOT NEW.transaction_id OR OLD.org_id IS NOT NEW.org_id
BEGIN
 UPDATE transactions SET action_assignment_generation=action_assignment_generation+1 WHERE (id=OLD.transaction_id AND org_id=OLD.org_id) OR (id=NEW.transaction_id AND org_id=NEW.org_id);
END;
CREATE TRIGGER action_generation_purpose_insert AFTER INSERT ON purpose_responsibles
BEGIN UPDATE transactions SET action_assignment_generation=action_assignment_generation+1 WHERE id IN (SELECT transaction_id FROM allocations WHERE purpose_id=NEW.purpose_id AND responsible_membership_id IS NULL); END;
CREATE TRIGGER action_generation_purpose_delete AFTER DELETE ON purpose_responsibles
BEGIN UPDATE transactions SET action_assignment_generation=action_assignment_generation+1 WHERE id IN (SELECT transaction_id FROM allocations WHERE purpose_id=OLD.purpose_id AND responsible_membership_id IS NULL); END;
CREATE TRIGGER action_generation_purpose_update AFTER UPDATE OF purpose_id,membership_id ON purpose_responsibles
WHEN OLD.purpose_id IS NOT NEW.purpose_id OR OLD.membership_id IS NOT NEW.membership_id
BEGIN UPDATE transactions SET action_assignment_generation=action_assignment_generation+1 WHERE id IN (SELECT transaction_id FROM allocations WHERE purpose_id IN (OLD.purpose_id,NEW.purpose_id) AND responsible_membership_id IS NULL); END;
CREATE TRIGGER action_generation_purpose_visibility AFTER UPDATE OF suppressed ON purposes
WHEN OLD.suppressed IS NOT NEW.suppressed
BEGIN UPDATE transactions SET action_assignment_generation=action_assignment_generation+1 WHERE id IN (SELECT transaction_id FROM allocations WHERE purpose_id=NEW.id); END;

ALTER TABLE action_responses RENAME TO action_responses_legacy;
CREATE TABLE action_responses (
 org_id INTEGER NOT NULL REFERENCES organizations(id),
 transaction_id INTEGER NOT NULL REFERENCES transactions(id),
 membership_id INTEGER NOT NULL REFERENCES memberships(id),
 explanation TEXT NOT NULL,
 assignment_key TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 mutation_token TEXT NOT NULL UNIQUE,
 PRIMARY KEY(org_id,transaction_id,membership_id,assignment_key)
);
-- Keep legacy responses auditable, but never treat unversioned assignments as current.
INSERT INTO action_responses SELECT org_id,transaction_id,membership_id,explanation,'legacy:'||transaction_revision,created_at,mutation_token FROM action_responses_legacy;
DROP TABLE action_responses_legacy;
