import type { RepositoryImportErrorCode } from "./schema";

export class RepositoryImportError extends Error {
  constructor(
    readonly code: RepositoryImportErrorCode,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "RepositoryImportError";
  }
}
