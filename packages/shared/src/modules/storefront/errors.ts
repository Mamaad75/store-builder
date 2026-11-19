export class CandidateThemeUnavailableError extends Error {
  constructor() {
    super("Candidate theme is not available");
    this.name = "CandidateThemeUnavailableError";
  }
}
