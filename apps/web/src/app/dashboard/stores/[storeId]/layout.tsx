import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import StoreShell from "@/components/admin/StoreShell";
import { mediaPublicUrl } from "@/lib/media-url";
import { publicStoreUrl } from "@/lib/store-url";
import { requireUser } from "@/modules/auth/session";
import { NotFoundError } from "@store-builder/shared/modules/stores/errors";
import Alert from "@mui/material/Alert";
import AlertTitle from "@mui/material/AlertTitle";
import { getStore, getStoreAccess, getStoreSuspension } from "@/gateway/stores";
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
  // ADR 0003 (G2): a platform suspension is shown on every page of the store (public message only).
  const suspension = await getStoreSuspension(storeId).catch(() => null);
  // What this person may do here (an owner, a manager or an operator): the menu shows only the pages their role can use.
  const access = await getStoreAccess(storeId).catch(() => null);
  // The live address is only offered while the store is published (and not suspended).
  let liveUrl: string | null = null;
  if (store.status === "PUBLISHED" && !suspension?.suspended) {
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
    <StoreShell store={{ id: store.id, name: store.name, status: store.status, logoUrl }} liveUrl={liveUrl} permissions={access?.permissions ?? null}>
      {suspension?.suspended && (
        <Alert severity="error" role="alert" sx={{ mb: 3 }}>
          <AlertTitle>این فروشگاه توسط پلتفرم معلق شده است</AlertTitle>
          {suspension.publicMessage && <p style={{ margin: "0 0 8px" }}>{suspension.publicMessage}</p>}
          فروشگاه برای خریداران در دسترس نیست و تغییر تنظیمات، محصولات و انتشار تا رفع تعلیق ممکن نیست. سفارش‌های موجود را همچنان می‌توانید
          ببینید و پیگیری کنید. برای پیگیری با پشتیبانی پلتفرم تماس بگیرید.
        </Alert>
      )}
      {children}
    </StoreShell>
  );
}
