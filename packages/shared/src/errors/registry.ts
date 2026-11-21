import { InvitationTargetError, PermissionDeniedError, StaffLimitError } from "../modules/access/errors.js";
import { CandidateThemeUnavailableError } from "../modules/storefront/errors.js";
import { MediaInUseError, MediaQuotaError, MediaRateLimitError, MediaStorageError, MediaValidationError } from "../modules/media/errors.js";
import { PageNeedsRecoveryError, SectionLimitError, UnsupportedTemplateError } from "../modules/pages/errors.js";
import * as publishing from "../modules/publishing/errors.js";
import { CatalogLimitError, CategoryNotEmptyError, ConflictError, DraftBusyError, NotFoundError, StoreLimitError, ValidationError } from "../modules/stores/errors.js";
import { ThemeSwitchBlockedError } from "../modules/stores/theme-switch-types.js";

/**
 * Domain errors cross the HTTP boundary as `{ statusCode, error, errorName, payload }` and are rebuilt on the other side as instances of the
 * SAME classes, so callers keep using `instanceof` exactly as when the services were in-process. Only the classes listed here are ever
 * transported, and only their own data fields (never the message, the stack or a `cause`): the message is rebuilt from the class.
 */
type ErrorClass = new (...args: never[]) => Error;

const publishingErrors = Object.fromEntries(Object.entries(publishing).filter(([, v]) => typeof v === "function")) as Record<string, ErrorClass>;

export const DOMAIN_ERRORS: Record<string, ErrorClass> = {
  NotFoundError, ValidationError, ConflictError, StoreLimitError, CatalogLimitError, CategoryNotEmptyError, DraftBusyError,
  PageNeedsRecoveryError, SectionLimitError, UnsupportedTemplateError,
  MediaValidationError, MediaQuotaError, MediaInUseError, MediaRateLimitError, MediaStorageError,
  ThemeSwitchBlockedError, CandidateThemeUnavailableError,
  PermissionDeniedError, InvitationTargetError, StaffLimitError,
  ...publishingErrors,
};

/** HTTP status per class (the default for a domain error is 422). */
const STATUS: Record<string, number> = {
  NotFoundError: 404, ValidationError: 400, ConflictError: 409, DraftBusyError: 409, PublishBusyError: 409, StoreAlreadyLiveError: 409, VersionAlreadyLiveError: 409,
  PermissionDeniedError: 403, InvitationTargetError: 400, StaffLimitError: 409,
  SubdomainTakenError: 409, SlugReservationConflictError: 409, MediaInUseError: 409, MediaRateLimitError: 429, PublishRateLimitedError: 429, MediaStorageError: 502, PublishTimedOutError: 503,
};

export function statusOfDomainError(name: string): number {
  return STATUS[name] ?? 422;
}

export function isDomainError(e: unknown): e is Error {
  return e instanceof Error && Object.prototype.hasOwnProperty.call(DOMAIN_ERRORS, e.name) && e instanceof DOMAIN_ERRORS[e.name]!;
}

/** The own data fields of a domain error (everything the constructor stored), without `message`, `stack`, `cause` or `name`. */
export function domainErrorPayload(e: Error): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(e)) if (k !== "message" && k !== "stack" && k !== "cause" && k !== "name") out[k] = v;
  return out;
}

/** Rebuilds an error of a known class from a transported payload. Unknown names yield null. */
export function rebuildDomainError(name: unknown, payload: unknown): Error | null {
  if (typeof name !== "string" || !Object.prototype.hasOwnProperty.call(DOMAIN_ERRORS, name)) return null;
  const Cls = DOMAIN_ERRORS[name]!;
  const err = Object.create(Cls.prototype) as Error;
  const proto = Cls.prototype as Error;
  Object.defineProperty(err, "message", { value: proto.message || name, writable: true, configurable: true, enumerable: false });
  Object.defineProperty(err, "name", { value: name, writable: true, configurable: true, enumerable: false });
  if (payload && typeof payload === "object") for (const [k, v] of Object.entries(payload as Record<string, unknown>)) (err as unknown as Record<string, unknown>)[k] = v;
  return err;
}
