import type { EditResultDto } from "@store-builder/shared/dto/index";
import { enc, request } from "./core";

const base = (storeId: string) => `/api/stores/${enc(storeId)}`;

export const uploadProductImage = (storeId: string, productId: string, bytes: Uint8Array) => request("POST", `${base(storeId)}/products/${enc(productId)}/image`, { raw: bytes });
export const removeProductImage = (storeId: string, productId: string) => request("POST", `${base(storeId)}/products/${enc(productId)}/image/delete`);
export const uploadStoreLogo = (storeId: string, bytes: Uint8Array) => request("POST", `${base(storeId)}/logo`, { raw: bytes });
export const removeStoreLogo = (storeId: string) => request("POST", `${base(storeId)}/logo/delete`);
export const uploadSectionImage = (storeId: string, pageType: string, sectionId: string, expectedRevision: unknown, bytes: Uint8Array) =>
  request("POST", `${base(storeId)}/pages/${enc(pageType)}/sections/${enc(sectionId)}/image`, { raw: bytes, query: { expectedRevision: String(expectedRevision ?? "") } });
export const removeSectionImage = (storeId: string, pageType: string, sectionId: string, expectedRevision: unknown) =>
  request<EditResultDto>("POST", `${base(storeId)}/pages/${enc(pageType)}/sections/${enc(sectionId)}/image/delete`, { body: { expectedRevision } });
