import type { OnboardingFactDto, StoreDto, TemplateOptionDto } from "@store-builder/shared/dto/index";
import type { ThemeRef, ThemeSwitchReport } from "@store-builder/shared/modules/stores/theme-switch-types";
import { enc, request } from "./core";

export type { StoreDto, ThemeRef, ThemeSwitchReport };

export const listStores = () => request<StoreDto[]>("GET", "/api/stores");
export const getOnboardingFacts = () => request<OnboardingFactDto[]>("GET", "/api/stores/onboarding");
export const listActiveTemplates = () => request<TemplateOptionDto[]>("GET", "/api/stores/templates");
export const getStore = (storeId: string) => request<StoreDto>("GET", `/api/stores/${enc(storeId)}`);
export const createStore = (input: unknown) => request<{ id: string }>("POST", "/api/stores", { body: input });
export const updateStore = (storeId: string, input: unknown) => request<StoreDto>("PATCH", `/api/stores/${enc(storeId)}`, { body: input });
export const updateBusinessCategory = (storeId: string, input: unknown) =>
  request<{ businessCategory: string; changed: boolean }>("PATCH", `/api/stores/${enc(storeId)}/business-category`, { body: input });
export const deleteStore = (storeId: string, confirmName: string) => request("POST", `/api/stores/${enc(storeId)}/delete`, { body: { confirmName } });
export const listSwitchableThemes = (storeId: string) => request<{ current: ThemeRef | null; themes: ThemeRef[] }>("GET", `/api/stores/${enc(storeId)}/themes`);
export const previewThemeSwitch = (storeId: string, targetKey: string) => request<ThemeSwitchReport>("GET", `/api/stores/${enc(storeId)}/themes/${enc(targetKey)}/report`);
export const switchTheme = (storeId: string, input: unknown) => request<{ changed: boolean; theme: ThemeRef }>("POST", `/api/stores/${enc(storeId)}/themes/switch`, { body: input });
