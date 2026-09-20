import { randomUUID } from "node:crypto";

import { ArchitectureGenerateError } from "./errors";
import { architectureDraftSchema, type ArchitectureDraft } from "./schema";

import { deriveImplementationPlan } from "@/lib/architecture/plan";
import {
  projectSchema,
  type ArchitectureNode,
  type ArchitectureProject,
} from "@/lib/architecture/schema";

const MAX_LIST_ITEMS = 8;
const MAX_ITEM_LENGTH = 2000;

function clip(value: string, max: number, fallback = "") {
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (!cleaned) return fallback;
  return cleaned.length <= max
    ? cleaned
    : `${cleaned.slice(0, max - 1).trimEnd()}…`;
}

function clipList(values: string[] | undefined) {
  return [
    ...new Set((values ?? []).map((value) => clip(value, MAX_ITEM_LENGTH))),
  ]
    .filter(Boolean)
    .slice(0, MAX_LIST_ITEMS);
}

function projectNameFromIntent(intent: string) {
  const firstLine =
    intent
      .trim()
      .split(/\n|[.!?]/, 1)[0]
      ?.trim() || "New architecture";
  return clip(firstLine, 80, "New architecture");
}

function nodeFromDraft(
  draft: ArchitectureDraft["nodes"][number],
  id: string,
  parentId: string | undefined,
): ArchitectureNode {
  return {
    id,
    ...(parentId ? { parentId } : {}),
    name: clip(draft.name, 80, "Component"),
    kind: draft.kind,
    summary: clip(
      draft.summary,
      2000,
      `${draft.name} is part of the intended architecture.`,
    ),
    intent: clip(draft.intent, 10000),
    provenance: "defined",
    intended: true,
    observed: false,
    intentChanges: [],
    requirements: clipList(draft.requirements),
    rules: clipList(draft.rules),
    constraints: clipList(draft.constraints),
    security: clipList(draft.security),
    permissions: clipList(draft.permissions),
    events: clipList(draft.events),
    implementation: [],
    sourceReferences: [],
    questions: clipList(draft.questions),
    assumptions: clipList(draft.assumptions),
  };
}

function wouldCycle(
  nodes: Record<string, ArchitectureNode>,
  nodeId: string,
  parentId: string,
) {
  const seen = new Set<string>([nodeId]);
  let cursor: string | undefined = parentId;
  while (cursor) {
    if (seen.has(cursor)) return true;
    seen.add(cursor);
    cursor = nodes[cursor]?.parentId;
  }
  return false;
}

export function parseArchitectureDraft(value: unknown): ArchitectureDraft {
  const parsed = architectureDraftSchema.safeParse(value);
  if (!parsed.success)
    throw new ArchitectureGenerateError(
      "INVALID_ARCHITECTURE",
      "The model did not return a usable architecture. Try a more specific description.",
      422,
    );
  return parsed.data;
}

export function hydrateArchitectureDraft(
  value: unknown,
  description: string,
): ArchitectureProject {
  const draft = parseArchitectureDraft(value);
  const createdAt = new Date().toISOString();
  const idByDraft = new Map<string, string>();
  for (const node of draft.nodes) {
    if (idByDraft.has(node.id)) continue;
    idByDraft.set(node.id, randomUUID());
  }

  const nodes: ArchitectureProject["nodes"] = {};
  for (const node of draft.nodes) {
    const id = idByDraft.get(node.id);
    if (!id) continue;
    const parentId = node.parentId ? idByDraft.get(node.parentId) : undefined;
    nodes[id] = nodeFromDraft(
      node,
      id,
      parentId && parentId !== id ? parentId : undefined,
    );
  }

  for (const node of Object.values(nodes)) {
    if (!node.parentId) continue;
    if (!nodes[node.parentId] || wouldCycle(nodes, node.id, node.parentId))
      delete node.parentId;
  }

  const edges: ArchitectureProject["edges"] = [];
  const seenEdges = new Set<string>();
  for (const edge of draft.edges) {
    const source = idByDraft.get(edge.source);
    const target = idByDraft.get(edge.target);
    if (!source || !target || source === target) continue;
    const key = `${source}:${edge.relation}:${target}`;
    if (seenEdges.has(key)) continue;
    seenEdges.add(key);
    edges.push({
      id: randomUUID(),
      source,
      target,
      relation: edge.relation,
    });
  }

  const decisions = draft.decisions.slice(0, 8).map((decision) => ({
    id: randomUUID(),
    title: clip(decision.title, 200, "Decision"),
    reason: clip(
      decision.reason,
      10000,
      "Recorded during architecture drafting.",
    ),
    alternative: clip(decision.alternative, 10000),
  }));

  const nodeIds = Object.keys(nodes);
  if (nodeIds.length === 0)
    throw new ArchitectureGenerateError(
      "INVALID_ARCHITECTURE",
      "The model did not return a usable architecture. Try a more specific description.",
      422,
    );

  const events = nodeIds.map((nodeId) => ({
    id: randomUUID(),
    type: "node.created" as const,
    actor: "ai" as const,
    at: createdAt,
    summary: `Drafted ${nodes[nodeId].name}.`,
    nodeIds: [nodeId],
  }));

  const projectName =
    clip(draft.name, 80) || projectNameFromIntent(description);
  const projectDescription =
    clip(draft.description, 10000) || clip(description, 10000);
  const draftProject: ArchitectureProject = {
    id: randomUUID(),
    name: projectName,
    description: projectDescription,
    version: 1,
    source: "local",
    nodes,
    edges,
    decisions,
    events,
    history: [
      {
        version: 1,
        title: "Architecture drafted",
        date: createdAt,
        initiator: "ai",
        reason: clip(
          description,
          2000,
          "Drafted from the project description.",
        ),
      },
    ],
  };
  const plan = deriveImplementationPlan(draftProject, createdAt);
  const parsed = projectSchema.safeParse(
    plan ? { ...draftProject, plan } : draftProject,
  );
  if (!parsed.success)
    throw new ArchitectureGenerateError(
      "INVALID_ARCHITECTURE",
      "The generated architecture could not be opened. Try again with a shorter description.",
      422,
    );
  return parsed.data;
}
