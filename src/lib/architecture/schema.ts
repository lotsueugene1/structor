import { z } from "zod";

const identifierSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .refine(
    (id) => !["__proto__", "constructor", "prototype"].includes(id),
    "Invalid identifier",
  );

export const nodeKindSchema = z.enum([
  "application",
  "domain",
  "feature",
  "capability",
  "service",
  "page",
  "flow",
  "data",
  "api",
  "actor",
  "event",
  "integration",
  "infrastructure",
  "security",
  "custom",
]);

export const provenanceSchema = z.enum(["observed", "inferred", "defined"]);

export const intentChangeSchema = z
  .object({
    id: identifierSchema,
    field: z.enum([
      "name",
      "summary",
      "intent",
      "requirements",
      "rules",
      "constraints",
      "security",
      "permissions",
      "events",
    ]),
    value: z.string().trim().min(1).max(2000),
    at: z.iso.datetime(),
  })
  .strict();

export const sourceReferenceSchema = z
  .object({
    path: z.string().trim().min(1).max(500),
    symbol: z.string().trim().min(1).max(300).optional(),
    startLine: z.number().int().positive().max(10_000_000).optional(),
    endLine: z.number().int().positive().max(10_000_000).optional(),
    language: z.string().trim().min(1).max(80).optional(),
    provenance: provenanceSchema.default("observed"),
  })
  .strict()
  .superRefine((reference, ctx) => {
    if (
      reference.startLine !== undefined &&
      reference.endLine !== undefined &&
      reference.endLine < reference.startLine
    )
      ctx.addIssue({
        code: "custom",
        message: "Source reference end line must follow its start line.",
      });
  });

const nodeListItemSchema = z.string().trim().min(1).max(2000);

export const nodeSchema = z
  .object({
    id: identifierSchema,
    parentId: identifierSchema.optional(),
    name: z.string().trim().min(1).max(80),
    kind: nodeKindSchema,
    summary: z.string().trim().min(1).max(2000),
    intent: z.string().max(10000),
    provenance: provenanceSchema.default("defined"),
    // Two architectural states: what the user intends, and what analysis observed.
    intended: z.boolean().default(true),
    observed: z.boolean().default(false),
    intentChanges: z.array(intentChangeSchema).max(200).default([]),
    requirements: z.array(nodeListItemSchema).max(100).default([]),
    rules: z.array(nodeListItemSchema).max(100),
    constraints: z.array(nodeListItemSchema).max(100).default([]),
    security: z.array(nodeListItemSchema).max(100),
    permissions: z.array(nodeListItemSchema).max(100).default([]),
    events: z.array(nodeListItemSchema).max(100).default([]),
    implementation: z.array(z.string().trim().min(1).max(500)).max(100),
    sourceReferences: z.array(sourceReferenceSchema).max(200).default([]),
    questions: z.array(nodeListItemSchema).max(100),
    assumptions: z.array(nodeListItemSchema).max(100),
  })
  .strict();

export const taskOperationSchema = z.enum(["CREATE", "UPDATE", "REMOVE"]);
export const taskStatusSchema = z.enum([
  "PLANNED",
  "READY",
  "IN_PROGRESS",
  "BLOCKED",
  "IMPLEMENTED",
  "VERIFIED",
]);

export const implementationTaskSchema = z
  .object({
    id: identifierSchema,
    nodeId: identifierSchema,
    operation: taskOperationSchema,
    title: z.string().trim().min(1).max(200),
    goal: z.string().trim().max(2000).default(""),
    requirements: z.array(nodeListItemSchema).max(100).default([]),
    businessRules: z.array(nodeListItemSchema).max(100).default([]),
    acceptanceCriteria: z.array(nodeListItemSchema).max(100).default([]),
    securityRequirements: z.array(nodeListItemSchema).max(100).default([]),
    affectedEntities: z.array(identifierSchema).max(200).default([]),
    dependencies: z.array(identifierSchema).max(200).default([]),
    status: taskStatusSchema.default("PLANNED"),
    notes: z.string().max(4000).default(""),
    updatedAt: z.iso.datetime(),
  })
  .strict();

