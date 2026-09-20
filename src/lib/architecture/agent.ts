import { calculateArchitectureImpact } from "./commands";
import {
  deriveNodeDelta,
  childrenOf,
  patchSchema,
  type ArchitectureCommand,
  type ArchitecturePatch,
  type ArchitectureProject,
  type NodeKind,
  type NodeListField,
} from "./schema";

export type AgentScope =
  | { type: "project" }
  | { type: "node"; nodeId: string }
  | { type: "subsystem"; nodeIds: string[] };

export type AgentMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  scope: AgentScope;
};

export type ArchitectureReviewFinding = {
  id: string;
  nodeId: string;
  severity: "attention" | "open";
  title: string;
  detail: string;
};

export type AgentContext = {
  scope: AgentScope;
  project: Pick<ArchitectureProject, "id" | "name" | "description" | "version">;
  nodes: ArchitectureProject["nodes"][string][];
  relationships: ArchitectureProject["edges"];
  neighbors: ArchitectureProject["nodes"][string][];
  parents: Array<{ nodeId: string; parentId: string; parentName: string }>;
  children: ArchitectureProject["nodes"][string][];
  decisions: ArchitectureProject["decisions"];
  sourceReferences: Array<{
    nodeId: string;
    references: ArchitectureProject["nodes"][string]["sourceReferences"];
  }>;
  findings: ArchitectureReviewFinding[];
  delta: Array<{ nodeId: string; name: string; operation: string }>;
};

export const architectureAgentTools = [
  { name: "get_current_entity", access: "read" },
  { name: "get_entity", access: "read" },
  { name: "get_parent", access: "read" },
  { name: "get_children", access: "read" },
  { name: "get_subtree", access: "read" },
  { name: "get_neighbors", access: "read" },
  { name: "get_relationships", access: "read" },
  { name: "get_requirements", access: "read" },
  { name: "get_business_rules", access: "read" },
  { name: "get_constraints", access: "read" },
  { name: "get_security", access: "read" },
  { name: "get_permissions", access: "read" },
  { name: "get_decisions", access: "read" },
  { name: "get_assumptions", access: "read" },
  { name: "get_open_questions", access: "read" },
  { name: "get_source_references", access: "read" },
  { name: "get_implementation_state", access: "read" },
  { name: "get_implementation_plan", access: "read" },
  { name: "search_architecture", access: "read" },
  { name: "update_entity", access: "write" },
  { name: "create_entity", access: "write" },
  { name: "create_child", access: "write" },
  { name: "reparent_entity", access: "write" },
  { name: "delete_entity", access: "write" },
  { name: "mark_not_intended", access: "write" },
  { name: "add_requirement", access: "write" },
  { name: "add_business_rule", access: "write" },
  { name: "add_constraint", access: "write" },
  { name: "add_security_requirement", access: "write" },
  { name: "add_permission", access: "write" },
  { name: "add_event", access: "write" },
  { name: "add_open_question", access: "write" },
  { name: "add_assumption", access: "write" },
  { name: "resolve_assumption", access: "write" },
  { name: "create_edge", access: "write" },
  { name: "delete_edge", access: "write" },
  { name: "add_decision", access: "write" },
  { name: "attach_source_reference", access: "write" },
] as const;

