/**
 * Store roles and permissions (phase 2.3, D23-1). Pure and shared: the API enforces them (StoreAccessGuard), the dashboard uses the
 * same table only to hide controls a role cannot use. OWNER is Store.ownerId (exactly one); MANAGER and OPERATOR are staff rows.
 */
export const STORE_ROLES = ["OWNER", "MANAGER", "OPERATOR"] as const;
export type StoreRole = (typeof STORE_ROLES)[number];
/** Roles that can be given to staff (the owner is never a member row and cannot be invited). */
export const STAFF_ROLES = ["MANAGER", "OPERATOR"] as const satisfies readonly StoreRole[];
export type StaffRole = (typeof STAFF_ROLES)[number];

export const PERMISSIONS = [
  "store.view", // read the store, its pages, catalog, preview and publish state
  "store.settings", // name, contact, colour, typography, business category
  "store.delete",
  "catalog.write", // categories and products
  "media.write", // uploads, product images, logo
  "pages.write", // page sections and visibility
  "theme.switch",
  "publish", // publish, unpublish, roll back a version
  "domain.manage", // subdomain claim/release
  "members.manage", // invitations, roles, removing staff
  "audit.view",
  "secrets.manage", // payment gateway keys and other store secrets (phase 2.4): owner only
  "customers.view", // the store's customers and their phone numbers (phase 3.1): personal data, owner and manager only
  "orders.view", // orders with the shopper's name, phone and address (phase 3.4): personal data, owner and manager only
  "orders.manage", // confirm, ship, deliver, cancel orders (phase 3.4)
  "discounts.manage", // discount codes (phase 5.1): owner and manager
  "content.manage", // reviews moderation and the blog: owner and manager
  "support.write", // support requests to the platform (owner and manager); also allowed while the store is suspended, so the owner can ask why
  "payout.manage", // the bank cards shoppers transfer money to (D-3, V0-1): create, replace, remove. Owner only
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ALL: readonly Permission[] = PERMISSIONS;
export const ROLE_PERMISSIONS: Readonly<Record<StoreRole, readonly Permission[]>> = {
  OWNER: ALL,
  MANAGER: ALL.filter((p) => p !== "store.delete" && p !== "members.manage" && p !== "secrets.manage" && p !== "payout.manage"),
  OPERATOR: ["store.view", "catalog.write", "media.write", "pages.write"],
};

export function can(role: StoreRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

export const ROLE_LABELS: Readonly<Record<StoreRole, string>> = { OWNER: "مالک", MANAGER: "مدیر", OPERATOR: "کارمند" };

/** How long an invitation stays valid (D23-2). */
export const INVITATION_TTL_DAYS = 14;
/** How long audit events are kept (D23-3). */
export const AUDIT_RETENTION_DAYS = 365;
/** Upper bound of staff per store (members + pending invitations). */
export const MAX_STAFF_PER_STORE = 20;

/**
 * ADR 0003 (D4): what store staff may still do while the platform suspends a store. Reads (GET) stay allowed for whatever the role allows;
 * of the writes, only managing EXISTING orders (fulfil, cancel, review receipts) is allowed, to protect shoppers, and writing to the platform's
 * support (the owner must be able to ask why). Everything else - publishing,
 * catalog, pages, theme, settings, subdomain, staff, secrets and bank cards, discounts, deleting the store - is refused with STORE_SUSPENDED.
 */
export const SUSPENDED_WRITE_PERMISSIONS: readonly Permission[] = ["orders.manage", "support.write"];
export const allowedWhileSuspended = (permission: Permission, write: boolean): boolean => !write || SUSPENDED_WRITE_PERMISSIONS.includes(permission);
