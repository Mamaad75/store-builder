// Server-side READS of the API for rendering (ADR 0001). Writes happen in the browser: see src/client/api.ts.
import type { z } from "zod";
import type { orderDto } from "@store-builder/shared/api/schemas";
import { enc, request } from "./core";

export type OrderView = z.infer<typeof orderDto>;

/** One order of the store (orders.view: owner and manager). */
export const getOrderView = (storeId: string, orderId: string) => request<OrderView>("GET", `/api/stores/${enc(storeId)}/orders/${enc(orderId)}`);
