import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

/**
 * Request correlation (phase 2.6): every API request carries one id, in the `X-Request-Id` response header, on every log line written
 * while it is handled (json-logger reads it from here) and as a tag of its error report. An incoming id is kept only when it is a short
 * token of safe characters (so a client or the reverse proxy can correlate), otherwise a new one is made: it can never inject text into
 * a log line.
 */
const store = new AsyncLocalStorage<{ requestId: string }>();
const INCOMING = /^[A-Za-z0-9._-]{8,64}$/;

export const currentRequestId = (): string | undefined => store.getStore()?.requestId;

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const raw = req.headers["x-request-id"];
  const requestId = typeof raw === "string" && INCOMING.test(raw) ? raw : randomUUID();
  res.setHeader("X-Request-Id", requestId);
  store.run({ requestId }, next);
}
