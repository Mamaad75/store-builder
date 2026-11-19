import type { EditResultDto, PageEditorViewDto, PageSummaryDto } from "@store-builder/shared/dto/index";
import { enc, request } from "./core";

export type { EditResultDto, PageEditorViewDto, PageSummaryDto };

const base = (storeId: string, pageType: string) => `/api/stores/${enc(storeId)}/pages/${enc(pageType)}`;

export const listPages = (storeId: string) => request<{ supported: boolean; pages: PageSummaryDto[] }>("GET", `/api/stores/${enc(storeId)}/pages`);
export const getPageEditor = (storeId: string, pageType: string) => request<PageEditorViewDto>("GET", base(storeId, pageType));
export const addSection = (storeId: string, pageType: string, input: { type: unknown }, expectedRevision: unknown) =>
  request<EditResultDto>("POST", `${base(storeId, pageType)}/sections`, { body: { type: input.type, expectedRevision } });
export const updateSection = (storeId: string, pageType: string, sectionId: string, props: unknown, expectedRevision: unknown) =>
  request<EditResultDto>("PATCH", `${base(storeId, pageType)}/sections/${enc(sectionId)}`, { body: { props, expectedRevision } });
export const removeSection = (storeId: string, pageType: string, sectionId: string, expectedRevision: unknown) =>
  request<EditResultDto>("POST", `${base(storeId, pageType)}/sections/${enc(sectionId)}/delete`, { body: { expectedRevision } });
export const removeDormantSection = (storeId: string, pageType: string, sectionId: string, expectedRevision: unknown) =>
  request<EditResultDto>("POST", `${base(storeId, pageType)}/sections/${enc(sectionId)}/delete-dormant`, { body: { expectedRevision } });
export const moveSection = (storeId: string, pageType: string, sectionId: string, direction: unknown, expectedRevision: unknown) =>
  request<EditResultDto>("POST", `${base(storeId, pageType)}/sections/${enc(sectionId)}/move`, { body: { direction, expectedRevision } });
export const setPageVisibility = (storeId: string, pageType: string, visible: unknown, expectedRevision: unknown) =>
  request<EditResultDto>("POST", `${base(storeId, pageType)}/visibility`, { body: { visible, expectedRevision } });
export const recoverPage = (storeId: string, pageType: string, expectedRevision: unknown) =>
  request<EditResultDto>("POST", `${base(storeId, pageType)}/recover`, { body: { expectedRevision } });
