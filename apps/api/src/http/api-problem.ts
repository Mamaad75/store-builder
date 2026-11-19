import { HttpException } from "@nestjs/common";

export interface ProblemDetail {
  /** Stable machine-readable reason, e.g. "invalid", "rate_limited". Never free text. */
  code?: string;
  fieldErrors?: Record<string, string[]>;
  retryAfterSeconds?: number;
}

/** An expected, client-caused failure whose small, whitelisted detail may be returned (the exception filter copies only these keys). */
export class ApiProblem extends HttpException {
  constructor(status: number, readonly detail: ProblemDetail = {}) {
    super("problem", status);
  }
}
