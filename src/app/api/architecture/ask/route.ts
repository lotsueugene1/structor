import { converseArchitectureAsk } from "@/lib/ai/bedrock";
import { ArchitectureGenerateError } from "@/lib/ai/errors";
import {
  architectureAskErrorSchema,
  architectureAskRequestSchema,
  architectureAskSuccessSchema,
} from "@/lib/ai/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function errorBody(code: ArchitectureGenerateError["code"], message: string) {
  return architectureAskErrorSchema.parse({
    ok: false,
    error: { code, message },
  });
}

function jsonError(
  code: ArchitectureGenerateError["code"],
  message: string,
  status: number,
) {
  return Response.json(errorBody(code, message), {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    if (request.signal.aborted)
      return jsonError("REQUEST_ABORTED", "The question was stopped.", 408);
    return jsonError(
      "INVALID_REQUEST",
      "Send a JSON body with a prompt and architecture context.",
      400,
    );
  }

  const parsed = architectureAskRequestSchema.safeParse(body);
  if (!parsed.success)
    return jsonError(
      "INVALID_REQUEST",
      "Ask a question about this architecture.",
      400,
    );

  const contextJson = JSON.stringify(parsed.data.context ?? {});
  if (contextJson.length > 80_000)
    return jsonError(
      "INVALID_REQUEST",
      "Architecture context is too large for this question.",
      400,
    );

  try {
    const reply = await converseArchitectureAsk(
      {
        prompt: parsed.data.prompt,
        messages: parsed.data.messages,
        context: parsed.data.context,
      },
      request.signal,
    );
    return Response.json(
      architectureAskSuccessSchema.parse({ ok: true, reply }),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof ArchitectureGenerateError)
      return jsonError(error.code, error.message, error.status);
    return jsonError(
      "INTERNAL_ERROR",
      "Structor AI could not answer. Try again.",
      500,
    );
  }
}
