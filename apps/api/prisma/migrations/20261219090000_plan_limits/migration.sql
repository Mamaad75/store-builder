-- Plan limits: products and staff a plan allows. Existing plans keep today's global maxima (no plan is made stricter by this migration).
ALTER TABLE "Plan" ADD COLUMN "maxProducts" INTEGER NOT NULL DEFAULT 500;
ALTER TABLE "Plan" ADD COLUMN "maxStaff" INTEGER NOT NULL DEFAULT 20;
ALTER TABLE "Plan" ADD CONSTRAINT "Plan_maxProducts_check" CHECK ("maxProducts" BETWEEN 1 AND 500);
ALTER TABLE "Plan" ADD CONSTRAINT "Plan_maxStaff_check" CHECK ("maxStaff" BETWEEN 0 AND 20);
