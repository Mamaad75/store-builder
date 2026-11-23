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

// ---- phase 2.5: the response schemas of the API contract (packages/shared/src/api) are pinned to the same results ----
import type { AuditEventDto, MyInvitationDto, SecretListDto, SharedStoreDto, TeamDto } from "@store-builder/shared/dto/index";
import type { ProductCursorListDto } from "@store-builder/shared/api/schemas";
import type { AccessService } from "./modules/access/access.api.js";
import type { SecretService } from "./modules/secrets/secrets.api.js";
import type { changeProductStatus, createProduct, listProductsAfter, updateProduct } from "./modules/products/service.js";
import type { createStore, listStores, updateBusinessCategory, updateStore } from "./modules/stores/service.js";
import type { claimSubdomain } from "./modules/publishing/subdomain.js";
import type { setLiveVersion } from "./modules/publishing/service.js";
import type { moveSection, recoverPage, removeDormantSection, removeSection, setPageVisibility, setSectionImage, updateSection } from "./modules/pages/service.js";

export type _P25 = [
  Assert<Same<Resolved<typeof listProductsAfter>, ProductCursorListDto>>,
  Assert<Same<Resolved<typeof createProduct>, ProductDto>>,
  Assert<Same<Resolved<typeof updateProduct>, ProductDto>>,
  Assert<Same<Resolved<typeof changeProductStatus>, ProductDto>>,
  Assert<Same<Resolved<typeof listStores>, StoreDto[]>>,
  Assert<Same<Resolved<typeof updateStore>, StoreDto>>,
  Assert<Same<Resolved<typeof createStore>, { id: string }>>,
  Assert<Same<Resolved<typeof updateBusinessCategory>, { businessCategory: string; changed: boolean }>>,
  Assert<Same<Resolved<typeof listPages>, { supported: boolean; pages: PageSummaryDto[] }>>,
  Assert<Same<Resolved<typeof updateSection>, EditResultDto>>,
  Assert<Same<Resolved<typeof removeSection>, EditResultDto>>,
  Assert<Same<Resolved<typeof removeDormantSection>, EditResultDto>>,
  Assert<Same<Resolved<typeof moveSection>, EditResultDto>>,
  Assert<Same<Resolved<typeof setSectionImage>, EditResultDto>>,
  Assert<Same<Resolved<typeof setPageVisibility>, EditResultDto>>,
  Assert<Same<Resolved<typeof recoverPage>, EditResultDto>>,
  Assert<Same<Resolved<typeof setLiveVersion>, { number: number }>>,
  Assert<Same<Resolved<typeof claimSubdomain>, { label: string; changed: boolean }>>,
  Assert<Same<Resolved<AccessService["team"]>, TeamDto>>,
  Assert<Same<Resolved<AccessService["myInvitations"]>, MyInvitationDto[]>>,
  Assert<Same<Resolved<AccessService["sharedStores"]>, SharedStoreDto[]>>,
  Assert<Same<Resolved<AccessService["auditLog"]>, AuditEventDto[]>>,
  Assert<Same<Resolved<AccessService["invite"]>, { id: string }>>,
  Assert<Same<Resolved<AccessService["acceptInvitation"]>, { storeId: string }>>,
  Assert<Same<Resolved<SecretService["list"]>, SecretListDto>>,
];

// ---- phase 3.1: customers and platform operators
import type * as S31 from "@store-builder/shared/api/schemas";
import type { z } from "zod";
import type { CustomerAuthService, CustomersService } from "./modules/customers/customers.api.js";
import type { PlatformService } from "./modules/platform/platform.api.js";

export type _P31 = [
  Assert<Same<Resolved<CustomerAuthService["requestCode"]>, z.infer<typeof S31.otpRequestedDto>>>,
  Assert<Same<Resolved<CustomerAuthService["verifyCode"]>["customer"], z.infer<typeof S31.customerProfileDto>>>,
  Assert<Same<Resolved<CustomersService["list"]>, z.infer<typeof S31.customerListItemDto>[]>>,
  Assert<Same<Resolved<PlatformService["overview"]>, z.infer<typeof S31.platformOverviewDto>>>,
  Assert<Same<Resolved<PlatformService["stores"]>, z.infer<typeof S31.platformStoreDto>[]>>,
  Assert<Same<Resolved<PlatformService["admins"]>, z.infer<typeof S31.platformAdminDto>[]>>,
  Assert<Same<Resolved<PlatformService["grant"]>, { userId: string }>>,
];
import type { PlatformSettingsService } from "./modules/platform/platform.api.js";
export type _P31b = [
  Assert<Same<Resolved<PlatformSettingsService["view"]>, z.infer<typeof S31.platformSettingsViewDto>>>,
  Assert<Same<Resolved<PlatformSettingsService["update"]>, z.infer<typeof S31.platformSettingsDto>>>,
];
