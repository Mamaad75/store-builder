/**
 * Compile-time conformance between the service results and the wire DTOs in @store-builder/shared (nothing runs): if a service starts
 * returning something the DTO does not describe (or the reverse), `tsc` fails here.
 */
import type {
  CategoryDto, DraftPreviewDto, EditResultDto, Jsonify, LiveStoreDto, OnboardingFactDto, PageEditorViewDto, PageSummaryDto, ProductDto, ProductListDto,
  PublishResultDto, PublishStateDto, StoreDto, SubdomainStateDto, TemplateOptionDto, VersionDto,
} from "@store-builder/shared/dto/index";
import type { CategoryService } from "./modules/categories/categories.api.js";
import type { getPageEditor, listPages, addSection } from "./modules/pages/service.js";
import type { getProduct, listProducts } from "./modules/products/service.js";
import type { getPublishState, listVersions, publishStore } from "./modules/publishing/service.js";
import type { getSubdomainState } from "./modules/publishing/subdomain.js";
import type { LiveStore } from "./modules/publishing/public-read.js";
import type { getDraftPreview } from "./modules/storefront/service.js";
import type { getOnboardingFacts, getStore, listActiveTemplates } from "./modules/stores/service.js";

type Resolved<F extends (...a: never[]) => Promise<unknown>> = Jsonify<Awaited<ReturnType<F>>>;
/** The service result is accepted where the DTO is expected (the DTO may be less specific, e.g. `unknown` for stored JSON). */
type Same<A, B> = [A] extends [B] ? true : false;
type Assert<T extends true> = T;

export type _31546 = Assert<Same<Resolved<typeof getStore>, StoreDto>>;
export type _79929 = Assert<Same<Resolved<typeof listActiveTemplates>, TemplateOptionDto[]>>;
export type _62335 = Assert<Same<Resolved<typeof getOnboardingFacts>, OnboardingFactDto[]>>;
export type _23509 = Assert<Same<Resolved<CategoryService["list"]>, CategoryDto[]>>;
export type _36355 = Assert<Same<Resolved<typeof getProduct>, ProductDto>>;
export type _30231 = Assert<Same<Resolved<typeof listProducts>, ProductListDto>>;
export type _50896 = Assert<Same<Resolved<typeof addSection>, EditResultDto>>;
export type _80053 = Assert<Same<Resolved<typeof getPageEditor>, PageEditorViewDto>>;
export type _13745 = Assert<Same<Resolved<typeof listPages>["pages"][number], PageSummaryDto>>;
export type _94557 = Assert<Same<Resolved<typeof publishStore>, PublishResultDto>>;
export type _43912 = Assert<Same<Resolved<typeof getPublishState>, PublishStateDto>>;
export type _29599 = Assert<Same<Resolved<typeof listVersions>, VersionDto[]>>;
export type _93007 = Assert<Same<Resolved<typeof getSubdomainState>, SubdomainStateDto>>;
export type _14751 = Assert<Same<Jsonify<LiveStore>, LiveStoreDto>>;
export type _60727 = Assert<Same<Resolved<typeof getDraftPreview>, DraftPreviewDto>>;
