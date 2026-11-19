import type { LoggerService } from "@nestjs/common";

/**
 * Structured logging (same contract as the web app's src/lib/log.ts): one JSON object per line, values under sensitive key names
 * replaced by "[redacted]", Error objects reduced to their class name, strings bounded. Console output is allowed ONLY in this file
 * (lint rule `no-console` and an architecture test).
 */
export type LogLevel = "info" | "warn" | "error";

const SENSITIVE = /(pass(word)?|secret|token|authorization|cookie|credential|api[-_]?key|email|link|url|hash)/i;
const MAX_STRING = 500;

export function redact(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Error) return { name: value.name };
  if (depth >= 3) return "[depth]";
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => redact(v, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = SENSITIVE.test(k) ? "[redacted]" : redact(v, depth + 1);
    return out;
  }
  return typeof value;
}

export function formatLog(level: LogLevel, event: string, fields: Record<string, unknown> = {}, now: () => Date = () => new Date()): string {
  const rest = { ...fields };
  delete rest.ts;
  delete rest.level;
  delete rest.event;
  return JSON.stringify({ ts: now().toISOString(), level, event, ...(redact(rest) as Record<string, unknown>) });
}

export type LogSink = (level: LogLevel, line: string) => void;

/* eslint-disable no-console -- the one file allowed to write to the console */
const consoleSink: LogSink = (level, line) => {
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.info(line);
};
/* eslint-enable no-console */

/** Nest logger that writes the structured format. Framework messages become `nest.<context>` events. */
export class JsonLogger implements LoggerService {
  constructor(private readonly sink: LogSink = consoleSink) {}

  event(level: LogLevel, event: string, fields?: Record<string, unknown>): void {
    this.sink(level, formatLog(level, event, fields));
  }
  log(message: unknown, context?: string): void {
    this.event("info", "nest.log", { context, message: typeof message === "string" ? message : "[object]" });
  }
  warn(message: unknown, context?: string): void {
    this.event("warn", "nest.warn", { context, message: typeof message === "string" ? message : "[object]" });
  }
  error(message: unknown, _stack?: unknown, context?: string): void {
    // never the stack or the message of an Error: they can carry values
    this.event("error", "nest.error", { context, message: message instanceof Error ? message.name : typeof message === "string" ? message : "[object]" });
  }
  debug(): void {}
  verbose(): void {}
}
