import { randomUUID } from "node:crypto";

import { ArchitectureGenerateError } from "./errors";
import {
  architectureDraftKindSchema,
  architectureDraftRelationSchema,
  architectureDraftSchema,
  type ArchitectureDraft,
} from "./schema";

import { deriveImplementationPlan } from "@/lib/architecture/plan";
import {
  projectSchema,
  type ArchitectureNode,
  type ArchitectureProject,
} from "@/lib/architecture/schema";

const MAX_LIST_ITEMS = 12;
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

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asList(value: unknown) {
  const items = Array.isArray(value)
    ? value
    : typeof value === "string" && value.trim()
      ? [value]
      : [];
  return items
    .map((item) => (typeof item === "string" ? item : String(item ?? "")))
    .map((item) => clip(item, MAX_ITEM_LENGTH))
    .filter(Boolean)
    .slice(0, MAX_LIST_ITEMS);
}

function slugId(value: string, fallback: string) {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return slug || fallback;
}

function coerceKind(
  value: unknown,
): ArchitectureDraft["nodes"][number]["kind"] {
  if (typeof value !== "string") return "custom";
  const raw = value.trim().toLowerCase();
  const direct = architectureDraftKindSchema.safeParse(raw);
  if (direct.success) return direct.data;
  if (
    /\b(database|datastore|postgres|postgresql|mysql|mongo|sqlite|schema)\b/.test(
      raw,
    )
  )
    return "data";
  if (/\b(api|endpoint|graphql|rest|rpc)\b/.test(raw)) return "api";
  if (/\b(auth|identity|iam|permission)\b/.test(raw)) return "security";
  if (/\b(user|actor|customer|guest|admin|host|vendor)\b/.test(raw))
    return "actor";
  if (/\b(page|screen|ui|frontend|web)\b/.test(raw)) return "page";
  if (/\b(flow|journey|workflow)\b/.test(raw)) return "flow";
  if (/\b(event|topic|notification)\b/.test(raw)) return "event";
  if (/\b(queue|cache|cdn|k8s|kubernetes|server|hosting|infra)\b/.test(raw))
    return "infrastructure";
  if (/\b(stripe|twilio|email|sso|oauth|slack|s3|integration)\b/.test(raw))
    return "integration";
  if (/\bdomain\b/.test(raw)) return "domain";
  if (/\b(feature|module)\b/.test(raw)) return "feature";
  if (/\b(capability|ability)\b/.test(raw)) return "capability";
  if (/\b(service|worker|job|backend)\b/.test(raw)) return "service";
  if (/\b(app|application|platform|product)\b/.test(raw)) return "application";
  return "custom";
}

function coerceRelation(
  value: unknown,
): ArchitectureDraft["edges"][number]["relation"] {
  if (typeof value !== "string") return "depends_on";
  const raw = value
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  const direct = architectureDraftRelationSchema.safeParse(raw);
  if (direct.success) return direct.data;
  if (/read/.test(raw)) return "reads_from";
  if (/write/.test(raw)) return "writes_to";
  if (/emit|publish|produc/.test(raw)) return "emits";
  if (/protect|secur/.test(raw)) return "protects";
  if (/call|invok|http/.test(raw)) return "calls";
  return "depends_on";
}

function unwrapDraft(value: unknown): unknown {
  const root = asRecord(value);
  if (!root) return value;
  if (Array.isArray(root.nodes)) return root;
  for (const nested of Object.values(root)) {
    const inner = asRecord(nested);
    if (inner && Array.isArray(inner.nodes)) return inner;
  }
  return value;
}

