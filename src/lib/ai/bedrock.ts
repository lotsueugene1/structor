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
          "Propose a complete intended software architecture for Structor. Use product-specific names, nested boundaries, and filled requirements, rules, security, events, questions, and decisions — not a toy diagram.",
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
                minItems: 16,
                maxItems: 36,
                items: {
                  type: "object",
                  properties: {
                    id: {
                      type: "string",
                      description:
                        "Stable slug used by parentId and edges, for example matching-engine.",
                    },
                    parentId: {
                      type: "string",
                      description:
                        "Slug of the containing application, domain, or feature.",
                    },
                    name: {
                      type: "string",
                      description:
                        "Specific name a teammate would use, never generic labels like API or Database.",
                    },
                    kind: { type: "string", enum: nodeKindValues },
                    summary: {
                      type: "string",
                      description:
                        "One concrete sentence about what this boundary does in this product.",
                    },
                    intent: {
                      type: "string",
                      description:
                        "Why this exists, who it serves, and what would break without it.",
                    },
                    requirements: {
                      type: "array",
                      minItems: 2,
                      items: { type: "string" },
                      description:
                        "2 to 5 testable requirements for this boundary.",
                    },
                    rules: {
                      type: "array",
                      items: { type: "string" },
                      description: "Business rules and invariants.",
                    },
                    constraints: {
                      type: "array",
                      items: { type: "string" },
                      description: "Hard limits, SLAs, or non-negotiables.",
                    },
                    security: {
                      type: "array",
                      items: { type: "string" },
                      description:
                        "Authn, authz, data protection, and abuse controls.",
                    },
                    permissions: {
                      type: "array",
                      items: { type: "string" },
                      description: "Who may read or change this, and when.",
                    },
                    events: {
                      type: "array",
                      items: { type: "string" },
                      description:
                        "Domain events this boundary emits or consumes.",
                    },
                    questions: {
                      type: "array",
                      items: { type: "string" },
                      description:
                        "Open architecture questions that still need a decision.",
                    },
                    assumptions: {
                      type: "array",
                      items: { type: "string" },
                      description:
                        "Assumptions this draft is making so they can be challenged.",
                    },
                  },
                  required: [
                    "id",
                    "name",
                    "kind",
                    "summary",
                    "intent",
                    "requirements",
                    "questions",
                  ],
                },
              },
              edges: {
                type: "array",
                minItems: 16,
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
                minItems: 3,
                items: {
                  type: "object",
                  properties: {
                    title: { type: "string" },
                    reason: { type: "string" },
                    alternative: { type: "string" },
                  },
                  required: ["title", "reason", "alternative"],
                },
              },
            },
            required: ["name", "description", "nodes", "edges", "decisions"],
          },
        },
      },
    },
  ],
  toolChoice: { tool: { name: TOOL_NAME } },
} satisfies ToolConfiguration;

export const architectureSystemPrompt = `You are a principal engineer drafting intended architecture for Structor.

Structor is an architecture-first workspace. The graph you return becomes the team's source of truth: nested product boundaries, requirements, business rules, security, events, and open questions. A sparse "frontend / API / database" sketch is a failed draft.

Infer a production-ready intended architecture from a short product description. Fill in the system a competent team would actually have to design, even when the user did not list every piece. Stay faithful to the product; do not bolt on unrelated platforms.

Required shape:
- 18 to 32 components. Two to four levels of containment. One application root, then domains or major capabilities, then the features, services, pages, APIs, and data they own.
- Use product-specific names. Never name a node "API", "Backend", "Frontend", "Database", "Auth", or "Users" unless you qualify it (for example "Roommate matching API").
- Always include: the people (actors), the work they do (flows and pages), the records (data), the contracts (APIs), the behavior (features, capabilities, services), and a security boundary for identity and access.
- Include domain events when work happens asynchronously (matching completed, message sent, payment captured).
- Include integrations and infrastructure the product would need in production: notifications, object storage, email, queues, search, payments, maps, school SSO, and so on — only ones this product would actually use.
- Most nodes nest under a parent. Isolated top-level nodes should be rare.

Fill the fields:
- Every node: specific summary and intent (not restatements of the name).
- Features, services, APIs, data, and security: 2 to 5 requirements, plus security or permissions where access matters.
- Services, APIs, and data: at least one business rule or constraint.
- Every domain, feature, and service: at least one open question that a real team would still debate.
- Record assumptions so they can be challenged.
- 16+ relationships: calls, reads_from, writes_to, emits, protects, depends_on. Connect actors to flows, flows to features, features to APIs and data, security to what it protects.
- 3 to 6 architecture decisions with a reason and a rejected alternative (sync vs async matching, who owns identity, where source of truth lives).

Do not invent source files or observed implementation. This is intended architecture, not a scanned repo.`;

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
                text: `Draft a complete intended architecture a senior team would use before building this product. Infer the domains, actors, flows, services, APIs, data, events, security, and production integrations this would need. Use specific names and fill requirements, rules, security, events, questions, assumptions, and decisions. Do not return a toy three-tier diagram.\n\nProduct:\n${description}`,
              },
            ],
          },
        ],
        toolConfig: architectureToolConfig,
        inferenceConfig: {
          maxTokens: 16384,
          temperature: 0.4,
        },
      }),
      signal ? { abortSignal: signal } : undefined,
    );
    return extractToolInput(response.output?.message?.content);
  } catch (error) {
    throw mapBedrockError(error);
  }
}
