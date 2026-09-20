import {
  ancestorsOf,
  deriveNodeDelta,
  implementationPlanSchema,
  type ArchitectureNode,
  type ArchitectureProject,
  type ImplementationPlan,
  type ImplementationTask,
  type TaskOperation,
} from "./schema";

const FIELD_LABELS: Record<string, string> = {
  name: "Name",
  summary: "Summary",
  intent: "Purpose",
  requirements: "Requirement",
  rules: "Business rule",
  constraints: "Constraint",
  security: "Security requirement",
  permissions: "Permission",
  events: "Event",
};

export function taskIdFor(operation: TaskOperation, nodeId: string) {
  return `task-${operation.toLowerCase()}-${nodeId}`;
}

function relatedIds(project: ArchitectureProject, nodeId: string) {
  const related = new Set<string>();
  for (const edge of project.edges) {
    if (edge.source === nodeId) related.add(edge.target);
    if (edge.target === nodeId) related.add(edge.source);
  }
  const parent = project.nodes[nodeId]?.parentId;
  if (parent) related.add(parent);
  return [...related];
}

function describeCreate(node: ArchitectureNode, path: string) {
  return {
    title: `Implement ${node.name}`,
    goal:
      node.intent ||
      `Bring ${path} into the codebase so the observed implementation matches the intended architecture.`,
    acceptanceCriteria: [
      `${node.name} exists in the implementation with evidence that can be attached as source references.`,
      ...node.requirements.map((item) => `Requirement satisfied: ${item}`),
    ],
  };
}

function describeUpdate(node: ArchitectureNode, path: string) {
  const changes = node.intentChanges.map(
    (change) =>
      `${FIELD_LABELS[change.field] ?? change.field}: ${change.value}`,
  );
  return {
    title: `Update ${node.name}`,
    goal: `Reconcile the observed implementation of ${path} with the intended changes recorded by the team.`,
    acceptanceCriteria: changes.map((change) => `Implemented — ${change}`),
  };
}

function describeRemove(node: ArchitectureNode, path: string) {
  return {
    title: `Remove ${node.name}`,
    goal: `Retire ${path}; it is observed in the implementation but no longer part of the intended architecture.`,
    acceptanceCriteria: [
      `${node.name} and its exclusive dependencies are removed from the codebase.`,
      "Dependent systems are updated so nothing relies on the removed behavior.",
    ],
  };
}

export function deriveImplementationPlan(
  project: ArchitectureProject,
  now = new Date().toISOString(),
): ImplementationPlan | undefined {
  const existing = new Map(
    (project.plan?.tasks ?? []).map((task) => [task.id, task]),
  );
  const tasks: ImplementationTask[] = [];
  const nodes = Object.values(project.nodes).sort((left, right) =>
    left.name.localeCompare(right.name),
  );
  for (const node of nodes) {
    const operation = deriveNodeDelta(node);
    if (!operation) continue;
    const path = [...ancestorsOf(project, node.id), node]
      .map((item) => item.name)
      .join(" / ");
    const description =
      operation === "CREATE"
        ? describeCreate(node, path)
        : operation === "UPDATE"
          ? describeUpdate(node, path)
          : describeRemove(node, path);
    const id = taskIdFor(operation, node.id);
    const previous = existing.get(id);
    const parentTask =
      node.parentId && operation === "CREATE"
        ? taskIdFor("CREATE", node.parentId)
        : null;
    tasks.push({
      id,
      nodeId: node.id,
      operation,
      title: previous?.title ?? description.title,
      goal: previous?.goal ?? description.goal,
      requirements: node.requirements,
      businessRules: [...node.rules, ...node.constraints],
      acceptanceCriteria:
        previous?.acceptanceCriteria ?? description.acceptanceCriteria,
      securityRequirements: [...node.security, ...node.permissions],
      affectedEntities: relatedIds(project, node.id),
      dependencies:
        parentTask &&
        project.nodes[node.parentId!] &&
        deriveNodeDelta(project.nodes[node.parentId!]) === "CREATE"
          ? [parentTask]
          : [],
      status: previous?.status ?? "PLANNED",
      notes: previous?.notes ?? "",
      updatedAt: previous ? previous.updatedAt : now,
    });
  }
  if (tasks.length === 0 && !project.plan) return undefined;
  const done = tasks.every(
    (task) => task.status === "IMPLEMENTED" || task.status === "VERIFIED",
  );
  const started = tasks.some((task) => task.status !== "PLANNED");
  return implementationPlanSchema.parse({
    id: project.plan?.id ?? `plan-${project.id}`,
    architectureVersion: project.version,
    status:
      tasks.length === 0
        ? "EMPTY"
        : done
          ? "COMPLETE"
          : started
            ? "IN_PROGRESS"
            : "PENDING",
    tasks,
    updatedAt: now,
  });
}

export function tasksForNode(project: ArchitectureProject, nodeId: string) {
  return (project.plan?.tasks ?? []).filter((task) => task.nodeId === nodeId);
}
