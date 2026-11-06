import { NotFoundError } from "@/modules/stores/errors";
import { parseStoreId } from "@/modules/stores/service";
import { buildStorefrontData, type StorefrontNotes } from "./build";
import { DraftStorefrontRepository } from "./repository";
import type { StorefrontData } from "@/templates/storefront-data";

export interface DraftPreview {
  data: StorefrontData;
  notes: StorefrontNotes;
}

/**
 * Owner-only draft preview data. `ownerId` must come from the server session. Missing and foreign
 * stores are indistinguishable (NotFoundError). Read-only: no write, no revision bump, no publish.
 */
export async function getDraftPreview(ownerId: string, storeId: unknown): Promise<DraftPreview> {
  const id = parseStoreId(storeId);
  const source = await new DraftStorefrontRepository(ownerId).load(id);
  if (!source) throw new NotFoundError();
  return buildStorefrontData(source);
}