export function reviewArchitectureNode(
  project: ArchitectureProject,
  nodeId: string,
): ArchitectureReviewFinding[] {
  const node = project.nodes[nodeId];
  if (!node) return [];
  const findings: ArchitectureReviewFinding[] = node.questions.map(
    (question, index) => ({
      id: `${node.id}:question:${index}`,
      nodeId: node.id,
      severity: "open",
      title: "Open architecture question",
      detail: question,
    }),
  );
  if (
    ["domain", "feature", "capability", "service", "api", "flow", "data"].includes(
      node.kind,
    ) &&
    node.security.length === 0
  )
    findings.push({
      id: `${node.id}:security`,
      nodeId: node.id,
      severity: "attention",
      title: "Security behavior is undefined",
      detail: "No security requirements are recorded for this boundary.",
    });
  if (["data", "api"].includes(node.kind) && node.permissions.length === 0)
    findings.push({
      id: `${node.id}:permissions`,
      nodeId: node.id,
      severity: "attention",
      title: "Access policy is undefined",
      detail: "No actors or permissions are recorded for this component.",
    });
  if (node.kind === "event") {
    const consumed = project.edges.some(
      (edge) => edge.source === node.id || edge.target === node.id,
    );
    if (!consumed)
      findings.push({
        id: `${node.id}:consumer`,
        nodeId: node.id,
        severity: "attention",
        title: "Event has no connected producer or consumer",
        detail: "Connect this event to the systems that emit or handle it.",
      });
  }
  if (node.assumptions.length > 0)
    findings.push({
      id: `${node.id}:assumptions`,
      nodeId: node.id,
      severity: "open",
      title: `${node.assumptions.length} unresolved assumption${node.assumptions.length === 1 ? "" : "s"}`,
      detail: "Accept, correct, or remove assumptions before implementation.",
    });
  return findings;
}

export function buildAgentContext(
  project: ArchitectureProject,
  scope: AgentScope,
): AgentContext {
  const scopedIds = new Set<string>();
  if (scope.type === "node") scopedIds.add(scope.nodeId);
  if (scope.type === "subsystem")
    for (const nodeId of scope.nodeIds) scopedIds.add(nodeId);
  if (scope.type === "project")
    for (const nodeId of Object.keys(project.nodes)) scopedIds.add(nodeId);
  const relationships = project.edges.filter(
    (edge) => scopedIds.has(edge.source) || scopedIds.has(edge.target),
  );
  const neighborIds = new Set(
    relationships.flatMap((edge) => [edge.source, edge.target]),
  );
  for (const nodeId of scopedIds) neighborIds.delete(nodeId);
  const nodes = [...scopedIds]
    .map((nodeId) => project.nodes[nodeId])
    .filter((node) => node !== undefined);
  const neighbors = [...neighborIds]
    .map((nodeId) => project.nodes[nodeId])
    .filter((node) => node !== undefined);
  const contextNodes = [...nodes, ...neighbors];
  const children = nodes.flatMap((node) => childrenOf(project, node.id));
  return {
    scope,
    project: {
      id: project.id,
      name: project.name,
      description: project.description,
      version: project.version,
    },
    nodes,
    relationships,
    neighbors,
    parents: nodes
      .filter((node) => node.parentId && project.nodes[node.parentId])
      .map((node) => ({
        nodeId: node.id,
        parentId: node.parentId!,
        parentName: project.nodes[node.parentId!].name,
      })),
    children,
    decisions: project.decisions,
    sourceReferences: contextNodes
      .filter((node) => node.sourceReferences.length > 0)
      .map((node) => ({ nodeId: node.id, references: node.sourceReferences })),
    findings: nodes.flatMap((node) => reviewArchitectureNode(project, node.id)),
    delta: nodes
      .map((node) => ({
        nodeId: node.id,
        name: node.name,
        operation: deriveNodeDelta(node) ?? "ALIGNED",
      }))
      .filter((entry) => entry.operation !== "ALIGNED"),
  };
}

function addItemCommand(
  nodeId: string,
  field: NodeListField,
  value: string,
): ArchitectureCommand {
  return { type: "add_node_item", nodeId, field, value };
}

function nodeKind(value: string): NodeKind | null {
  const normalized = value.toLowerCase();
  if (normalized === "data model") return "data";
  if (normalized === "security boundary") return "security";
  if (normalized === "user flow") return "flow";
  if (normalized === "api") return "api";
  const kinds: NodeKind[] = [
    "domain",
    "feature",
    "capability",
    "service",
    "page",
    "flow",
    "actor",
    "event",
    "integration",
    "infrastructure",
    "custom",
  ];
  return kinds.find((kind) => kind === normalized) ?? null;
}

