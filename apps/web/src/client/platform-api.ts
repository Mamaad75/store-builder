import { send } from "./http";

/** Browser writes of the super admin pages (phase 3.1): same-origin calls to /api/v1/platform (Caddy in production, Next in development). */
const P = "/api/v1/platform";
const enc = encodeURIComponent;

export const updatePlatformSettings = (group: "sms" | "payment" | "ai" | "rates", body: unknown) => send("PATCH", `${P}/settings/${enc(group)}`, { body });
export const setPlatformSecret = (name: string, value: string) => send("POST", `${P}/secrets/${enc(name)}`, { body: { value } });
export const removePlatformSecret = (name: string) => send("POST", `${P}/secrets/${enc(name)}/delete`);
export const grantPlatformAdmin = (username: string) => send<{ userId: string }>("POST", `${P}/admins`, { body: { username } });
export const revokePlatformAdmin = (userId: string) => send("POST", `${P}/admins/${enc(userId)}/revoke`);
// phase 3.2b: rates
export const enterRate = (code: "USD" | "GOLD18", rateToman: number) => send("POST", `${P}/rates`, { body: { code, rateToman } });
export const decideRate = (id: string, to: "confirm" | "reject") => send("POST", `${P}/rates/${enc(id)}/${to}`);
// ADR 0003 (G2): platform store suspension
export const suspendStore = (storeId: string, body: { reason: string; publicMessage: string; internalNote: string }) => send("POST", `${P}/stores/${enc(storeId)}/suspend`, { body });
export const restoreStore = (storeId: string, note: string) => send("POST", `${P}/stores/${enc(storeId)}/restore`, { body: { note } });
export type SuspensionRow = { id: string; reason: string; publicMessage: string; internalNote: string; merchantStatusAtStart: string; suspendedAt: string; liftedAt: string | null; liftNote: string | null };
export const getSuspensions = (storeId: string) => send<SuspensionRow[]>("GET", `${P}/stores/${enc(storeId)}/suspensions`);
