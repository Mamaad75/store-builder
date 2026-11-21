-- Reverse of migration.sql (phase 2.3). NOT applied by Prisma; run by hand only if the release is rolled back, after the backup step in
-- docs/runbook.md. Staff memberships, pending invitations and the audit log are lost with the tables (owners keep their stores:
-- ownership is Store.ownerId and is untouched). Afterwards delete this migration's row from "_prisma_migrations".
BEGIN;
DROP TABLE "AuditEvent";
DROP TABLE "StoreInvitation";
DROP TABLE "StoreMember";
DROP TYPE "StoreRole";
COMMIT;
