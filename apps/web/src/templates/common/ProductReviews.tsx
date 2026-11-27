"use client";

import { useEffect, useState, type FormEvent } from "react";
import { REVIEW_BODY_MAX } from "@store-builder/shared/modules/reviews/limits";
import c from "./content.module.css";
import { me, problemText, productReviews, submitReview, type ShopReviews } from "@/client/shop";

const fa = (n: number) => n.toLocaleString("fa-IR");
const faAvg = (n: number) => n.toLocaleString("fa-IR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const sr = { position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap" } as const;

function Stars({ rating }: { rating: number }) {
  return (
    <span>
      <span aria-hidden="true" className={c.stars}>{"★".repeat(rating)}{"☆".repeat(5 - rating)}</span>
      <span style={sr}>امتیاز {fa(rating)} از {fa(5)}</span>
    </span>
  );
}

/**
 * Buyers' reviews under a product on a LIVE store: the approved ones with the average, and a form for a signed-in customer of this store
 * (a new review waits for the merchant's approval). Fetched in the browser from this store's own host, so it is always current and never part
 * of the published snapshot. Any failure hides the section: it must never break the product page. Drawn with the theme's own tokens (content.module.css).
 */
export default function ProductReviews({ slug }: { slug: string }) {
  const [data, setData] = useState<ShopReviews | null | "failed">(null);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [rating, setRating] = useState(0);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    let live = true;
    productReviews(slug).then((d) => live && setData(d)).catch(() => live && setData("failed"));
    me().then((u) => live && setSignedIn(u !== null));
    return () => {
      live = false;
    };
  }, [slug]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await submitReview(slug, rating, text);
      setSent(true);
      setText("");
      setRating(0);
    } catch (err) {
      setError(problemText(err));
    } finally {
      setBusy(false);
    }
  }

  if (data === "failed" || data === null) return null;
  const next = encodeURIComponent(`/products/${encodeURIComponent(slug)}`);
  const disabled = busy || rating === 0 || text.trim().length === 0;
  return (
    <section aria-labelledby="reviews-h" data-reviews="" className={`${c.reviews} ${c.scope}`}>
      <h2 id="reviews-h">نظرات خریداران</h2>
      <p className={c.muted} data-testid="reviews-summary">
        {data.summary.count === 0 ? "هنوز نظری ثبت نشده است." : `میانگین امتیاز ${faAvg(data.summary.average ?? 0)} از ${fa(5)} (${fa(data.summary.count)} نظر)`}
      </p>
      {data.reviews.length > 0 && (
        <ol aria-label="نظرها" className={c.stack} style={{ marginBottom: 24 }}>
          {data.reviews.map((r) => (
            <li key={r.id} className={c.card} data-testid="shop-review">
              <div className={c.reviewHead}>
                <strong>{r.authorName}</strong>
                <Stars rating={r.rating} />
                <small>{new Date(r.createdAt).toLocaleDateString("fa-IR", { dateStyle: "medium" })}</small>
              </div>
              <p className={c.p} style={{ margin: "8px 0 0", whiteSpace: "pre-wrap" }}>{r.body}</p>
              {r.reply && (
                <p className={c.reply}>
                  <strong>پاسخ فروشگاه: </strong>{r.reply}
                </p>
              )}
            </li>
          ))}
        </ol>
      )}

      {signedIn === false && (
        <p style={{ margin: 0 }}>
          برای ثبت نظر <a href={`/account?next=${next}`} style={{ color: "inherit", textDecoration: "underline" }}>وارد حساب خود شوید</a>.
        </p>
      )}
      {signedIn && (sent ? (
        <p role="status" className={c.card} style={{ margin: 0 }}>نظر شما ثبت شد و پس از تأیید فروشگاه نمایش داده می‌شود.</p>
      ) : (
        <form onSubmit={submit} noValidate className={`${c.card} ${c.form}`}>
          <h3>نظر شما</h3>
          <fieldset className={c.fieldset}>
            <legend className={c.legend}>امتیاز</legend>
            <div className={c.ratings}>
              {[1, 2, 3, 4, 5].map((n) => (
                <label key={n} className={c.rating} data-on={rating === n}>
                  <input type="radio" name="rating" value={n} checked={rating === n} onChange={() => setRating(n)} />
                  {fa(n)}
                </label>
              ))}
            </div>
          </fieldset>
          <div className={c.field}>
            <label htmlFor="review-body">متن نظر</label>
            <textarea id="review-body" value={text} onChange={(e) => setText(e.target.value)} rows={4} maxLength={REVIEW_BODY_MAX} className={c.textarea} />
          </div>
          {error && <p role="alert" className={c.alert}>{error}</p>}
          <div>
            <button type="submit" disabled={disabled} className={c.submit}>{busy ? "در حال ارسال…" : "ثبت نظر"}</button>
          </div>
        </form>
      ))}
    </section>
  );
}
