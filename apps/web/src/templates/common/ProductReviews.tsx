"use client";

import { useEffect, useState, type CSSProperties, type FormEvent } from "react";
import { REVIEW_BODY_MAX } from "@store-builder/shared/modules/reviews/reviews";
import { me, problemText, productReviews, submitReview, type ShopReviews } from "@/client/shop";

const fa = (n: number) => n.toLocaleString("fa-IR");
const faAvg = (n: number) => n.toLocaleString("fa-IR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const edge = "1px solid rgba(128,128,128,.45)";
const box: CSSProperties = { border: edge, borderRadius: 10, padding: "12px 14px", background: "transparent" };

function Stars({ rating }: { rating: number }) {
  return (
    <span>
      <span aria-hidden="true" style={{ letterSpacing: 2 }}>{"★".repeat(rating)}{"☆".repeat(5 - rating)}</span>
      <span style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap" }}>امتیاز {fa(rating)} از {fa(5)}</span>
    </span>
  );
}

/**
 * Buyers' reviews under a product on a LIVE store: the approved ones with the average, and a form for a signed-in customer of this store
 * (a new review waits for the merchant's approval). Fetched in the browser from this store's own host, so it is always current and never part
 * of the published snapshot. Any failure hides the section: it must never break the product page. Plain HTML, inheriting the theme's colours.
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
    me().then((c) => live && setSignedIn(c !== null));
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
  return (
    <section aria-labelledby="reviews-h" data-reviews="" style={{ maxWidth: 960, margin: "32px auto", padding: "0 16px" }}>
      <h2 id="reviews-h" style={{ margin: "0 0 4px" }}>نظرات خریداران</h2>
      <p style={{ margin: "0 0 16px" }} data-testid="reviews-summary">
        {data.summary.count === 0 ? "هنوز نظری ثبت نشده است." : `میانگین امتیاز ${faAvg(data.summary.average ?? 0)} از ${fa(5)} (${fa(data.summary.count)} نظر)`}
      </p>
      {data.reviews.length > 0 && (
        <ol aria-label="نظرها" style={{ listStyle: "none", margin: "0 0 24px", padding: 0, display: "grid", gap: 12 }}>
          {data.reviews.map((r) => (
            <li key={r.id} style={box} data-testid="shop-review">
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "baseline" }}>
                <strong>{r.authorName}</strong>
                <Stars rating={r.rating} />
                <small>{new Date(r.createdAt).toLocaleDateString("fa-IR", { dateStyle: "medium" })}</small>
              </div>
              <p style={{ margin: "8px 0 0", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{r.body}</p>
              {r.reply && (
                <p style={{ margin: "10px 0 0", paddingInlineStart: 12, borderInlineStart: edge, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
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
        <p role="status" style={{ ...box, margin: 0 }}>نظر شما ثبت شد و پس از تأیید فروشگاه نمایش داده می‌شود.</p>
      ) : (
        <form onSubmit={submit} noValidate style={{ ...box, display: "grid", gap: 12 }}>
          <h3 style={{ margin: 0 }}>نظر شما</h3>
          <fieldset style={{ border: 0, margin: 0, padding: 0 }}>
            <legend style={{ padding: 0, marginBottom: 6 }}>امتیاز</legend>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {[1, 2, 3, 4, 5].map((n) => (
                <label key={n} style={{ display: "inline-flex", alignItems: "center", gap: 6, minHeight: 44, minWidth: 44, padding: "0 10px", border: edge, borderRadius: 8, cursor: "pointer", fontWeight: rating === n ? 700 : 400 }}>
                  <input type="radio" name="rating" value={n} checked={rating === n} onChange={() => setRating(n)} />
                  {fa(n)}
                </label>
              ))}
            </div>
          </fieldset>
          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor="review-body">متن نظر</label>
            <textarea id="review-body" value={text} onChange={(e) => setText(e.target.value)} rows={4} maxLength={REVIEW_BODY_MAX} style={{ font: "inherit", color: "inherit", background: "transparent", border: edge, borderRadius: 8, padding: 10, width: "100%", boxSizing: "border-box" }} />
          </div>
          {error && <p role="alert" style={{ margin: 0, fontWeight: 700 }}>{error}</p>}
          <div>
            <button type="submit" disabled={busy || rating === 0 || text.trim().length === 0} style={{ font: "inherit", minHeight: 44, padding: "0 20px", border: 0, borderRadius: 8, background: "var(--primary, #1f2937)", color: "var(--on-primary, #fff)", cursor: "pointer", opacity: busy || rating === 0 || !text.trim() ? 0.6 : 1 }}>
              {busy ? "در حال ارسال…" : "ثبت نظر"}
            </button>
          </div>
        </form>
      ))}
    </section>
  );
}
