import { send } from "./http";
import type { TicketDetailDto, TicketDto } from "./api";
import type { z } from "zod";
import type { planDto, purchaseResultDto, staffStoreBillingDto } from "@store-builder/shared/api/schemas";

/** Browser writes of the super admin pages (phase 3.1): same-origin calls to /api/v1/platform (Caddy in production, Next in development). */
const P = "/api/v1/platform";
const enc = encodeURIComponent;

export const updatePlatformSettings = (group: "sms" | "payment" | "ai" | "rates" | "registration", body: unknown) => send("PATCH", `${P}/settings/${enc(group)}`, { body });
export const setPlatformSecret = (name: string, value: string) => send("POST", `${P}/secrets/${enc(name)}`, { body: { value } });
export const removePlatformSecret = (name: string) => send("POST", `${P}/secrets/${enc(name)}/delete`);
export const grantPlatformAdmin = (username: string) => send<{ userId: string }>("POST", `${P}/admins`, { body: { username } });
export const revokePlatformAdmin = (userId: string) => send("POST", `${P}/admins/${enc(userId)}/revoke`);
// MVP item 2: invitation codes and account recovery
export type InviteRow = { id: string; note: string; createdAt: string; expiresAt: string; usedBy: string | null; status: "active" | "used" | "expired" | "revoked" };
export type PlatformUser = { id: string; username: string; name: string; createdAt: string; recoveredAt: string | null; isPlatformAdmin: boolean; stores: number };
export const listInvites = () => send<InviteRow[]>("GET", `${P}/invites`);
export const createInvite = (note: string, days: number) => send<{ id: string; code: string; url: string; expiresAt: string }>("POST", `${P}/invites`, { body: { note, days } });
export const revokeInvite = (id: string) => send("POST", `${P}/invites/${enc(id)}/revoke`);
export const findPlatformUser = (username: string) => send<PlatformUser>("GET", `${P}/users`, { query: { username } });
export const recoverUser = (userId: string, body: { adminPassword: string; reason: string; identityVerified: boolean }) =>
  send<{ url: string; expiresAt: string }>("POST", `${P}/users/${enc(userId)}/recovery`, { body });
// phase 3.2b: rates
export const enterRate = (code: "USD" | "GOLD18", rateToman: number) => send("POST", `${P}/rates`, { body: { code, rateToman } });
export const decideRate = (id: string, to: "confirm" | "reject") => send("POST", `${P}/rates/${enc(id)}/${to}`);
// ADR 0003 (G2): platform store suspension
export const suspendStore = (storeId: string, body: { reason: string; publicMessage: string; internalNote: string }) => send("POST", `${P}/stores/${enc(storeId)}/suspend`, { body });
export const restoreStore = (storeId: string, note: string) => send("POST", `${P}/stores/${enc(storeId)}/restore`, { body: { note } });
export type SuspensionRow = { id: string; reason: string; publicMessage: string; internalNote: string; merchantStatusAtStart: string; suspendedAt: string; liftedAt: string | null; liftNote: string | null };
export const getSuspensions = (storeId: string) => send<SuspensionRow[]>("GET", `${P}/stores/${enc(storeId)}/suspensions`);

// support requests from every store
export type StaffTicket = TicketDto & { storeId: string; storeName: string };
export type StaffTicketDetail = TicketDetailDto & { storeId: string; storeName: string };
export const listStaffTickets = (status?: string) => send<StaffTicket[]>("GET", `${P}/tickets`, { query: { status, limit: "100" } });
export const getStaffTicket = (id: string) => send<StaffTicketDetail>("GET", `${P}/tickets/${enc(id)}`);
export const replyStaffTicket = (id: string, body: string) => send<TicketDto>("POST", `${P}/tickets/${enc(id)}/messages`, { body: { body } });
export const setStaffTicketStatus = (id: string, status: string) => send("POST", `${P}/tickets/${enc(id)}/status`, { body: { status } });

// finance: plans, one store's money
export type PlanDto = z.infer<typeof planDto>;
export type StaffStoreBilling = z.infer<typeof staffStoreBillingDto>;
export type PurchaseResult = z.infer<typeof purchaseResultDto>;
export const listPlans = () => send<PlanDto[]>("GET", `${P}/plans`);
export const createPlan = (body: unknown) => send<PlanDto>("POST", `${P}/plans`, { body });
export const updatePlan = (id: string, body: unknown) => send<PlanDto>("PUT", `${P}/plans/${enc(id)}`, { body });
export const getStoreBilling = (storeId: string) => send<StaffStoreBilling>("GET", `${P}/stores/${enc(storeId)}/billing`);
export const recordPurchase = (storeId: string, body: unknown) => send<PurchaseResult>("POST", `${P}/stores/${enc(storeId)}/purchases`, { body });
export const adjustWallet = (storeId: string, body: unknown) => send<{ balanceToman: number }>("POST", `${P}/stores/${enc(storeId)}/wallet-adjust`, { body });
