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

## Known limitations (9A)

* Theme switching, the compatibility report and theme previews are phase 9B; the home-appliances theme and any product specification model are phase 9C (`Product.specs` is deliberately not added).
* The `home-appliances` category exists but has no dedicated theme yet (it suggests `general`).
* Seeds for a new theme are applied with `db:seed` (idempotent), not by a migration; this becomes a deployment step in phase 13.