export type CanvasAction =
  | { type: "move_into_boundary"; nodeIds: string[]; boundaryLabel: string }
  | { type: "remove_from_boundary"; nodeIds: string[] }
  | { type: "arrange" };

function findNodeByName(project: ArchitectureProject, name: string) {
  const normalized = name.trim().toLowerCase();
  return Object.values(project.nodes).find(
    (node) => node.name.toLowerCase() === normalized,
  );
}

export function runScopedArchitectureAgent(
  project: ArchitectureProject,
  scope: AgentScope,
  prompt: string,
): {
  reply: string;
  commands?: ArchitectureCommand[];
  patch?: ArchitecturePatch;
  canvas?: CanvasAction;
} {
  const text = prompt.trim();
  const node = scope.type === "node" ? project.nodes[scope.nodeId] : undefined;
  if (scope.type === "node" && !node)
    return { reply: "The selected architecture component no longer exists." };

  if (
    /^(?:arrange|tidy|re-?layout)(?: the)?(?: canvas| architecture)?\.?$/i.test(
      text,
    )
  )
    return {
      reply: "Rearranged the canvas using the grouped layout.",
      canvas: { type: "arrange" },
    };
  const moveInto = text.match(
    /^(?:move|put|place) (?:this|it|["']?(.+?)["']?) (?:into|inside|under|in) ["']?(.+?)["']?\.?$/i,
  );
  if (moveInto) {
    const target = moveInto[1] ? findNodeByName(project, moveInto[1]) : node;
    if (!target)
      return {
        reply: `I could not find a component named “${moveInto[1]}”.`,
      };
    return {
      reply: `Moved ${target.name} into the ${moveInto[2].trim()} boundary on the canvas. This changes the view, not the canonical relationships.`,
      canvas: {
        type: "move_into_boundary",
        nodeIds: [target.id],
        boundaryLabel: moveInto[2].trim(),
      },
    };
  }
  const removeFrom = text.match(
    /^(?:remove|take) (?:this|it|["']?(.+?)["']?) (?:out of|from) (?:its |the )?boundary\.?$/i,
  );
  if (removeFrom) {
    const target = removeFrom[1]
      ? findNodeByName(project, removeFrom[1])
      : node;
    if (!target)
      return {
        reply: `I could not find a component named “${removeFrom[1]}”.`,
      };
    return {
      reply: `Removed ${target.name} from its boundary.`,
      canvas: { type: "remove_from_boundary", nodeIds: [target.id] },
    };
  }

  const notIntended = text.match(
    /^(?:remove|we no longer (?:want|need)|delete|retire) (?:this|it|["']?(.+?)["']?)(?:\s+(?:from(?: the)? (?:intent|intended architecture|plan)))?\.?$/i,
  );
  if (notIntended && notIntended[1]) {
    const target = findNodeByName(project, notIntended[1]);
    if (!target)
      return { reply: `I could not find a component named “${notIntended[1]}”.` };
    if (!target.observed)
      return {
        reply: `${target.name} has no observed implementation, so this removes it outright.`,
        patch: patchSchema.parse({
          id: crypto.randomUUID(),
          baseVersion: project.version,
          title: `Remove ${target.name}`,
          reason: text,
          source: "ai",
          commands: [{ type: "delete_node", nodeId: target.id }],
          impact: calculateArchitectureImpact(project, [target.id]),
        }),
      };
    return {
      reply: `${target.name} is marked as no longer intended. It stays visible as REMOVE work in the implementation plan — observed evidence is preserved.`,
      commands: [
        {
          type: "update_node",
          nodeId: target.id,
          changes: { intended: false, provenance: "defined" },
        },
      ],
    };
  }

  if (node) {
    const rename = text.match(
      /^rename (?:this|it)(?: to)?\s+["']?(.+?)["']?\.?$/i,
    );
    if (rename)
      return {
        reply: `Renamed ${node.name} to ${rename[1].trim()}.`,
        commands: [
          {
            type: "update_node",
            nodeId: node.id,
            changes: { name: rename[1].trim(), provenance: "defined" },
          },
        ],
      };
    const purpose = text.match(
      /^(?:change|set|update) (?:the )?purpose(?: to)?\s+["']?(.+?)["']?\.?$/i,
    );
    if (purpose)
      return {
        reply: `Updated the defined purpose for ${node.name}.`,
        commands: [
          {
            type: "update_node",
            nodeId: node.id,
            changes: { intent: purpose[1].trim(), provenance: "defined" },
          },
        ],
      };
    const itemPatterns: Array<[RegExp, NodeListField, string]> = [
      [/^add (?:a )?requirement[:\s]+(.+)/i, "requirements", "requirement"],
      [/^add (?:a )?(?:business )?rule[:\s]+(.+)/i, "rules", "business rule"],
      [
        /^add (?:a )?security requirement[:\s]+(.+)/i,
        "security",
        "security requirement",
      ],
      [/^add (?:a )?permission[:\s]+(.+)/i, "permissions", "permission"],
      [/^add (?:an )?event[:\s]+(.+)/i, "events", "event"],
      [/^add (?:an )?open question[:\s]+(.+)/i, "questions", "open question"],
      [/^add (?:an )?assumption[:\s]+(.+)/i, "assumptions", "assumption"],
    ];
    for (const [pattern, field, label] of itemPatterns) {
      const match = text.match(pattern);
      if (match)
        return {
          reply: `Added the ${label} to ${node.name}.`,
          commands: [addItemCommand(node.id, field, match[1].trim())],
        };
    }
  }

  const create = text.match(
    /^(?:add|create) (?:a |an )?(domain|feature|capability|service|page|user flow|flow|data model|api|actor|event|integration|infrastructure|security boundary|custom)(?: called| named)?\s+["']?(.+?)["']?(?:\s+(?:inside|under|within|in)\s+(?:this|it|["']?(.+?)["']?))?\.?$/i,
  );
  if (create) {
    const kind = nodeKind(create[1]);
    if (kind) {
      const id = crypto.randomUUID();
      const name = create[2].trim();
      const createUnder = create[3];
      const parentId =
        createUnder?.trim() && findNodeByName(project, createUnder)
          ? findNodeByName(project, createUnder)!.id
          : scope.type === "node" &&
              /\b(?:inside|under|within|in) (?:this|it)\b/i.test(text)
            ? scope.nodeId
            : undefined;
      const command: ArchitectureCommand = {
        type: "upsert_node",
        node: {
          id,
          ...(parentId ? { parentId } : {}),
          name,
          kind,
          summary: `${name} architecture proposed through Structor AI.`,
          intent: "",
          provenance: "defined",
          intended: true,
          observed: false,
          intentChanges: [],
          requirements: [],
          rules: [],
          constraints: [],
          security: [],
          permissions: [],
          events: [],
          implementation: [],
          sourceReferences: [],
          questions: [],
          assumptions: [],
        },
      };
      const primary = scope.type === "node" ? [scope.nodeId] : [];
      const impact = calculateArchitectureImpact(project, primary);
      return {
        reply: `Prepared a proposal to create ${name}. Review its impact before applying it.`,
        patch: patchSchema.parse({
          id: crypto.randomUUID(),
          baseVersion: project.version,
          title: `Create ${name}`,
          reason: text,
          source: "ai",
          commands: [command],
          impact: {
            ...impact,
            primary: [id, ...impact.primary],
            reasons: [
              {
                nodeId: id,
                reason: "New architecture created by this proposal.",
              },
              ...impact.reasons,
            ],
          },
        }),
      };
    }
  }

  const context = buildAgentContext(project, scope);
  return {
    reply: `I assembled scoped architecture context for ${context.nodes.map((item) => item.name).join(", ") || project.name}, including ${context.relationships.length} relationships and ${context.findings.length} review findings. A model provider is not configured in this build, so I did not infer or mutate architecture from this request. Supported local actions include “rename this to …”, “set purpose to …”, “add requirement …”, “create feature …”, “move this into Payments”, and “arrange”.`,
  };
}
