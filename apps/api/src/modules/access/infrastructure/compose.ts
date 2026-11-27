import { storeLimitsNow } from "../../billing/billing.api.js";
import { AccessService } from "../application/access.service.js";
import { PrismaAccessRepository, PrismaAuditRepository } from "./prisma-access.repository.js";

/** Composition: the one place where the PostgreSQL implementations are handed to the access use cases. */
export function createAccessService(): AccessService {
  return new AccessService(new PrismaAccessRepository(), new PrismaAuditRepository(), undefined, async (storeId, now) => {
    const l = await storeLimitsNow(storeId, now);
    return { limit: l.maxStaff, free: l.free };
  });
}
