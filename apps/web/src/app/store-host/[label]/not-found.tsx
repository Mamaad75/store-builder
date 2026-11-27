import { buildView } from "@/templates/engine/view";
import AnnouncementBar from "@/templates/common/AnnouncementBar";
import InfoLinks from "@/templates/common/InfoLinks";
import c from "@/templates/common/content.module.css";
import { formTarget } from "@store-builder/shared/templates/engine/listing";
import NeutralNotFound from "@/app/not-found"; // every other case: byte-for-byte the plain page of the rest of the application, saying nothing about the store
import { loadPublicStore, safeMediaUrl, storeHostLabel } from "./_public";

/**
 * "This page does not exist" on a store's own host, inside the store's own theme (header, menu, footer, colours), with a way back: the home page, the
 * products and a search. It is shown ONLY for a store that is live: every unavailable case (unknown host or label, never published, unpublished,
 * suspended, unsupported theme, invalid snapshot) keeps the same neutral 404 as before, so nothing reveals whether a store exists.
 */
export default async function StoreNotFound() {
  const label = await storeHostLabel();
  const store = label ? await loadPublicStore(label) : null;
  const view = store ? buildView(store.data, { basePath: "", segments: [], mediaUrl: safeMediaUrl }) : null;
  if (!store || !view || view.status !== "ok") return <NeutralNotFound />;
  const { Layout } = view.template;
  const ctx = { ...view.ctx, commerce: true };
  const search = formTarget(ctx, "/products");
  return (
    <>
      <title>{`صفحه پیدا نشد | ${store.data.store.name}`}</title>
      <AnnouncementBar ctx={ctx} />
      <Layout ctx={ctx}>
        <section className={`${c.wrap} ${c.scope}`} data-store-not-found="">
          <h1 className={c.title}>صفحه پیدا نشد</h1>
          <p className={c.p}>آدرسی که وارد کرده‌اید در این فروشگاه وجود ندارد یا جابه‌جا شده است. از یکی از راه‌های زیر ادامه دهید.</p>
          <p className={c.p}>
            <a href={ctx.href("/")} className={c.back}>بازگشت به صفحهٔ اصلی</a>
            {" · "}
            <a href={ctx.href("/products")} className={c.back}>مشاهدهٔ محصولات</a>
          </p>
          <form method="get" action={search.action} role="search" aria-label="جستجوی محصولات" className={c.form}>
            {search.hidden.map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
            <div className={c.field}>
              <label htmlFor="nf-q">جستجو در محصولات</label>
              <input id="nf-q" name="q" type="search" maxLength={60} autoComplete="off" className={c.textarea} />
            </div>
            <div><button type="submit" className={c.submit}>جستجو</button></div>
          </form>
        </section>
        <InfoLinks ctx={ctx} />
      </Layout>
    </>
  );
}
