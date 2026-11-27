import { formTarget } from "@store-builder/shared/templates/engine/listing";
import type { RenderContext } from "../types";
import c from "./content.module.css";

/**
 * A price range (Toman) and an "in stock only" switch above a product listing, for every theme. A plain GET form: it works without JavaScript, the
 * address carries the filter (shareable, back button), and what the shopper already chose (search, category, sort) is kept as hidden fields.
 * Changing a filter starts again at page one.
 */
export default function ListFilters({ ctx }: { ctx: RenderContext }) {
  if (ctx.page.type !== "PRODUCTS" || ctx.data.products.length < 2) return null;
  const { action, hidden } = formTarget(ctx, "/products");
  const { q, category, sort, min, max, available } = ctx.query;
  const active = min !== undefined || max !== undefined || available === true;
  const clear = (() => {
    const p = new URLSearchParams(hidden);
    if (q) p.set("q", q);
    if (category) p.set("category", category);
    if (sort) p.set("sort", sort);
    const s = p.toString();
    return action + (s ? `?${s}` : "");
  })();
  return (
    <div className={`${c.filters} ${c.scope}`} data-list-filters="">
      <form method="get" action={action} role="search" aria-label="فیلتر قیمت و موجودی" className={c.filterBox}>
        {hidden.map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
        {q && <input type="hidden" name="q" value={q} />}
        {category && <input type="hidden" name="category" value={category} />}
        {sort && <input type="hidden" name="sort" value={sort} />}
        <div className={c.field}>
          <label htmlFor="flt-min">حداقل قیمت (تومان)</label>
          <input id="flt-min" name="min" type="text" inputMode="numeric" autoComplete="off" maxLength={14} defaultValue={min ?? ""} dir="ltr" />
        </div>
        <div className={c.field}>
          <label htmlFor="flt-max">حداکثر قیمت (تومان)</label>
          <input id="flt-max" name="max" type="text" inputMode="numeric" autoComplete="off" maxLength={14} defaultValue={max ?? ""} dir="ltr" />
        </div>
        <label className={c.check}>
          <input type="checkbox" name="available" value="1" defaultChecked={available === true} />
          فقط کالاهای موجود
        </label>
        <button type="submit" className={c.submit}>اعمال فیلتر</button>
        {active && <a href={clear} className={c.clear}>حذف فیلتر</a>}
      </form>
    </div>
  );
}
