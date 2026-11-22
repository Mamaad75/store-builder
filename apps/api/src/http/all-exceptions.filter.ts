import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, HttpStatus, Inject } from "@nestjs/common";
import type { Request, Response } from "express";
import type { ErrorReporter } from "@store-builder/shared/observability/error-report";
import { domainErrorPayload, isDomainError, statusOfDomainError } from "@store-builder/shared/errors/registry";
import { ERROR_REPORTER, LOGGER } from "../config/tokens.js";
import { routeLabel } from "../platform/observability/metrics.js";
import { currentRequestId } from "../platform/observability/request-context.js";
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

/** Every error leaves as `{ statusCode, error }`: fixed text per status, never the exception's message, stack or details. */
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
      const dbody: Record<string, unknown> = { statusCode: dcode, error: REASONS[dcode] ?? "Unprocessable Entity", errorName: exception.name, payload: domainErrorPayload(exception) };
      const retry = (exception as { retryAfterSeconds?: number }).retryAfterSeconds;
      if (retry) res.setHeader("Retry-After", String(Math.ceil(retry)));
      res.status(dcode).json(dbody);
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
    const body: Record<string, unknown> = { statusCode: code, error: REASONS[code] ?? (code >= 500 ? "Server Error" : "Request Error") };
    if (exception instanceof ApiProblem) {
      const { code: reason, fieldErrors, retryAfterSeconds } = exception.detail;
      if (reason) body.code = reason;
      if (fieldErrors) body.fieldErrors = fieldErrors;
      if (retryAfterSeconds) {
        body.retryAfterSeconds = retryAfterSeconds;
        res.setHeader("Retry-After", String(retryAfterSeconds));
      }
    }
    res.status(code).json(body);
  }
}
