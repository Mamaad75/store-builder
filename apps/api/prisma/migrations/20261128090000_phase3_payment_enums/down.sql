-- Reverse of migration.sql (phase 3.5 part 1). PostgreSQL cannot drop an enum value; the values stay (harmless once part 2 is reversed and
-- no order uses them). Before reversing, make sure no order is AWAITING_PAYMENT, EXPIRED or paid ONLINE (see part 2's down.sql), then delete
-- this migration's row from "_prisma_migrations".
SELECT 1;
