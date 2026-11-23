import { z } from "zod";
import type * as D from "../dto/index.js";
import { STAFF_ROLES, STORE_ROLES } from "../modules/access/permissions.js";
import type { PageEditorRules } from "../templates/editor.js";
import type { PageSection, SectionIssue } from "../templates/section-parse.js";
import { PAGE_TYPES } from "../templates/sections.js";
import { aiSettingsSchema, paymentSettingsSchema, ratesSettingsSchema, smsSettingsSchema } from "../modules/platform/settings.js";
import type { StorefrontData } from "../templates/storefront-data.js";

/**
 * Response schemas of the API contract (phase 2.5). They DESCRIBE the JSON the API already returns: each one is pinned to its wire type
 * in `dto/index.ts` by a two-way compile-time check at the bottom of this file, and `apps/api/src/dto.check.ts` pins those types to the
 * real service results. So the OpenAPI document cannot drift from the code without `tsc` failing.
 * Deeply nested editor/storefront structures are referenced as opaque objects (`z.custom`): they have their own validators elsewhere.
 */
const iso = z.string().describe("ISO 8601 date-time");
const storeStatus = z.enum(["DRAFT", "PUBLISHED", "UNPUBLISHED"]);
const productStatus = z.enum(["DRAFT", "ACTIVE", "ARCHIVED"]);
const opaque = <T>(name: string) => z.custom<T>(() => true).describe(name);

export const mediaRefDto = z.object({ id: z.string(), key: z.string(), width: z.number().nullable(), height: z.number().nullable() });
export const storeDto = z.object({
  id: z.string(),
  name: z.string(),
  status: storeStatus,
  settings: z.unknown(),
  businessCategory: z.string(),
  draftRevision: z.number(),
  publishedAt: iso.nullable(),
  createdAt: iso,
  updatedAt: iso,
  logo: mediaRefDto.nullable(),
  templateVersion: z.object({ version: z.number(), template: z.object({ key: z.string(), name: z.string() }) }),
});
export const templateOptionDto = z.object({ key: z.string(), name: z.string(), description: z.string() });
export const onboardingFactDto = z.object({ id: z.string(), name: z.string(), status: storeStatus, categories: z.number(), products: z.number(), hasSubdomain: z.boolean() });
export const categoryDto = z.object({ id: z.string(), name: z.string(), slug: z.string(), createdAt: iso, _count: z.object({ products: z.number() }) });
export const productDto = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  description: z.string(),
  price: z.number().describe("Toman"),
  stockQuantity: z.number(),
  weightGrams: z.number().nullable().describe("grams; null = unknown (weight-based shipping counts the method's default)"),
  specs: z.unknown(),
  status: productStatus,
  categoryId: z.string().nullable(),
  category: z.object({ id: z.string(), name: z.string() }).nullable(),
  image: mediaRefDto.nullable(),
  createdAt: iso,
  updatedAt: iso,
});
/** Phase 3.2: one purchasable combination of a product. */
export const variantDto = z.object({
  id: z.string(),
  options: z.array(z.object({ name: z.string(), value: z.string() })),
  optionsKey: z.string(),
  sku: z.string().nullable(),
  price: z.number(),
  stockQuantity: z.number().describe("sellable quantity: active reservations are already taken out"),
  position: z.number(),
});
export const productListDto = z.object({ items: z.array(productDto), total: z.number(), page: z.number(), pageSize: z.number(), totalPages: z.number() });
/** v1 only: keyset pages (phase 2.5). `nextCursor` is opaque; null on the last page. */
export const productCursorListDto = z.object({ items: z.array(productDto), total: z.number(), limit: z.number(), nextCursor: z.string().nullable() });
export type ProductCursorListDto = z.infer<typeof productCursorListDto>;