export const implementationPlanSchema = z
  .object({
    id: identifierSchema,
    architectureVersion: z.number().int().positive(),
    status: z.enum(["EMPTY", "PENDING", "IN_PROGRESS", "COMPLETE"]),
    tasks: z.array(implementationTaskSchema).max(500),
    updatedAt: z.iso.datetime(),
  })
  .strict();

export const edgeSchema = z
  .object({
    id: identifierSchema,
    source: identifierSchema,
    target: identifierSchema,
    relation: z.enum([
      "calls",
      "reads_from",
      "writes_to",
      "emits",
      "protects",
      "depends_on",
    ]),
  })
  .strict();

export const decisionSchema = z
  .object({
    id: identifierSchema,
    title: z.string().trim().min(1).max(200),
    reason: z.string().trim().min(1).max(10000),
    alternative: z.string().max(10000),
  })
  .strict();

export const canvasPositionSchema = z
  .object({
    x: z.number().finite().min(-1_000_000).max(1_000_000),
    y: z.number().finite().min(-1_000_000).max(1_000_000),
  })
  .strict();

export const canvasSizeSchema = z
  .object({
    w: z.number().finite().min(80).max(4000),
    h: z.number().finite().min(40).max(4000),
  })
  .strict();

export const canvasBoundarySchema = z
  .object({
    id: identifierSchema,
    label: z.string().trim().min(1).max(80),
    description: z.string().trim().max(200).default(""),
    x: z.number().finite().min(-1_000_000).max(1_000_000),
    y: z.number().finite().min(-1_000_000).max(1_000_000),
    w: z.number().finite().min(120).max(8000),
    h: z.number().finite().min(80).max(8000),
  })
  .strict();

export const canvasNoteSchema = z
  .object({
    id: identifierSchema,
    kind: z.enum(["note", "text"]).default("note"),
    text: z.string().max(4000),
    x: z.number().finite().min(-1_000_000).max(1_000_000),
    y: z.number().finite().min(-1_000_000).max(1_000_000),
  })
  .strict();

export const canvasEdgeRouteSchema = z
  .object({
    routing: z.enum(["flexible", "pinned"]).default("flexible"),
    bend: z.number().finite().min(-500).max(500).default(0),
  })
  .strict();

export const canvasLayoutSchema = z
  .object({
    presentation: z.enum(["grouped-v1", "freeform-v1"]).optional(),
    positions: z
      .record(z.string().min(1).max(128), canvasPositionSchema)
      .refine((positions) => Object.keys(positions).length <= 500),
    sizes: z
      .record(z.string().min(1).max(128), canvasSizeSchema)
      .refine((sizes) => Object.keys(sizes).length <= 500)
      .optional(),
    boundaries: z.array(canvasBoundarySchema).max(100).optional(),
    memberships: z
      .record(z.string().min(1).max(128), identifierSchema)
      .refine((memberships) => Object.keys(memberships).length <= 500)
      .optional(),
    notes: z.array(canvasNoteSchema).max(200).optional(),
    edgeRoutes: z
      .record(z.string().min(1).max(128), canvasEdgeRouteSchema)
      .refine((routes) => Object.keys(routes).length <= 2000)
      .optional(),
  })
  .strict();

export const repositoryMetadataSchema = z
  .object({
    fileName: z.string().trim().min(1).max(255),
    repositoryRoot: z.string().max(300),
    scannerVersion: z.string().trim().min(1).max(80).optional(),
    importedAt: z.iso.datetime(),
    filesDiscovered: z.number().int().nonnegative().max(5000),
    analyzedFiles: z.number().int().nonnegative().max(400),
    frameworks: z.array(z.string().trim().min(1).max(80)).max(12),
    appRoots: z.array(z.string().min(1).max(300)).max(20),
  })
  .strict();

