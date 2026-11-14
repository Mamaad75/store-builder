# SEO and metadata of published stores (phase 11)

Everything here concerns the **public** store host (`<label>.<APP_ROOT_DOMAIN>`) and the platform root. It is built only from the
**published snapshot** (never a draft table), from the validated `StorefrontData` the renderer already uses. The code lives in
`src/modules/seo/` (pure: no database, no request, no Next runtime) and is wired into the store routes under
`src/app/store-host/[label]/`.

## What a store page emits

| Page | Title | Description | Canonical |
|---|---|---|---|
| Home | the store name (absolute: no platform suffix) | owner description, else the first meaningful home text (hero subtitle, rich text), else the name | `/` |
| Products | `Products \| name`; `Category \| name` when filtered; ` - صفحه n` after page 1 | `فهرست محصولات name`, or the category with its product count; owner description appended | `/products`, `/products?category=slug`, `&page=n` |
| Product | `product \| name` | the product description cleaned and clipped to 160 characters, else `product - name` | `/products/<encoded slug>` |
| About, Contact | `page title \| name` | page title and store name, owner description appended | `/about`, `/contact` |

* **Canonical URL** = `APP_PROTOCOL://<label>.<APP_ROOT_DOMAIN>` (configuration, never a request header) + the canonical path. Only the
  **parsed** query is ever part of it, so `?utm_source=...`, unknown categories and garbage page numbers collapse into the canonical
  URL, and `?page=999` canonicalises to the last real page. Every public page is `index, follow` (category pages explicitly included, each with its own canonical
  `/products?category=slug`); pagination and category pages are self-canonical (`?category=slug&page=n`, page 1 omitted, page clamped to the
  filtered list's last page, unknown categories dropped) (the storefront has no search, so there is no parameter space to de-duplicate beyond these).
* **Open Graph and Twitter:** `og:type website`, `og:url`, `og:title`, `og:description`, `og:site_name`, `og:locale fa_IR`; the share
  image is the product photo on a product page, otherwise the store logo; with an image the Twitter card is `summary_large_image`,
  otherwise `summary`.
* **Description field:** one optional owner-written line (max 160 characters, whitespace collapsed, control characters refused) in the
  store settings form. It lives in the draft settings JSON (no migration) and reaches the snapshot as `store.description`, an
  **optional field with no default that is absent when empty**, so the snapshot (and therefore the content hash) of every store that
  never set one is unchanged and "no changes" detection keeps working.

## Structured data (JSON-LD, schema.org)

* Home: `Organization` (name, url, description, logo, contact point, postal address, `sameAs` for well-formed social handles) and
  `WebSite`.
* Product: `Product` (name, url, description, image, category, specifications as `additionalProperty`, an `Offer`) and a
  3-level `BreadcrumbList`. Listing, about and contact pages carry none.
* **Prices:** stored in Toman, but schema.org needs an ISO 4217 currency and Toman has none, so offers use **`IRR` with the amount x 10**
  (1 Toman = 10 rials). The visible page keeps showing Toman. A price of zero emits no `Offer` at all; availability is `InStock` when
  stock is above zero, otherwise `OutOfStock`.
* **Injection safety:** the blocks are rendered by one component (`JsonLd.tsx`, the only place in the application that injects raw
  markup; an architecture test pins that) and always through `serializeJsonLd`, which escapes `<`, `>`, `&`, U+2028 and U+2029. Store
  data cannot close the `<script>` tag or open a comment (unit and E2E tested with a hostile store name and description).

## `robots.txt` and `sitemap.xml`

* **Store host:** `/robots.txt` is `User-agent: *`, `Allow: /` and the sitemap URL. `/sitemap.xml` lists the home page, product list,
  about and contact pages that exist in the live snapshot, every category that has products, and every product of the live version
  (percent-encoded paths, XML-escaped), with `<lastmod>` = when this version went live (`Store.publishedAt`, which moves on
  publish, rollback and republish, not on draft edits). A store holds at most 500 products, far below the 50,000-URL limit (a guard
  truncates anyway), so no sitemap index is needed. A store that is unknown, never published, unpublished or on a foreign host gets the
  **same neutral 404** as every other path: nothing reveals whether a store exists.
* **Platform host:** `/robots.txt` allows the root page (the landing page stays indexable, decision D11-4) and disallows only `/dashboard`,
  `/preview` and `/api/`. `/login` and `/register` are deliberately **not** disallowed: they are crawlable but `noindex, nofollow`
  (a URL blocked in robots.txt is never fetched, so its `noindex` could not be read and the bare URL could still be indexed from
  external links). The whole dashboard is `noindex, nofollow`; the draft preview was already `noindex` (and `X-Robots-Tag`).
  robots.txt is advisory only: authentication and authorization remain the actual security boundary of every blocked path.
* Store-host responses are `Cache-Control: no-store` today (the proxy applies it to everything on a store host so that publish,
  rollback and unpublish are visible at once). A caching strategy for crawlers and a CDN belongs to phase 13.

## Tests

Unit (`seo.test.ts`: text clipping, titles, descriptions, canonical rules incl. junk parameters and page clamping, Open Graph/Twitter,
JSON-LD per page type, serialisation safety, sitemap and robots, snapshot contract), build contract (`build.test.ts`), real
PostgreSQL (`description.db.test.ts`: settings, publish, no hash churn, `liveSince`), architecture guards (pure SEO modules, one
raw-markup component, shared host check and published-store loader on every SEO route, platform robots) and E2E on real hosts
(`seo.spec.ts`).

## Known limits

No per-product meta description, no `hreflang` (single language), no image sitemap, no ratings/reviews/brand/GTIN data (the
catalog has none), no `lastmod` per page (all pages share the live time), no search-engine verification tags, no `og:type product`.
Real indexing needs a real domain and certificates: phase 14.
