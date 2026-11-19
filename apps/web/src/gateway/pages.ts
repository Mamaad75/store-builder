// Server-side READS of the API for rendering (ADR 0001). Writes happen in the browser: see src/client/api.ts.
import type { EditResultDto, PageEditorViewDto, PageSummaryDto } from "@store-builder/shared/dto/index";
import { enc, request } from "./core";

export type { EditResultDto, PageEditorViewDto, PageSummaryDto };

const base = (storeId: string, pageType: string) => `/api/stores/${enc(storeId)}/pages/${enc(pageType)}`;

export const listPages = (storeId: string) => request<{ supported: boolean; pages: PageSummaryDto[] }>("GET", `/api/stores/${enc(storeId)}/pages`);
export const getPageEditor = (storeId: string, pageType: string) => request<PageEditorViewDto>("GET", base(storeId, pageType));
