# Storefront rendering architecture (phase 6)

```
Store / Page / Category / Product rows (owner-scoped, draft)        StoreVersion.snapshot (phase 10)
              |  DraftStorefrontRepository (SQL: ownerId, ACTIVE only)            |  readPublishedStorefront
              v                                                                    v
        buildStorefrontData  --- validates JSON, skips bad sections, reports ---> StorefrontData (strict Zod, schemaVersion 1)
                                                                                   |
                         buildView(data, {basePath, segments, searchParams})  <---+
                           1. storefrontDataSchema.safeParse   -> invalid_data
                           2. resolveTemplate(key, version)    -> unsupported_template
                           3. resolveStorefrontRoute           -> not_found
                           v
                  StorefrontRenderer -> template.Layout + template.sections[type]
```

## Contracts

* **Data:** `src/templates/storefront-data.ts`. `{ schemaVersion: 1, template: {key, version}, store: {name, direction, primaryColor, contact, social}, pages: [{type, title, slug, position, sections}], categories, products }`. Strict (unknown keys rejected); products carry no status or ownership fields.
* **Sections:** `src/templates/sections.ts`. `{ id, type, props }`, one strict props schema per type (`hero`, `featuredProducts`, `productGrid`, `categoryFilter`, `productDetail`, `richText`, `imageText`, `contactInfo`, `callToAction`), links are internal paths only.

```json
{ "id": "home-hero", "type": "hero",
  "props": { "title": "...", "subtitle": "...", "buttonText": "...", "buttonLink": "/products", "imageId": null } }
```

* **Template:** `src/templates/types.ts`.

```ts
interface TemplateModule { key: string; version: number; name: string;
  Layout(props: { ctx: RenderContext; children }): ReactElement;
  sections: { [T in SectionType]?: SectionComponent<T> } }
```

## Template versioning

A store points to a `TemplateVersion` row (immutable once used). The renderer resolves `(key, version)` in `src/templates/registry.ts`. A new visual version of a template is a new `version` number registered next to the old one; old stores keep rendering with the version they use. An unregistered pair is reported as unsupported (never substituted).

## Adding a template

Create `src/templates/<key>/index.ts` exporting a `TemplateModule`, add it to `registry.ts`. Nothing else changes (architecture tests enforce that the engine does not know concrete templates and that templates import no dashboard/data code).

## Preview security model

`/preview/<storeId>/<path>`: server-side `requireUser()`, ownership in SQL, identical 404 for missing/foreign/malformed ids (raised in the layout, before streaming), `proxy.ts` login redirect, `no-store`, `noindex` header and metadata, persistent banner, read-only (no writes), only ACTIVE products. Tests: `storefront.db.test.ts`, `e2e/storefront.spec.ts`, `architecture.test.ts`.

## Compatibility decisions

See D6-2/D6-3 in [`decisions.md`](decisions.md): stored data is never rewritten by rendering; invalid sections/settings are skipped or defaulted and reported.

## Phase 8 additions to the contract (same `schemaVersion: 1`, all optional with defaults)

`store.typography` (closed allow-lists, see `docs/pages.md`) and `images` (`{ [mediaId]: { key, width, height } }`, relative keys, at most 60) are added; data written earlier parses with the defaults. Templates get section images through `sectionImage(ctx, imageId)`; an id that is not in `images` renders the placeholder.

## Phase 11 additions (SEO)

`StorefrontData.store.description` is optional with **no default** (absent when the owner set none). The page metadata, canonical URL,
Open Graph/Twitter cards, JSON-LD, `robots.txt` and `sitemap.xml` are derived from the same validated data: see `docs/seo.md`.

