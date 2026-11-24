-- D35c-1: several online gateways (Zarinpal, Aghaye Pardakht). EXPAND-only. Reversible: down.sql.

-- The gateway an ONLINE order is paid through (orders of phase 3.5 were all Zarinpal).
ALTER TABLE "Order" ADD COLUMN "paymentGateway" VARCHAR(20);
UPDATE "Order" SET "paymentGateway" = 'ZARINPAL' WHERE "paymentMethod" = 'ONLINE' AND "paymentGateway" IS NULL;
-- Only ONLINE orders have a gateway. An ONLINE order WITHOUT one is still accepted (read as Zarinpal): the previous release inserts such
-- orders until it is replaced, so this step stays expand-only during a deploy (review D35c-1).
ALTER TABLE "Order"
  ADD CONSTRAINT "Order_gateway_online_only" CHECK ("paymentGateway" IS NULL OR "paymentMethod" = 'ONLINE'),
  ADD CONSTRAINT "Order_gateway_known" CHECK ("paymentGateway" IS NULL OR "paymentGateway" IN ('ZARINPAL', 'AQAYEPARDAKHT'));

-- Payment attempts of either gateway: each with its own session-id shape; Aghaye Pardakht takes up to 400,000,000 toman (rial stored).
ALTER TABLE "Payment"
  DROP CONSTRAINT "Payment_authority_shape",
  DROP CONSTRAINT "Payment_provider_known",
  DROP CONSTRAINT "Payment_amount_range";
ALTER TABLE "Payment"
  ADD CONSTRAINT "Payment_provider_known" CHECK ("provider" IN ('ZARINPAL', 'AQAYEPARDAKHT')),
  ADD CONSTRAINT "Payment_authority_shape" CHECK (
    ("provider" = 'ZARINPAL' AND "authority" ~ '^[AS][0-9A-Za-z]{35}$')
    OR ("provider" = 'AQAYEPARDAKHT' AND "authority" ~ '^[0-9A-Za-z]{6,40}$')
  ),
  ADD CONSTRAINT "Payment_amount_range" CHECK (
    ("provider" = 'ZARINPAL' AND "amountRial" BETWEEN 1000 AND 1000000000)
    OR ("provider" = 'AQAYEPARDAKHT' AND "amountRial" BETWEEN 10000 AND 4000000000)
  );
