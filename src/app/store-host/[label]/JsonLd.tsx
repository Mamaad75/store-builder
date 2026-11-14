import { serializeJsonLd } from "@/modules/seo/jsonld";

/**
 * The ONLY place in the application that injects raw markup. It renders `<script type="application/ld+json">` blocks whose
 * content is ALWAYS produced by `serializeJsonLd`, which escapes `<`, `>`, `&` and the line separators, so nothing in store
 * data (names, descriptions, handles) can close the tag or start a comment. React would entity-escape the JSON quotes if the
 * JSON were passed as a child, which is why this one use is needed (an architecture test pins it to this file).
 */
export default function JsonLd({ items }: { items: object[] }) {
  return (
    <>
      {items.map((item, i) => (
        <script key={i} type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(item) }} />
      ))}
    </>
  );
}
