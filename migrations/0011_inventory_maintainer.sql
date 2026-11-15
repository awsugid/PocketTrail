-- Independent inventory access without granting access to financial records.
-- Preserve any organization-customized role already using this name.
INSERT INTO roles(org_id,name,permissions)
SELECT o.id,'Inventory Maintainer','["UpdateStock"]'
FROM organizations o
WHERE NOT EXISTS (
  SELECT 1 FROM roles r WHERE r.org_id=o.id AND lower(r.name)=lower('Inventory Maintainer')
);
