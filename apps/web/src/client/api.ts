import type { ProductDto } from "@store-builder/shared/dto/index";
import type { EditResultDto, PageEditorViewDto, PublishResultDto } from "@store-builder/shared/dto/index";
import type { ThemeRef } from "@store-builder/shared/modules/stores/theme-switch-types";
import { enc, send } from "./http";
import type { z } from "zod";
import type { orderDto, orderListDto, shippingMethodDto } from "@store-builder/shared/api/schemas";

/** Every write the dashboard can make, as browser calls (reads are rendered by the server components through `@/gateway`). */
const store = (id: string) => `/api/stores/${enc(id)}`;
const page = (id: string, type: string) => `${store(id)}/pages/${enc(type)}`;

// auth
export const register = (body: unknown) => send("POST", "/api/auth/register", { body });
export const login = (body: unknown) => send<{ user: { id: string } }>("POST", "/api/auth/login", { body });
export const logout = () => send("POST", "/api/auth/logout");
export const changePassword = (body: unknown) => send("POST", "/api/auth/change-password", { body });
export const logoutAll = () => send("POST", "/api/auth/logout-all");

// stores
export const createStore = (input: unknown) => send<{ id: string }>("POST", "/api/stores", { body: input });
export const updateStore = (storeId: string, input: unknown) => send("PATCH", store(storeId), { body: input });
export const updateBusinessCategory = (storeId: string, input: unknown) => send<{ businessCategory: string; changed: boolean }>("PATCH", `${store(storeId)}/business-category`, { body: input });
export const deleteStore = (storeId: string, confirmName: string) => send("POST", `${store(storeId)}/delete`, { body: { confirmName } });
export const switchTheme = (storeId: string, input: unknown) => send<{ changed: boolean; theme: ThemeRef }>("POST", `${store(storeId)}/themes/switch`, { body: input });

// catalog
export const createCategory = (storeId: string, input: unknown) => send<{ id: string }>("POST", `${store(storeId)}/categories`, { body: input });
export const updateCategory = (storeId: string, id: string, input: unknown) => send("PATCH", `${store(storeId)}/categories/${enc(id)}`, { body: input });
export const deleteCategory = (storeId: string, id: string, options: { moveProducts: boolean }) => send<{ movedProducts: number }>("POST", `${store(storeId)}/categories/${enc(id)}/delete`, { body: options });
export const createProduct = (storeId: string, input: unknown) => send<ProductDto>("POST", `${store(storeId)}/products`, { body: input });
export const updateProduct = (storeId: string, id: string, input: unknown) => send<ProductDto>("PATCH", `${store(storeId)}/products/${enc(id)}`, { body: input });
export const changeProductStatus = (storeId: string, id: string, status: string) => send<ProductDto>("POST", `${store(storeId)}/products/${enc(id)}/status`, { body: { status } });
export const deleteProduct = (storeId: string, id: string) => send("POST", `${store(storeId)}/products/${enc(id)}/delete`);

// pages
export const addSection = (storeId: string, type: string, input: { type: unknown }, expectedRevision: unknown) => send<EditResultDto>("POST", `${page(storeId, type)}/sections`, { body: { type: input.type, expectedRevision } });
export const updateSection = (storeId: string, type: string, sectionId: string, props: unknown, expectedRevision: unknown) => send<EditResultDto>("PATCH", `${page(storeId, type)}/sections/${enc(sectionId)}`, { body: { props, expectedRevision } });
export const removeSection = (storeId: string, type: string, sectionId: string, expectedRevision: unknown) => send<EditResultDto>("POST", `${page(storeId, type)}/sections/${enc(sectionId)}/delete`, { body: { expectedRevision } });
export const removeDormantSection = (storeId: string, type: string, sectionId: string, expectedRevision: unknown) => send<EditResultDto>("POST", `${page(storeId, type)}/sections/${enc(sectionId)}/delete-dormant`, { body: { expectedRevision } });
export const moveSection = (storeId: string, type: string, sectionId: string, direction: unknown, expectedRevision: unknown) => send<EditResultDto>("POST", `${page(storeId, type)}/sections/${enc(sectionId)}/move`, { body: { direction, expectedRevision } });
export const setPageVisibility = (storeId: string, type: string, visible: unknown, expectedRevision: unknown) => send<EditResultDto>("POST", `${page(storeId, type)}/visibility`, { body: { visible, expectedRevision } });
export const recoverPage = (storeId: string, type: string, expectedRevision: unknown) => send<EditResultDto>("POST", `${page(storeId, type)}/recover`, { body: { expectedRevision } });
export const getPageEditor = (storeId: string, type: string) => send<PageEditorViewDto>("GET", page(storeId, type));

