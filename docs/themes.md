# Business categories, themes and the section registry (phase 9A)

Three concepts are kept apart:

| Concept | Where | What it does |
|---|---|---|
| **Business category** (what the merchant sells) | `Store.businessCategory` + `src/lib/business-categories.ts` | A label, suggested themes and starter text used **once, at store creation**. The renderer never reads it. |
| **Theme** (visual direction) | `Template` / `TemplateVersion` rows (unchanged) + `src/templates/<key>/` | Layout, styling and component composition. Identified by `(key, version)`; a published version is immutable, a redesign is a new version. |
| **Content** | Product, Category, Media, `Page.sections`, `Store.settings` | Shared by every theme. |

`general`, `coffee` and `fashion` are **themes** now (display names "ساده و همه‌منظوره", "گرم و ادیتوریال", "مینیمال و مدرن"); their database keys and version 1 seeds are untouched. Any category can be combined with any theme.

## Business category

* Column `Store.businessCategory` (text, default `general`). The CHECK validates the **key format** only (`^[a-z][a-z0-9-]{0,39}$`); the application registry (`general`, `coffee-food`, `fashion`, `home-appliances`) is the allowlist. Adding a category needs no migration.
* Backfill in the migration: `coffee -> coffee-food`, `fashion -> fashion`, anything else `-> general` (best effort; owners can change it). A stored value the registry does not know still renders and can be changed.
* **Starter text is applied only while a store is created** (`applyStarterCopy`: replaces wording of the existing home hero / home image+text / about text; never adds, removes or reorders sections). Changing the category later changes the label only.
* **Metadata, not draft content:** `updateBusinessCategory` is one atomic compare-and-set (`WHERE id AND ownerId AND businessCategory = expected`). It does **not** bump `draftRevision` (no rendered content changes), writes nothing for a same-value save, and answers a stale form with `ConflictError`. Ownership is part of the statement (foreign/missing/malformed store = the same `NotFoundError`).

## Themes

* `ThemeDefinition` (pure, `src/templates/theme.ts`): key, version, display metadata, the extra section definitions the theme brings, and its editor spec. `TemplateModule` (React) adds the Layout and components and **must implement every core section type** (type-checked), so content is portable between themes.
* Two registries, kept in sync by a test: the pure `theme-catalog.ts` (server code, validation, editing, scripts) and the React `registry.ts`. Adding a theme = its folder + one line in each. The engine, routes and data layer do not change.
* Store creation validates the theme server-side: active in the database **and** present in the catalog. A store is never created on a theme that cannot be shown. Existing stores pinned to a theme that no code registers get the explicit "unsupported" outcome.
* Version 1 of coffee and fashion are now real themes, so existing coffee/fashion stores (which previously had no preview or editor) work without migration.

## Section registry

`SectionDefinition` = type, label, strict props schema, defaults, form fields, image flag. Core types live in the core; a theme's extra types are **namespaced by the theme** (`coffee.openingHours`, `fashion.sizeGuide`), never by a category, and a theme cannot define a type outside its own namespace. Validation of persisted JSON (`parseSection`, the storefront contract, seeds) uses the **global** registry, independent of the active theme. Extra types must stay permanent (renaming one would invalidate stored data and snapshots).

## Three section states

| State | Definition | Behaviour |
|---|---|---|
| **active** | valid, known to the registry, **approved** by the active theme's editor spec for that page | rendered, editable, reorderable |
| **dormant** | valid and known to the registry, but **not approved** by the active theme | stored value kept verbatim and in place, never rendered, never in storefront data, does not block editing, still counts toward the 20-section limit; removable **only** by an explicit owner action (`removeDormantSection`) |
| **invalid** | not an array/object, type unknown to every theme, props failing the strict schema, duplicate id, extra copy of an active singleton | Phase 8 recovery protections unchanged: edits are refused until the explicit recovery MOVES the entries verbatim to `legacySections` |

Preservation criterion (not byte equality: JSONB does not keep object key order): all keys and values, array order, section order and every reference (`imageId`) are unchanged, and nothing is normalised or rewritten. Implementation: analysis keeps each entry's stored value (`raw`); every edit writes back `raw` for entries it does not deliberately change, and reordering swaps only active entries (dormant entries never move).

**Media:** dormant sections stay in `Page.sections`, so `isMediaReferenced` (page-JSON scan) keeps their images protected; the Phase 7 reference-aware deletion is unchanged. Dormant images never reach `StorefrontData.images` (it is built from rendered sections only). Deleting a dormant section releases its media through the normal reference-aware rule.

## Theme-specific sections (9A)

* `coffee.openingHours` `{ title, body (lines "label: hours"), note }` - dotted-leader rows. Approved on home, about, contact.
* `fashion.sizeGuide` `{ title, intro, table ("a | b" lines, first line = header), note }` - an accessible table. Approved on products and about.
All text is rendered as escaped React text.

## Theme switching (9B)

