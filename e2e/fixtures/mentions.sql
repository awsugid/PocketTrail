-- Local mention regression only; appended to isolated extra.sql by mentions.mjs.
UPDATE memberships SET handle = 'github:1234567890123456789012345678901234567890' WHERE org_id = 1 AND user_id = 'bob';
UPDATE organizations SET notifications_enabled = 1 WHERE id = 1;
INSERT INTO users (id, email, name, is_platform_admin, created_at) VALUES
  ('budi', 'budi@example.test', 'Budi Santoso', 0, 0),
  ('mochamad', 'mochamad@example.test', 'Mochamad Suhri Ardiansyah', 0, 0);
INSERT INTO memberships (id, org_id, user_id, role_id, handle, created_at) VALUES
  (801, 1, 'budi', 1, 'budi', 0),
  (802, 1, 'mochamad', 1, 'mochamad', 0);
