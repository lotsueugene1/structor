import path from "node:path";
import { fromBufferPromise, type Entry, type ZipFile } from "yauzl";

import {
  MAX_ANALYZED_FILE_BYTES,
  MAX_ANALYZED_FILES,
  MAX_COMPRESSION_RATIO,
  MAX_DECLARED_UNCOMPRESSED_BYTES,
  MAX_ENTRIES,
  MAX_NORMALIZED_PATH_LENGTH,
} from "./constants";
import { RepositoryImportError } from "./errors";
import type { RepositoryFileType, RepositoryImportStats } from "./schema";

const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".hg",
  ".svn",
  "node_modules",
  ".next",
  ".nuxt",
  ".output",
  ".cache",
  ".parcel-cache",
  ".turbo",
  "cache",
  "caches",
  "coverage",
  "dist",
  "build",
  "out",
  "target",
  "tmp",
  "vendor",
  "generated",
  ".generated",
  "__macosx",
]);

const SENSITIVE_DIRECTORIES = new Set([
  ".aws",
  ".docker",
  ".gnupg",
  ".kube",
  ".ssh",
  "credential",
  "credentials",
  "secret",
  "secrets",
]);

const LOCK_FILES = new Set([
  "package-lock.json",
  "npm-shrinkwrap.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "bun.lock",
  "bun.lockb",
  "composer.lock",
  "gemfile.lock",
  "cargo.lock",
  "pipfile.lock",
  "poetry.lock",
  "uv.lock",
  "go.sum",
]);

const BINARY_EXTENSIONS = new Set([
  ".7z",
  ".a",
  ".avi",
  ".avif",
  ".bin",
  ".bmp",
  ".class",
  ".dmg",
  ".dll",
  ".doc",
  ".docx",
  ".eot",
  ".exe",
  ".flac",
  ".gif",
  ".gz",
  ".ico",
  ".jar",
  ".jpeg",
  ".jpg",
  ".lockb",
  ".m4a",
  ".mkv",
  ".mov",
  ".mp3",
  ".mp4",
  ".o",
  ".ogg",
  ".otf",
  ".pdf",
  ".png",
  ".ppt",
  ".pptx",
  ".pyc",
  ".rar",
  ".so",
  ".sqlite",
  ".sqlite3",
  ".tar",
  ".tgz",
  ".tiff",
  ".ttf",
  ".wav",
  ".webm",
  ".webp",
  ".woff",
  ".woff2",
  ".xls",
  ".xlsx",
  ".xz",
  ".zip",
]);

const TEXT_EXTENSIONS = new Set([
  ".astro",
  ".bash",
  ".c",
  ".cc",
  ".conf",
  ".cpp",
  ".cs",
  ".css",
  ".csv",
  ".env.example",
  ".fish",
  ".gql",
  ".go",
  ".gradle",
  ".graphql",
  ".h",
  ".html",
  ".java",
  ".js",
  ".json",
  ".jsonc",
  ".jsx",
  ".kt",
  ".kts",
  ".less",
  ".md",
  ".mdx",
  ".mjs",
  ".php",
  ".prisma",
  ".properties",
  ".proto",
  ".py",
  ".rb",
  ".rs",
  ".sass",
  ".scss",
  ".sh",
  ".sql",
  ".svelte",
  ".swift",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".vue",
  ".xml",
  ".yaml",
  ".yml",
  ".zsh",
]);

const TEXT_BASENAMES = new Set([
  "dockerfile",
  "gemfile",
  "makefile",
  "procfile",
  "rakefile",
  "requirements.txt",
  "go.mod",
]);

type SafeEntry = {
  entry: Entry;
  archivePath: string;
  path: string;
  symlink: boolean;
};

export type ScannedTextFile = {
  path: string;
  type: RepositoryFileType;
  size: number;
  text: string;
};

export type ScannedRepository = {
  archiveName: string;
  suggestedName: string;
  repositoryRoot: string;
  files: ScannedTextFile[];
  stats: RepositoryImportStats;
};

export type RepositoryScanOptions = {
  signal?: AbortSignal;
  deadline?: number;
};

function unsafeArchive(message: string) {
  return new RepositoryImportError("UNSAFE_ARCHIVE", message, 422);
}

function assertScanActive(options: RepositoryScanOptions) {
  if (options.signal?.aborted)
    throw new RepositoryImportError(
      "REQUEST_ABORTED",
      "Repository analysis was stopped.",
      408,
    );
  if (options.deadline !== undefined && Date.now() > options.deadline)
    throw new RepositoryImportError(
      "ANALYSIS_TIMEOUT",
      "Repository analysis took too long. Try a smaller ZIP.",
      408,
    );
}

