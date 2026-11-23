-- Phase 3.3b: password sign-in for shoppers and guest orders attached to the customer with the same phone. EXPAND-only: two columns.
-- Reversible: down.sql.

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "passwordHash" TEXT;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "linkedByPhone" BOOLEAN NOT NULL DEFAULT false;


-- Only Argon2id hashes (the application writes nothing else).
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_passwordHash_argon2id" CHECK ("passwordHash" IS NULL OR "passwordHash" LIKE '$argon2id$%');
