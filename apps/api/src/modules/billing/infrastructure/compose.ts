import { randomBytes } from "node:crypto";
import { referralCodeFrom, REFERRAL_CODE_LENGTH } from "@store-builder/shared/modules/billing/billing";
import { StaffBillingService, StoreBillingService } from "../application/billing.service.js";
import { PrismaBillingRepository } from "./prisma-billing.repository.js";

const repo = () => new PrismaBillingRepository(() => referralCodeFrom(randomBytes(REFERRAL_CODE_LENGTH)));
export const createStoreBillingService = (): StoreBillingService => new StoreBillingService(repo());
export const createStaffBillingService = (): StaffBillingService => new StaffBillingService(repo());
