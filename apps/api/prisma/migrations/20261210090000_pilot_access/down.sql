-- Reverse of migration.sql (MVP item 2). Run by hand only on rollback, after the backup step in docs/runbook.md. Outstanding invitation
-- codes and recovery links stop working; registration then follows the platform setting alone (set it to "open" before rolling back if
-- sign-up must stay possible). Afterwards delete this migration's row from "_prisma_migrations".
BEGIN;
DROP TABLE IF EXISTS "AccountRecovery";
DROP TABLE IF EXISTS "RegistrationInvite";
ALTER TABLE "User" DROP COLUMN IF EXISTS "recoveredAt";
DELETE FROM "PlatformSetting" WHERE "key" = 'registration';
ALTER TABLE "PlatformSetting" DROP CONSTRAINT "PlatformSetting_key_known";
ALTER TABLE "PlatformSetting" ADD CONSTRAINT "PlatformSetting_key_known" CHECK ("key" IN ('sms', 'payment', 'ai', 'rates'));
COMMIT;
