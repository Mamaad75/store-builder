-- U1 (ADR 0001): sign-in by username instead of email. EXPAND step only: nothing is dropped and no existing value is changed.
--   * adds "User"."username" (lower-case a-z, 0-9 and "_", starting with a letter, 3-30 characters), unique;
--   * makes "User"."email" optional (new accounts have none); its unique index stays (several NULLs are allowed);
--   * "PasswordResetToken" is left in place, unused by the application. Dropping it and "email" is a separate CONTRACT migration
--     that needs the owner's explicit approval.
-- Reverse: see down.sql in this folder (not applied by Prisma). Locks: "User" is tiny; ADD COLUMN without default is metadata-only.

ALTER TABLE "User" ADD COLUMN "username" TEXT;

-- Existing accounts (development data only: nothing is deployed) get a deterministic, unique username derived from the e-mail's
-- local part plus 8 characters of the (unique) id, e.g. "ali_k3x9q2mw". They can sign in with it immediately.
UPDATE "User"
SET "username" = left(
      CASE WHEN regexp_replace(lower(split_part("email", '@', 1)), '[^a-z0-9_]', '', 'g') ~ '^[a-z]'
           THEN regexp_replace(lower(split_part("email", '@', 1)), '[^a-z0-9_]', '', 'g')
           ELSE 'u' || regexp_replace(lower(split_part("email", '@', 1)), '[^a-z0-9_]', '', 'g')
      END, 12) || '_' || lower(right("id", 8))
WHERE "username" IS NULL;

ALTER TABLE "User" ALTER COLUMN "username" SET NOT NULL;
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");
-- The database enforces the format too, so bypassing the application cannot store a username the application would reject.
ALTER TABLE "User" ADD CONSTRAINT "User_username_format" CHECK ("username" ~ '^[a-z][a-z0-9_]{2,29}$');

ALTER TABLE "User" ALTER COLUMN "email" DROP NOT NULL;
