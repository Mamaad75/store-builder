import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, HttpStatus, Inject } from "@nestjs/common";
import type { Request, Response } from "express";
import type { ErrorReporter } from "@store-builder/shared/observability/error-report";
import { domainErrorPayload, isDomainError, statusOfDomainError } from "@store-builder/shared/errors/registry";
import { ERROR_REPORTER, LOGGER } from "../config/tokens.js";
import { routeLabel } from "../platform/observability/metrics.js";
import { currentRequestId } from "../platform/observability/request-context.js";
import type { ApiErrorV1 } from "@store-builder/shared/api/schemas";
import { isV1 } from "./api-version.js";
import { ApiProblem } from "./api-problem.js";
import type { JsonLogger } from "../logging/json-logger.js";

const REASONS: Record<number, string> = {
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  405: "Method Not Allowed",
  409: "Conflict",
  413: "Payload Too Large",
  415: "Unsupported Media Type",
  422: "Unprocessable Entity",
  429: "Too Many Requests",
  500: "Internal Server Error",
  502: "Bad Gateway",
  503: "Service Unavailable",
};

/**
 * Every error leaves with fixed text per status, never the exception's message, stack or details. Unversioned paths keep their shape
 * `{ statusCode, error, ... }` (the web app reads it); /api/v1 answers `{ error: { code, message, reason?, fieldErrors?, ... }, requestId }`.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(
    @Inject(LOGGER) private readonly logger: JsonLogger,
    @Inject(ERROR_REPORTER) private readonly reporter: ErrorReporter,
  ) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    if (isDomainError(exception)) {
      const dcode = statusOfDomainError(exception.name);
      if (dcode >= 500) this.logger.event("error", "api.domain_error", { statusCode: dcode, errorName: exception.name });
      const payload = domainErrorPayload(exception);
      const retry = (exception as { retryAfterSeconds?: number }).retryAfterSeconds;
      if (retry) res.setHeader("Retry-After", String(Math.ceil(retry)));
      if (isV1(res)) {
        const fieldErrors = payload.fieldErrors as Record<string, string[]> | undefined;
        const rest = { ...payload };
        delete rest.fieldErrors;
        delete rest.retryAfterSeconds;
        res.status(dcode).json(v1Error(dcode, { reason: exception.name, fieldErrors, retryAfterSeconds: retry ? Math.ceil(retry) : undefined, details: Object.keys(rest).length ? rest : undefined }));
        return;
      }
      res.status(dcode).json({ statusCode: dcode, error: REASONS[dcode] ?? "Unprocessable Entity", errorName: exception.name, payload });
      return;
    }
    const status = exception instanceof HttpException ? exception.getStatus() : (exception as { status?: number; statusCode?: number })?.status ?? (exception as { statusCode?: number })?.statusCode ?? HttpStatus.INTERNAL_SERVER_ERROR;
    const code = typeof status === "number" && status >= 400 && status <= 599 ? status : 500;
    if (code >= 500) this.logger.event("error", "api.error", { statusCode: code, errorClass: exception instanceof Error ? exception.name : "UnknownError" });
    // Error tracking (phase 2.6): only UNEXPECTED failures (a bug or a broken dependency). A deliberate HttpException or ApiProblem and
    // every domain error are expected outcomes, already answered and logged. Tags: route template and method only, never the URL.
    if (code >= 500 && !(exception instanceof HttpException)) {
      const req = host.switchToHttp().getRequest<Request>();
      this.reporter.capture(exception, { route: routeLabel(req), method: req.method, request_id: currentRequestId(), status: String(code) });
    }
    const detail = exception instanceof ApiProblem ? exception.detail : {};
    if (detail.retryAfterSeconds) res.setHeader("Retry-After", String(detail.retryAfterSeconds));
    if (isV1(res)) {
      res.status(code).json(v1Error(code, { reason: detail.code, fieldErrors: detail.fieldErrors, retryAfterSeconds: detail.retryAfterSeconds }));
      return;
    }
    const body: Record<string, unknown> = { statusCode: code, error: REASONS[code] ?? (code >= 500 ? "Server Error" : "Request Error") };
    if (detail.code) body.code = detail.code;
    if (detail.fieldErrors) body.fieldErrors = detail.fieldErrors;
    if (detail.retryAfterSeconds) body.retryAfterSeconds = detail.retryAfterSeconds;
    res.status(code).json(body);
  }
}

/** v1 error codes and their fixed Persian messages (phase 2.5): the same text for every error of a status, never the exception's own. */
const V1: Record<number, [string, string]> = {
  400: ["BAD_REQUEST", "درخواست نامعتبر است."],
  401: ["UNAUTHENTICATED", "ابتدا وارد حساب کاربری خود شوید."],
  403: ["FORBIDDEN", "اجازه‌ی انجام این کار را ندارید."],
  404: ["NOT_FOUND", "مورد درخواستی پیدا نشد."],
  405: ["METHOD_NOT_ALLOWED", "این روش درخواست پشتیبانی نمی‌شود."],
  409: ["CONFLICT", "این مورد در این فاصله تغییر کرده است؛ دوباره بارگذاری کنید."],
  413: ["PAYLOAD_TOO_LARGE", "حجم درخواست بیش از حد مجاز است."],
  415: ["UNSUPPORTED_MEDIA_TYPE", "نوع محتوای درخواست پشتیبانی نمی‌شود."],
  422: ["VALIDATION_FAILED", "اطلاعات واردشده معتبر نیست."],
  429: ["RATE_LIMITED", "تعداد درخواست‌ها زیاد است؛ کمی بعد دوباره امتحان کنید."],
  500: ["INTERNAL", "خطای داخلی سرور رخ داد."],
  502: ["BAD_GATEWAY", "سرویس وابسته پاسخ نداد."],
  503: ["UNAVAILABLE", "سرویس موقتاً در دسترس نیست."],
};

export function v1Error(status: number, o: { reason?: string; fieldErrors?: Record<string, string[]>; retryAfterSeconds?: number; details?: Record<string, unknown> }): ApiErrorV1 {
  // Field-level problems are always VALIDATION_FAILED, whatever status the error has kept for the unversioned paths (400 or 422).
  const [code, message] = o.fieldErrors && status < 500 ? V1[422]! : (V1[status] ?? (status >= 500 ? V1[500]! : V1[400]!));
  const requestId = currentRequestId();
  return {
    error: {
      code,
      message,
      ...(o.reason ? { reason: o.reason } : {}),
      ...(o.fieldErrors ? { fieldErrors: o.fieldErrors } : {}),
      ...(o.retryAfterSeconds ? { retryAfterSeconds: o.retryAfterSeconds } : {}),
      ...(o.details ? { details: o.details } : {}),
    },
    ...(requestId ? { requestId } : {}),
  };
}
