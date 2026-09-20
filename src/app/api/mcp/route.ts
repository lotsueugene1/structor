import { readSharedProject } from "@/lib/mcp/registry";
import { mcpTools, runMcpTool } from "@/lib/mcp/tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PROTOCOL = "2025-03-26";

function rpcError(id: unknown, code: number, message: string) {
  return Response.json(
    { jsonrpc: "2.0", id: id ?? null, error: { code, message } },
    { headers: { "Cache-Control": "no-store" } },
  );
}

function message(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return rpcError(null, -32700, "The request body must be valid JSON.");
  }
  const calls = Array.isArray(body) ? body : [body];
  if (calls.length === 0 || calls.length > 8)
    return rpcError(null, -32600, "Send a single JSON-RPC request.");

  const responses = [];
  for (const call of calls) {
    if (
      typeof call !== "object" ||
      call === null ||
      (call as { jsonrpc?: unknown }).jsonrpc !== "2.0" ||
      typeof (call as { method?: unknown }).method !== "string"
    ) {
      responses.push({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32600, message: "Invalid JSON-RPC request." },
      });
      continue;
    }
    const request_ = call as {
      id?: unknown;
      method: string;
      params?: unknown;
    };
    const id = request_.id ?? null;
    try {
      if (request_.method === "initialize") {
        responses.push({
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: PROTOCOL,
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: "structor", version: "1.0.0" },
            instructions:
              "Read-only access to the shared Structor architecture. Tools reflect the canonical architecture, including hierarchy, provenance, and the implementation plan.",
          },
        });
        continue;
      }
      if (
        request_.method === "notifications/initialized" ||
        request_.method === "ping"
      ) {
        responses.push({ jsonrpc: "2.0", id, result: {} });
        continue;
      }
      if (request_.method === "tools/list") {
        responses.push({ jsonrpc: "2.0", id, result: { tools: mcpTools } });
        continue;
      }
      if (request_.method === "tools/call") {
        const params = (request_.params ?? {}) as {
          name?: unknown;
          arguments?: unknown;
        };
        if (typeof params.name !== "string")
          throw new Error("A tool name is required.");
        if (!mcpTools.some((tool) => tool.name === params.name))
          throw new Error(`Unknown tool: ${params.name}`);
        const project = readSharedProject(request.headers.get("authorization"));
        const output = runMcpTool(
          project,
          params.name,
          typeof params.arguments === "object" && params.arguments !== null
            ? (params.arguments as Record<string, unknown>)
            : {},
        );
        responses.push({
          jsonrpc: "2.0",
          id,
          result: {
            content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
            isError: false,
          },
        });
        continue;
      }
      throw new Error(`Method not supported: ${request_.method}`);
    } catch (error) {
      const err = message(error, "The request could not be completed.");
      const isProtocol = /unknown tool|unknown method|not supported/i.test(err);
      if (request_.method === "tools/call")
        responses.push({
          jsonrpc: "2.0",
          id,
          result: { content: [{ type: "text", text: err }], isError: true },
        });
      else
        responses.push({
          jsonrpc: "2.0",
          id,
          error: { code: isProtocol ? -32601 : -32000, message: err },
        });
    }
  }

  if (Array.isArray(body))
    return Response.json(responses, {
      headers: { "Cache-Control": "no-store" },
    });
  const response = responses[0];
  return Response.json(response, {
    status: "error" in response && !("result" in response) ? 200 : 200,
    headers: { "Cache-Control": "no-store" },
  });
}

export function GET() {
  return Response.json(
    {
      service: "structor-mcp",
      protocol: PROTOCOL,
      tools: mcpTools.map((tool) => tool.name),
      note: "POST JSON-RPC requests with Authorization: Bearer <share token>.",
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
