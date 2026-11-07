/** The page holds invalid/unknown section data: every edit is refused until the owner runs the explicit recovery. */
export class PageNeedsRecoveryError extends Error {
  constructor(public readonly invalidCount: number) {
    super("Page contains invalid sections");
    this.name = "PageNeedsRecoveryError";
  }
}

export class SectionLimitError extends Error {
  constructor(public readonly limit: number) {
    super(`Section limit reached (${limit})`);
    this.name = "SectionLimitError";
  }
}

/** The store's template has no renderer/editor registered (e.g. coffee/fashion before phase 9). */
export class UnsupportedTemplateError extends Error {
  constructor() {
    super("Template is not supported for editing");
    this.name = "UnsupportedTemplateError";
  }
}

/** Internal signal: the operation turned out to change nothing. Rolls the transaction back so no revision is bumped. */
export class NoChange extends Error {
  constructor() {
    super("no change");
    this.name = "NoChange";
  }
}