export const editResultDto = z.object({ changed: z.boolean(), revision: z.number() });
export const pageSummaryDto = z.object({
  type: z.enum(PAGE_TYPES),
  title: z.string(),
  slug: z.string(),
  isVisible: z.boolean(),
  canHide: z.boolean(),
  revision: z.number(),
  sectionCount: z.number(),
  invalidCount: z.number(),
  archivedCount: z.number(),
});
export const pageEditorViewDto = pageSummaryDto.extend({
  storeId: z.string(),
  sections: z.array(opaque<PageSection>("PageSection")),
  dormant: z.array(z.object({ id: z.string(), type: z.string(), label: z.string(), preview: z.string() })),
  issues: z.array(z.object({ index: z.number(), reason: z.enum(["not_an_array", "invalid_envelope", "unsupported_type", "invalid_props", "duplicate_singleton"]), preview: z.string() })),
  images: z.record(z.string(), z.object({ key: z.string(), width: z.number(), height: z.number() })),
  rules: opaque<PageEditorRules>("PageEditorRules"),
  maxSections: z.number(),
});
export const publishResultDto = z.object({
  versionId: z.string(),
  number: z.number(),
  draftRevision: z.number(),
  snapshotBytes: z.number(),
  contentHash: z.string(),
  lockHeldMs: z.number(),
  budgetExceeded: z.boolean(),
  buildMs: z.number(),
});
export const publishStateDto = z.object({
  status: storeStatus,
  draftRevision: z.number(),
  publishedAt: iso.nullable(),
  live: z.object({ number: z.number(), draftRevision: z.number(), createdAt: iso, snapshotBytes: z.number() }).nullable(),
  subdomain: z.string().nullable(),
  mayHaveUnpublishedChanges: z.boolean(),
});
export const versionDto = z.object({ id: z.string(), number: z.number(), createdAt: iso, snapshotBytes: z.number(), draftRevision: z.number(), contentHash: z.string() });
export const subdomainStateDto = z.object({ current: z.string().nullable(), reserved: z.array(z.object({ host: z.string(), until: iso })) });
const storefrontData = opaque<StorefrontData>("StorefrontData (validated by storefrontDataSchema)");
export const draftPreviewDto = z.object({
  data: storefrontData,
  notes: z.object({
    settingsFallback: z.boolean(),
    excludedProductCount: z.number(),
    skippedSections: z.array(z.object({ pageType: z.string(), issues: z.array(opaque<SectionIssue>("SectionIssue")) })),
    dormantSectionCount: z.number(),
    invalidSpecsProductCount: z.number(),
  }),
  candidate: z.object({ key: z.string(), name: z.string() }).nullable(),
});
export const liveStoreDto = z.object({ storeId: z.string(), versionId: z.string(), liveSince: iso });
export const publicStoreDto = z.object({ live: liveStoreDto, data: storefrontData });

export const sessionUserDto = z.object({ id: z.string(), username: z.string(), name: z.string() });
export const memberDto = z.object({ userId: z.string(), username: z.string(), name: z.string(), role: z.enum(STORE_ROLES), since: iso.nullable() });
export const invitationDto = z.object({ id: z.string(), username: z.string(), name: z.string(), role: z.enum(STAFF_ROLES), createdAt: iso, expiresAt: iso });
export const teamDto = z.object({ members: z.array(memberDto), invitations: z.array(invitationDto) });
export const myInvitationDto = z.object({ id: z.string(), storeId: z.string(), storeName: z.string(), role: z.enum(STAFF_ROLES), invitedBy: z.string(), expiresAt: iso });
export const sharedStoreDto = z.object({ storeId: z.string(), name: z.string(), role: z.enum(STAFF_ROLES) });
export const auditEventDto = z.object({
  id: z.string(),
  action: z.string(),
  actorId: z.string().nullable(),
  actorUsername: z.string().nullable(),
  targetType: z.string().nullable(),
  targetId: z.string().nullable(),
  metadata: z.unknown(),
  createdAt: iso,
});
export const secretListDto = z.object({ configured: z.boolean(), secrets: z.array(z.object({ name: z.string(), hint: z.string().nullable(), updatedAt: iso })) });

// ---- phase 3.1: customers and platform operators (pinned to the service results in apps/api/src/dto.check.ts)
export const customerProfileDto = z.object({ id: z.string(), phone: z.string().describe("+989xxxxxxxxx"), name: z.string().nullable() });
export const customerListItemDto = customerProfileDto.extend({ phoneVerifiedAt: iso.nullable(), lastLoginAt: iso.nullable(), createdAt: iso });
export const otpRequestedDto = z.object({ resendAfterSeconds: z.number(), expiresInSeconds: z.number() });

