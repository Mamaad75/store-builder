# Page editing and appearance (phase 8)

Everything here changes the **draft** only. Nothing is published and there is no public routing (phases 10+). The draft preview
(`/preview/<storeId>/...`) reflects every change immediately.

## Architecture

```
dashboard (MUI forms)  ->  pageEditAction (one Server Action, `intent` whitelist, requireUser first)
                           -> pages service (src/modules/pages/service.ts) -> mutatePage()
                                1. withStoreMutation(owner, store)   ownership in SQL, store row locked, draftRevision + 1
                                2. read the page (owner-scoped), resolve the template, resolve ITS editor spec
                                3. page.revision !== expectedRevision  ->  ConflictError (rolls everything back)
                                4. analyzePage(): valid+approved sections vs. entries that cannot be edited safely
                                5. invalid entries present (and not the recovery op) -> PageNeedsRecoveryError
                                6. the operation computes the new section list (strict props schemas)
                                7. nothing changed -> NoChange -> rollback (no draftRevision / page revision bump)
                                8. write sections/isVisible with `WHERE revision = expected`, revision + 1
                           -> after commit: release media that lost its last reference (reference-aware)
```

* **Template-aware.** `TemplateModule.editor` (`src/templates/editor.ts`) declares, per page type, the approved `allowed` sections, `singletons` (at most one) and `required` (at least one must stay). The editing service, forms and tests only consult the spec of the store's template; nothing names `general`. Coffee and Fashion (phase 9) bring their own spec; a store whose template is not registered gets an explicit "not available yet" state, never another template's rules. `setExtraTemplatesForTests` proves this in the tests.
* **Operations:** add (from the approved list; defaults from `section-defaults.ts`; ids are server generated), update (only whitelisted form fields, merged into the stored props and validated by the strict per-type schema; the type comes from the stored section), remove (required sections stay), move up/down (no drag and drop), set/clear section image, page visibility, recovery.
* **Limits:** at most 20 sections per page (service + UI); `HOME` and `PRODUCTS` can never be hidden (service + a CHECK constraint on `Page`).
* **Conflicts.** `Page.revision` is a per-page token carried by every form. A stale form is an explicit `ConflictError` ("the page was changed at the same time, reload"); nothing is overwritten. Different pages (and product edits) do not conflict with each other.
* **No-ops** (same values, moving past an edge, hiding an already hidden page, recovering a clean page) write nothing and bump neither `draftRevision` nor `Page.revision`. The same rule now applies to store settings (`updateStore`).

## Invalid and legacy section JSON

Stored JSON is never trusted by type: it is validated when read. A page is "needing recovery" when it contains entries that are not an array, not an object, of an unknown type, with props that fail the strict schema, with duplicate ids, valid but not approved for that page by the template, or extra copies of a singleton.

* The preview/renderer skips such entries and reports them to the owner. Rendering never changes data.
* The editor shows an **explicit recovery state** listing each entry with its stored JSON and reason, and refuses every edit (including visibility) until the owner runs **recovery**.
* **Recovery moves, it does not delete:** the offending entries are appended verbatim (with index, reason and timestamp) to `Page.legacySections`; a value that is not an array is archived whole; a `required` section that only existed in invalid form is re-created with defaults so the page keeps working. Tests assert the archived JSON equals the original.

## Images in sections

`hero` and `imageText` carry `imageId`. It changes only through the upload actions (the same media pipeline as phase 7), never through the text form. Setting it validates, **inside the store-mutation transaction**, that the media exists, belongs to this store and is `READY`; foreign, missing, PENDING and DELETING media are indistinguishable (not found). Replacing/clearing/removing a section releases the old media through `releaseMedia`, which keeps anything still referenced (another section, a product, the logo, a published snapshot). The draft storefront data exposes only READY images of this store, as relative keys in `images[mediaId]`.

## Appearance (closed allow-lists)

`Store.settings.typography`: `fontFamily` is the constant `vazirmatn` (bundled, no external fonts), `sizeScale` in `small|normal|large` (92%/100%/110% of the base size), `headingWeight` in `600|700|800`, `bodyWeight` in `400|500`. `primaryColor` is strict `#RRGGBB`. The update schema is `.strict()`: no font family, URL, CSS or unknown key is accepted, and the template turns the choices into a fixed set of CSS values. Settings stored before phase 8 parse with the defaults. Saved through `updateStore` (its existing conflict handling), not through the page revision.

## Known limitations

* Hiding `PRODUCT_DETAIL` is allowed by the decision; product URLs then answer "not found" in the preview.
* There is no media library: section images are uploaded per section.
* The recovery archive is read-only in the UI (count shown); restoring from it is a manual database operation.
* The editor shows one page at a time; no undo history.
