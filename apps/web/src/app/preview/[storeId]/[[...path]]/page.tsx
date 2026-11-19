import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { mediaPublicUrl } from "@/lib/storage";
import StorefrontRenderer from "@/templates/engine/StorefrontRenderer";
import { buildView } from "@/templates/engine/view";
import s from "../../preview.module.css";
import CandidateBanner from "../../CandidateBanner";
import { loadCandidatePreview, loadPreview } from "../load";

// Per-request and never cached or indexed: this is private, owner-only draft content.
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "پیش‌نمایش پیش‌نویس", robots: { index: false, follow: false, nocache: true } };

/** An unconfigured/invalid storage URL must never break the preview: images fall back to placeholders. */
function safeMediaUrl(key: string): string | null {
  try {
    return mediaPublicUrl(key);
  } catch {
    return null;
  }
}

type Params = { storeId: string; path?: string[] };

export default async function PreviewPage({ params, searchParams }: { params: Promise<Params>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { storeId, path = [] } = await params;
  const sp = await searchParams;
  // `?theme=<key>` previews another theme with this store's draft data. It is validated here AND in the service; a
  // repeated or malformed value is treated as "unavailable", never as the store's own theme.
  const rawTheme = sp.theme;
  const themeKey = typeof rawTheme === "string" && /^[a-z][a-z0-9-]{0,39}$/.test(rawTheme) ? rawTheme : null;
  const wantsCandidate = rawTheme !== undefined;
  if (wantsCandidate && !themeKey) return <CandidateBanner storeId={storeId} unavailable />;
  const preview = themeKey ? await loadCandidatePreview(storeId, themeKey) : await loadPreview(storeId); // authenticates (requireUser) and enforces ownership first
  if (!preview) return <CandidateBanner storeId={storeId} unavailable />;
  const view = buildView(preview.data, {
    basePath: `/preview/${encodeURIComponent(storeId)}`,
    segments: path,
    searchParams: sp,
    mediaUrl: safeMediaUrl,
    ...(themeKey ? { carryQuery: `theme=${themeKey}` } : {}),
  });

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
  return (
    <>
      {preview.candidate && <CandidateBanner storeId={storeId} candidate={preview.candidate} dormantCount={preview.notes.dormantSectionCount} />}
      <StorefrontRenderer template={view.template} ctx={view.ctx} />
    </>
  );
}
