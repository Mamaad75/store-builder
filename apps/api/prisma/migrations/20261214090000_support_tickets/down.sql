-- Reverse of migration.sql (support tickets). Run by hand only on rollback, after the backup step in docs/runbook.md: every ticket and
-- message is lost. Afterwards delete this migration's row from "_prisma_migrations".
BEGIN;
DROP TABLE IF EXISTS "SupportTicketMessage";
DROP TABLE IF EXISTS "SupportTicket";
DROP TYPE IF EXISTS "TicketMessageFrom";
DROP TYPE IF EXISTS "TicketStatus";
COMMIT;
