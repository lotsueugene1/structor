import { deriveImplementationPlan } from "./plan";
import {
  architectureCommandSchema,
  edgeSchema,
  nodeSchema,
  parsePersistableProject,
  sourceReferenceSchema,
  subtreeOf,
  type ArchitectureCommand,
  type ArchitectureEvent,
  type ArchitectureNode,
  type ArchitectureProject,
  type IntentChange,
  type NodeListField,
} from "./schema";

export type CommandMetadata = {
  actor: ArchitectureEvent["actor"];
  title: string;
  reason?: string;
  patchId?: string;
};

function requireNode(project: ArchitectureProject, nodeId: string) {
  const node = project.nodes[nodeId];
  if (!node) throw new Error("Component not found.");
  return node;
}

function listEventType(
  field: NodeListField,
  operation: "created" | "updated" | "deleted",
): ArchitectureEvent["type"] {
  if (field === "requirements") return `requirement.${operation}`;
  if (field === "rules") return `business_rule.${operation}`;
  if (field === "constraints") return "constraint.updated";
  if (field === "security") return "security.updated";
  if (field === "permissions") return "permission.updated";
  if (field === "events") return "event.updated";
  if (field === "questions") return "question.updated";
  if (field === "assumptions") return "assumption.updated";
  return "source_reference.updated";
}

const INTENT_FIELDS = new Set<IntentChange["field"]>([
  "name",
  "summary",
  "intent",
  "requirements",
  "rules",
  "constraints",
  "security",
  "permissions",
  "events",
]);

/**
 * Observed components keep a ledger of intended changes so the difference between
 * intended architecture and observed implementation stays explicit.
 */
function recordIntent(
  node: ArchitectureNode,
  actor: ArchitectureEvent["actor"],
  field: string,
  value: string,
  previous?: string,
): ArchitectureNode {
  if (actor === "import" || actor === "system" || !node.observed) return node;
  if (!INTENT_FIELDS.has(field as IntentChange["field"])) return node;
  const superseded = new Set([value, previous].filter(Boolean));
  return {
    ...node,
    provenance: "defined",
    intentChanges: [
      ...node.intentChanges.filter(
        (change) => !(change.field === field && superseded.has(change.value)),
      ),
      {
        id: crypto.randomUUID(),
        field: field as IntentChange["field"],
        value,
        at: new Date().toISOString(),
      },
    ].slice(-200),
  };
}

function forgetIntent(node: ArchitectureNode, field: string, value: string) {
  return {
    ...node,
    intentChanges: node.intentChanges.filter(
      (change) => !(change.field === field && change.value === value),
    ),
  };
}

function assertValidParent(
  project: ArchitectureProject,
  nodeId: string,
  parentId: string | null | undefined,
) {
  if (!parentId) return;
  if (parentId === nodeId)
    throw new Error("A component cannot contain itself.");
  requireNode(project, parentId);
  if (subtreeOf(project, nodeId).some((node) => node.id === parentId))
    throw new Error("A component cannot be moved inside one of its children.");
}

function eventFor(
  type: ArchitectureEvent["type"],
  summary: string,
  actor: ArchitectureEvent["actor"],
  nodeIds: string[] = [],
  patchId?: string,
): ArchitectureEvent {
  return {
    id: crypto.randomUUID(),
    type,
    actor,
    at: new Date().toISOString(),
    summary,
    nodeIds,
    patchId,
  };
}

export function calculateArchitectureImpact(
  project: ArchitectureProject,
  primary: string[],
) {
  const primaryIds = new Set(primary.filter((id) => project.nodes[id]));
  const secondaryIds = new Set<string>();
  const reasons: Array<{ nodeId: string; reason: string }> = [];
  for (const nodeId of primaryIds)
    reasons.push({ nodeId, reason: "Directly changed by this proposal." });
  for (const edge of project.edges) {
    if (primaryIds.has(edge.source) && !primaryIds.has(edge.target)) {
      secondaryIds.add(edge.target);
      reasons.push({
        nodeId: edge.target,
        reason: `${project.nodes[edge.source].name} ${edge.relation.replaceAll("_", " ")} this component.`,
      });
    }
    if (primaryIds.has(edge.target) && !primaryIds.has(edge.source)) {
      secondaryIds.add(edge.source);
      reasons.push({
        nodeId: edge.source,
        reason: `This component ${edge.relation.replaceAll("_", " ")} ${project.nodes[edge.target].name}.`,
      });
    }
  }
  return {
    primary: [...primaryIds],
    secondary: [...secondaryIds],
    reasons,
  };
}

