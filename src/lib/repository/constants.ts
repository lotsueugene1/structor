export const MAX_COMPRESSED_BYTES = 20 * 1024 * 1024;
export const MAX_ENTRIES = 5000;
export const MAX_DECLARED_UNCOMPRESSED_BYTES = 60 * 1024 * 1024;
export const MAX_ANALYZED_FILE_BYTES = 512 * 1024;
export const MAX_ANALYZED_FILES = 400;
export const MAX_NORMALIZED_PATH_LENGTH = 300;
export const MAX_COMPRESSION_RATIO = 100;
export const MAX_CONCURRENT_IMPORTS = 2;
export const ANALYSIS_TIMEOUT_MS = 25_000;
export const SCANNER_VERSION = "deterministic-v1";

export const ZIP_MEDIA_TYPES = new Set([
  "",
  "application/zip",
  "application/x-zip-compressed",
  "application/octet-stream",
]);
