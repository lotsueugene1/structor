import {
  ancestorsOf,
  childrenOf,
  type ArchitectureNode,
  type ArchitectureProject,
} from "./schema";

export type PresentationOptions = {
  /** The entity the canvas has entered; null means the project root. */
  scopeId?: string | null;
  /** Entities expanded in place so their children render inside them. */
  expanded?: Iterable<string>;
};

export type PresentationContainer = {
  node: ArchitectureNode;
  children: ArchitectureNode[];
};

export const canvasProjectionIds = [
  "system",
  "flow",
  "data",
  "security",
  "infrastructure",
] as const;

export type CanvasProjection = (typeof canvasProjectionIds)[number];
export type PresentationTone =
  | "experience"
  | "core"
  | "data"
  | "external"
  | "infrastructure"
  | "security";

export type PresentationGroup = {
  id: string;
  label: string;
  description: string;
  tone: PresentationTone;
  nodes: ArchitectureNode[];
  hiddenCount: number;
};

export type ArchitecturePresentation = {
  projection: CanvasProjection;
  groups: PresentationGroup[];
  nodes: ArchitectureNode[];
  edges: ArchitectureProject["edges"];
  /** Expanded entities whose children are drawn inside them. */
  containers: PresentationContainer[];
  /** Ancestors of the current scope, root first. Empty at the project root. */
  breadcrumbs: ArchitectureNode[];
  scopeId: string | null;
  rootId?: string;
  notice?: string;
};

export const canvasProjections: Array<{
  id: CanvasProjection;
  label: string;
  description: string;
}> = [
  {
    id: "system",
    label: "System",
    description: "Major product and platform boundaries",
  },
  {
    id: "flow",
    label: "User Flow",
    description: "Calls and events that move work through the product",
  },
  {
    id: "data",
    label: "Data",
    description: "Owned state and the systems that use it",
  },
  {
    id: "security",
    label: "Security",
    description: "Components with trust and access requirements",
  },
  {
    id: "infrastructure",
    label: "Infrastructure",
    description: "Runtime, storage, and external services",
  },
];

function nodeDegree(project: ArchitectureProject, id: string) {
  return project.edges.reduce(
    (count, edge) =>
      count + Number(edge.source === id) + Number(edge.target === id),
    0,
  );
}

function sortMajorNodes(
  project: ArchitectureProject,
  nodes: ArchitectureNode[],
) {
  return nodes
    .slice()
    .sort(
      (left, right) =>
        nodeDegree(project, right.id) - nodeDegree(project, left.id) ||
        right.rules.length - left.rules.length ||
        right.implementation.length - left.implementation.length ||
        left.name.localeCompare(right.name),
    );
}

function findApplicationRoot(project: ArchitectureProject) {
  if (Object.keys(project.nodes).length < 3) return undefined;
  const incoming = new Map<string, number>();
  const outgoing = new Map<string, number>();
  for (const node of Object.values(project.nodes)) {
    incoming.set(node.id, 0);
    outgoing.set(node.id, 0);
  }
  for (const edge of project.edges) {
    incoming.set(edge.target, (incoming.get(edge.target) ?? 0) + 1);
    outgoing.set(edge.source, (outgoing.get(edge.source) ?? 0) + 1);
  }
  const root = Object.values(project.nodes)
    .filter(
      (node) =>
        node.kind === "application" && (incoming.get(node.id) ?? 0) === 0,
    )
    .sort(
      (left, right) =>
        (outgoing.get(right.id) ?? 0) - (outgoing.get(left.id) ?? 0),
    )[0];
  return root && (outgoing.get(root.id) ?? 0) >= 2 ? root.id : undefined;
}

function group(
  project: ArchitectureProject,
  id: string,
  label: string,
  description: string,
  tone: PresentationTone,
  nodes: ArchitectureNode[],
): PresentationGroup | null {
  if (nodes.length === 0) return null;
  // Nothing is hidden: density is handled by semantic zoom on the canvas.
  return {
    id,
    label,
    description,
    tone,
    nodes: sortMajorNodes(project, nodes),
    hiddenCount: 0,
  };
}

function compactGroups(groups: Array<PresentationGroup | null>) {
  return groups.filter((item): item is PresentationGroup => item !== null);
}

type VisibleScope = {
  scopeId: string | null;
  /** Entities shown at the current level (children of the scope). */
  level: ArchitectureNode[];
  containers: PresentationContainer[];
  /** Maps every entity to the visible entity that represents it, if any. */
  representative: Map<string, string>;
  breadcrumbs: ArchitectureNode[];
};