export function executeArchitectureCommands(
  project: ArchitectureProject,
  input: ArchitectureCommand[],
  metadata: CommandMetadata,
) {
  const commands = input.map((command) =>
    architectureCommandSchema.parse(command),
  );
  if (commands.length === 0)
    throw new Error("No architecture changes provided.");
  let next: ArchitectureProject = {
    ...project,
    nodes: { ...project.nodes },
    edges: [...project.edges],
    decisions: [...project.decisions],
    canvas: project.canvas
      ? { ...project.canvas, positions: { ...project.canvas.positions } }
      : undefined,
    events: [...(project.events ?? [])],
  };
  const events: ArchitectureEvent[] = [];

  for (const command of commands) {
    if (command.type === "upsert_node") {
      const parsed = nodeSchema.parse(command.node);
      const exists = Object.hasOwn(next.nodes, parsed.id);
      assertValidParent(next, parsed.id, parsed.parentId);
      const previous = next.nodes[parsed.id];
      let stored = parsed;
      if (previous) {
        stored = { ...parsed, intentChanges: previous.intentChanges };
        for (const field of ["name", "summary", "intent"] as const)
          if (previous[field] !== parsed[field] && parsed[field])
            stored = recordIntent(
              stored,
              metadata.actor,
              field,
              parsed[field],
              previous[field],
            );
        for (const field of [
          "requirements",
          "rules",
          "constraints",
          "security",
          "permissions",
          "events",
        ] as const)
          for (const value of parsed[field])
            if (!previous[field].includes(value))
              stored = recordIntent(stored, metadata.actor, field, value);
      }
      next.nodes[parsed.id] = stored;
      events.push(
        eventFor(
          exists ? "node.updated" : "node.created",
          `${exists ? "Updated" : "Created"} ${parsed.name}.`,
          metadata.actor,
          [parsed.id],
          metadata.patchId,
        ),
      );
      continue;
    }
    if (command.type === "update_node") {
      const current = requireNode(next, command.nodeId);
      let updated = nodeSchema.parse({ ...current, ...command.changes });
      for (const field of ["name", "summary", "intent"] as const) {
        const value = command.changes[field];
        if (value !== undefined && value !== current[field] && value)
          updated = recordIntent(
            updated,
            metadata.actor,
            field,
            value,
            current[field],
          );
      }
      next.nodes[command.nodeId] = updated;
      events.push(
        eventFor(
          "node.updated",
          `Updated ${updated.name}.`,
          metadata.actor,
          [updated.id],
          metadata.patchId,
        ),
      );
      continue;
    }
    if (command.type === "delete_node") {
      const current = requireNode(next, command.nodeId);
      const removed = [
        command.nodeId,
        ...subtreeOf(next, command.nodeId).map((node) => node.id),
      ];
      for (const id of removed) {
        delete next.nodes[id];
        if (next.canvas) delete next.canvas.positions[id];
      }
      const removedSet = new Set(removed);
      next.edges = next.edges.filter(
        (edge) => !removedSet.has(edge.source) && !removedSet.has(edge.target),
      );
      events.push(
        eventFor(
          "node.deleted",
          removed.length > 1
            ? `Deleted ${current.name} and ${removed.length - 1} contained component${removed.length === 2 ? "" : "s"}.`
            : `Deleted ${current.name}.`,
          metadata.actor,
          removed,
          metadata.patchId,
        ),
      );
      continue;
    }
    if (command.type === "reparent_node") {
      const current = requireNode(next, command.nodeId);
      assertValidParent(next, command.nodeId, command.parentId);
      const rest = { ...current };
      delete rest.parentId;
      next.nodes[command.nodeId] = nodeSchema.parse(
        command.parentId ? { ...rest, parentId: command.parentId } : rest,
      );
      const parentName = command.parentId
        ? next.nodes[command.parentId].name
        : "the project root";
      events.push(
        eventFor(
          "node.reparented",
          `Moved ${current.name} into ${parentName}.`,
          metadata.actor,
          [command.nodeId, ...(command.parentId ? [command.parentId] : [])],
          metadata.patchId,
        ),
      );
      continue;
    }
    if (command.type === "update_task") {
      const tasks = next.plan?.tasks ?? [];
      const task = tasks.find((item) => item.id === command.taskId);
      if (!task || !next.plan)
        throw new Error("Implementation task not found.");
      const updated = {
        ...task,
        ...command.changes,
        updatedAt: new Date().toISOString(),
      };
      next.plan = {
        ...next.plan,
        tasks: tasks.map((item) => (item.id === task.id ? updated : item)),
      };
      events.push(
        eventFor(
          "task.updated",
          `${updated.title} is now ${updated.status.toLowerCase().replaceAll("_", " ")}.`,
          metadata.actor,
          [task.nodeId],
          metadata.patchId,
        ),
      );
      continue;
    }
    if (
      command.type === "add_node_item" ||
      command.type === "update_node_item" ||
      command.type === "delete_node_item"
    ) {
      const current = requireNode(next, command.nodeId);
      const values = [...current[command.field]];
      let ledger = current;
      if (command.type === "add_node_item") {
        if (values.includes(command.value))
          throw new Error("This item is already recorded.");
        values.push(command.value);
        ledger = recordIntent(
          current,
          metadata.actor,
          command.field,
          command.value,
        );
      } else {
        if (command.index >= values.length)
          throw new Error("Architecture item not found.");
        const previousValue = values[command.index];
        if (command.type === "update_node_item") {
          values[command.index] = command.value;
          ledger = recordIntent(
            current,
            metadata.actor,
            command.field,
            command.value,
            previousValue,
          );
        } else {
          values.splice(command.index, 1);
          ledger = forgetIntent(current, command.field, previousValue);
        }
      }
      next.nodes[command.nodeId] = nodeSchema.parse({
        ...ledger,
        [command.field]: values,
      });
      const operation =
        command.type === "add_node_item"
          ? "created"
          : command.type === "update_node_item"
            ? "updated"
            : "deleted";
      events.push(
        eventFor(
          listEventType(command.field, operation),
          `${operation.charAt(0).toUpperCase() + operation.slice(1)} ${command.field.replaceAll("_", " ")} for ${current.name}.`,
          metadata.actor,
          [current.id],
          metadata.patchId,
        ),
      );
      continue;
    }
    if (command.type === "upsert_edge") {
      const parsed = edgeSchema.parse(command.edge);
      requireNode(next, parsed.source);
      requireNode(next, parsed.target);
      const exists = next.edges.some((edge) => edge.id === parsed.id);
      next.edges = [
        ...next.edges.filter((edge) => edge.id !== parsed.id),
        parsed,
      ];
      events.push(
        eventFor(
          exists ? "edge.updated" : "edge.created",
          `${exists ? "Updated" : "Created"} relationship between ${next.nodes[parsed.source].name} and ${next.nodes[parsed.target].name}.`,
          metadata.actor,
          [parsed.source, parsed.target],
          metadata.patchId,
        ),
      );
      continue;
    }
    if (command.type === "delete_edge") {
      const edge = next.edges.find((item) => item.id === command.edgeId);
      if (!edge) throw new Error("Relationship not found.");
      next.edges = next.edges.filter((item) => item.id !== command.edgeId);
      events.push(
        eventFor(
          "edge.deleted",
          `Deleted relationship between ${next.nodes[edge.source].name} and ${next.nodes[edge.target].name}.`,
          metadata.actor,
          [edge.source, edge.target],
          metadata.patchId,
        ),
      );
      continue;
    }
    if (command.type === "attach_source_reference") {
      const current = requireNode(next, command.nodeId);
      const reference = sourceReferenceSchema.parse(command.reference);
      next.nodes[command.nodeId] = nodeSchema.parse({
        ...current,
        sourceReferences: [...current.sourceReferences, reference],
      });
      events.push(
        eventFor(
          "source_reference.updated",
          `Attached ${reference.path} to ${current.name}.`,
          metadata.actor,
          [current.id],
          metadata.patchId,
        ),
      );
      continue;
    }
    if (command.type === "delete_source_reference") {
      const current = requireNode(next, command.nodeId);
      if (command.index >= current.sourceReferences.length)
        throw new Error("Source reference not found.");
      const references = [...current.sourceReferences];
      references.splice(command.index, 1);
      next.nodes[command.nodeId] = nodeSchema.parse({
        ...current,
        sourceReferences: references,
      });
      events.push(
        eventFor(
          "source_reference.updated",
          `Removed a source reference from ${current.name}.`,
          metadata.actor,
          [current.id],
          metadata.patchId,
        ),
      );
      continue;
    }
    if (command.type === "upsert_decision") {
      const exists = next.decisions.some(
        (decision) => decision.id === command.decision.id,
      );
      next.decisions = [
        ...next.decisions.filter(
          (decision) => decision.id !== command.decision.id,
        ),
        command.decision,
      ];
      events.push(
        eventFor(
          exists ? "decision.updated" : "decision.created",
          `${exists ? "Updated" : "Created"} decision: ${command.decision.title}.`,
          metadata.actor,
          [],
          metadata.patchId,
        ),
      );
      continue;
    }
    const decision = next.decisions.find(
      (item) => item.id === command.decisionId,
    );
    if (!decision) throw new Error("Decision not found.");
    next.decisions = next.decisions.filter(
      (item) => item.id !== command.decisionId,
    );
    events.push(
      eventFor(
        "decision.deleted",
        `Deleted decision: ${decision.title}.`,
        metadata.actor,
        [],
        metadata.patchId,
      ),
    );
  }

  if (metadata.patchId)
    events.push(
      eventFor(
        "patch.applied",
        metadata.title,
        metadata.actor,
        [...new Set(events.flatMap((event) => event.nodeIds))],
        metadata.patchId,
      ),
    );
  const version = project.version + 1;
  const plan = deriveImplementationPlan({ ...next, version });
  if (
    plan &&
    JSON.stringify(plan.tasks) !== JSON.stringify(project.plan?.tasks ?? [])
  )
    events.push(
      eventFor(
        "plan.updated",
        `Implementation plan now tracks ${plan.tasks.length} task${plan.tasks.length === 1 ? "" : "s"}.`,
        "system",
        plan.tasks.map((task) => task.nodeId),
        metadata.patchId,
      ),
    );
  next = {
    ...next,
    version,
    plan,
    events: [...(next.events ?? []), ...events].slice(-5000),
    history: [
      ...project.history,
      {
        version,
        title: metadata.title,
        date: new Date().toISOString(),
        initiator: metadata.actor,
        reason: metadata.reason,
        patchId: metadata.patchId,
        eventIds: events.map((event) => event.id),
      },
    ],
  };
  return { project: parsePersistableProject(next), events };
}
