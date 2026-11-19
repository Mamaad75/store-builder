-- Phase 10: publishing, immutable versions, slug history and subdomain reservations.
--
-- 1. PRE-FLIGHT (fails loudly, never guesses): the application never created PUBLISHED stores, subdomains or version rows
--    before this phase, so every real database is consistent. If a row violates an invariant that this migration is about
--    to enforce, abort with the counts instead of rewriting user data.
DO $$
DECLARE
  n_status int;
  n_number int;
  n_dup    int;
  n_host   int;
BEGIN
  SELECT count(*) INTO n_status FROM "Store" WHERE ("status" = 'PUBLISHED') <> ("publishedVersionId" IS NOT NULL);
  SELECT count(*) INTO n_number FROM "StoreVersion" WHERE "number" < 1;
  SELECT count(*) INTO n_dup FROM (SELECT "storeId" FROM "Domain" WHERE "kind" = 'SUBDOMAIN' GROUP BY "storeId" HAVING count(*) > 1) d;
  SELECT count(*) INTO n_host FROM "Domain"
    WHERE "kind" = 'SUBDOMAIN'
      AND ("host" <> lower("host") OR "host" !~ '^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$');
  IF n_status > 0 OR n_number > 0 OR n_dup > 0 OR n_host > 0 THEN
    RAISE EXCEPTION 'Phase 10 migration aborted: inconsistent existing data (stores whose status and published pointer disagree: %, versions numbered below 1: %, stores with more than one subdomain: %, malformed subdomain rows: %). Nothing was changed. Repair these rows (see docs/publishing.md) and run the migration again.',
      n_status, n_number, n_dup, n_host;
  END IF;
END $$;

-- 2. StoreVersion: integrity metadata (hash and size of the canonical snapshot text) and sanity checks.
ALTER TABLE "StoreVersion" ADD COLUMN "contentHash" TEXT NOT NULL DEFAULT '';
ALTER TABLE "StoreVersion" ADD COLUMN "snapshotBytes" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "StoreVersion" ADD CONSTRAINT "StoreVersion_number_check" CHECK ("number" >= 1);
ALTER TABLE "StoreVersion" ADD CONSTRAINT "StoreVersion_snapshotBytes_check" CHECK ("snapshotBytes" >= 0 AND "snapshotBytes" <= 20971520);

-- 3. (Store_published_consistency from the init migration already enforces: PUBLISHED if and only if a live version is set.)

-- 4. Which slug does each product have in each version (immutable; lets the public side resolve redirects with index lookups).
CREATE TABLE "StoreVersionProduct" (
    "versionId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    CONSTRAINT "StoreVersionProduct_pkey" PRIMARY KEY ("versionId", "productId")
);
CREATE UNIQUE INDEX "StoreVersionProduct_versionId_slug_key" ON "StoreVersionProduct"("versionId", "slug");
ALTER TABLE "StoreVersionProduct" ADD CONSTRAINT "StoreVersionProduct_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "StoreVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 5. Every slug a product has ever been published under. Append-only; productId has NO foreign key, so the reservation
--    survives the deletion of the product (it only goes away with the whole store).
CREATE TABLE "PublishedSlug" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PublishedSlug_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PublishedSlug_storeId_slug_key" ON "PublishedSlug"("storeId", "slug");
CREATE INDEX "PublishedSlug_storeId_productId_idx" ON "PublishedSlug"("storeId", "productId");
ALTER TABLE "PublishedSlug" ADD CONSTRAINT "PublishedSlug_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 6. Subdomain reservations: independent of Store and Domain (NO foreign keys), so neither a store deletion nor a domain
--    cascade can remove them. `cause` is informational; no rule reads it.
CREATE TABLE "SubdomainReservation" (
    "host" TEXT NOT NULL,
    "previousStoreId" TEXT NOT NULL,
    "cause" TEXT NOT NULL,
    "releasedAt" TIMESTAMPTZ(6) NOT NULL,
    "reservedUntil" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "SubdomainReservation_pkey" PRIMARY KEY ("host"),
    CONSTRAINT "SubdomainReservation_cause_check" CHECK ("cause" IN ('RELEASED', 'STORE_DELETED')),
    CONSTRAINT "SubdomainReservation_window_check" CHECK ("reservedUntil" > "releasedAt"),
    CONSTRAINT "SubdomainReservation_host_check" CHECK ("host" ~ '^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$')
);
CREATE INDEX "SubdomainReservation_previousStoreId_idx" ON "SubdomainReservation"("previousStoreId");