export const architectureEventSchema = z
  .object({
    id: identifierSchema,
    type: z.enum([
      "node.created",
      "node.updated",
      "node.deleted",
      "edge.created",
      "edge.updated",
      "edge.deleted",
      "requirement.created",
      "requirement.updated",
      "requirement.deleted",
      "business_rule.created",
      "business_rule.updated",
      "business_rule.deleted",
      "security.updated",
      "permission.updated",
      "event.updated",
      "question.updated",
      "assumption.updated",
      "source_reference.updated",
      "decision.created",
      "decision.updated",
      "decision.deleted",
      "patch.applied",
      "node.reparented",
      "constraint.updated",
      "task.updated",
      "plan.updated",
    ]),
    actor: z.enum(["manual", "ai", "import", "system"]),
    at: z.iso.datetime(),
    summary: z.string().trim().min(1).max(500),
    nodeIds: z.array(identifierSchema).max(500).default([]),
    patchId: identifierSchema.optional(),
  })
  .strict();

const historyItemSchema = z
  .object({
    version: z.number().int().positive(),
    title: z.string().trim().min(1).max(500),
    date: z.iso.datetime(),
    initiator: z.enum(["manual", "ai", "import", "system"]).optional(),
    reason: z.string().trim().min(1).max(2000).optional(),
    patchId: identifierSchema.optional(),
    eventIds: z.array(identifierSchema).max(500).optional(),
  })
  .strict();

export const projectSchema = z
  .object({
    id: identifierSchema,
    name: z.string().trim().min(1).max(80),
    description: z.string().trim().max(10000),
    version: z.number().int().positive(),
    source: z.enum(["local", "repository"]),
    repository: repositoryMetadataSchema.optional(),
    canvas: canvasLayoutSchema.optional(),
    nodes: z.record(z.string(), nodeSchema),
    edges: z.array(edgeSchema).max(2000),
    decisions: z.array(decisionSchema).max(500),
    plan: implementationPlanSchema.optional(),
    history: z.array(historyItemSchema).max(1000),
    events: z.array(architectureEventSchema).max(5000).optional(),
  })
  .strict()
  .superRefine((project, ctx) => {
    for (const node of Object.values(project.nodes)) {
      if (!node.parentId) continue;
      if (node.parentId === node.id || !project.nodes[node.parentId]) {
        ctx.addIssue({
          code: "custom",
          path: ["nodes", node.id, "parentId"],
          message: "A component's parent must be another existing component.",
        });
        continue;
      }
      const seen = new Set<string>([node.id]);
      let cursor: string | undefined = node.parentId;
      while (cursor) {
        if (seen.has(cursor)) {
          ctx.addIssue({
            code: "custom",
            path: ["nodes", node.id, "parentId"],
            message: "Containment cannot form a cycle.",
          });
          break;
        }
        seen.add(cursor);
        cursor = project.nodes[cursor]?.parentId;
      }
    }
    for (const task of project.plan?.tasks ?? [])
      if (!project.nodes[task.nodeId])
        ctx.addIssue({
          code: "custom",
          path: ["plan", "tasks", task.id],
          message: "An implementation task references a missing component.",
        });
    if (project.source === "repository" && !project.repository)
      ctx.addIssue({
        code: "custom",
        path: ["repository"],
        message: "Repository imports require repository metadata.",
      });
    if (project.source === "local" && project.repository)
      ctx.addIssue({
        code: "custom",
        path: ["repository"],
        message: "Local projects cannot include repository metadata.",
      });
    for (const [id, node] of Object.entries(project.nodes)) {
      if (id !== node.id)
        ctx.addIssue({ code: "custom", message: "Node identity mismatch." });
    }
    for (const id of Object.keys(project.canvas?.positions ?? {})) {
      if (!Object.hasOwn(project.nodes, id))
        ctx.addIssue({
          code: "custom",
          path: ["canvas", "positions", id],
          message: "Canvas position references a missing component.",
        });
    }
    for (const id of Object.keys(project.canvas?.memberships ?? {})) {
      if (!Object.hasOwn(project.nodes, id))
        ctx.addIssue({
          code: "custom",
          path: ["canvas", "memberships", id],
          message: "Canvas membership references a missing component.",
        });
    }
    for (const edge of project.edges) {
      if (
        !Object.hasOwn(project.nodes, edge.source) ||
        !Object.hasOwn(project.nodes, edge.target)
      )
        ctx.addIssue({
          code: "custom",
          message: "A relationship references a missing node.",
        });
    }
    for (const items of [project.edges, project.decisions]) {
      if (new Set(items.map((item) => item.id)).size !== items.length)
        ctx.addIssue({
          code: "custom",
          message: "Duplicate identifiers are not allowed.",
        });
    }
    if (Object.keys(project.nodes).length > 500)
      ctx.addIssue({
        code: "custom",
        message: "A project can contain up to 500 components.",
      });
    const connections = project.edges.map(
      (edge) => `${edge.source}:${edge.relation}:${edge.target}`,
    );
    if (new Set(connections).size !== connections.length)
      ctx.addIssue({
        code: "custom",
        message: "This relationship already exists.",
      });
  });

