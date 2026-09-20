import { deleteProject, publishProject } from "@/lib/mcp/registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorResponse(error: unknown, fallback: string) {
  return Response.json(
    { ok: false, error: error instanceof Error ? error.message : fallback },
    { status: 400, headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  try {
    const body: unknown = await request.json();
    const value = (body ?? {}) as {
      project?: unknown;
      token?: unknown;
      stop?: unknown;
      projectId?: unknown;
    };
    if (value.stop === true) {
      const result = deleteProject(value.projectId, value.token);
      return Response.json(
        { ok: true, ...result },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    const result = publishProject(value.project, value.token);
    return Response.json(
      { ok: true, ...result },
      {
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch (error) {
    return errorResponse(error, "The project could not be shared.");
  }
}

export async function DELETE(request: Request) {
  try {
    const body: unknown = await request.json();
    const value = (body ?? {}) as { projectId?: unknown; token?: unknown };
    const result = deleteProject(value.projectId, value.token);
    return Response.json(
      { ok: true, ...result },
      {
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch (error) {
    return errorResponse(error, "The project share could not be removed.");
  }
}
