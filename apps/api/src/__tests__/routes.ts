import { RequestMethod } from "@nestjs/common";
import { GUARDS_METADATA, HTTP_CODE_METADATA, METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants.js";
import { PERMISSION_KEY } from "../modules/access/access.api.js";
import { ModulesContainer } from "@nestjs/core";
import type { INestApplication } from "@nestjs/common";

export interface RegisteredRoute {
  method: string;
  /** Handler path with the global prefix, e.g. "/api/stores/:storeId/products". */
  path: string;
  controller: string;
  handler: string;
  /** @RequirePermission value, or undefined. */
  permission?: string;
  /** @HttpCode value, or undefined (Nest default: 201 for POST, 200 otherwise). */
  status?: number;
  /** Names of the guards on the controller class and on the handler. */
  guards: string[];
}

const join = (...parts: string[]) => `/${parts.map((p) => p.replace(/^\/+|\/+$/g, "")).filter(Boolean).join("/")}`;

/** Every route the booted app really serves, read from Nest's own metadata (not from source text). */
export function registeredRoutes(app: INestApplication, prefix = "api"): RegisteredRoute[] {
  const out: RegisteredRoute[] = [];
  for (const mod of app.get(ModulesContainer).values()) {
    for (const wrapper of mod.controllers.values()) {
      const cls = wrapper.metatype as (new (...a: never[]) => unknown) | undefined;
      if (!cls) continue;
      const base = String(Reflect.getMetadata(PATH_METADATA, cls) ?? "");
      const proto = cls.prototype as Record<string, unknown>;
      for (const name of Object.getOwnPropertyNames(proto)) {
        if (name === "constructor" || typeof proto[name] !== "function") continue;
        const fn = proto[name] as object;
        const method = Reflect.getMetadata(METHOD_METADATA, fn) as RequestMethod | undefined;
        const sub = Reflect.getMetadata(PATH_METADATA, fn) as string | undefined;
        if (method === undefined || sub === undefined) continue;
        out.push({
          method: RequestMethod[method],
          path: join(prefix, base, sub),
          controller: cls.name,
          handler: name,
          permission: Reflect.getMetadata(PERMISSION_KEY, fn) as string | undefined,
          status: Reflect.getMetadata(HTTP_CODE_METADATA, fn) as number | undefined,
          guards: [...((Reflect.getMetadata(GUARDS_METADATA, cls) as { name: string }[] | undefined) ?? []), ...((Reflect.getMetadata(GUARDS_METADATA, fn) as { name: string }[] | undefined) ?? [])].map((g) => g.name),
        });
      }
    }
  }
  return out.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
}
