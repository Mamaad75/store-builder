import type { Metadata } from "next";
import { notFound } from "next/navigation";
import StorefrontRenderer from "@/templates/engine/StorefrontRenderer";
import { buildView } from "@/templates/engine/view";
import s from "../../preview.module.css";
import { loadPreview } from "../load";

// Per-request and never cached or indexed: this is private, owner-only draft content.
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "پیش‌نمایش پیش‌نویس", robots: { index: false, follow: false, nocache: true } };

type Params = { storeId: string; path?: string[] };

export default async function PreviewPage({ params, searchParams }: { params: Promise<Params>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { storeId, path = [] } = await params;
  const preview = await loadPreview(storeId); // authenticates (requireUser) and enforces ownership first
  const view = buildView(preview.data, { basePath: `/preview/${encodeURIComponent(storeId)}`, segments: path, searchParams: await searchParams });

  if (view.status === "not_found") notFound();
  if (view.status !== "ok") {
    return (
      <main className={s.screen} data-testid={`preview-${view.status}`}>
        <div>
          <h1>{view.status === "unsupported_template" ? "این قالب هنوز پیش‌نمایش ندارد" : "پیش‌نمایش در دسترس نیست"}</h1>
          <p>
            {view.status === "unsupported_template"
              ? "قالب این فروشگاه هنوز در دسترس نیست. اطلاعات فروشگاه شما سالم است و تغییری نکرده است."
              : "داده‌های فروشگاه با قالب سازگار نیست. اطلاعات شما تغییری نکرده است."}
          </p>
          <a href={`/dashboard/stores/${encodeURIComponent(storeId)}/products`}>بازگشت به داشبورد</a>
        </div>
      </main>
    );
  }
  return <StorefrontRenderer template={view.template} ctx={view.ctx} />;
}
