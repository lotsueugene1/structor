import {
  BedrockRuntimeClient,
  ConverseCommand,
  type ToolConfiguration,
} from "@aws-sdk/client-bedrock-runtime";

import { ArchitectureGenerateError } from "./errors";
import {
  architectureDraftKindSchema,
  architectureDraftRelationSchema,
} from "./schema";

export const DEFAULT_BEDROCK_REGION = "us-east-1";
export const DEFAULT_BEDROCK_MODEL_ID =
  "us.anthropic.claude-sonnet-4-5-20250929-v1:0";

const TOOL_NAME = "propose_architecture";

const nodeKindValues = architectureDraftKindSchema.options;
const relationValues = architectureDraftRelationSchema.options;

export const architectureToolConfig = {
  tools: [
    {
      toolSpec: {
        name: TOOL_NAME,
        description:
          "Propose a starting software architecture for Structor. Return only the intended system: components, containment, relationships, and the few decisions that shape the product.",
        inputSchema: {
          json: {
            type: "object",
            properties: {
              name: {
                type: "string",
                description:
                  "Short product or system name, at most 80 characters.",
              },
              description: {
                type: "string",
                description:
                  "One or two sentences describing what is being structured.",
              },
              nodes: {
                type: "array",
                minItems: 6,
                maxItems: 24,
                items: {
                  type: "object",
                  properties: {
                    id: {
                      type: "string",
                      description:
                        "Stable slug used by parentId and edges, for example auth.",
                    },
                    parentId: {
                      type: "string",
                      description: "Slug of the containing component, if any.",
                    },
                    name: { type: "string" },
                    kind: { type: "string", enum: nodeKindValues },
                    summary: {
                      type: "string",
                      description: "One sentence a teammate would recognize.",
                    },
                    intent: {
                      type: "string",
                      description: "Why this component exists in the product.",
                    },
                    requirements: {
                      type: "array",
                      items: { type: "string" },
                    },
                    rules: { type: "array", items: { type: "string" } },
                    constraints: {
                      type: "array",
                      items: { type: "string" },
                    },
                    security: { type: "array", items: { type: "string" } },
                    permissions: {
                      type: "array",
                      items: { type: "string" },
                    },
                    events: { type: "array", items: { type: "string" } },
                    questions: {
                      type: "array",
                      items: { type: "string" },
                    },
                    assumptions: {
                      type: "array",
                      items: { type: "string" },
                    },
                  },
                  required: ["id", "name", "kind", "summary", "intent"],
                },
              },
              edges: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    source: { type: "string" },
                    target: { type: "string" },
                    relation: { type: "string", enum: relationValues },
                  },
                  required: ["source", "target", "relation"],
                },
              },
              decisions: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    title: { type: "string" },
                    reason: { type: "string" },
                    alternative: { type: "string" },
                  },
                  required: ["title", "reason"],
                },
              },
            },
            required: ["name", "description", "nodes", "edges"],
          },
        },
      },
    },
  ],
  toolChoice: { tool: { name: TOOL_NAME } },
} satisfies ToolConfiguration;

export const architectureSystemPrompt = `You draft starting architectures for Structor, an architecture-first workspace.

Return a coherent intended architecture for a greenfield product, not a blank canvas and not an observed codebase.

Rules:
- 8 to 18 components. Prefer product boundaries over technology layers.
- One application root. Nest features, capabilities, services, pages, and APIs under the application or a domain.
- Include the people (actors), the work they do (flows), the records the product stores (data), and the contracts they use (APIs) when those exist in the description.
- Add integrations, infrastructure, and security boundaries only when the description implies them.
- Every component needs a recognizable name, a one-sentence summary, and a purpose.
- Put 1 to 3 requirements on user-facing and service nodes.
- Put security requirements on APIs, data, and anything that handles identity or money.
- Open questions are for real undecided choices, not filler.
- parentId and edge endpoints must use node ids from this same proposal.
- Do not invent source files, repositories, or implementation evidence.
- This is intended architecture: it has not been observed in a codebase yet.`;

