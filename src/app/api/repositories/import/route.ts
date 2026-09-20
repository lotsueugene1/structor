import { NextResponse } from "next/server";

import { buildRepositoryImport } from "@/lib/repository/architecture";
import {
  ANALYSIS_TIMEOUT_MS,
  MAX_COMPRESSED_BYTES,
  MAX_CONCURRENT_IMPORTS,
  ZIP_MEDIA_TYPES,
} from "@/lib/repository/constants";
import { RepositoryImportError } from "@/lib/repository/errors";
import { scanRepositoryZip } from "@/lib/repository/scanner";
import {
  repositoryImportErrorSchema,
  type RepositoryImportErrorCode,
} from "@/lib/repository/schema";

export const runtime = "nodejs";
export const maxDuration = 30;

let activeImports = 0;

function errorResponse(
  code: RepositoryImportErrorCode,
  message: string,
  status: number,
) {
  const body = repositoryImportErrorSchema.parse({
    ok: false,
    error: { code, message },
  });
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function hasZipSignature(buffer: Buffer) {
  if (buffer.length < 4) return false;
  return (
    buffer[0] === 0x50 &&
    buffer[1] === 0x4b &&
    ((buffer[2] === 0x03 && buffer[3] === 0x04) ||
      (buffer[2] === 0x05 && buffer[3] === 0x06) ||
      (buffer[2] === 0x07 && buffer[3] === 0x08))
  );
}

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data"))
    return errorResponse(
      "INVALID_MULTIPART",
      "Send the repository ZIP as multipart form data.",
      400,
    );

  const contentEncoding = request.headers.get("content-encoding");
  if (contentEncoding && contentEncoding.toLowerCase() !== "identity")
    return errorResponse(
      "INVALID_MULTIPART",
      "Compressed HTTP request bodies are not supported.",
      415,
    );

  const contentLengthHeader = request.headers.get("content-length");
  if (!contentLengthHeader || !/^\d+$/.test(contentLengthHeader))
    return errorResponse(
      "INVALID_MULTIPART",
      "The upload size could not be verified.",
      411,
    );
  const contentLength = Number(contentLengthHeader);
  if (!Number.isSafeInteger(contentLength) || contentLength <= 0)
    return errorResponse(
      "INVALID_MULTIPART",
      "The upload size could not be verified.",
      411,
    );
  if (contentLength > MAX_COMPRESSED_BYTES + 1024 * 1024)
    return errorResponse(
      "FILE_TOO_LARGE",
      "Repository ZIPs must be 20 MB or smaller.",
      413,
    );

  if (activeImports >= MAX_CONCURRENT_IMPORTS)
    return errorResponse(
      "SERVER_BUSY",
      "Structor is already analyzing other repositories. Try again shortly.",
      429,
    );

  activeImports += 1;
  try {
    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      if (request.signal.aborted)
        return errorResponse(
          "REQUEST_ABORTED",
          "Repository analysis was stopped.",
          408,
        );
      return errorResponse(
        "INVALID_MULTIPART",
        "The multipart upload could not be read.",
        400,
      );
    }

    if (request.signal.aborted)
      return errorResponse(
        "REQUEST_ABORTED",
        "Repository analysis was stopped.",
        408,
      );

    const repository = formData.get("repository");
    if (!(repository instanceof File))
      return errorResponse(
        "MISSING_REPOSITORY",
        'Attach a repository ZIP in the "repository" field.',
        400,
      );

    const name = repository.name.normalize("NFC");
    const mediaType = repository.type.toLowerCase().split(";", 1)[0];
    if (
      name.length === 0 ||
      name.length > 255 ||
      /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(name) ||
      name.includes("/") ||
      name.includes("\\") ||
      !name.toLowerCase().endsWith(".zip") ||
      !ZIP_MEDIA_TYPES.has(mediaType)
    )
      return errorResponse(
        "INVALID_FILE_TYPE",
        "Choose a .zip repository archive.",
        415,
      );

    if (repository.size > MAX_COMPRESSED_BYTES)
      return errorResponse(
        "FILE_TOO_LARGE",
        "Repository ZIPs must be 20 MB or smaller.",
        413,
      );

    let buffer: Buffer;
    try {
      buffer = Buffer.from(await repository.arrayBuffer());
    } catch {
      return errorResponse(
        "INVALID_ARCHIVE",
        "The repository ZIP could not be read.",
        422,
      );
    }
    try {
      if (!hasZipSignature(buffer))
        return errorResponse(
          "INVALID_ZIP_SIGNATURE",
          "The uploaded file is not a valid ZIP archive.",
          415,
        );

      const scanned = await scanRepositoryZip(buffer, name, {
        signal: request.signal,
        deadline: Date.now() + ANALYSIS_TIMEOUT_MS,
      });
      const response = buildRepositoryImport(scanned);
      return NextResponse.json(response, {
        headers: { "Cache-Control": "no-store" },
      });
    } catch (error) {
      if (error instanceof RepositoryImportError)
        return errorResponse(error.code, error.message, error.status);
      return errorResponse(
        "INTERNAL_ERROR",
        "The repository could not be analyzed. Try another ZIP.",
        500,
      );
    } finally {
      buffer.fill(0);
    }
  } finally {
    activeImports -= 1;
  }
}
