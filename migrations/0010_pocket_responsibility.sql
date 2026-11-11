-- Unknown historical creators remain NULL; explicit owner selection is required.
ALTER TABLE organizations ADD COLUMN creator_membership_id INTEGER REFERENCES memberships(id);
ALTER TABLE organizations ADD COLUMN income_explanation_role_id INTEGER REFERENCES roles(id);
ALTER TABLE pockets ADD COLUMN owner_membership_id INTEGER REFERENCES memberships(id);
UPDATE pockets SET owner_membership_id=(SELECT m.id FROM organizations o JOIN memberships m ON m.id=o.creator_membership_id WHERE o.id=pockets.org_id AND m.removed_at IS NULL);

-- Legacy organization mappings become explicit mappings for each existing pocket.
ALTER TABLE actor_mappings RENAME TO actor_mappings_legacy;
CREATE TABLE actor_mappings (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 org_id INTEGER NOT NULL REFERENCES organizations(id),
 pocket_id INTEGER NOT NULL REFERENCES pockets(id),
 pattern TEXT NOT NULL CHECK(length(trim(pattern)) BETWEEN 1 AND 300),
 membership_id INTEGER NOT NULL REFERENCES memberships(id),
 created_by_membership_id INTEGER NOT NULL REFERENCES memberships(id),
 created_at INTEGER NOT NULL
);
INSERT INTO actor_mappings(org_id,pocket_id,pattern,membership_id,created_by_membership_id,created_at)
SELECT a.org_id,p.id,trim(a.pattern),a.membership_id,a.created_by_membership_id,a.created_at
FROM actor_mappings_legacy a JOIN pockets p ON p.org_id=a.org_id
WHERE length(trim(a.pattern))>0 AND NOT EXISTS(SELECT 1 FROM actor_mappings_legacy b WHERE b.org_id=a.org_id AND lower(trim(b.pattern))=lower(trim(a.pattern)) AND b.id<a.id);
DROP TABLE actor_mappings_legacy;
CREATE UNIQUE INDEX actor_mapping_pocket_label ON actor_mappings(pocket_id,lower(trim(pattern)));
CREATE TRIGGER pocket_owner_insert BEFORE INSERT ON pockets WHEN NEW.owner_membership_id IS NULL OR NOT EXISTS(SELECT 1 FROM memberships WHERE id=NEW.owner_membership_id AND org_id=NEW.org_id AND removed_at IS NULL) BEGIN SELECT RAISE(ABORT,'Pocket requires an active owner'); END;
CREATE TRIGGER pocket_owner_update BEFORE UPDATE OF owner_membership_id,org_id ON pockets WHEN NEW.owner_membership_id IS NULL OR NOT EXISTS(SELECT 1 FROM memberships WHERE id=NEW.owner_membership_id AND org_id=NEW.org_id AND removed_at IS NULL) BEGIN SELECT RAISE(ABORT,'Pocket requires an active owner'); END;
CREATE TRIGGER pocket_owner_deactivation BEFORE UPDATE OF removed_at ON memberships WHEN NEW.removed_at IS NOT NULL AND EXISTS(SELECT 1 FROM pockets WHERE owner_membership_id=OLD.id) BEGIN SELECT RAISE(ABORT,'Transfer pocket ownership before deactivation'); END;
CREATE TRIGGER mapping_member_update BEFORE UPDATE OF membership_id,pocket_id,org_id ON actor_mappings WHEN NOT EXISTS(SELECT 1 FROM memberships WHERE id=NEW.membership_id AND org_id=NEW.org_id AND removed_at IS NULL) OR NOT EXISTS(SELECT 1 FROM pockets WHERE id=NEW.pocket_id AND org_id=NEW.org_id) BEGIN SELECT RAISE(ABORT,'Mapping requires current pocket and active member'); END;
CREATE TRIGGER mapping_member_insert BEFORE INSERT ON actor_mappings WHEN NOT EXISTS(SELECT 1 FROM memberships WHERE id=NEW.membership_id AND org_id=NEW.org_id AND removed_at IS NULL) OR NOT EXISTS(SELECT 1 FROM pockets WHERE id=NEW.pocket_id AND org_id=NEW.org_id) BEGIN SELECT RAISE(ABORT,'Mapping requires current pocket and active member'); END;
