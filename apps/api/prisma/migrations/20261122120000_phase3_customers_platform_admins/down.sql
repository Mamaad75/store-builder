-- Reverse of migration.sql (phase 3.1). NOT applied by Prisma; run by hand only if the release is rolled back, after the backup step in
-- docs/runbook.md. Every customer account, pending sign-in code, platform role, platform setting and platform secret is lost (super admins
-- must be granted again with pnpm platform:admin; keys entered again). Afterwards delete this migration's row from "_prisma_migrations".
BEGIN;
DROP TABLE "PlatformSecret";
DROP TABLE "PlatformSetting";
DROP TABLE "OtpChallenge";
DROP TABLE "Customer";
DROP TABLE "PlatformAdmin";
DROP TYPE "PlatformRole";
COMMIT;
