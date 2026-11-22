/**
 * Public API of the access module (docs/architecture/modules.md). Other modules' controllers protect their `:storeId` routes with
 * StoreAccessGuard + @RequirePermission, take the resolved access with @StoreAccess() and mark sensitive writes with @Audit.
 */
export { AccessService } from "./application/access.service.js";
export type { StoreAccessContext } from "./application/ports.js";
export { Audit, PERMISSION_KEY, RequirePermission, StoreAccess, StoreAccessGuard } from "./interface/store-access.js";
export { PrismaAuditRepository } from "./infrastructure/prisma-access.repository.js";