function resolveScope(
  project: ArchitectureProject,
  rootId: string | undefined,
  options: PresentationOptions,
): VisibleScope {
  const requested = options.scopeId ?? null;
  const scopeId = requested && project.nodes[requested] ? requested : null;
  const expanded = new Set(options.expanded ?? []);
  const level = childrenOf(project, scopeId).filter(
    (node) => scopeId !== null || node.id !== rootId,
  );
  const containers: PresentationContainer[] = [];
  const representative = new Map<string, string>();

  function claim(node: ArchitectureNode, visibleId: string) {
    representative.set(node.id, visibleId);
    for (const child of childrenOf(project, node.id)) {
      if (visibleId === node.id && expanded.has(node.id)) continue;
      claim(child, visibleId);
    }
  }
  for (const node of level) {
    representative.set(node.id, node.id);
    const children = childrenOf(project, node.id);
    if (expanded.has(node.id) && children.length > 0) {
      containers.push({ node, children });
      for (const child of children) claim(child, child.id);
    } else for (const child of children) claim(child, node.id);
  }
  return {
    scopeId,
    level,
    containers,
    representative,
    breadcrumbs: scopeId
      ? [...ancestorsOf(project, scopeId), project.nodes[scopeId]]
      : [],
  };
}

function liftEdges(
  project: ArchitectureProject,
  visible: VisibleScope,
  edgeFilter: (edge: ArchitectureProject["edges"][number]) => boolean,
) {
  const lifted: ArchitectureProject["edges"] = [];
  const seen = new Set<string>();
  for (const edge of project.edges) {
    if (!edgeFilter(edge)) continue;
    const source = visible.representative.get(edge.source);
    const target = visible.representative.get(edge.target);
    if (!source || !target || source === target) continue;
    const key = `${source}:${edge.relation}:${target}`;
    if (seen.has(key)) continue;
    seen.add(key);
    lifted.push(
      source === edge.source && target === edge.target
        ? edge
        : { id: `lifted-${edge.id}`, source, target, relation: edge.relation },
    );
  }
  return lifted;
}

function presentationFromGroups(
  project: ArchitectureProject,
  projection: CanvasProjection,
  groups: PresentationGroup[],
  visible: VisibleScope,
  rootId?: string,
  edgeFilter: (edge: ArchitectureProject["edges"][number]) => boolean = () =>
    true,
  notice?: string,
): ArchitecturePresentation {
  const levelNodes = groups.flatMap((item) => item.nodes);
  const levelIds = new Set(levelNodes.map((node) => node.id));
  const containers = visible.containers.filter((container) =>
    levelIds.has(container.node.id),
  );
  const nodes = [
    ...levelNodes,
    ...containers.flatMap((container) => container.children),
  ];
  const ids = new Set(nodes.map((node) => node.id));
  const scopedVisible: VisibleScope = {
    ...visible,
    representative: new Map(
      [...visible.representative].filter(([, id]) => ids.has(id)),
    ),
  };
  return {
    projection,
    groups,
    nodes,
    edges: liftEdges(project, scopedVisible, edgeFilter),
    containers,
    breadcrumbs: visible.breadcrumbs,
    scopeId: visible.scopeId,
    rootId,
    notice,
  };
}

