import { getAppEnv } from "./env";

/** Public address of a store: `<protocol>://<label>.<APP_ROOT_DOMAIN>` (never derived from request headers). */
export function publicStoreUrl(label: string, env = getAppEnv()): string {
  return `${env.APP_PROTOCOL}://${label}.${env.APP_ROOT_DOMAIN}`;
}