function normalizeArchitectureDraft(value: unknown) {
  const root = asRecord(unwrapDraft(value));
  if (!root) return value;
  const rawNodes = Array.isArray(root.nodes) ? root.nodes : [];
  const nodes = rawNodes.slice(0, 40).flatMap((item, index) => {
    const node = asRecord(item);
    if (!node) return [];
    const name = clip(String(node.name ?? ""), 80);
    if (!name) return [];
    const id = slugId(String(node.id ?? name), `node-${index + 1}`);
    const parentId = clip(String(node.parentId ?? ""), 128);
    return [
      {
        ...node,
        id,
        ...(parentId ? { parentId } : {}),
        name,
        kind: coerceKind(node.kind),
        summary: clip(
          String(node.summary ?? ""),
          2000,
          `${name} is part of the intended architecture.`,
        ),
        intent: clip(String(node.intent ?? ""), 10000),
        requirements: asList(node.requirements),
        rules: asList(node.rules),
        constraints: asList(node.constraints),
        security: asList(node.security),
        permissions: asList(node.permissions),
        events: asList(node.events),
        questions: asList(node.questions),
        assumptions: asList(node.assumptions),
      },
    ];
  });
  const rawEdges = Array.isArray(root.edges) ? root.edges : [];
  const edges = rawEdges.slice(0, 120).flatMap((item) => {
    const edge = asRecord(item);
    if (!edge) return [];
    const source = clip(String(edge.source ?? ""), 128);
    const target = clip(String(edge.target ?? ""), 128);
    if (!source || !target) return [];
    return [
      {
        ...edge,
        source,
        target,
        relation: coerceRelation(edge.relation),
      },
    ];
  });
  const rawDecisions = Array.isArray(root.decisions) ? root.decisions : [];
  const decisions = rawDecisions.slice(0, 12).flatMap((item) => {
    const decision = asRecord(item);
    if (!decision) return [];
    const title = clip(String(decision.title ?? ""), 200);
    const reason = clip(String(decision.reason ?? ""), 10000);
    if (!title || !reason) return [];
    return [
      {
        ...decision,
        title,
        reason,
        alternative: clip(String(decision.alternative ?? ""), 10000),
      },
    ];
  });
  return {
    ...root,
    name: clip(String(root.name ?? ""), 80, "New architecture"),
    description: clip(String(root.description ?? ""), 10000),
    nodes,
    edges,
    decisions,
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
  const parsed = architectureDraftSchema.safeParse(
    normalizeArchitectureDraft(value),
  );
  if (!parsed.success)
    throw new ArchitectureGenerateError(
      "INVALID_ARCHITECTURE",
      "The generated architecture could not be opened. Try generating again.",
      422,
    );
  return parsed.data;
}

export type ArchitectureHydrationSession = {
  projectId: string;
  createdAt: string;
  idByDraft: Map<string, string>;
  edgeIds: Map<string, string>;
  decisionIds: Map<string, string>;
};

export function createHydrationSession(): ArchitectureHydrationSession {
  return {
    projectId: randomUUID(),
    createdAt: new Date().toISOString(),
    idByDraft: new Map(),
    edgeIds: new Map(),
    decisionIds: new Map(),
  };
}

export function hydrateArchitectureDraft(
  value: unknown,
  description: string,
  session: ArchitectureHydrationSession = createHydrationSession(),
): ArchitectureProject {
  const draft = parseArchitectureDraft(value);
  const { createdAt, idByDraft, edgeIds, decisionIds, projectId } = session;
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
    const id = edgeIds.get(key) ?? randomUUID();
    edgeIds.set(key, id);
    edges.push({
      id,
      source,
      target,
      relation: edge.relation,
    });
  }

  const decisions = draft.decisions.slice(0, 12).map((decision) => {
    const title = clip(decision.title, 200, "Decision");
    const id = decisionIds.get(title) ?? randomUUID();
    decisionIds.set(title, id);
    return {
      id,
      title,
      reason: clip(
        decision.reason,
        10000,
        "Recorded during architecture drafting.",
      ),
      alternative: clip(decision.alternative, 10000),
    };
  });

  const nodeIds = Object.keys(nodes);
  if (nodeIds.length === 0)
    throw new ArchitectureGenerateError(
      "INVALID_ARCHITECTURE",
      "The generated architecture could not be opened. Try generating again.",
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
    id: projectId,
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
      "The generated architecture could not be opened. Try generating again.",
      422,
    );
  return parsed.data;
}