// ---- phase 3.3: cart, shipping, addresses, checkout summary (all money in toman, integers)
const lineProblem = z.enum(["unavailable", "choose_variant", "out_of_stock", "not_enough_stock"]);
export const pricedLineDto = z.object({
  productId: z.string(),
  variantId: z.string().nullable(),
  quantity: z.number(),
  name: z.string(),
  slug: z.string().nullable(),
  variantLabel: z.string(),
  imageKey: z.string().nullable(),
  unitPrice: z.number().describe("current price: the published price with live gold/dollar prices applied"),
  lineTotal: z.number().describe("0 when the line has a problem"),
  problem: lineProblem.nullable().describe("null = can be bought as is"),
  available: z.number().nullable().describe("what is left, when less than asked for"),
});
export const cartViewDto = z.object({ lines: z.array(pricedLineDto), subtotal: z.number(), count: z.number().describe("units in the cart") });
const shippingKind = z.enum(["FLAT", "WEIGHT", "PICKUP"]);
export const shippingOptionDto = z.object({
  methodId: z.string(),
  name: z.string(),
  kind: shippingKind,
  description: z.string(),
  cost: z.number(),
  freeByThreshold: z.boolean(),
  cashOnDelivery: z.object({ available: z.boolean(), fee: z.number() }),
});
export const checkoutSummaryDto = z.object({
  lines: z.array(pricedLineDto),
  subtotal: z.number(),
  shippingOptions: z.array(shippingOptionDto).describe("methods offered for the address's province"),
  shippingMethodId: z.string().nullable(),
  shippingCost: z.number(),
  cashOnDelivery: z.boolean(),
  codFee: z.number(),
  total: z.number(),
  ready: z.boolean().describe("an order could be placed now (phase 3.4)"),
  blockers: z.array(z.enum(["empty_cart", "line_problems", "no_address", "no_shipping_for_province", "choose_shipping", "shipping_unavailable", "cod_unavailable"])),
});
export const savedAddressDto = z.object({
  id: z.string(),
  recipientName: z.string(),
  phone: z.string().describe("+989xxxxxxxxx"),
  province: z.string().describe("province code (packages/shared/src/modules/checkout/provinces.ts)"),
  city: z.string(),
  line: z.string(),
  postalCode: z.string(),
});
// ---- phase 3.4: orders (money in toman; the snapshot taken at checkout)
const orderStatus = z.enum(["PLACED", "CONFIRMED", "SHIPPED", "DELIVERED", "CANCELLED"]);
export const orderDto = z.object({
  id: z.string(),
  number: z.number().describe("gap-free per store; also the invoice number"),
  status: orderStatus,
  createdAt: iso,
  customerId: z.string().nullable(),
  address: z.object({ recipientName: z.string(), phone: z.string(), province: z.string(), city: z.string(), line: z.string(), postalCode: z.string() }),
  shipping: z.object({ name: z.string(), kind: z.enum(["FLAT", "WEIGHT", "PICKUP"]), cost: z.number() }),
  paymentMethod: z.enum(["COD"]),
  subtotal: z.number(),
  codFee: z.number(),
  total: z.number(),
  itemCount: z.number(),
  note: z.string(),
  items: z.array(z.object({ productId: z.string(), variantId: z.string().nullable(), name: z.string(), variantLabel: z.string(), unitPrice: z.number(), quantity: z.number(), lineTotal: z.number(), weightGrams: z.number().nullable() })),
  history: z.array(z.object({ from: orderStatus.nullable(), to: orderStatus, actor: z.enum(["CUSTOMER", "MERCHANT", "SYSTEM"]), note: z.string(), at: iso })),
});
export const shopperOrderDto = z.object({ order: orderDto, canCancel: z.boolean() });
export const placedOrderDto = shopperOrderDto.extend({ accessToken: z.string().describe("follow or cancel the order with it (keep it secret: it is the order link)") });
export const orderListDto = z.object({ items: z.array(orderDto), nextCursor: z.string().nullable() });
export const shippingMethodDto = z.object({
  id: z.string(),
  name: z.string(),
  kind: shippingKind,
  enabled: z.boolean(),
  description: z.string(),
  price: z.number(),
  perKg: z.number(),
  defaultItemGrams: z.number(),
  provinces: z.array(z.string()),
  provincePrices: z.array(z.object({ province: z.string(), price: z.number() })),
  freeAbove: z.number().nullable(),
  cashOnDelivery: z.object({ enabled: z.boolean(), provinces: z.array(z.string()), fee: z.number() }),
});
export const platformOverviewDto = z.object({ users: z.number(), stores: z.number(), publishedStores: z.number(), products: z.number(), customers: z.number() });
export const platformStoreDto = z.object({
  id: z.string(),
  name: z.string(),
  status: storeStatus,
  ownerUsername: z.string(),
  subdomain: z.string().nullable(),
  products: z.number(),
  createdAt: iso,
});
export const platformAdminDto = z.object({ userId: z.string(), username: z.string(), name: z.string(), role: z.enum(["SUPER_ADMIN"]), grantedAt: iso });

