-- Preserve item/location identities and stock history instead of deleting rows.
ALTER TABLE inventory_items ADD COLUMN archived_at INTEGER;
ALTER TABLE inventory_locations ADD COLUMN archived_at INTEGER;
