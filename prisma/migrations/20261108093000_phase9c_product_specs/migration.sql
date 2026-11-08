-- Phase 9C: product specifications.
-- A constant default makes this a metadata-only change on PostgreSQL 11+: existing rows are NOT rewritten and read as
-- an empty list. The CHECK is a backstop (an array of at most 30 elements); element-level rules (labels/values, length,
-- uniqueness) are enforced by the application on write and re-checked on read, and stored values that fail those
-- checks are preserved, reported and never silently replaced.
ALTER TABLE "Product" ADD COLUMN "specs" JSONB NOT NULL DEFAULT '[]';

ALTER TABLE "Product"
  ADD CONSTRAINT "Product_specs_check"
  CHECK (jsonb_typeof("specs") = 'array' AND jsonb_array_length("specs") <= 30);
