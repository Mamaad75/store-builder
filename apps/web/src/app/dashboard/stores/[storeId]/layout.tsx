import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import StoreShell from "@/components/admin/StoreShell";
import { mediaPublicUrl } from "@/lib/media-url";
import { publicStoreUrl } from "@/lib/store-url";
import { requireUser } from "@/modules/auth/session";
import { NotFoundError } from "@store-builder/shared/modules/stores/errors";
import { getStore } from "@/gateway/stores";
import { getSubdomainState } from "@/gateway/publishing";

/** The layout checks ownership too, but every page re-checks through the owner-scoped service. */
export default async function StoreLayout({ children, params }: { children: ReactNode; params: Promise<{ storeId: string }> }) {
  await requireUser();
  const { storeId } = await params;
  let store;
  try {
    store = await getStore(storeId);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  // The live address is only offered while the store is published.
  let liveUrl: string | null = null;
  if (store.status === "PUBLISHED") {
    const sub = await getSubdomainState(storeId).catch(() => null);
    if (sub?.current) liveUrl = publicStoreUrl(sub.current);
  }
  let logoUrl: string | null = null;
  try {
    logoUrl = store.logo ? mediaPublicUrl(store.logo.key) : null;
  } catch {
    logoUrl = null; // an unconfigured media URL must never break the admin
  }
  return (
    <StoreShell store={{ id: store.id, name: store.name, status: store.status, logoUrl }} liveUrl={liveUrl}>
      {children}
    </StoreShell>
  );
}