export const nodeListFieldSchema = z.enum([
  "requirements",
  "rules",
  "constraints",
  "security",
  "permissions",
  "events",
  "questions",
  "assumptions",
  "implementation",
]);

const updateNodeChangesSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    kind: nodeKindSchema.optional(),
    summary: z.string().trim().min(1).max(2000).optional(),
    intent: z.string().max(10000).optional(),
    provenance: provenanceSchema.optional(),
    intended: z.boolean().optional(),
    observed: z.boolean().optional(),
  })
  .strict()
  .refine((changes) => Object.keys(changes).length > 0, {
    message: "A node update must contain at least one change.",
  });

const updateTaskChangesSchema = z
  .object({
    status: taskStatusSchema.optional(),
    title: z.string().trim().min(1).max(200).optional(),
    goal: z.string().trim().max(2000).optional(),
    acceptanceCriteria: z.array(nodeListItemSchema).max(100).optional(),
    notes: z.string().max(4000).optional(),
  })
  .strict()
  .refine((changes) => Object.keys(changes).length > 0, {
    message: "A task update must contain at least one change.",
  });

export const architectureCommandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("upsert_node"), node: nodeSchema }).strict(),
  z
    .object({
      type: z.literal("update_node"),
      nodeId: identifierSchema,
      changes: updateNodeChangesSchema,
    })
    .strict(),
  z
    .object({ type: z.literal("delete_node"), nodeId: identifierSchema })
    .strict(),
  z
    .object({
      type: z.literal("reparent_node"),
      nodeId: identifierSchema,
      parentId: identifierSchema.nullable(),
    })
    .strict(),
  z
    .object({
      type: z.literal("update_task"),
      taskId: identifierSchema,
      changes: updateTaskChangesSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("add_node_item"),
      nodeId: identifierSchema,
      field: nodeListFieldSchema,
      value: z.string().trim().min(1).max(2000),
    })
    .strict(),
  z
    .object({
      type: z.literal("update_node_item"),
      nodeId: identifierSchema,
      field: nodeListFieldSchema,
      index: z.number().int().nonnegative().max(999),
      value: z.string().trim().min(1).max(2000),
    })
    .strict(),
  z
    .object({
      type: z.literal("delete_node_item"),
      nodeId: identifierSchema,
      field: nodeListFieldSchema,
      index: z.number().int().nonnegative().max(999),
    })
    .strict(),
  z.object({ type: z.literal("upsert_edge"), edge: edgeSchema }).strict(),
  z
    .object({ type: z.literal("delete_edge"), edgeId: identifierSchema })
    .strict(),
  z
    .object({
      type: z.literal("attach_source_reference"),
      nodeId: identifierSchema,
      reference: sourceReferenceSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("delete_source_reference"),
      nodeId: identifierSchema,
      index: z.number().int().nonnegative().max(999),
    })
    .strict(),
  z
    .object({ type: z.literal("upsert_decision"), decision: decisionSchema })
    .strict(),
  z
    .object({
      type: z.literal("delete_decision"),
      decisionId: identifierSchema,
    })
    .strict(),
]);

const patchImpactSchema = z
  .object({
    primary: z.array(identifierSchema).max(500).default([]),
    secondary: z.array(identifierSchema).max(500).default([]),
    reasons: z
      .array(
        z
          .object({
            nodeId: identifierSchema,
            reason: z.string().trim().min(1).max(1000),
          })
          .strict(),
      )
      .max(1000)
      .default([]),
  })
  .strict();