function normalizeArchivePath(fileName: string) {
  if (/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(fileName))
    throw unsafeArchive("The archive contains an invalid file path.");
  if (fileName.includes("\\"))
    throw unsafeArchive("The archive contains a non-portable file path.");
  if (fileName.startsWith("/") || /^[a-zA-Z]:/.test(fileName))
    throw unsafeArchive("The archive contains an absolute file path.");

  const normalized = fileName.normalize("NFC");
  if (normalized.length > MAX_NORMALIZED_PATH_LENGTH)
    throw unsafeArchive(
      `Repository paths must be ${MAX_NORMALIZED_PATH_LENGTH} characters or shorter.`,
    );

  const parts = normalized.split("/");
  const pathParts = normalized.endsWith("/") ? parts.slice(0, -1) : parts;
  if (
    pathParts.length === 0 ||
    pathParts.some((part) => part === "" || part === "." || part === "..")
  ) {
    throw unsafeArchive("The archive contains an unsafe relative file path.");
  }

  return normalized;
}

function isDirectory(entry: Entry, archivePath: string) {
  if (archivePath.endsWith("/")) return true;
  const mode = entry.externalFileAttributes >>> 16;
  return (mode & 0xf000) === 0x4000;
}

function isSymlink(entry: Entry) {
  const platform = entry.versionMadeBy >>> 8;
  if (platform !== 3 && platform !== 19) return false;
  const mode = entry.externalFileAttributes >>> 16;
  return (mode & 0xf000) === 0xa000;
}

function commonRepositoryRoot(entries: SafeEntry[]) {
  if (entries.length === 0) return "";
  const first = entries[0].archivePath.split("/");
  if (first.length < 2) return "";
  const candidate = first[0];
  return entries.every((item) => {
    const parts = item.archivePath.split("/");
    return parts.length > 1 && parts[0] === candidate;
  })
    ? candidate
    : "";
}

function stripRepositoryRoot(archivePath: string, root: string) {
  return root ? archivePath.slice(root.length + 1) : archivePath;
}

function isSensitivePath(filePath: string) {
  const parts = filePath.toLowerCase().split("/");
  const basename = parts.at(-1) ?? "";
  if (
    parts
      .slice(0, -1)
      .some(
        (part) =>
          SENSITIVE_DIRECTORIES.has(part) ||
          /(^|[._-])(secret|secrets|credential|credentials)([._-]|$)/.test(
            part,
          ),
      )
  )
    return true;
  if (basename === ".env" || basename.startsWith(".env.")) return true;
  if (
    [
      ".netrc",
      ".npmrc",
      ".pypirc",
      "application_default_credentials.json",
      "credentials.json",
    ].includes(basename)
  )
    return true;
  if (
    [".key", ".pem", ".p12", ".pfx", ".jks", ".keystore", ".crt", ".cer"].some(
      (extension) => basename.endsWith(extension),
    )
  )
    return true;
  if (
    /^(id_(rsa|dsa|ecdsa|ed25519)|service-account.*\.json|firebase-adminsdk.*\.json)$/i.test(
      basename,
    )
  )
    return true;
  return /(^|[._-])(secret|secrets|credential|credentials)([._-]|$)/i.test(
    basename,
  );
}

