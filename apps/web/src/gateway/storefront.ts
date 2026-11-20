import type { DraftPreviewDto } from "@store-builder/shared/dto/index";
import { enc, request } from "./core";

export type { DraftPreviewDto };

export const getDraftPreview = (storeId: string, opts: { candidateThemeKey?: string } = {}) =>
  request<DraftPreviewDto>("GET", `/api/stores/${enc(storeId)}/preview`, { query: { theme: opts.candidateThemeKey } });
