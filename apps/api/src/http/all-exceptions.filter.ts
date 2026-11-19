import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, HttpStatus, Inject } from "@nestjs/common";
import type { Response } from "express";
import { LOGGER } from "../config/tokens.js";
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
  503: "Service Unavailable",
};

/** Every error leaves as `{ statusCode, error }`: fixed text per status, never the exception's message, stack or details. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(@Inject(LOGGER) private readonly logger: JsonLogger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const status = exception instanceof HttpException ? exception.getStatus() : (exception as { status?: number; statusCode?: number })?.status ?? (exception as { statusCode?: number })?.statusCode ?? HttpStatus.INTERNAL_SERVER_ERROR;
    const code = typeof status === "number" && status >= 400 && status <= 599 ? status : 500;
    if (code >= 500) this.logger.event("error", "api.error", { statusCode: code, errorClass: exception instanceof Error ? exception.name : "UnknownError" });
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
