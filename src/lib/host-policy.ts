import { getAppEnv } from "./env";
import { platformAliases } from "./hostname";

export interface HostPolicy {
  rootDomain: string;
  /** Extra exact platform hosts: loopback names, only when NODE_ENV is "development" or "test". Empty otherwise. */
  aliases: string[];
}

/** The single place where the accepted-host configuration is assembled (root domain from APP_ROOT_DOMAIN, aliases from NODE_ENV). */
export function getHostPolicy(source: NodeJS.ProcessEnv = process.env): HostPolicy {
  const { APP_ROOT_DOMAIN } = getAppEnv(source);
  return { rootDomain: APP_ROOT_DOMAIN, aliases: platformAliases(APP_ROOT_DOMAIN, source.NODE_ENV) };
}
