export const architectureGenerateErrorCodes = [
  "INVALID_REQUEST",
  "NOT_CONFIGURED",
  "MODEL_UNAVAILABLE",
  "GENERATION_FAILED",
  "INVALID_ARCHITECTURE",
  "TIMEOUT",
  "REQUEST_ABORTED",
  "SERVER_BUSY",
  "INTERNAL_ERROR",
] as const;

export type ArchitectureGenerateErrorCode =
  (typeof architectureGenerateErrorCodes)[number];

export class ArchitectureGenerateError extends Error {
  constructor(
    readonly code: ArchitectureGenerateErrorCode,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ArchitectureGenerateError";
  }
}