-- 7. Domain: subdomains are lowercase platform labels.
ALTER TABLE "Domain" ADD CONSTRAINT "Domain_subdomain_check" CHECK (
  "kind" <> 'SUBDOMAIN' OR ("host" = lower("host") AND "host" ~ '^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$')
);
-- (one subdomain per store is already enforced by the partial unique index "Domain_one_subdomain_per_store" from the init migration)

-- 8. Immutability. UPDATE is refused on every published-data table (even a no-op); a DIRECT delete is refused too
--    (versions are never pruned in this phase), while deletes that come from the store's own cascade (trigger depth > 1) pass.
CREATE FUNCTION sb_immutable_row() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% rows are immutable', TG_TABLE_NAME USING ERRCODE = 'P0001';
END $$;

CREATE FUNCTION sb_no_direct_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF pg_trigger_depth() = 1 THEN
    RAISE EXCEPTION 'direct deletion of % rows is not allowed', TG_TABLE_NAME USING ERRCODE = 'P0001';
  END IF;
  RETURN OLD;
END $$;

CREATE TRIGGER "StoreVersion_immutable" BEFORE UPDATE ON "StoreVersion" FOR EACH ROW EXECUTE FUNCTION sb_immutable_row();
CREATE TRIGGER "StoreVersion_no_direct_delete" BEFORE DELETE ON "StoreVersion" FOR EACH ROW EXECUTE FUNCTION sb_no_direct_delete();
CREATE TRIGGER "StoreVersionProduct_immutable" BEFORE UPDATE ON "StoreVersionProduct" FOR EACH ROW EXECUTE FUNCTION sb_immutable_row();
CREATE TRIGGER "StoreVersionProduct_no_direct_delete" BEFORE DELETE ON "StoreVersionProduct" FOR EACH ROW EXECUTE FUNCTION sb_no_direct_delete();
CREATE TRIGGER "PublishedSlug_immutable" BEFORE UPDATE ON "PublishedSlug" FOR EACH ROW EXECUTE FUNCTION sb_immutable_row();
CREATE TRIGGER "PublishedSlug_no_direct_delete" BEFORE DELETE ON "PublishedSlug" FOR EACH ROW EXECUTE FUNCTION sb_no_direct_delete();

-- 9. Reserved-slug limits (checked per INSERT statement, i.e. inside the publish transaction, before anything is visible):
--    at most 10,000 reserved slugs per store and 6 per product (the current slug plus 5 historical ones).
CREATE FUNCTION sb_published_slug_limits() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  bad_store   text;
  bad_product text;
BEGIN
  SELECT s."storeId" INTO bad_store FROM (SELECT DISTINCT "storeId" FROM new_rows) s
    WHERE (SELECT count(*) FROM "PublishedSlug" p WHERE p."storeId" = s."storeId") > 10000 LIMIT 1;
  IF bad_store IS NOT NULL THEN
    RAISE EXCEPTION 'RESERVED_SLUG_LIMIT: store % would hold more than 10000 reserved slugs', bad_store USING ERRCODE = 'P0001';
  END IF;
  SELECT s."productId" INTO bad_product FROM (SELECT DISTINCT "storeId", "productId" FROM new_rows) s
    WHERE (SELECT count(*) FROM "PublishedSlug" p WHERE p."storeId" = s."storeId" AND p."productId" = s."productId") > 6 LIMIT 1;
  IF bad_product IS NOT NULL THEN
    RAISE EXCEPTION 'PRODUCT_SLUG_LIMIT: product % would have more than 6 published slugs', bad_product USING ERRCODE = 'P0001';
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER "PublishedSlug_limits" AFTER INSERT ON "PublishedSlug" REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION sb_published_slug_limits();

