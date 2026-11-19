import { cardSpecs, detailSpecs, type SpecRow } from "@/lib/product-specs";

/** Class names a theme supplies from its own CSS module (the engine owns no styles). */
export interface SpecClasses {
  wrap: string | undefined;
  title: string | undefined;
  list: string | undefined;
  row: string | undefined;
  term: string | undefined;
  def: string | undefined;
}

/**
 * ALL specification rows of a product, for the product detail page. Labels and values are rendered as plain React text
 * (escaped); nothing is ever interpreted as markup. No rows => nothing at all (never an empty block).
 */
export function ProductSpecs({ specs, classes }: { specs: readonly SpecRow[] | undefined; classes: SpecClasses }) {
  const rows = detailSpecs(specs);
  if (rows.length === 0) return null;
  return (
    <section className={classes.wrap} aria-label="مشخصات فنی" data-testid="product-specs">
      <h2 className={classes.title}>مشخصات فنی</h2>
      <dl className={classes.list}>
        {rows.map((r, i) => (
          <div key={i} className={classes.row}>
            <dt className={classes.term}>{r.label}</dt>
            <dd className={classes.def}>{r.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** At most the first two rows, for product listing cards. No rows => nothing. */
export function CardSpecs({ specs, classes }: { specs: readonly SpecRow[] | undefined; classes: Pick<SpecClasses, "list" | "row" | "term" | "def"> }) {
  const rows = cardSpecs(specs);
  if (rows.length === 0) return null;
  return (
    <dl className={classes.list} data-testid="card-specs">
      {rows.map((r, i) => (
        <div key={i} className={classes.row}>
          <dt className={classes.term}>{r.label}</dt>
          <dd className={classes.def}>{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}
