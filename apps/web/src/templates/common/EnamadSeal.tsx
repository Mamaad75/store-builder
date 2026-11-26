import { enamadLinks, type Enamad } from "@store-builder/shared/lib/enamad";

/**
 * The store's eNamad trust seal in the footer: the official image from the one eNamad host, linking to its verification page. Only the
 * validated id and code are used (the addresses are built here), so nothing a merchant typed can reach the page as markup. eNamad needs the
 * `origin` referrer to verify the badge (the page's default policy would not send it), and the only external image the storefront allows.
 */
export default function EnamadSeal({ enamad }: { enamad?: Enamad | null }) {
  if (!enamad) return null;
  const { href, src } = enamadLinks(enamad);
  return (
    <div data-testid="enamad-seal" style={{ padding: "16px 0", textAlign: "center" }}>
      <a href={href} target="_blank" rel="noopener" referrerPolicy="origin" aria-label="نماد اعتماد الکترونیکی؛ صفحهٔ تأیید در زبانهٔ جدید باز می‌شود">
        {/* eslint-disable-next-line @next/next/no-img-element -- an external badge of fixed size; next/image would proxy it through our server */}
        <img src={src} alt="نماد اعتماد الکترونیکی" referrerPolicy="origin" loading="lazy" decoding="async" width={100} height={110} style={{ height: 110, width: "auto", cursor: "pointer" }} />
      </a>
    </div>
  );
}
