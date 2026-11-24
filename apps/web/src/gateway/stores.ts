// Server-side READS of the API for rendering (ADR 0001). Writes happen in the browser: see src/client/api.ts.
import type { OnboardingFactDto, StoreDto, TemplateOptionDto } from "@store-builder/shared/dto/index";
import type { ThemeRef, ThemeSwitchReport } from "@store-builder/shared/modules/stores/theme-switch-types";
import { enc, request } from "./core";

export type { StoreDto, ThemeRef, ThemeSwitchReport };

export const listStores = () => request<StoreDto[]>("GET", "/api/stores");
export const getOnboardingFacts = () => request<OnboardingFactDto[]>("GET", "/api/stores/onboarding");
export const listActiveTemplates = () => request<TemplateOptionDto[]>("GET", "/api/stores/templates");
export const getStore = (storeId: string) => request<StoreDto>("GET", `/api/stores/${enc(storeId)}`);
export const listSwitchableThemes = (storeId: string) => request<{ current: ThemeRef | null; themes: ThemeRef[] }>("GET", `/api/stores/${enc(storeId)}/themes`);
export const previewThemeSwitch = (storeId: string, targetKey: string) => request<ThemeSwitchReport>("GET", `/api/stores/${enc(storeId)}/themes/${enc(targetKey)}/report`);

/** ADR 0003 (G2): whether the platform suspended the store, with its public message only. */
export const getStoreSuspension = (storeId: string) =>
  request<{ suspended: boolean; publicMessage: string | null; since: string | null }>("GET", `/api/stores/${enc(storeId)}/suspension`);
