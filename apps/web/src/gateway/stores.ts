import type { Permission, StoreRole } from "@store-builder/shared/modules/access/permissions";
// Server-side READS of the API for rendering (ADR 0001). Writes happen in the browser: see src/client/api.ts.
import type { OnboardingFactDto, StoreDto, TemplateOptionDto } from "@store-builder/shared/dto/index";
import type { ThemeRef, ThemeSwitchReport } from "@store-builder/shared/modules/stores/theme-switch-types";
import { enc, request } from "./core";

export type { StoreDto, ThemeRef, ThemeSwitchReport };

export const listStores = () => request<StoreDto[]>("GET", "/api/stores");
/** MVP item 2: account notices (a recent recovery by platform support). */
export const getAccountNotices = () => request<{ recoveredAt: string | null }>("GET", "/api/auth/notices");
export const getOnboardingFacts = () => request<OnboardingFactDto[]>("GET", "/api/stores/onboarding");
export const listActiveTemplates = () => request<TemplateOptionDto[]>("GET", "/api/stores/templates");
export const getStore = (storeId: string) => request<StoreDto>("GET", `/api/stores/${enc(storeId)}`);
export const listSwitchableThemes = (storeId: string) => request<{ current: ThemeRef | null; themes: ThemeRef[] }>("GET", `/api/stores/${enc(storeId)}/themes`);
export const previewThemeSwitch = (storeId: string, targetKey: string) => request<ThemeSwitchReport>("GET", `/api/stores/${enc(storeId)}/themes/${enc(targetKey)}/report`);

/** ADR 0003 (G2): whether the platform suspended the store, with its public message only. */
export const getStoreSuspension = (storeId: string) =>
  request<{ suspended: boolean; publicMessage: string | null; since: string | null }>("GET", `/api/stores/${enc(storeId)}/suspension`);

/** What the signed-in person may do in this store (any member). The sidebar shows only the pages their role can use. */
export const getStoreAccess = (storeId: string) => request<{ role: StoreRole; permissions: Permission[] }>("GET", `/api/stores/${enc(storeId)}/access`);
/** The stores I work for as staff, and invitations waiting for me (the stores page). */
export const listSharedStores = () => request<{ storeId: string; name: string; role: "MANAGER" | "OPERATOR" }[]>("GET", "/api/me/shared-stores");
export const listMyInvitations = () => request<{ id: string; storeId: string; storeName: string; role: "MANAGER" | "OPERATOR"; invitedBy: string; expiresAt: string }[]>("GET", "/api/me/invitations");
