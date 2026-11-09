-- Import review staging. Parsed statements land here as previews ('ready' or
-- 'review') and only become transactions when a member with ImportStatements
-- confirms the batch.
-- Existing batches were direct imports, so they default to 'committed'.
ALTER TABLE import_batches ADD COLUMN status TEXT NOT NULL DEFAULT 'committed';

-- Staged payload of exactly the rows this batch inserts on confirmation, plus
-- the retained statement text and the parser warnings:
-- {"rows":[{"bank_id":...,"date":...,"time":...,"counterparty":...,
--   "transaction_type":...,"notes":...,"amount_minor":...,"balance_minor":...}],
--  "warnings":["..."],"statement_text":"..."}
-- payload.rows order matches the staged 'imported' import_items rows (matched
-- by bank_id, which is unique within a batch). Note: large statements make this
-- a large bound parameter; move to R2 if a statement payload approaches the
-- D1 request limit.
ALTER TABLE import_batches ADD COLUMN payload TEXT NOT NULL DEFAULT '';

-- Display totals snapshot (the batch pages read this, not a re-aggregation):
-- {"imported":n,"duplicate_unchanged":n,"conflict":n,"needs_review":n}
ALTER TABLE import_batches ADD COLUMN totals TEXT NOT NULL DEFAULT '{}';
