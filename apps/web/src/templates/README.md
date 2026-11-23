# Templates

Independent React implementations of storefronts (`general` today; `coffee`/`fashion` in phase 9) behind the
`TemplateModule` contract in `types.ts`, plus the generic `engine/` (routing, validation, renderer) and the
strict section/data contracts (`sections.ts`, `storefront-data.ts`). Templates never touch the database, MUI
or dashboard code. See `docs/storefront.md`.

## Starter content

Public demos and populated drafts use the same versioned content in `packages/shared/src/templates/demo.ts`. Creation turns the demo's catalog and media into store-owned records. Default pages keep ordered, individually typed sections with stable IDs. Subsequent edits use the same section schemas and page-editor rules as any other draft.

A section composition tool can use the versioned theme's allowed and required section types and schema defaults, then save the resulting order through the normal page editor contract. Starter image keys resolve to bundled WebP assets. Keep assigned asset IDs and files stable so existing published snapshots continue to display their images.
