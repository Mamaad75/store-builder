import { cache } from "react";
import { notFound } from "next/navigation";
import { requireUser } from "@/modules/auth/session";
import { NotFoundError } from "@/modules/stores/errors";
import { getDraftPreview } from "@/modules/storefront/service";

/**
 * Authenticates on the server and loads the owner's draft storefront. Used by the layout (so a
 * missing/foreign store is a real 404 before any streaming starts) and by the page; `cache` makes
 * both share one query per request. The owner id comes from the session, never from the URL.
 */
export const loadPreview = cache(async (storeId: string) => {
  const user = await requireUser();
  try {
    return await getDraftPreview(user.id, storeId); // ownership enforced in SQL: missing and foreign are both 404
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
});
