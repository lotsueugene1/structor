import { readSharedProject } from "@/lib/mcp/registry";
import { mcpTools, runMcpTool } from "@/lib/mcp/tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PROTOCOL_VERSIONS = ["2025-03-26", "2025-06-18", "2025-11-25"] as const;
const DEFAULT_PROTOCOL = PROTOCOL_VERSIONS[0];

type RpcCall = {
  jsonrpc?: unknown;
  id?: unknown;
  method?: unknown;
  params?: unknown;
};

function corsHeaders() {
  return {
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type, Accept, Authorization, MCP-Protocol-Version, Mcp-Session-Id",
    "Access-Control-Expose-Headers": "MCP-Protocol-Version, Mcp-Session-Id",
  };
}

function jsonResponse(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: corsHeaders(),
  });
}

function rpcError(id: unknown, code: number, message: string, status = 200) {
  return jsonResponse(
    { jsonrpc: "2.0", id: id ?? null, error: { code, message } },
    status,
  );
}

function message(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function isRpcCall(value: unknown): value is RpcCall {
  return typeof value === "object" && value !== null;
}

function isNotification(call: RpcCall) {
  return (
    typeof call.method === "string" &&
    (call.method.startsWith("notifications/") || call.id === undefined)
  );
}

function negotiatedProtocol(params: unknown) {
  const requested =
    params !== null &&
    typeof params === "object" &&
    "protocolVersion" in params &&
    typeof (params as { protocolVersion?: unknown }).protocolVersion ===
      "string"
      ? (params as { protocolVersion: string }).protocolVersion
      : undefined;
  return PROTOCOL_VERSIONS.includes(
    requested as (typeof PROTOCOL_VERSIONS)[number],
  )
    ? requested
    : DEFAULT_PROTOCOL;
}

function handleCall(call: RpcCall, authorization: string | null) {
  const id = call.id ?? null;
  const method = call.method;
  if (call.jsonrpc !== "2.0" || typeof method !== "string")
    return {
      jsonrpc: "2.0",
      id,
      error: { code: -32600, message: "Invalid JSON-RPC request." },
    };

  try {
    if (method === "initialize")
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: negotiatedProtocol(call.params),
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "structor", version: "1.2.0" },
          instructions:
            "Read-only access to the shared Structor architecture. Tools reflect the canonical architecture, including hierarchy, provenance, and the implementation plan.",
        },
      };
    if (method === "ping") return { jsonrpc: "2.0", id, result: {} };
    if (method === "tools/list")
      return { jsonrpc: "2.0", id, result: { tools: mcpTools } };
    if (method === "tools/call") {
      const params = (call.params ?? {}) as {
        name?: unknown;
        arguments?: unknown;
      };
      if (typeof params.name !== "string")
        throw new Error("A tool name is required.");
      if (!mcpTools.some((tool) => tool.name === params.name))
        throw new Error(`Unknown tool: ${params.name}`);
      const project = readSharedProject(authorization);
      const output = runMcpTool(
        project,
        params.name,
        typeof params.arguments === "object" && params.arguments !== null
          ? (params.arguments as Record<string, unknown>)
          : {},
      );
      return {
        jsonrpc: "2.0",
        id,
        result: {
          content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
          isError: false,
        },
      };
    }
    throw new Error(`Method not supported: ${method}`);
  } catch (error) {
    const err = message(error, "The request could not be completed.");
    const isProtocol = /unknown tool|unknown method|not supported/i.test(err);
    if (method === "tools/call")
      return {
        jsonrpc: "2.0",
        id,
        result: { content: [{ type: "text", text: err }], isError: true },
      };
    return {
      jsonrpc: "2.0",
      id,
      error: { code: isProtocol ? -32601 : -32000, message: err },
    };
  }
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export function GET() {
  return new Response(null, {
    status: 405,
    headers: {
      ...corsHeaders(),
      Allow: "POST, OPTIONS",
    },
  });
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return rpcError(null, -32700, "The request body must be valid JSON.", 400);
  }

  const calls = (Array.isArray(body) ? body : [body]).filter(isRpcCall);
  if (calls.length === 0 || calls.length > 8)
    return rpcError(null, -32600, "Send a single JSON-RPC request.", 400);

  const requests = calls.filter((call) => !isNotification(call));
  if (requests.length === 0)
    return new Response(null, { status: 202, headers: corsHeaders() });

  const authorization = request.headers.get("authorization");
  const responses = requests.map((call) => handleCall(call, authorization));
  return jsonResponse(Array.isArray(body) ? responses : responses[0]);
}
