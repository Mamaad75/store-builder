-- Finance: subscription plans and purchases, the store wallet and its ledger, referral codes and referrals. EXPAND-only. Reversible: down.sql.
CREATE TYPE "WalletEntryKind" AS ENUM ('REFERRAL_REWARD', 'PURCHASE', 'ADMIN_ADJUST');
CREATE TYPE "ReferralStatus" AS ENUM ('PENDING', 'REWARDED');

CREATE TABLE "Plan" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "description" VARCHAR(300) NOT NULL DEFAULT '',
    "priceToman" INTEGER NOT NULL,
    "durationDays" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Plan_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Plan_price_range" CHECK ("priceToman" BETWEEN 0 AND 1000000000),
    CONSTRAINT "Plan_duration_range" CHECK ("durationDays" BETWEEN 1 AND 3660)
);

CREATE TABLE "StoreSubscription" (
    "storeId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "planName" VARCHAR(60) NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "StoreSubscription_pkey" PRIMARY KEY ("storeId"),
    CONSTRAINT "StoreSubscription_period_order" CHECK ("endsAt" > "startsAt")
);

CREATE TABLE "SubscriptionPurchase" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "planName" VARCHAR(60) NOT NULL,
    "priceToman" INTEGER NOT NULL,
    "discountToman" INTEGER NOT NULL,
    "walletUsedToman" INTEGER NOT NULL,
    "cashToman" INTEGER NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "note" VARCHAR(200) NOT NULL DEFAULT '',
    "recordedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SubscriptionPurchase_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SubscriptionPurchase_amounts" CHECK ("priceToman" >= 0 AND "discountToman" >= 0 AND "walletUsedToman" >= 0 AND "cashToman" >= 0 AND "priceToman" - "discountToman" = "walletUsedToman" + "cashToman")
);
CREATE INDEX "SubscriptionPurchase_storeId_createdAt_idx" ON "SubscriptionPurchase"("storeId", "createdAt");

CREATE TABLE "StoreWallet" (
    "storeId" TEXT NOT NULL,
    "balanceToman" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "StoreWallet_pkey" PRIMARY KEY ("storeId"),
    CONSTRAINT "StoreWallet_balance_range" CHECK ("balanceToman" BETWEEN 0 AND 2000000000)
);

CREATE TABLE "WalletEntry" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "amountToman" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "kind" "WalletEntryKind" NOT NULL,
    "note" VARCHAR(200) NOT NULL DEFAULT '',
    "refId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WalletEntry_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "WalletEntry_nonzero" CHECK ("amountToman" <> 0 AND "balanceAfter" >= 0)
);
CREATE INDEX "WalletEntry_storeId_createdAt_idx" ON "WalletEntry"("storeId", "createdAt");

CREATE TABLE "StoreReferralCode" (
    "storeId" TEXT NOT NULL,
    "code" VARCHAR(8) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StoreReferralCode_pkey" PRIMARY KEY ("storeId")
);
CREATE UNIQUE INDEX "StoreReferralCode_code_key" ON "StoreReferralCode"("code");

CREATE TABLE "Referral" (
    "id" TEXT NOT NULL,
    "referrerStoreId" TEXT NOT NULL,
    "referredStoreId" TEXT NOT NULL,
    "status" "ReferralStatus" NOT NULL DEFAULT 'PENDING',
    "rewardToman" INTEGER NOT NULL DEFAULT 0,
    "rewardedAt" TIMESTAMP(3),
    "purchaseId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Referral_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Referral_not_self" CHECK ("referrerStoreId" <> "referredStoreId"),
    CONSTRAINT "Referral_rewarded_has_date" CHECK ("status" <> 'REWARDED' OR "rewardedAt" IS NOT NULL),
    CONSTRAINT "Referral_reward_nonnegative" CHECK ("rewardToman" >= 0)
);
CREATE UNIQUE INDEX "Referral_referredStoreId_key" ON "Referral"("referredStoreId");
CREATE INDEX "Referral_referrerStoreId_createdAt_idx" ON "Referral"("referrerStoreId", "createdAt");

ALTER TABLE "StoreSubscription" ADD CONSTRAINT "StoreSubscription_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StoreSubscription" ADD CONSTRAINT "StoreSubscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SubscriptionPurchase" ADD CONSTRAINT "SubscriptionPurchase_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SubscriptionPurchase" ADD CONSTRAINT "SubscriptionPurchase_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StoreWallet" ADD CONSTRAINT "StoreWallet_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WalletEntry" ADD CONSTRAINT "WalletEntry_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "StoreWallet"("storeId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StoreReferralCode" ADD CONSTRAINT "StoreReferralCode_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_referrerStoreId_fkey" FOREIGN KEY ("referrerStoreId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_referredStoreId_fkey" FOREIGN KEY ("referredStoreId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