-- 10. Subdomain protection. Every path that creates, changes or removes a SUBDOMAIN row goes through these triggers,
--     whatever the caller (application, raw SQL, ON CONFLICT DO UPDATE, or a store-deletion cascade).
CREATE FUNCTION sb_domain_before_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  r "SubdomainReservation"%ROWTYPE;
BEGIN
  IF NEW."kind" <> 'SUBDOMAIN' THEN RETURN NEW; END IF;
  -- Serialises this claim against a concurrent release/deletion of the same host (the other side locks in its own trigger).
  PERFORM pg_advisory_xact_lock(hashtextextended('subdomain:' || NEW."host", 0));
  SELECT * INTO r FROM "SubdomainReservation" WHERE "host" = NEW."host";
  IF FOUND THEN
    IF r."reservedUntil" <= now() THEN
      DELETE FROM "SubdomainReservation" WHERE "host" = NEW."host";            -- the window is over: the label is free
    ELSIF r."previousStoreId" = NEW."storeId" THEN
      DELETE FROM "SubdomainReservation" WHERE "host" = NEW."host";            -- the same store takes its own label back
    ELSE
      RAISE EXCEPTION 'SUBDOMAIN_RESERVED' USING ERRCODE = 'P0001', DETAIL = to_char(r."reservedUntil" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION sb_domain_before_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."storeId" IS DISTINCT FROM OLD."storeId"
     OR NEW."kind" IS DISTINCT FROM OLD."kind" OR NEW."host" IS DISTINCT FROM OLD."host" THEN
    RAISE EXCEPTION 'DOMAIN_IDENTITY_IMMUTABLE: release the domain and claim again' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION sb_domain_before_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."kind" = 'SUBDOMAIN' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('subdomain:' || OLD."host", 0));
  END IF;
  RETURN OLD;
END $$;

CREATE FUNCTION sb_domain_after_delete() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  t timestamptz := clock_timestamp();
BEGIN
  IF OLD."kind" = 'SUBDOMAIN' THEN
    INSERT INTO "SubdomainReservation" ("host", "previousStoreId", "cause", "releasedAt", "reservedUntil")
    VALUES (OLD."host", OLD."storeId",
            CASE WHEN EXISTS (SELECT 1 FROM "Store" WHERE "id" = OLD."storeId") THEN 'RELEASED' ELSE 'STORE_DELETED' END,
            t, t + interval '30 days')
    ON CONFLICT ("host") DO UPDATE SET "previousStoreId" = EXCLUDED."previousStoreId", "cause" = EXCLUDED."cause",
      "releasedAt" = EXCLUDED."releasedAt", "reservedUntil" = EXCLUDED."reservedUntil";
  END IF;
  RETURN NULL;
END $$;

CREATE TRIGGER "Domain_reservation_before_insert" BEFORE INSERT ON "Domain" FOR EACH ROW EXECUTE FUNCTION sb_domain_before_insert();
CREATE TRIGGER "Domain_identity_immutable" BEFORE UPDATE ON "Domain" FOR EACH ROW EXECUTE FUNCTION sb_domain_before_update();
CREATE TRIGGER "Domain_lock_before_delete" BEFORE DELETE ON "Domain" FOR EACH ROW EXECUTE FUNCTION sb_domain_before_delete();
CREATE TRIGGER "Domain_tombstone_after_delete" AFTER DELETE ON "Domain" FOR EACH ROW EXECUTE FUNCTION sb_domain_after_delete();
