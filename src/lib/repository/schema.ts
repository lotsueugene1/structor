import { z } from "zod";

import { projectSchema } from "@/lib/architecture/schema";

export const repositoryFileTypeSchema = z.enum([
  "manifest",
  "config",
  "page",
  "api-route",
  "feature",
  "data-schema",
  "state-store",
  "integration-config",
  "source",
  "test",
  "documentation",
  "other",
]);

export const repositoryManifestFileSchema = z
  .object({
    path: z.string().min(1).max(300),
    type: repositoryFileTypeSchema,
    size: z
      .number()
      .int()
      .nonnegative()
      .max(512 * 1024),
  })
  .strict();

export const repositoryManifestSchema = z
  .object({
    project: z.string().trim().min(1).max(80),
    repositoryRoot: z.string().max(300),
    frameworks: z.array(z.string().trim().min(1).max(80)).max(12),
    appRoots: z.array(z.string().min(1).max(300)).max(20),
    files: z.array(repositoryManifestFileSchema).max(400),
  })
  .strict();

export const repositoryImportStatsSchema = z
  .object({
    entriesDiscovered: z.number().int().nonnegative().max(5000),
    filesDiscovered: z.number().int().nonnegative().max(5000),
    analyzedFiles: z.number().int().nonnegative().max(400),
    ignoredFiles: z.number().int().nonnegative().max(5000),
    declaredUncompressedBytes: z
      .number()
      .int()
      .nonnegative()
      .max(60 * 1024 * 1024),
  })
  .strict();

export const repositoryImportSuccessSchema = z
  .object({
    ok: z.literal(true),
    project: projectSchema,
    manifest: repositoryManifestSchema,
    stats: repositoryImportStatsSchema,
  })
  .strict();

export const repositoryImportErrorCodeSchema = z.enum([
  "INVALID_MULTIPART",
  "MISSING_REPOSITORY",
  "INVALID_FILE_TYPE",
  "FILE_TOO_LARGE",
  "INVALID_ZIP_SIGNATURE",
  "INVALID_ARCHIVE",
  "UNSAFE_ARCHIVE",
  "UNSUPPORTED_ARCHIVE",
  "TOO_MANY_ENTRIES",
  "ARCHIVE_TOO_LARGE",
  "NO_ANALYZABLE_FILES",
  "ANALYSIS_TIMEOUT",
  "REQUEST_ABORTED",
  "SERVER_BUSY",
  "INTERNAL_ERROR",
]);

export const repositoryImportErrorSchema = z
  .object({
    ok: z.literal(false),
    error: z
      .object({
        code: repositoryImportErrorCodeSchema,
        message: z.string().trim().min(1).max(300),
      })
      .strict(),
  })
  .strict();

export const repositoryImportResponseSchema = z.discriminatedUnion("ok", [
  repositoryImportSuccessSchema,
  repositoryImportErrorSchema,
]);

export type RepositoryFileType = z.infer<typeof repositoryFileTypeSchema>;
export type RepositoryManifest = z.infer<typeof repositoryManifestSchema>;
export type RepositoryImportStats = z.infer<typeof repositoryImportStatsSchema>;
export type RepositoryImportSuccess = z.infer<
  typeof repositoryImportSuccessSchema
>;
export type RepositoryImportErrorCode = z.infer<
  typeof repositoryImportErrorCodeSchema
>;
export type RepositoryImportError = z.infer<typeof repositoryImportErrorSchema>;
export type RepositoryImportResponse = z.infer<
  typeof repositoryImportResponseSchema
>;
