import { streamConverseToolJson } from "./bedrock";
import { ArchitectureGenerateError } from "./errors";
import {
  createHydrationSession,
  hydrateArchitectureDraft,
  type ArchitectureHydrationSession,
} from "./hydrate";
import {
  extractCompleteJsonArray,
  extractJsonStringField,
} from "./partial-json";

import type { ArchitectureProject } from "@/lib/architecture/schema";

const SNAPSHOT_MS = 450;

export type ArchitectureDraftSnapshot = {
  project: ArchitectureProject;
  complete: boolean;
  nodeCount: number;
};

type DraftParts = {
  name: string;
  description: string;
  nodes: unknown[];
  edges: unknown[];
  decisions: unknown[];
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function mergeKeyed(
  existing: unknown[],
  incoming: unknown[],
  keyOf: (item: Record<string, unknown>) => string | null,
) {
  const map = new Map<string, unknown>();
  let anon = 0;
  for (const item of [...existing, ...incoming]) {
    const rec = asRecord(item);
    const key = rec ? keyOf(rec) : null;
    map.set(key || `_${anon++}`, item);
  }
  return [...map.values()];
}

function parseCompleteJson(source: string) {
  const start = source.indexOf("{");
  const end = source.lastIndexOf("}");
  if (start < 0 || end <= start) return undefined;
  try {
    return JSON.parse(source.slice(start, end + 1)) as unknown;
  } catch {
    return undefined;
  }
}

function partsFromUnknown(value: unknown, fallback: DraftParts): DraftParts {
  const rec = asRecord(value);
  if (!rec) return fallback;
  return {
    name:
      typeof rec.name === "string" && rec.name.trim()
        ? rec.name
        : fallback.name,
    description:
      typeof rec.description === "string"
        ? rec.description
        : fallback.description,
    nodes: mergeKeyed(
      fallback.nodes,
      Array.isArray(rec.nodes) ? rec.nodes : [],
      (node) => (typeof node.id === "string" ? node.id : null),
    ),
    edges: mergeKeyed(
      fallback.edges,
      Array.isArray(rec.edges) ? rec.edges : [],
      (edge) =>
        typeof edge.source === "string" && typeof edge.target === "string"
          ? `${edge.source}:${String(edge.relation ?? "")}:${edge.target}`
          : null,
    ),
    decisions: mergeKeyed(
      fallback.decisions,
      Array.isArray(rec.decisions) ? rec.decisions : [],
      (decision) =>
        typeof decision.title === "string" ? decision.title : null,
    ),
  };
}

function partsFromPartial(source: string, fallback: DraftParts): DraftParts {
  const complete = parseCompleteJson(source);
  if (complete) return partsFromUnknown(complete, fallback);
  return {
    name: extractJsonStringField(source, "name") ?? fallback.name,
    description:
      extractJsonStringField(source, "description") ?? fallback.description,
    nodes: mergeKeyed(
      fallback.nodes,
      extractCompleteJsonArray(source, "nodes"),
      (node) => (typeof node.id === "string" ? node.id : null),
    ),
    edges: mergeKeyed(
      fallback.edges,
      extractCompleteJsonArray(source, "edges"),
      (edge) =>
        typeof edge.source === "string" && typeof edge.target === "string"
          ? `${edge.source}:${String(edge.relation ?? "")}:${edge.target}`
          : null,
    ),
    decisions: mergeKeyed(
      fallback.decisions,
      extractCompleteJsonArray(source, "decisions"),
      (decision) =>
        typeof decision.title === "string" ? decision.title : null,
    ),
  };
}

function tryHydrate(
  value: unknown,
  description: string,
  session: ArchitectureHydrationSession,
) {
  try {
    return hydrateArchitectureDraft(value, description, session);
  } catch (error) {
    if (
      error instanceof ArchitectureGenerateError &&
      error.code === "INVALID_ARCHITECTURE"
    )
      return undefined;
    throw error;
  }
}

export async function* streamArchitectureFromDescription(
  description: string,
  signal?: AbortSignal,
): AsyncGenerator<ArchitectureDraftSnapshot> {
  const trimmed = description.trim();
  if (!trimmed)
    throw new ArchitectureGenerateError(
      "INVALID_REQUEST",
      "Describe what you want to build.",
      400,
    );

  const session = createHydrationSession();
  let parts: DraftParts = {
    name: "",
    description: trimmed,
    nodes: [],
    edges: [],
    decisions: [],
  };
  let lastProject: ArchitectureProject | undefined;
  let lastCount = 0;
  let lastEmit = 0;

  function snapshot(project: ArchitectureProject, complete: boolean) {
    lastProject = project;
    lastCount = Object.keys(project.nodes).length;
    lastEmit = Date.now();
    return {
      project,
      complete,
      nodeCount: lastCount,
    } satisfies ArchitectureDraftSnapshot;
  }

  async function* consume(
    mode: "skeleton" | "expand",
  ): AsyncGenerator<ArchitectureDraftSnapshot> {
    let buffer = "";
    for await (const chunk of streamConverseToolJson(trimmed, {
      signal,
      mode,
      skeleton: mode === "expand" ? parts : undefined,
    })) {
      buffer = chunk;
      parts = partsFromPartial(chunk, parts);
      const project = tryHydrate(parts, trimmed, session);
      if (!project) continue;
      const count = Object.keys(project.nodes).length;
      const now = Date.now();
      const first = lastProject === undefined;
      const jumped = count >= lastCount + 2;
      const timed = now - lastEmit >= SNAPSHOT_MS && count > lastCount;
      if (first || jumped || timed) yield snapshot(project, false);
      else {
        lastProject = project;
        lastCount = Math.max(lastCount, count);
      }
    }
    const completeParts = partsFromPartial(buffer, parts);
    parts = completeParts;
    const project = tryHydrate(completeParts, trimmed, session) ?? lastProject;
    if (project) yield snapshot(project, false);
  }

  yield* consume("skeleton");
  if (!lastProject)
    throw new ArchitectureGenerateError(
      "INVALID_ARCHITECTURE",
      "The generated architecture could not be opened. Try generating again.",
      422,
    );

  try {
    yield* consume("expand");
  } catch (error) {
    if (!lastProject) throw error;
  }

  yield snapshot(lastProject, true);
}

export async function generateArchitectureFromDescription(
  description: string,
  signal?: AbortSignal,
): Promise<ArchitectureProject> {
  let latest: ArchitectureProject | undefined;
  for await (const snapshot of streamArchitectureFromDescription(
    description,
    signal,
  )) {
    latest = snapshot.project;
    if (snapshot.complete) return snapshot.project;
  }
  if (!latest)
    throw new ArchitectureGenerateError(
      "GENERATION_FAILED",
      "The architecture could not be generated. Try again.",
      502,
    );
  return latest;
}
