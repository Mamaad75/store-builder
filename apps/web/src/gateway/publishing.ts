import type { PublishResultDto, PublishStateDto, SubdomainStateDto, VersionDto } from "@store-builder/shared/dto/index";
import { enc, request } from "./core";

export type { PublishResultDto, PublishStateDto, SubdomainStateDto, VersionDto };

const base = (storeId: string) => `/api/stores/${enc(storeId)}`;

export const getPublishState = (storeId: string) => request<PublishStateDto>("GET", `${base(storeId)}/publish`);
export const listVersions = (storeId: string) => request<VersionDto[]>("GET", `${base(storeId)}/versions`);
export const getSubdomainState = (storeId: string) => request<SubdomainStateDto>("GET", `${base(storeId)}/subdomain`);
export const publishStore = (storeId: string, input: unknown) => request<PublishResultDto>("POST", `${base(storeId)}/publish`, { body: input });
export const unpublishStore = (storeId: string) => request("POST", `${base(storeId)}/unpublish`);
export const setLiveVersion = (storeId: string, input: { versionNumber: unknown; mode: "rollback" | "republish" }) => request<{ number: number }>("POST", `${base(storeId)}/versions/live`, { body: input });
export const claimSubdomain = (storeId: string, input: { label: unknown; confirmChange?: unknown }) => request<{ label: string; changed: boolean }>("POST", `${base(storeId)}/subdomain`, { body: input });
