import { db } from "../../../lib/db.js";
import type { SetupReader } from "../application/setup.service.js";

/** MVP item 3: counts for the setup checklist. Every query is filtered by the caller's storeId. */
export class PrismaSetupReader implements SetupReader {
  async facts(storeId: string) {
    const [store, activeProducts, enabledShipping, codShipping, subdomains] = await Promise.all([
      db.store.findUnique({ where: { id: storeId }, select: { status: true } }),
      db.product.count({ where: { storeId, status: "ACTIVE" } }),
      db.shippingMethod.count({ where: { storeId, enabled: true } }),
      db.shippingMethod.count({ where: { storeId, enabled: true, codEnabled: true } }),
      db.domain.count({ where: { storeId, kind: "SUBDOMAIN" } }),
    ]);
    return { activeProducts, enabledShipping, codShipping, hasSubdomain: subdomains > 0, published: store?.status === "PUBLISHED" };
  }
}