function containsSecretMaterial(text: string) {
  return [
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
    /\bAKIA[0-9A-Z]{16}\b/,
    /\bgh[pousr]_[A-Za-z0-9]{36,}\b/,
    /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/,
    /\bsk_live_[A-Za-z0-9]{16,}\b/,
    /["'](?:private_key|client_secret)["']\s*:\s*["'](?!example|replace|your-)[^"']{12,}["']/i,
  ].some((pattern) => pattern.test(text));
}

function shouldIgnorePath(filePath: string) {
  const lower = filePath.toLowerCase();
  const parts = lower.split("/");
  const basename = parts.at(-1) ?? "";
  const extension = path.posix.extname(basename);

  if (parts.slice(0, -1).some((part) => IGNORED_DIRECTORIES.has(part)))
    return true;
  if (isSensitivePath(filePath)) return true;
  if (LOCK_FILES.has(basename)) return true;
  if (BINARY_EXTENSIONS.has(extension)) return true;
  if (basename.endsWith(".map")) return true;
  if (/\.min\.(css|js|mjs|cjs)$/.test(basename)) return true;
  if (/\.(generated|g)\.[a-z0-9]+$/.test(basename)) return true;
  return false;
}

function isTextCandidate(filePath: string) {
  const basename = path.posix.basename(filePath).toLowerCase();
  if (TEXT_BASENAMES.has(basename)) return true;
  if (basename.startsWith("dockerfile.")) return true;
  if (basename === ".gitignore" || basename === ".npmrc.example") return true;
  if (basename.endsWith(".env.example")) return true;
  const extension = path.posix.extname(basename);
  return TEXT_EXTENSIONS.has(extension);
}

export function classifyRepositoryFile(filePath: string): RepositoryFileType {
  const lower = filePath.toLowerCase();
  const basename = path.posix.basename(lower);

  if (
    [
      "package.json",
      "pyproject.toml",
      "requirements.txt",
      "cargo.toml",
      "go.mod",
      "gemfile",
      "composer.json",
      "pom.xml",
      "build.gradle",
      "build.gradle.kts",
    ].includes(basename)
  )
    return "manifest";
  if (
    /(^|\/)(?:pages\/api|app\/api|api)\//.test(lower) ||
    (/(^|\/)api(\/|$)/.test(lower) &&
      /(route|handler|controller|endpoint|server)\.[^.]+$/.test(basename))
  )
    return "api-route";
  if (
    /\/(pages?|routes?)\//.test(`/${lower}`) ||
    /\/page\.[^.]+$/.test(`/${lower}`)
  )
    return "page";
  if (
    basename === "schema.prisma" ||
    /(^|\/)(db|database)\/.*schema\./.test(lower) ||
    /(^|\/)(models?|entities)\//.test(lower) ||
    /(^|\/)migrations?\//.test(lower)
  )
    return "data-schema";
  if (
    /(^|\/)(stores?|state)\//.test(lower) ||
    /(^|\/)[^/]+\.store\.[^.]+$/.test(lower) ||
    /(^|\/)store\.[^.]+$/.test(lower)
  )
    return "state-store";
  if (/^readme(\.|$)/.test(basename) || /(^|\/)docs?\//.test(lower))
    return "documentation";
  if (/\.(test|spec)\.[^.]+$/.test(lower) || /(^|\/)__tests__\//.test(lower))
    return "test";
  if (/^([^.]+\.)?config\.[^.]+$/.test(basename) || basename === "dockerfile")
    return "config";
  if (/^\.env\.example$/.test(basename)) return "integration-config";
  if (/(^|\/)(features|modules|domains)\//.test(lower)) return "feature";
  if (isTextCandidate(filePath)) return "source";
  return "other";
}

function candidatePriority(filePath: string, type: RepositoryFileType) {
  const basename = path.posix.basename(filePath).toLowerCase();
  if (type === "manifest") return 100;
  if (type === "data-schema" || type === "api-route") return 95;
  if (type === "config" || type === "integration-config") return 90;
  if (type === "page" || type === "feature" || type === "state-store")
    return 85;
  if (basename === "readme.md") return 60;
  if (type === "test" || type === "documentation") return 30;
  return filePath.startsWith("src/") || filePath.startsWith("app/") ? 75 : 50;
}

async function readEntryText(
  zip: ZipFile,
  item: SafeEntry,
  options: RepositoryScanOptions,
) {
  assertScanActive(options);
  const stream = await zip.openReadStreamPromise(item.entry);
  const chunks: Buffer[] = [];
  let bytes = 0;
  const stop = () => stream.destroy(new Error("Repository analysis stopped."));
  options.signal?.addEventListener("abort", stop, { once: true });

  try {
    for await (const chunk of stream) {
      assertScanActive(options);
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buffer.length;
      if (bytes > MAX_ANALYZED_FILE_BYTES) {
        stream.destroy();
        throw unsafeArchive(
          "A repository file expanded beyond the analysis limit.",
        );
      }
      chunks.push(buffer);
    }
    assertScanActive(options);
  } catch (error) {
    assertScanActive(options);
    throw error;
  } finally {
    options.signal?.removeEventListener("abort", stop);
  }

  const content = Buffer.concat(chunks);
  if (content.includes(0)) return null;
  try {
    return new TextDecoder("utf-8", { fatal: true })
      .decode(content)
      .replace(/^\uFEFF/, "");
  } catch {
    return null;
  }
}

function suggestedProjectName(archiveName: string) {
  const name = path.posix
    .basename(archiveName)
    .replace(/\.zip$/i, "")
    .replace(/\.git$/i, "")
    .trim();
  return (name || "Imported repository").slice(0, 80);
}

export async function scanRepositoryZip(
  buffer: Buffer,
  archiveName: string,
  options: RepositoryScanOptions = {},
): Promise<ScannedRepository> {
  let zip: ZipFile | undefined;
  try {
    assertScanActive(options);
    zip = await fromBufferPromise(buffer, {
      // Entries are collected before selected files are streamed.
      autoClose: false,
      decodeStrings: true,
      lazyEntries: true,
      strictFileNames: true,
      validateEntrySizes: true,
    });

    if (zip.entryCount > MAX_ENTRIES)
      throw new RepositoryImportError(
        "TOO_MANY_ENTRIES",
        `Repository ZIPs can contain up to ${MAX_ENTRIES.toLocaleString()} entries.`,
        413,
      );

    const safeEntries: SafeEntry[] = [];
    const seenPaths = new Set<string>();
    const seenPortablePaths = new Set<string>();
    let entriesDiscovered = 0;
    let filesDiscovered = 0;
    let declaredUncompressedBytes = 0;

    for await (const entry of zip.eachEntry()) {
      assertScanActive(options);
      entriesDiscovered += 1;
      if (entriesDiscovered > MAX_ENTRIES)
        throw new RepositoryImportError(
          "TOO_MANY_ENTRIES",
          `Repository ZIPs can contain up to ${MAX_ENTRIES.toLocaleString()} entries.`,
          413,
        );

      const archivePath = normalizeArchivePath(entry.fileName);
      if (entry.isEncrypted())
        throw new RepositoryImportError(
          "UNSUPPORTED_ARCHIVE",
          "Encrypted repository ZIPs are not supported.",
          422,
        );
      if (!entry.canDecodeFileData())
        throw new RepositoryImportError(
          "UNSUPPORTED_ARCHIVE",
          "The repository ZIP uses an unsupported compression method.",
          422,
        );
      if (isDirectory(entry, archivePath)) continue;

      const portablePath = archivePath.toLocaleLowerCase("en-US");
      if (seenPaths.has(archivePath) || seenPortablePaths.has(portablePath))
        throw unsafeArchive(
          "The archive contains duplicate or case-colliding file paths.",
        );
      seenPaths.add(archivePath);
      seenPortablePaths.add(portablePath);

      filesDiscovered += 1;
      declaredUncompressedBytes += entry.uncompressedSize;
      if (declaredUncompressedBytes > MAX_DECLARED_UNCOMPRESSED_BYTES)
        throw new RepositoryImportError(
          "ARCHIVE_TOO_LARGE",
          "The repository expands beyond the 60 MB analysis limit.",
          413,
        );

      if (
        entry.uncompressedSize > 0 &&
        entry.uncompressedSize / Math.max(entry.compressedSize, 1) >
          MAX_COMPRESSION_RATIO
      )
        throw unsafeArchive(
          "The repository ZIP contains an entry with an unsafe compression ratio.",
        );

      safeEntries.push({
        entry,
        archivePath,
        path: archivePath,
        symlink: isSymlink(entry),
      });
    }

    const rootCandidates = safeEntries.filter(
      (item) => !shouldIgnorePath(item.archivePath),
    );
    const repositoryRoot = commonRepositoryRoot(rootCandidates);
    for (const item of safeEntries)
      item.path = stripRepositoryRoot(item.archivePath, repositoryRoot);

    const candidates = safeEntries
      .filter(
        (item) =>
          !item.symlink &&
          item.entry.uncompressedSize > 0 &&
          item.entry.uncompressedSize <= MAX_ANALYZED_FILE_BYTES &&
          !shouldIgnorePath(item.archivePath) &&
          !shouldIgnorePath(item.path) &&
          isTextCandidate(item.path),
      )
      .map((item) => ({
        ...item,
        type: classifyRepositoryFile(item.path),
      }))
      .sort(
        (a, b) =>
          candidatePriority(b.path, b.type) -
            candidatePriority(a.path, a.type) || a.path.localeCompare(b.path),
      );

    const files: ScannedTextFile[] = [];
    for (const item of candidates) {
      assertScanActive(options);
      if (files.length >= MAX_ANALYZED_FILES) break;
      const text = await readEntryText(zip, item, options);
      if (text === null || containsSecretMaterial(text)) continue;
      files.push({
        path: item.path,
        type: item.type,
        size: item.entry.uncompressedSize,
        text,
      });
    }

    if (files.length === 0)
      throw new RepositoryImportError(
        "NO_ANALYZABLE_FILES",
        "No supported source or configuration files were found in this ZIP.",
        422,
      );

    return {
      archiveName,
      suggestedName: suggestedProjectName(archiveName),
      repositoryRoot,
      files,
      stats: {
        entriesDiscovered,
        filesDiscovered,
        analyzedFiles: files.length,
        ignoredFiles: filesDiscovered - files.length,
        declaredUncompressedBytes,
      },
    };
  } catch (error) {
    if (error instanceof RepositoryImportError) throw error;
    throw new RepositoryImportError(
      "INVALID_ARCHIVE",
      "The repository ZIP is damaged or could not be read.",
      422,
    );
  } finally {
    zip?.close();
  }
}
