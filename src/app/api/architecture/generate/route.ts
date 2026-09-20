import { NextResponse } from "next/server";

import { ArchitectureGenerateError } from "@/lib/ai/errors";
import { generateArchitectureFromDescription } from "@/lib/ai/generate";
import {
  architectureGenerateErrorSchema,
  architectureGenerateRequestSchema,
} from "@/lib/ai/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90;

const MAX_CONCURRENT_GENERATIONS = 2;

let activeGenerations = 0;

function errorResponse(
  code: ArchitectureGenerateError["code"],
  message: string,
  status: number,
) {
  const body = architectureGenerateErrorSchema.parse({
    ok: false,
    error: { code, message },
  });
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(request: Request) {
  if (activeGenerations >= MAX_CONCURRENT_GENERATIONS)
    return errorResponse(
      "SERVER_BUSY",
      "Structor is already drafting another architecture. Try again shortly.",
      429,
    );

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    if (request.signal.aborted)
      return errorResponse(
        "REQUEST_ABORTED",
        "Architecture generation was stopped.",
        408,
      );
    return errorResponse(
      "INVALID_REQUEST",
      "Send a JSON body with a project description.",
      400,
    );
  }

  const parsed = architectureGenerateRequestSchema.safeParse(body);
  if (!parsed.success)
    return errorResponse(
      "INVALID_REQUEST",
      "Describe what you want to build.",
      400,
    );

  activeGenerations += 1;
  try {
    const project = await generateArchitectureFromDescription(
      parsed.data.description,
      request.signal,
    );
    return NextResponse.json(
      { ok: true, project },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof ArchitectureGenerateError)
      return errorResponse(error.code, error.message, error.status);
    return errorResponse(
      "INTERNAL_ERROR",
      "The architecture could not be generated. Try again.",
      500,
    );
  } finally {
    activeGenerations -= 1;
  }
}
