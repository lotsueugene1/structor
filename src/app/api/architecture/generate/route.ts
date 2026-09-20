import { ArchitectureGenerateError } from "@/lib/ai/errors";
import { streamArchitectureFromDescription } from "@/lib/ai/generate";
import {
  architectureGenerateErrorSchema,
  architectureGenerateRequestSchema,
  architectureGenerateStreamEventSchema,
} from "@/lib/ai/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

const MAX_CONCURRENT_GENERATIONS = 2;

let activeGenerations = 0;

function errorBody(code: ArchitectureGenerateError["code"], message: string) {
  return architectureGenerateErrorSchema.parse({
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

function wantsStream(request: Request) {
  return (request.headers.get("accept") ?? "").includes("text/event-stream");
}

export async function POST(request: Request) {
  if (activeGenerations >= MAX_CONCURRENT_GENERATIONS)
    return jsonError(
      "SERVER_BUSY",
      "Structor is already drafting another architecture. Try again shortly.",
      429,
    );

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    if (request.signal.aborted)
      return jsonError(
        "REQUEST_ABORTED",
        "Architecture generation was stopped.",
        408,
      );
    return jsonError(
      "INVALID_REQUEST",
      "Send a JSON body with a project description.",
      400,
    );
  }

  const parsed = architectureGenerateRequestSchema.safeParse(body);
  if (!parsed.success)
    return jsonError(
      "INVALID_REQUEST",
      "Describe what you want to build.",
      400,
    );

  if (!wantsStream(request)) {
    activeGenerations += 1;
    try {
      let latest;
      for await (const snapshot of streamArchitectureFromDescription(
        parsed.data.description,
        request.signal,
      )) {
        latest = snapshot;
        if (snapshot.complete) break;
      }
      if (!latest)
        return jsonError(
          "GENERATION_FAILED",
          "The architecture could not be generated. Try again.",
          502,
        );
      return Response.json(
        { ok: true, project: latest.project },
        { headers: { "Cache-Control": "no-store" } },
      );
    } catch (error) {
      if (error instanceof ArchitectureGenerateError)
        return jsonError(error.code, error.message, error.status);
      return jsonError(
        "INTERNAL_ERROR",
        "The architecture could not be generated. Try again.",
        500,
      );
    } finally {
      activeGenerations -= 1;
    }
  }

  activeGenerations += 1;
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: unknown) => {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify(architectureGenerateStreamEventSchema.parse(event))}\n\n`,
          ),
        );
      };
      try {
        for await (const snapshot of streamArchitectureFromDescription(
          parsed.data.description,
          request.signal,
        )) {
          send({
            type: "snapshot",
            complete: snapshot.complete,
            nodeCount: snapshot.nodeCount,
            project: snapshot.project,
          });
        }
        controller.close();
      } catch (error) {
        const mapped =
          error instanceof ArchitectureGenerateError
            ? error
            : new ArchitectureGenerateError(
                "INTERNAL_ERROR",
                "The architecture could not be generated. Try again.",
                500,
              );
        try {
          send({
            type: "error",
            error: { code: mapped.code, message: mapped.message },
          });
          controller.close();
        } catch {
          controller.error(error);
        }
      } finally {
        activeGenerations -= 1;
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
