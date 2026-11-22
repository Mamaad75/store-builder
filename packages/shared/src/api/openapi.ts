import { z } from "zod";
import { ROUTES, type RouteSpec } from "./contract.js";
import { v1PathOf } from "./routing.js";
import { apiErrorV1 } from "./schemas.js";

/**
 * OpenAPI 3.1 document of the v1 API (phase 2.5, D25-1), generated from the route contract with Zod's own JSON Schema output (no extra
 * dependency). Deterministic: the same contract always yields the same JSON, so the committed file (docs/api/openapi.json) can be
 * checked for drift in CI. Health and readiness are listed unversioned; the deprecated unversioned product paths are not documented.
 */
type Json = Record<string, unknown>;

function schemaOf(s: z.ZodType, io: "input" | "output"): Json {
  const out = z.toJSONSchema(s, { io, unrepresentable: "any", target: "draft-2020-12" }) as Json;
  delete out.$schema;
  return out;
}

const SCOPE_TAG: Record<string, string> = { auth: "auth", me: "me", admin: "admin", store: "store" };
const tagOf = (v1: string | null) => (v1 ? (SCOPE_TAG[v1.split("/")[3] ?? ""] ?? "other") : "operations");
const openApiPath = (p: string) => p.replace(/:(\w+)/g, "{$1}");

const ERRORS: Record<string, string> = {
  "400": "Invalid request",
  "401": "Not signed in",
  "403": "Signed in, but this action needs a permission the member does not have",
  "404": "Not found (also: a store the user has no role in)",
  "409": "Conflict (e.g. the page changed since it was read)",
  "422": "Validation failed (`fieldErrors`)",
  "429": "Too many requests (`retryAfterSeconds`)",
  "500": "Server error (details never leave the server)",
};

function operation(rt: RouteSpec, v1: string | null): Json {
  const params: Json[] = [...rt.path.matchAll(/:(\w+)/g)].map((m) => ({ name: m[1], in: "path", required: true, schema: { type: "string" } }));
  if (rt.query) {
    const q = schemaOf(rt.query, "input") as { properties?: Record<string, Json>; required?: string[] };
    for (const [name, schema] of Object.entries(q.properties ?? {})) params.push({ name, in: "query", required: (q.required ?? []).includes(name), schema });
  }
  const op: Json = {
    operationId: `${rt.method.toLowerCase()}${openApiPath(v1 ?? rt.path).replace(/[{}]/g, "").replace(/(^|[/_-])(\w)/g, (_m, _s, c: string) => c.toUpperCase())}`,
    summary: rt.summary,
    tags: [tagOf(v1)],
    ...(params.length ? { parameters: params } : {}),
    ...(rt.auth === "session" ? { security: [{ session: [] }] } : { security: [] }),
    ...(rt.permission ? { "x-permission": rt.permission } : {}),
  };
  if (rt.body === "image") {
    op.requestBody = { required: true, content: { "application/octet-stream": { schema: { type: "string", contentMediaType: "image/*", description: "JPEG, PNG or WebP, at most 5 MB" } } } };
  } else if (rt.body) {
    op.requestBody = { required: true, content: { "application/json": { schema: schemaOf(rt.body, "input") } }, ...(rt.bodyDoc ? { description: "Fields are validated one by one by the service." } : {}) };
  }
  const ok: Json = { description: rt.untyped ? "Success (response schema not described yet)" : "Success" };
  if (rt.response) ok.content = { "application/json": { schema: schemaOf(rt.response, "output") } };
  else if (rt.untyped) ok.content = { "application/json": { schema: {} } };
  const responses: Json = { [String(rt.status)]: ok };
  if (v1) for (const [code, description] of Object.entries(ERRORS)) responses[code] = { description, content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorV1" } } } };
  op.responses = responses;
  return op;
}

export function buildOpenApi(version = "1.0.0"): Json {
  const paths: Record<string, Json> = {};
  for (const rt of ROUTES) {
    const v1 = v1PathOf(rt.path);
    const key = openApiPath(v1 ?? rt.path);
    paths[key] = { ...(paths[key] ?? {}), [rt.method.toLowerCase()]: operation(rt, v1) };
  }
  const sorted = Object.fromEntries(Object.entries(paths).sort(([a], [b]) => a.localeCompare(b)));
  return {
    openapi: "3.1.0",
    info: {
      title: "Store Builder API",
      version,
      description:
        "Versioned API (v1). Scopes: /api/v1/auth, /api/v1/me, /api/v1/admin (merchant), /api/v1/store (shoppers); /api/v1/platform is reserved. " +
        "State-changing requests must come from the platform origin (Origin check). Errors have one shape (ErrorV1) with a fixed code and a Persian message.",
    },
    servers: [{ url: "/" }],
    tags: [
      { name: "auth", description: "Sign-in, sign-up, session" },
      { name: "me", description: "The signed-in account" },
      { name: "admin", description: "A merchant's stores (store roles and permissions apply)" },
      { name: "store", description: "Published storefronts, for shoppers" },
      { name: "operations", description: "Health and readiness (unversioned)" },
    ],
    paths: sorted,
    components: {
      securitySchemes: { session: { type: "apiKey", in: "cookie", name: "__Host-sb_session", description: "Session cookie (sb_session over plain http in development)" } },
      schemas: { ErrorV1: schemaOf(apiErrorV1, "output") },
    },
  };
}
