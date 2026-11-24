-- Reverse of migration.sql (phase 3.6). Run by hand only on rollback, after the backup step in docs/runbook.md. The SMS log and the stores'
-- SMS choices are lost (the next deploy starts with order SMS on for every store and empty monthly counts). Afterwards delete this
-- migration's row from "_prisma_migrations".
BEGIN;
DROP TABLE IF EXISTS "SmsMessage";
DROP TABLE IF EXISTS "StoreSmsSetting";
COMMIT;
