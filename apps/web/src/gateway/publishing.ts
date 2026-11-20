// Server-side READS of the API for rendering (ADR 0001). Writes happen in the browser: see src/client/api.ts.
import type { PublishResultDto, PublishStateDto, SubdomainStateDto, VersionDto } from "@store-builder/shared/dto/index";
import { enc, request } from "./core";

export type { PublishResultDto, PublishStateDto, SubdomainStateDto, VersionDto };

const base = (storeId: string) => `/api/stores/${enc(storeId)}`;

export const getPublishState = (storeId: string) => request<PublishStateDto>("GET", `${base(storeId)}/publish`);
export const listVersions = (storeId: string) => request<VersionDto[]>("GET", `${base(storeId)}/versions`);
export const getSubdomainState = (storeId: string) => request<SubdomainStateDto>("GET", `${base(storeId)}/subdomain`);
