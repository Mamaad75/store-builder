import { buildSetupChecklist, type SetupChecklist, type SetupFacts } from "@store-builder/shared/modules/stores/setup";
import type { PaymentsService } from "./payments.service.js";
import type { TransfersService } from "./transfers.service.js";

/** What the checklist reads from the database, always for ONE store (the caller's, from the access guard). */
export interface SetupReader {
  facts(storeId: string): Promise<Pick<SetupFacts, "activeProducts" | "enabledShipping" | "codShipping" | "hasSubdomain" | "published">>;
}

/**
 * MVP item 3: is this store ready to take an order? Payment availability uses the SAME services checkout uses (gateway credential and
 * platform switch; bank cards), so the checklist cannot say "ready" when checkout would refuse.
 */
export class SetupService {
  constructor(
    private readonly reader: SetupReader,
    private readonly payments: Pick<PaymentsService, "available">,
    private readonly transfers: Pick<TransfersService, "available">,
  ) {}

  async checklist(a: { storeId: string }): Promise<SetupChecklist> {
    const [facts, gateways, hasBankCards] = await Promise.all([this.reader.facts(a.storeId), this.payments.available(a.storeId), this.transfers.available(a.storeId)]);
    return buildSetupChecklist({ ...facts, onlineGateways: gateways.length, hasBankCards });
  }
}