A switch changes **one column**: `Store.templateVersionId` (and bumps `draftRevision`, because the draft renders differently). Nothing else is written - no page, section, product, category, media, setting, snapshot, published pointer or status. The section state (active / dormant / invalid) is *derived* from the stored JSON and the active theme on every read, so "becoming dormant" and "reappearing" need no data change and a round trip cannot lose anything.

* **Compatibility report** (`src/modules/pages/compat.ts`, pure): for every stored entry of every page (hidden pages included) the state under the current and under the target theme is computed with the editor's own `analyzePage`, so the report cannot disagree with what the editor will show. Labels: `stays_active`, `becomes_dormant`, `becomes_active`, `stays_dormant`, `stays_invalid` (**pre-existing**, never blocks), `becomes_invalid` (**new**, blocks), `invalid_becomes_active/dormant`. Required-section violations are listed per page (`missingRequired`, with `alsoMissingNow`) and block.
* **Blocking rule:** the switch is refused (`ThemeSwitchBlockedError`, full report) when it would introduce a new invalid entry (e.g. an extra copy of a type the target treats as a singleton) or leave a page without a type the target requires. Nothing is repaired automatically: the owner fixes the page under the current theme first. Pre-existing invalid data never blocks and is left exactly as stored (the Phase 8 recovery stays an explicit action).
* **Concurrency:** the report carries the `draftRevision` it was computed from. `switchTheme` runs inside `withStoreMutation` (ownership in SQL, store lock, revision bump), checks that the revision is exactly one behind, **re-computes the report under the lock** and only then writes the pointer (conditional on the previous pointer). A stale report or concurrent draft edit is a `ConflictError`; a switch to the current theme writes nothing and does not bump the revision.
* **Targets:** only the latest *active* version of an active theme key that also exists in the code catalog. A newer DB version without code is "unavailable" (never silently replaced by the old one); version upgrades are out of scope.
* **Candidate-theme preview:** `/preview/<storeId>?theme=<key>` renders the draft with another theme. Owner-only (same ownership-in-SQL read and identical 404), read-only (no write call on that path, enforced by an architecture test), never reads published data, `noindex`/no-store like every preview, shows a banner "not applied", and carries `theme=` on its internal links. An unknown/inactive/malformed key shows a neutral notice.
* **Published storefront:** nothing a switch or a candidate preview does can reach it. The published storefront reads only the immutable `StoreVersion.snapshot` named by the published pointer, which carries its own `template {key, version}`. (There is no snapshot writer until phase 10; the tests publish by hand and compare output before/after.)
* **Media:** a switch touches no media row. Active, dormant and invalid sections all live in `Page.sections` and are matched by `isMediaReferenced`; **archived** sections (`Page.legacySections`, where the Phase 8 recovery moves invalid entries) are now matched too (a phase 8 gap closed in 9B). Nothing in the application removes archived entries, so their media stay protected indefinitely; a dormant section's media is released only by explicitly removing that dormant section.

## Home & Appliances theme and product specifications (9C)

