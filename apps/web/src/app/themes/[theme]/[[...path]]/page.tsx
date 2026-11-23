import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { assertPlatformHost } from "@/lib/host-guard";
import StorefrontRenderer from "@/templates/engine/StorefrontRenderer";
import { buildView } from "@/templates/engine/view";
import { loadThemeDemo } from "../../demo";
import s from "../../demo.module.css";

export const metadata: Metadata = { title: "پیش‌نمایش قالب", robots: { index: false, follow: false } };

export default async function ThemeDemoPage({ params, searchParams }: {
  params: Promise<{ theme: string; path?: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await assertPlatformHost();
  const { theme, path = [] } = await params;
  const demo = loadThemeDemo(theme);
  if (!demo) notFound();
  const view = buildView(demo.data, {
    basePath: `/themes/${theme}`,
    segments: path,
    searchParams: await searchParams,
    mediaUrl: demo.mediaUrl,
  });
  if (view.status !== "ok") notFound();
  return (
    <>
      <aside className={s.bar} aria-label="پیش‌نمایش قالب">
        <span>پیش‌نمایش قالب <strong>{demo.definition.name}</strong> · داده‌های نمونه</span>
        <a href={`/dashboard/stores/new?theme=${theme}`}>ساخت فروشگاه با این قالب</a>
      </aside>
      <StorefrontRenderer template={view.template} ctx={view.ctx} />
    </>
  );
}
