import type { ReactNode } from "react";
import PreviewBanner from "../PreviewBanner";
import { loadPreview } from "./load";

export default async function PreviewLayout({ children, params }: { children: ReactNode; params: Promise<{ storeId: string }> }) {
  const { storeId } = await params;
  const preview = await loadPreview(storeId); // 404s here for missing/foreign stores, before anything streams
  return (
    <>
      <PreviewBanner storeId={storeId} notes={preview.notes} />
      {children}
    </>
  );
}