### The `appliances` theme
Key `appliances`, version 1, display name "تمیز و کاتالوگی": a clean, technical visual direction (cool neutrals, the store's primary colour as the accent, white product tiles with the image *contained* rather than cropped, a bordered spec table). It is a theme, not a category: any business category can use it and a home-appliances store can use any theme. It implements all nine core sections (enforced by the shared theme contract tests) and registers like the others: `definition.ts` + catalog line + registry line + seed definition (`definitions.ts`). Existing themes, stores and seeds are untouched. The `home-appliances` category now suggests `appliances` first (still only a suggestion), and a store created without a category on this theme infers `home-appliances`.

* `appliances.serviceInfo` `{ title, items ("title: text" lines, at most 14 shown), note }` - warranty, delivery and after-sales points as plain text cards. Singleton; approved on home, about and contact. This is the only theme-specific section in 9C. A product comparison table (needs product ids inside section JSON that must stay valid when products are deleted) and a brand strip (needs media with reference protection) were considered and deliberately not built.

### Product specifications (`Product.specs`)
`specs` is an ordered JSONB array of `{ label, value }` text rows that belongs to the **product** (never to a theme, a section or a business category).

| Rule | Value |
|---|---|
| rows per product | at most **30** |
| label | 1-**40** characters |
| value | 1-**120** characters |
| labels | unique within a product (case-insensitive); no control characters; Persian letters normalised (`normalizeFa`) |
| default | `[]` (existing products are not rewritten) |

* **Migration `20261108093000_phase9c_product_specs`:** `ADD COLUMN "specs" JSONB NOT NULL DEFAULT '[]'` + `CHECK (jsonb_typeof(specs) = 'array' AND jsonb_array_length(specs) <= 30)`. A constant default makes it metadata-only on PostgreSQL 16: no row rewrite, every existing product reads as an empty list. The database only guarantees "an array of at most 30 elements"; element rules are enforced by the application on write and re-checked on read. Rollback = drop the column (only specs are lost).
* **Write vs stored schemas** (`src/lib/product-specs.ts`): the write schema normalises and limits; the *stored* schema only checks. `analyzeSpecs` classifies a stored value as valid or invalid (`not_an_array`, `too_many_rows`, `invalid_row`, `duplicate_label`) and never rewrites it.
* **Invalid stored specifications are never silently lost.** The original JSON is preserved byte for byte. The product list shows a "مشخصات نامعتبر" flag, the edit page shows a warning with the stored value, and the draft preview says how many products are affected (and renders them without specs). Editing any other field cannot touch them: the update path writes `specs` only when the patch carries them (`undefined` = untouched), and the form sends specs only for the two explicit intents `replace` and `clear` (the default for an invalid value is `keep`, which sends nothing). Repair is always the owner's explicit choice: "replace with new specifications" or "clear". Status changes, activation, image attachment and theme switches never touch specs either.
* **Presets** (`src/lib/spec-presets.ts`) are optional label suggestions ("add these rows, then fill in the values"; rows left without a value are not saved). They are never validation rules and are not tied to a business category: every store is offered every preset; a category only decides which are listed first.
* **Rendering** (`src/templates/engine/Specs.tsx`, one place for every theme): product listing cards show at most the **first two** rows, the detail page shows **all** rows, as a definition list of escaped React text (no HTML, no markdown, no links). No rows = no element at all (never an empty heading or list). All four themes render them with their own styling.
* **Storefront contract:** `storefrontProductSchema.specs` is optional with an empty default, so schemaVersion-1 data and snapshots written before specs existed stay valid (tested, including a stored snapshot). Invalid stored specs reach the contract as `[]`.
* **Search and filtering:** none in 9C (no storefront search exists). Later, exact label+value filters (e.g. brand) can use JSONB containment (`specs @> '[{"label":"برند","value":"..."}]'`, GIN-indexable). Numeric ranges would need typed attributes; `{label, value}` rows migrate to such a table by backfill.

### Snapshot size budget (phase 10 input)
The earlier planning estimate (~2.5 MB for 500 products) was wrong; the validated figures (recomputed from the real validators in `src/lib/product-specs.size.test.ts` and in a DB test) are:

| | per product | 500 products |
|---|---|---|
| **Worst case** (30 rows, 40/120-unit labels/values of 3-byte characters, compact JSON) | **15,121 bytes** | **7,560,500 bytes (~7.2 MiB)** |
| Same value in PostgreSQL's `jsonb::text` form (adds spaces after `:` and `,`) | 15,240 bytes | ~7.3 MiB |
| Typical (about a dozen short Persian rows) | under 1 KiB | under ~0.6 MB |

3 bytes per UTF-16 unit is the maximum JSON allows without escaping (BMP characters from U+0800); quotes/backslashes (2 bytes per unit) and astral characters (2 bytes per unit) are lighter. For perspective a product description can already weigh 15,000 bytes at its limit, so the worst case adds about the same again. All fields at their maximum (descriptions, specs, page sections) can approach ~17 MB for a full store.

**Is an explicit guard needed for Phase 10?** Not for specs on their own: they are bounded by the validators. But the combined worst case justifies a **snapshot-level size guard in Phase 10** (measure the serialized snapshot and refuse to publish above a documented ceiling, e.g. 20 MiB, with a clear owner-facing message) rather than restricting specs further. `SPECS_WORST_CASE_JSON_BYTES_PER_PRODUCT/STORE` are exported for that purpose. No snapshot writer exists yet, so nothing is enforced in 9C.

## Known limitations (9C)

* Specs are free text: no units, numeric types, ranges or storefront filtering; consistent labels depend on the owner (presets help).
* Spec values are not part of the dashboard product search.
* Only one theme-specific section for appliances; no comparison table or brand strip.
* The product form edits up to 30 rows with plain inputs (no drag-and-drop reordering; use delete and re-add).
* No snapshot size guard yet (recommended for phase 10, see above).

## Known limitations (9B)

* **Archived content has no owner-facing removal.** Entries archived by the Phase 8 recovery (`Page.legacySections`) are kept verbatim and their media references are protected, but nothing lets the owner review, restore or delete them. Media referenced **only** by archived entries therefore stays protected (and stored) indefinitely. By decision, nothing deletes archived content or media automatically, the protection is unchanged, and an explicit archived-content cleanup/recovery capability is recorded as future work (see the roadmap).

* The report is computed for the whole store at once; very large stores are not paginated (a store has at most 5 pages x 20 sections).
* Mixed states are possible by design: a store can keep dormant sections of several themes at once.
* Starter text, the new theme's `defaultSettings` and `defaultPages` are never applied by a switch (content is not rewritten).
* Version upgrades of a theme (coffee@1 -> coffee@2) are not offered.

## Known limitations (9A)

* Theme switching, the compatibility report and theme previews are phase 9B; the home-appliances theme and any product specification model are phase 9C (`Product.specs` is deliberately not added).
* The `home-appliances` category exists but has no dedicated theme yet (it suggests `general`).
* Seeds for a new theme are applied with `db:seed` (idempotent), not by a migration; this becomes a deployment step in phase 13.
