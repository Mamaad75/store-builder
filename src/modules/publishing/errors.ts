/** Typed outcomes of publishing and subdomain operations. Every one is raised inside the transaction, so it rolls back. */
export class PublishBusyError extends Error {
  constructor() {
    super("Another operation on this store is running; retry shortly");
    this.name = "PublishBusyError";
  }
}
export class PublishTimedOutError extends Error {
  constructor(public readonly step: string) {
    super(`Publishing exceeded its lock-hold budget at step "${step}"`);
    this.name = "PublishTimedOutError";
  }
}
export class NoChangesError extends Error {
  constructor() {
    super("The draft is identical to the live version");
    this.name = "NoChangesError";
  }
}
export class SnapshotTooLargeError extends Error {
  constructor(public readonly bytes: number, public readonly limit: number) {
    super(`Snapshot is ${bytes} bytes (limit ${limit})`);
    this.name = "SnapshotTooLargeError";
  }
}
export class SnapshotTextError extends Error {
  constructor(public readonly where: string) {
    super(`Snapshot contains text PostgreSQL JSONB cannot store (${where})`);
    this.name = "SnapshotTextError";
  }
}
export class PublishDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PublishDataError";
  }
}
export class PublishRateLimitedError extends Error {
  constructor(public readonly retryAfterMs: number, public readonly limit: number) {
    super(`At most ${limit} publishes per hour`);
    this.name = "PublishRateLimitedError";
  }
}
export class SubdomainRequiredError extends Error {
  constructor() {
    super("Claim a subdomain before publishing");
    this.name = "SubdomainRequiredError";
  }
}
export class SlugHistoryLimitError extends Error {
  constructor(public readonly products: { id: string; name: string }[], public readonly limit: number) {
    super(`Products exceed the published-slug history limit (${limit})`);
    this.name = "SlugHistoryLimitError";
  }
}
export class RedirectLimitError extends Error {
  constructor(public readonly count: number, public readonly limit: number) {
    super(`Redirect count ${count} exceeds ${limit}`);
    this.name = "RedirectLimitError";
  }
}
export class ReservedSlugLimitError extends Error {
  constructor(public readonly count: number, public readonly limit: number) {
    super(`Reserved slug count ${count} exceeds ${limit}`);
    this.name = "ReservedSlugLimitError";
  }
}
export class SlugReservationConflictError extends Error {
  constructor(public readonly slug: string) {
    super(`Slug "${slug}" is already reserved for another product`);
    this.name = "SlugReservationConflictError";
  }
}
export class StoreNotLiveError extends Error {
  constructor() {
    super("The store is not published");
    this.name = "StoreNotLiveError";
  }
}
export class StoreAlreadyLiveError extends Error {
  constructor() {
    super("The store is already published");
    this.name = "StoreAlreadyLiveError";
  }
}
export class VersionAlreadyLiveError extends Error {
  constructor() {
    super("That version is already live");
    this.name = "VersionAlreadyLiveError";
  }
}
export class IncompatibleVersionError extends Error {
  constructor() {
    super("That version cannot be rendered by the current application");
    this.name = "IncompatibleVersionError";
  }
}
export class SubdomainTakenError extends Error {
  constructor() {
    super("Subdomain is taken");
    this.name = "SubdomainTakenError";
  }
}
export class SubdomainReservedError extends Error {
  constructor(public readonly until: Date) {
    super(`Subdomain is reserved until ${until.toISOString()}`);
    this.name = "SubdomainReservedError";
  }
}
export class ReservedLabelLimitError extends Error {
  constructor(public readonly until: Date, public readonly limit: number) {
    super(`At most ${limit} released subdomains can be reserved at once`);
    this.name = "ReservedLabelLimitError";
  }
}
export class ConfirmationRequiredError extends Error {
  constructor() {
    super("Changing a live subdomain needs confirmation");
    this.name = "ConfirmationRequiredError";
  }
}
