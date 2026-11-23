import { send } from "./http";

/** Browser writes of the super admin pages (phase 3.1): same-origin calls to /api/v1/platform (Caddy in production, Next in development). */
const P = "/api/v1/platform";
const enc = encodeURIComponent;

export const updatePlatformSettings = (group: "sms" | "payment" | "ai", body: unknown) => send("PATCH", `${P}/settings/${enc(group)}`, { body });
export const setPlatformSecret = (name: string, value: string) => send("POST", `${P}/secrets/${enc(name)}`, { body: { value } });
export const removePlatformSecret = (name: string) => send("POST", `${P}/secrets/${enc(name)}/delete`);
export const grantPlatformAdmin = (username: string) => send<{ userId: string }>("POST", `${P}/admins`, { body: { username } });
export const revokePlatformAdmin = (userId: string) => send("POST", `${P}/admins/${enc(userId)}/revoke`);
