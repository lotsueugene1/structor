import {
  ancestorsOf,
  childrenOf,
  deriveNodeDelta,
  subtreeOf,
  type ArchitectureNode,
  type ArchitectureProject,
} from "@/lib/architecture/schema";

/**
 * Read-only architecture tools shared by the MCP endpoint and the Structor AI
 * context assembler. They never receive source code, only canonical architecture.
 */
export type McTool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

const idParam = { type: "string", description: "Architecture entity id." };

export const mcpTools: McTool[] = [
  {
    name: "get_project",
    description:
      "Project identity, description, version, and the implementation plan summary.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "list_entities",
    description:
      "Every architecture entity with id, kind, name, parent, provenance, and implementation state.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "get_entity",
    description:
      "The complete record for one entity: intent, requirements, rules, constraints, security, permissions, events, questions, assumptions, source references, and implementation state.",
    inputSchema: {
      type: "object",
      properties: { id: idParam },
      required: ["id"],
    },
  },
  {
    name: "get_children",
    description: "Entities contained by an entity, with their summaries.",
    inputSchema: {
      type: "object",
      properties: { id: idParam },
      required: ["id"],
    },
  },
  {
    name: "get_subtree",
    description:
      "An entity and its complete descendant tree with relationships inside the subtree.",
    inputSchema: {
      type: "object",
      properties: { id: idParam },
      required: ["id"],
    },
  },
  {
    name: "get_relationships",
    description: "Every relationship touching an entity, in either direction.",
    inputSchema: {
      type: "object",
      properties: { id: idParam },
      required: ["id"],
    },
  },
  {
    name: "search_architecture",
    description:
      "Search names, summaries, requirements, rules, security, and questions.",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    },
  },
  {
    name: "get_implementation_plan",
    description:
      "Structured tasks that reconcile intended architecture with observed implementation.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "get_architecture_delta",
    description:
      "Entities that are intended but not observed (CREATE), observed but not intended (REMOVE), or intended with unobserved changes (UPDATE).",
    inputSchema: { type: "object", properties: {} },
  },
];

function requireEntity(project: ArchitectureProject, id: unknown) {
  const node = typeof id === "string" ? project.nodes[id] : undefined;
  if (!node) throw new Error("Entity not found.");
  return node;
}

function presentNode(project: ArchitectureProject, node: ArchitectureNode) {
  return {
    id: node.id,
    parentId: node.parentId ?? null,
    kind: node.kind,
    name: node.name,
    summary: node.summary,
    intent: node.intent,
    provenance: node.provenance,
    intended: node.intended,
    observed: node.observed,
    delta: deriveNodeDelta(node),
    path: [...ancestorsOf(project, node.id), node]
      .map((item) => item.name)
      .join(" / "),
    requirements: node.requirements,
    rules: node.rules,
    constraints: node.constraints,
    security: node.security,
    permissions: node.permissions,
    events: node.events,
    questions: node.questions,
    assumptions: node.assumptions,
    implementationEvidence: node.implementation,
    sourceReferences: node.sourceReferences,
  };
}

export function runMcpTool(
  project: ArchitectureProject,
  name: string,
  args: Record<string, unknown>,
) {
  if (name === "get_project")
    return {
      id: project.id,
      name: project.name,
      description: project.description,
      version: project.version,
      source: project.source,
      entities: Object.keys(project.nodes).length,
      relationships: project.edges.length,
      plan: project.plan
        ? {
            status: project.plan.status,
            tasks: project.plan.tasks.length,
            updatedAt: project.plan.updatedAt,
          }
        : null,
    };
  if (name === "list_entities")
    return Object.values(project.nodes).map((node) => ({
      id: node.id,
      parentId: node.parentId ?? null,
      kind: node.kind,
      name: node.name,
      path: [...ancestorsOf(project, node.id), node]
        .map((item) => item.name)
        .join(" / "),
      summary: node.summary,
      provenance: node.provenance,
      intended: node.intended,
      observed: node.observed,
      delta: deriveNodeDelta(node),
    }));
  if (name === "get_entity")
    return presentNode(project, requireEntity(project, args.id));
  if (name === "get_children") {
    const entity = requireEntity(project, args.id);
    return childrenOf(project, entity.id).map((child) =>
      presentNode(project, child),
    );
  }
  if (name === "get_subtree") {
    const entity = requireEntity(project, args.id);
    const nodes = [entity, ...subtreeOf(project, entity.id)];
    const ids = new Set(nodes.map((node) => node.id));
    return {
      entities: nodes.map((node) => presentNode(project, node)),
      relationships: project.edges.filter(
        (edge) => ids.has(edge.source) && ids.has(edge.target),
      ),
    };
  }
  if (name === "get_relationships") {
    const entity = requireEntity(project, args.id);
    return project.edges
      .filter((edge) => edge.source === entity.id || edge.target === entity.id)
      .map((edge) => ({
        id: edge.id,
        relation: edge.relation,
        source: presentNodeSummary(project, edge.source),
        target: presentNodeSummary(project, edge.target),
      }));
  }
  if (name === "search_architecture") {
    const query = String(args.query ?? "")
      .trim()
      .toLowerCase();
    if (!query) throw new Error("A non-empty query is required.");
    return Object.values(project.nodes)
      .map((node) => ({ node, haystack: searchText(node) }))
      .filter(({ haystack }) => haystack.includes(query))
      .slice(0, 50)
      .map(({ node }) => presentNode(project, node));
  }
  if (name === "get_implementation_plan")
    return project.plan ?? { status: "EMPTY", tasks: [] };
  if (name === "get_architecture_delta") {
    const classify = (delta: ReturnType<typeof deriveNodeDelta>) =>
      Object.values(project.nodes)
        .filter((node) => deriveNodeDelta(node) === delta)
        .map((node) => ({
          id: node.id,
          name: node.name,
          kind: node.kind,
          path: [...ancestorsOf(project, node.id), node]
            .map((item) => item.name)
            .join(" / "),
          change: delta === "UPDATE" ? node.intentChanges : undefined,
        }));
    return {
      create: classify("CREATE"),
      update: classify("UPDATE"),
      remove: classify("REMOVE"),
    };
  }
  throw new Error(`Unknown tool: ${name}`);
}

function presentNodeSummary(project: ArchitectureProject, id: string) {
  const node = project.nodes[id];
  return node ? { id: node.id, name: node.name, kind: node.kind } : { id };
}

function searchText(node: ArchitectureNode) {
  return [
    node.name,
    node.summary,
    node.intent,
    ...node.requirements,
    ...node.rules,
    ...node.constraints,
    ...node.security,
    ...node.permissions,
    ...node.events,
    ...node.questions,
    ...node.assumptions,
  ]
    .join("\n")
    .toLowerCase();
}
