import { UNAVAILABLE_ERROR } from "@/app/actions-auth";
import { ApiUnavailableError, UnauthenticatedError } from "./http";
import { hardGo } from "./nav";
import { StoreSuspendedError } from "@store-builder/shared/modules/access/errors";

/**
 * Failures that belong to no particular form: a missing/revoked session sends the person to /login, an unreachable API becomes the
 * standard message. Returns the form state to show, or `null` when the error is not one of these (the caller then handles it or rethrows).
 */
export function transportState(e: unknown): { error?: string } | null {
  if (e instanceof UnauthenticatedError) {
    hardGo("/login");
    return {};
  }
  if (e instanceof ApiUnavailableError) return { error: UNAVAILABLE_ERROR };
  // ADR 0003 (G2): the platform suspended the store; every form shows the same explanation (403 STORE_SUSPENDED).
  if (e instanceof StoreSuspendedError) return { error: e.message };
  return null;
}

/** For handlers without a form state (plain buttons): sign-in problems are handled, anything else is rethrown to the error boundary. */
export function unexpected(e: unknown): void {
  if (e instanceof UnauthenticatedError) {
    hardGo("/login");
    return;
  }
  throw e;
}