// ---- phase 3.2b: prices linked to the dollar or gold
const rateCode = z.enum(["USD", "GOLD18"]);
const appliedRate = z.object({ rateToman: z.number(), appliedAt: iso });
export const currentRatesDto = z.object({ USD: appliedRate.nullable(), GOLD18: appliedRate.nullable() });
export const priceLinkDto = z.object({
  productId: z.string(),
  variantId: z.string().nullable(),
  kind: z.enum(["USD", "GOLD"]),
  usdCents: z.number().nullable().describe("dollar amount in cents (kind USD)"),
  weightMg: z.number().nullable().describe("gold weight in milligrams (kind GOLD)"),
  wageBp: z.number().describe("labour, basis points (900 = 9%)"),
  profitBp: z.number(),
  taxBp: z.number(),
  stoneToman: z.number(),
  roundingToman: z.number(),
  status: z.enum(["OK", "OUT_OF_RANGE"]),
  lastPriceToman: z.number().nullable(),
  lastRateAt: iso.nullable(),
});
export const rateRowDto = z.object({
  id: z.string(),
  code: rateCode,
  rateToman: z.number(),
  source: z.string(),
  observedAt: iso,
  status: z.enum(["APPLIED", "PENDING", "REJECTED"]),
  decidedById: z.string().nullable(),
  decidedAt: iso.nullable(),
  createdAt: iso,
});
const currentRateWithAge = z.object({ rateToman: z.number(), appliedAt: iso, stale: z.boolean() });
export const platformRatesDto = z.object({
  provider: z.enum(["off", "manual", "navasan"]),
  current: z.object({ USD: currentRateWithAge.nullable(), GOLD18: currentRateWithAge.nullable() }),
  pending: z.array(rateRowDto),
  history: z.array(rateRowDto),
});

export const platformSettingsDto = z.object({ sms: smsSettingsSchema, payment: paymentSettingsSchema, ai: aiSettingsSchema, rates: ratesSettingsSchema });
const secretStateDto = z.object({ configured: z.boolean(), hint: z.string().nullable(), updatedAt: iso.nullable() });
export const platformSettingsViewDto = z.object({
  settings: platformSettingsDto,
  secrets: z.object({ "sms.kavenegar.api_key": secretStateDto, "payment.zarinpal.merchant_id": secretStateDto, "ai.api_key": secretStateDto, "rates.navasan.api_key": secretStateDto }),
  encryptionReady: z.boolean(),
});

/** The v1 error body (phase 2.5): a fixed status-level `code`, a fixed Persian `message`, optional details. Never a stack. */
export const apiErrorV1 = z.object({
  error: z.object({
    code: z.string().describe("e.g. NOT_FOUND, VALIDATION_FAILED, RATE_LIMITED"),
    message: z.string().describe("fixed Persian text per code"),
    reason: z.string().optional().describe("finer machine-readable cause, e.g. a domain error name"),
    fieldErrors: z.record(z.string(), z.array(z.string())).optional(),
    retryAfterSeconds: z.number().optional(),
    details: z.unknown().optional(),
  }),
  requestId: z.string().optional(),
});
export type ApiErrorV1 = z.infer<typeof apiErrorV1>;

// ---- compile-time pinning to the wire types (both directions) ----
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Assert<T extends true> = T;
type I<S extends z.ZodType> = z.infer<S>;
export type _Pins = [
  Assert<Same<I<typeof storeDto>, D.StoreDto>>,
  Assert<Same<I<typeof templateOptionDto>, D.TemplateOptionDto>>,
  Assert<Same<I<typeof onboardingFactDto>, D.OnboardingFactDto>>,
  Assert<Same<I<typeof categoryDto>, D.CategoryDto>>,
  Assert<Same<I<typeof productDto>, D.ProductDto>>,
  Assert<Same<I<typeof productListDto>, D.ProductListDto>>,
  Assert<Same<I<typeof editResultDto>, D.EditResultDto>>,
  Assert<Same<I<typeof pageSummaryDto>, D.PageSummaryDto>>,
  Assert<Same<I<typeof pageEditorViewDto>, D.PageEditorViewDto>>,
  Assert<Same<I<typeof publishResultDto>, D.PublishResultDto>>,
  Assert<Same<I<typeof publishStateDto>, D.PublishStateDto>>,
  Assert<Same<I<typeof versionDto>, D.VersionDto>>,
  Assert<Same<I<typeof subdomainStateDto>, D.SubdomainStateDto>>,
  Assert<Same<I<typeof draftPreviewDto>, D.DraftPreviewDto>>,
  Assert<Same<I<typeof liveStoreDto>, D.LiveStoreDto>>,
  Assert<Same<I<typeof publicStoreDto>, D.PublicStoreDto>>,
  Assert<Same<I<typeof sessionUserDto>, D.SessionUserDto>>,
  Assert<Same<I<typeof teamDto>, D.TeamDto>>,
  Assert<Same<I<typeof myInvitationDto>, D.MyInvitationDto>>,
  Assert<Same<I<typeof sharedStoreDto>, D.SharedStoreDto>>,
  Assert<Same<I<typeof auditEventDto>, D.AuditEventDto>>,
  Assert<Same<I<typeof secretListDto>, D.SecretListDto>>,
];