function envValue(name: string) {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

export function bedrockConfig() {
  return {
    region: envValue("AWS_REGION") ?? DEFAULT_BEDROCK_REGION,
    modelId: envValue("BEDROCK_MODEL_ID") ?? DEFAULT_BEDROCK_MODEL_ID,
  };
}

let client: BedrockRuntimeClient | undefined;

function bedrockClient(region: string) {
  if (!client)
    client = new BedrockRuntimeClient({
      region,
      maxAttempts: 2,
    });
  return client;
}

function awsErrorName(error: unknown) {
  if (typeof error === "object" && error !== null && "name" in error)
    return String((error as { name?: unknown }).name ?? "");
  return "";
}

export function mapBedrockError(error: unknown): ArchitectureGenerateError {
  if (error instanceof ArchitectureGenerateError) return error;
  if (error instanceof Error && error.name === "AbortError")
    return new ArchitectureGenerateError(
      "REQUEST_ABORTED",
      "Architecture generation was stopped.",
      408,
    );
  const name = awsErrorName(error);
  if (
    name === "CredentialsProviderError" ||
    name === "ExpiredTokenException" ||
    name === "UnrecognizedClientException" ||
    name === "InvalidSignatureException"
  )
    return new ArchitectureGenerateError(
      "NOT_CONFIGURED",
      "Architecture generation is not configured for this environment.",
      503,
    );
  if (
    name === "AccessDeniedException" ||
    name === "ResourceNotFoundException" ||
    name === "ValidationException"
  )
    return new ArchitectureGenerateError(
      "MODEL_UNAVAILABLE",
      "The configured Bedrock model is not available to this account.",
      503,
    );
  if (
    name === "ThrottlingException" ||
    name === "ServiceQuotaExceededException" ||
    name === "ModelTimeoutException"
  )
    return new ArchitectureGenerateError(
      "TIMEOUT",
      "Architecture generation is busy. Try again shortly.",
      429,
    );
  return new ArchitectureGenerateError(
    "GENERATION_FAILED",
    "The architecture could not be generated. Try again.",
    502,
  );
}

export function extractToolInput(
  content:
    | Array<{ toolUse?: { name?: string; input?: unknown }; text?: string }>
    | undefined,
) {
  const tool = content?.find(
    (block) =>
      block.toolUse?.name === TOOL_NAME && block.toolUse.input !== undefined,
  );
  if (tool?.toolUse?.input !== undefined) return tool.toolUse.input;
  const text = content
    ?.map((block) => block.text)
    .filter((value): value is string => Boolean(value))
    .join("\n")
    .trim();
  if (!text)
    throw new ArchitectureGenerateError(
      "GENERATION_FAILED",
      "The model did not return an architecture. Try again.",
      502,
    );
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced?.[1]?.trim() ?? text;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start)
    throw new ArchitectureGenerateError(
      "GENERATION_FAILED",
      "The model did not return an architecture. Try again.",
      502,
    );
  try {
    return JSON.parse(raw.slice(start, end + 1)) as unknown;
  } catch {
    throw new ArchitectureGenerateError(
      "GENERATION_FAILED",
      "The model did not return an architecture. Try again.",
      502,
    );
  }
}

export async function converseArchitectureDraft(
  description: string,
  signal?: AbortSignal,
) {
  const { region, modelId } = bedrockConfig();
  try {
    const response = await bedrockClient(region).send(
      new ConverseCommand({
        modelId,
        system: [{ text: architectureSystemPrompt }],
        messages: [
          {
            role: "user",
            content: [
              {
                text: `Draft a starting architecture for this product:\n\n${description}`,
              },
            ],
          },
        ],
        toolConfig: architectureToolConfig,
        inferenceConfig: {
          maxTokens: 8192,
          temperature: 0.2,
        },
      }),
      signal ? { abortSignal: signal } : undefined,
    );
    return extractToolInput(response.output?.message?.content);
  } catch (error) {
    throw mapBedrockError(error);
  }
}
