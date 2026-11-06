# Templates

Independent React implementations of storefronts (`general` today; `coffee`/`fashion` in phase 9) behind the
`TemplateModule` contract in `types.ts`, plus the generic `engine/` (routing, validation, renderer) and the
strict section/data contracts (`sections.ts`, `storefront-data.ts`). Templates never touch the database, MUI
or dashboard code. See `docs/storefront.md`.
