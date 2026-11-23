import type { z } from "zod";
import type { platformAdminDto, platformOverviewDto, platformRatesDto, platformSettingsViewDto, platformStoreDto } from "@store-builder/shared/api/schemas";
import type { Jsonify } from "@store-builder/shared/dto/index";
import { ApiHttpError, enc, request } from "./core";

/** Server-side reads for the super admin pages (phase 3.1). The API checks the platform role on every call. */
export type PlatformOverview = z.infer<typeof platformOverviewDto>;
export type PlatformStore = Jsonify<z.infer<typeof platformStoreDto>>;
export type PlatformAdmin = Jsonify<z.infer<typeof platformAdminDto>>;
export type PlatformSettingsView = Jsonify<z.infer<typeof platformSettingsViewDto>>;
export type PlatformRates = Jsonify<z.infer<typeof platformRatesDto>>;

const P = "/api/v1/platform";

/** The signed-in user's platform role, or null when they have none (403) - the pages then answer 404. */
export async function getPlatformRole(): Promise<"SUPER_ADMIN" | null> {
  try {
    return (await request<{ role: "SUPER_ADMIN" }>("GET", `${P}/me`)).role;
  } catch (e) {
    if (e instanceof ApiHttpError && e.status === 403) return null;
    throw e;
  }
}

export const getPlatformOverview = () => request<PlatformOverview>("GET", `${P}/overview`);
export const getPlatformStores = (before?: string) => request<PlatformStore[]>("GET", `${P}/stores`, { query: { limit: "50", before } });
export const getPlatformAdmins = () => request<PlatformAdmin[]>("GET", `${P}/admins`);
export const getPlatformSettings = () => request<PlatformSettingsView>("GET", `${P}/settings`);
export const getPlatformRates = () => request<PlatformRates>("GET", `${P}/rates`);
export { enc };
