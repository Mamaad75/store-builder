import type { PageEditorRules } from "../templates/editor.js";
import type { InvalidEntry } from "../modules/pages/analyze.js";
import type { SectionIssue, PageSection } from "../templates/section-parse.js";
import type { PageType } from "../templates/sections.js";
import type { StorefrontData } from "../templates/storefront-data.js";
import type { StaffRole, StoreRole } from "../modules/access/permissions.js";

/**
 * The JSON the API returns (dates are ISO strings). apps/api has a compile-time check (src/dto.check.ts) that every service result
 * still matches these shapes, so the two sides cannot drift apart silently.
 */

export type StoreStatus = "DRAFT" | "PUBLISHED" | "UNPUBLISHED";
export type ProductStatus = "DRAFT" | "ACTIVE" | "ARCHIVED";

export interface MediaRefDto {
  id: string;
  key: string;
  width: number | null;
  height: number | null;
}

export interface StoreDto {
  id: string;
  name: string;
  status: StoreStatus;
  settings: unknown;
  businessCategory: string;
  draftRevision: number;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  logo: MediaRefDto | null;
  templateVersion: { version: number; template: { key: string; name: string } };
}

export interface TemplateOptionDto {
  key: string;
  name: string;
  description: string;
}

export interface OnboardingFactDto {
  id: string;
  name: string;
  status: StoreStatus;
  categories: number;
  products: number;
  hasSubdomain: boolean;
}

export interface CategoryDto {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  _count: { products: number };
}

export interface ProductDto {
  id: string;
  name: string;
  slug: string;
  description: string;
  price: number;
  stockQuantity: number;
  /** Phase 3.3: grams, null = unknown. */
  weightGrams: number | null;
  specs: unknown;
  status: ProductStatus;
  categoryId: string | null;
  category: { id: string; name: string } | null;
  image: MediaRefDto | null;
  createdAt: string;
  updatedAt: string;
  /** Variants and price links: with variants the price and stock come from them; a link on a product without variants owns its price. */
  _count: { variants: number; priceLinks: number };
}

export interface ProductListDto {
  items: ProductDto[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

// ---- page editor
export interface EditResultDto {
  changed: boolean;
  revision: number;
}
export interface EditorIssueDto {
  index: number;
  reason: InvalidEntry["reason"];
  preview: string;
}
export interface PageSummaryDto {
  type: PageType;
  title: string;
  slug: string;
  isVisible: boolean;
  canHide: boolean;
  revision: number;
  sectionCount: number;
  invalidCount: number;
  archivedCount: number;
}
export interface DormantViewDto {
  id: string;
  type: string;
  label: string;
  preview: string;
}
export interface PageEditorViewDto extends PageSummaryDto {
  storeId: string;
  sections: PageSection[];
  dormant: DormantViewDto[];
  issues: EditorIssueDto[];
  images: Record<string, { key: string; width: number; height: number }>;
  rules: PageEditorRules;
  maxSections: number;
}

// ---- publishing
export interface PublishResultDto {
  versionId: string;
  number: number;
  draftRevision: number;
  snapshotBytes: number;
  contentHash: string;
  lockHeldMs: number;
  budgetExceeded: boolean;
  buildMs: number;
}
export interface PublishStateDto {
  status: StoreStatus;
  draftRevision: number;
  publishedAt: string | null;
  live: { number: number; draftRevision: number; createdAt: string; snapshotBytes: number } | null;
  subdomain: string | null;
  mayHaveUnpublishedChanges: boolean;
}
export interface VersionDto {
  id: string;
  number: number;
  createdAt: string;
  snapshotBytes: number;
  draftRevision: number;
  contentHash: string;
}
export interface SubdomainStateDto {
  current: string | null;
  reserved: { host: string; until: string }[];
}

// ---- storefront
export interface StorefrontNotesDto {
  settingsFallback: boolean;
  excludedProductCount: number;
  skippedSections: { pageType: string; issues: SectionIssue[] }[];
  dormantSectionCount: number;
  invalidSpecsProductCount: number;
}
export interface DraftPreviewDto {
  data: StorefrontData;
  notes: StorefrontNotesDto;
  candidate: { key: string; name: string } | null;
}
export interface LiveStoreDto {
  storeId: string;
  versionId: string;
  liveSince: string;
}
export interface PublicStoreDto {
  live: LiveStoreDto;
  data: StorefrontData;
}

// ---- session, staff and audit (2.3), secrets (2.4): added with the API contract (phase 2.5)
export interface SessionUserDto {
  id: string;
  username: string;
  name: string;
}
export interface MemberDto {
  userId: string;
  username: string;
  name: string;
  role: StoreRole;
  since: string | null;
}
export interface InvitationDto {
  id: string;
  username: string;
  name: string;
  role: StaffRole;
  createdAt: string;
  expiresAt: string;
}
export interface TeamDto {
  members: MemberDto[];
  invitations: InvitationDto[];
}
export interface MyInvitationDto {
  id: string;
  storeId: string;
  storeName: string;
  role: StaffRole;
  invitedBy: string;
  expiresAt: string;
}
export interface SharedStoreDto {
  storeId: string;
  name: string;
  role: StaffRole;
}
export interface AuditEventDto {
  id: string;
  action: string;
  actorId: string | null;
  actorUsername: string | null;
  targetType: string | null;
  targetId: string | null;
  metadata: unknown;
  createdAt: string;
}
export interface SecretListDto {
  configured: boolean;
  secrets: { name: string; hint: string | null; updatedAt: string }[];
}

/** What `JSON.stringify` does to a value: Date becomes a string, `undefined` members vanish. Used by the conformance check. */
export type Jsonify<T> = T extends Date ? string : T extends readonly (infer U)[] ? Jsonify<U>[] : T extends object ? { [K in keyof T]: Jsonify<T[K]> } : T;