// media (raw bytes)
export const uploadProductImage = (storeId: string, id: string, bytes: Blob) => send("POST", `${store(storeId)}/products/${enc(id)}/image`, { raw: bytes });
export const removeProductImage = (storeId: string, id: string) => send("POST", `${store(storeId)}/products/${enc(id)}/image/delete`);
export const uploadStoreLogo = (storeId: string, bytes: Blob) => send("POST", `${store(storeId)}/logo`, { raw: bytes });
export const removeStoreLogo = (storeId: string) => send("POST", `${store(storeId)}/logo/delete`);
export const uploadSectionImage = (storeId: string, type: string, sectionId: string, expectedRevision: unknown, bytes: Blob) =>
  send("POST", `${page(storeId, type)}/sections/${enc(sectionId)}/image`, { raw: bytes, query: { expectedRevision: String(expectedRevision ?? "") } });
export const removeSectionImage = (storeId: string, type: string, sectionId: string, expectedRevision: unknown) =>
  send<EditResultDto>("POST", `${page(storeId, type)}/sections/${enc(sectionId)}/image/delete`, { body: { expectedRevision } });

// publishing
export const publishStore = (storeId: string, input: unknown) => send<PublishResultDto>("POST", `${store(storeId)}/publish`, { body: input });
export const unpublishStore = (storeId: string) => send("POST", `${store(storeId)}/unpublish`);
export const setLiveVersion = (storeId: string, input: { versionNumber: unknown; mode: "rollback" | "republish" }) => send<{ number: number }>("POST", `${store(storeId)}/versions/live`, { body: input });
export const claimSubdomain = (storeId: string, input: { label: unknown; confirmChange?: unknown }) => send<{ label: string; changed: boolean }>("POST", `${store(storeId)}/subdomain`, { body: input });

// ---- phase 3.4: orders; phase 3.3: shipping methods (the merchant side of checkout)
export type OrderDto = z.infer<typeof orderDto>;
export type OrderListDto = z.infer<typeof orderListDto>;
export type ShippingMethodDto = z.infer<typeof shippingMethodDto>;
export const listOrders = (storeId: string, query: { status?: string; customerId?: string; before?: string; limit?: string }) => send<OrderListDto>("GET", `${store(storeId)}/orders`, { query });
export const getOrder = (storeId: string, orderId: string) => send<OrderDto>("GET", `${store(storeId)}/orders/${enc(orderId)}`);
export const changeOrderStatus = (storeId: string, orderId: string, to: string, note: string) => send<OrderDto>("POST", `${store(storeId)}/orders/${enc(orderId)}/status`, { body: { to, note } });
export const listShippingMethods = (storeId: string) => send<ShippingMethodDto[]>("GET", `${store(storeId)}/shipping-methods`);
export const replaceShippingMethods = (storeId: string, methods: unknown[]) => send<ShippingMethodDto[]>("PUT", `${store(storeId)}/shipping-methods`, { body: { methods } });

// ---- phase 3.3b: the store's customers (personal data: owner and manager)
export type CustomerRow = { id: string; phone: string; name: string | null; phoneVerifiedAt: string | null; lastLoginAt: string | null; createdAt: string };
export type CustomerStats = { customerId: string; orders: number; spent: number; lastOrderAt: string | null };
export const listCustomers = (storeId: string, before?: string) => send<CustomerRow[]>("GET", `${store(storeId)}/customers`, { query: { before, limit: "50" } });
export const customerStats = (storeId: string, ids: string[]) => send<CustomerStats[]>("GET", `${store(storeId)}/orders/customer-stats`, { query: { ids: ids.join(",") } });
