import type { Metadata } from "next";
import { notFound } from "next/navigation";
import InfoPagesEditor from "@/components/content/InfoPagesEditor";
import { getStore } from "@/gateway/stores";
import { requireUser } from "@/modules/auth/session";
import { NotFoundError } from "@store-builder/shared/modules/stores/errors";
import { templateSettingsSchema } from "@store-builder/shared/templates/sections";

export const metadata: Metadata = { title: "قوانین و اطلاعات" };

export default async function InfoPagesPage({ params }: { params: Promise<{ storeId: string }> }) {
  await requireUser();
  const { storeId } = await params;
  let store;
  try {
    store = await getStore(storeId);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const settings = templateSettingsSchema.parse(store.settings);
  return <InfoPagesEditor storeId={storeId} pages={settings.infoPages} announcement={settings.announcement} />;
}