export const patchSchema = z
  .object({
    id: identifierSchema,
    baseVersion: z.number().int().positive(),
    title: z.string().trim().min(1).max(500),
    reason: z.string().trim().max(2000).default(""),
    source: z.enum(["manual", "ai"]).default("manual"),
    rule: z.string().trim().max(2000).default(""),
    updates: z
      .array(
        z
          .object({ nodeId: identifierSchema, rule: nodeListItemSchema })
          .strict(),
      )
      .max(500)
      .default([]),
    commands: z.array(architectureCommandSchema).max(1000).default([]),
    impact: patchImpactSchema.default({
      primary: [],
      secondary: [],
      reasons: [],
    }),
    implications: z.array(z.string().max(2000)).max(500).default([]),
    resolvedQuestions: z
      .array(
        z
          .object({
            nodeId: identifierSchema,
            question: nodeListItemSchema,
          })
          .strict(),
      )
      .max(500)
      .default([]),
  })
  .strict()
  .refine((patch) => patch.commands.length > 0 || patch.updates.length > 0, {
    message: "An architecture patch must contain at least one change.",
  });

export function parsePersistableProject(value: unknown) {
  return projectSchema.parse(value);
}

export type ArchitectureNode = z.infer<typeof nodeSchema>;
export type ArchitectureProject = z.infer<typeof projectSchema>;
export type ArchitecturePatch = z.infer<typeof patchSchema>;
export type ArchitectureCommand = z.infer<typeof architectureCommandSchema>;
export type ArchitectureEvent = z.infer<typeof architectureEventSchema>;
export type CanvasPosition = z.infer<typeof canvasPositionSchema>;
export type CanvasSize = z.infer<typeof canvasSizeSchema>;
export type CanvasBoundary = z.infer<typeof canvasBoundarySchema>;
export type CanvasNote = z.infer<typeof canvasNoteSchema>;
export type CanvasEdgeRoute = z.infer<typeof canvasEdgeRouteSchema>;
export type CanvasLayout = z.infer<typeof canvasLayoutSchema>;
export type NodeKind = z.infer<typeof nodeKindSchema>;
export type NodeListField = z.infer<typeof nodeListFieldSchema>;
export type Provenance = z.infer<typeof provenanceSchema>;
export type IntentChange = z.infer<typeof intentChangeSchema>;
export type ImplementationTask = z.infer<typeof implementationTaskSchema>;
export type ImplementationPlan = z.infer<typeof implementationPlanSchema>;
export type TaskOperation = z.infer<typeof taskOperationSchema>;
export type TaskStatus = z.infer<typeof taskStatusSchema>;

export function childrenOf(
  project: ArchitectureProject,
  nodeId: string | null,
) {
  return Object.values(project.nodes).filter((node) =>
    nodeId === null ? !node.parentId : node.parentId === nodeId,
  );
}

export function ancestorsOf(project: ArchitectureProject, nodeId: string) {
  const path: ArchitectureNode[] = [];
  const seen = new Set<string>();
  let cursor = project.nodes[nodeId]?.parentId;
  while (cursor && !seen.has(cursor)) {
    const parent = project.nodes[cursor];
    if (!parent) break;
    seen.add(cursor);
    path.unshift(parent);
    cursor = parent.parentId;
  }
  return path;
}

export function subtreeOf(project: ArchitectureProject, nodeId: string) {
  const result: ArchitectureNode[] = [];
  const queue = [nodeId];
  const seen = new Set<string>();
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (seen.has(current)) continue;
    seen.add(current);
    for (const child of childrenOf(project, current)) {
      result.push(child);
      queue.push(child.id);
    }
  }
  return result;
}

export function deriveNodeDelta(node: ArchitectureNode): TaskOperation | null {
  if (node.intended && !node.observed) return "CREATE";
  if (!node.intended && node.observed) return "REMOVE";
  if (node.intended && node.observed && node.intentChanges.length > 0)
    return "UPDATE";
  return null;
}
export type SourceReference = z.infer<typeof sourceReferenceSchema>;