export function deriveArchitecturePresentation(
  project: ArchitectureProject,
  projection: CanvasProjection,
  options: PresentationOptions = {},
): ArchitecturePresentation {
  const rootId = findApplicationRoot(project);
  const visible = resolveScope(project, rootId, options);
  const nodes = visible.level;
  const withoutRoot = nodes.filter((node) => node.id !== rootId);
  const applications = withoutRoot.filter((node) =>
    ["application", "page", "actor", "flow"].includes(node.kind),
  );
  const services = withoutRoot.filter((node) =>
    [
      "domain",
      "feature",
      "capability",
      "service",
      "api",
      "event",
      "security",
      "custom",
    ].includes(node.kind),
  );
  const data = withoutRoot.filter((node) => node.kind === "data");
  const integrations = withoutRoot.filter(
    (node) => node.kind === "integration",
  );
  const infrastructure = withoutRoot.filter(
    (node) => node.kind === "infrastructure",
  );

  if (projection === "system") {
    const groups = compactGroups([
      group(
        project,
        "experience",
        "Experience",
        "User-facing surfaces and product journeys",
        "experience",
        applications,
      ),
      group(
        project,
        "core",
        "Core systems",
        "Business capabilities and application services",
        "core",
        services,
      ),
      group(
        project,
        "data",
        "Data",
        "State and models owned by the product",
        "data",
        data,
      ),
      group(
        project,
        "infrastructure",
        "Infrastructure",
        "Runtime and platform components operated by the team",
        "infrastructure",
        infrastructure,
      ),
      group(
        project,
        "external",
        "External",
        "Third-party platforms and integrations",
        "external",
        integrations,
      ),
    ]);
    return presentationFromGroups(project, projection, groups, visible, rootId);
  }

  if (projection === "flow") {
    const flowRelations = new Set(["calls", "emits"]);
    const flowEdges = project.edges.filter((edge) =>
      flowRelations.has(edge.relation),
    );
    const flowIds = new Set(
      flowEdges.flatMap((edge) => [edge.source, edge.target]),
    );
    const journeyNodes = applications.filter(
      (node) => flowIds.size === 0 || flowIds.has(node.id),
    );
    const capabilityNodes = services.filter(
      (node) => flowIds.size === 0 || flowIds.has(node.id),
    );
    const groups = compactGroups([
      group(
        project,
        "journey",
        "Experience",
        "Where people enter and move through the product",
        "experience",
        journeyNodes,
      ),
      group(
        project,
        "capabilities",
        "Product capabilities",
        "Systems that carry out the journey",
        "core",
        capabilityNodes,
      ),
    ]);
    return presentationFromGroups(
      project,
      projection,
      groups,
      visible,
      rootId,
      (edge) => flowRelations.has(edge.relation),
      flowEdges.length === 0
        ? "No explicit user journey is captured yet. Showing candidate experience and capability boundaries without inventing a flow."
        : undefined,
    );
  }

  if (projection === "data") {
    const dataIds = new Set(data.map((node) => node.id));
    const dataEdges = project.edges.filter(
      (edge) =>
        dataIds.has(edge.source) ||
        dataIds.has(edge.target) ||
        edge.relation === "reads_from" ||
        edge.relation === "writes_to",
    );
    const connectedIds = new Set(
      dataEdges.flatMap((edge) => [edge.source, edge.target]),
    );
    const systems = withoutRoot.filter(
      (node) => node.kind !== "data" && connectedIds.has(node.id),
    );
    const groups = compactGroups([
      group(
        project,
        "data-systems",
        "Systems",
        "Capabilities that read or change product state",
        "core",
        systems.length > 0 ? systems : services,
      ),
      group(
        project,
        "owned-data",
        "Owned data",
        "Persistent models, stores, and state boundaries",
        "data",
        data,
      ),
    ]);
    return presentationFromGroups(
      project,
      projection,
      groups,
      visible,
      rootId,
      (edge) =>
        edge.relation === "reads_from" ||
        edge.relation === "writes_to" ||
        dataIds.has(edge.source) ||
        dataIds.has(edge.target),
      dataEdges.length === 0
        ? "No explicit data access relationships are captured yet. Data boundaries remain visible without inferred reads or writes."
        : undefined,
    );
  }

  if (projection === "security") {
    const protectedIds = new Set(
      project.edges
        .filter((edge) => edge.relation === "protects")
        .flatMap((edge) => [edge.source, edge.target]),
    );
    const secured = withoutRoot.filter(
      (node) => node.security.length > 0 || protectedIds.has(node.id),
    );
    const candidates =
      secured.length > 0 ? secured : [...applications, ...services];
    const groups = compactGroups([
      group(
        project,
        "trust-boundaries",
        "Trust boundaries",
        "Components where identity, access, and ownership matter",
        "security",
        candidates,
      ),
    ]);
    return presentationFromGroups(
      project,
      projection,
      groups,
      visible,
      rootId,
      (edge) => edge.relation === "protects",
      secured.length === 0
        ? "No security requirements are captured yet. Showing likely trust boundaries without inventing access rules."
        : undefined,
    );
  }

  const root = rootId ? project.nodes[rootId] : undefined;
  const runtimeNodes = [root, ...applications, ...infrastructure].filter(
    (node): node is ArchitectureNode => node !== undefined,
  );
  const groups = compactGroups([
    group(
      project,
      "runtime",
      "Runtime",
      "Application and deployment boundaries",
      "infrastructure",
      runtimeNodes,
    ),
    group(
      project,
      "infrastructure-data",
      "Data services",
      "Persistent infrastructure and state",
      "data",
      data,
    ),
    group(
      project,
      "infrastructure-external",
      "External services",
      "Platforms operated outside the application",
      "external",
      integrations,
    ),
  ]);
  return presentationFromGroups(project, projection, groups, visible, rootId);
}
