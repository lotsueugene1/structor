"use client";

import { create } from "zustand";

import {
  buildAgentContext,
  interpretLocalArchitectureAction,
  serializeAgentContext,
  type AgentMessage,
  type AgentScope,
  type CanvasAction,
} from "./agent";
import {
  calculateArchitectureImpact,
  executeArchitectureCommands,
  type CommandMetadata,
} from "./commands";
import { deriveArchitecturePresentation } from "./presentation";
import {
  parsePersistableProject,
  patchSchema,
  type ArchitectureCommand,
  type ArchitectureNode,
  type ArchitecturePatch,
  type ArchitectureProject,
  type CanvasBoundary,
  type CanvasEdgeRoute,
  type CanvasLayout,
  type CanvasNote,
  type CanvasPosition,
  type CanvasSize,
} from "./schema";

import { askArchitecture } from "@/lib/ai/ask-client";

type Relationship = ArchitectureProject["edges"][number];
type Decision = ArchitectureProject["decisions"][number];
export type CanvasLayoutPatch = {
  positions?: Record<string, CanvasPosition>;
  sizes?: Record<string, CanvasSize>;
  boundaries?: CanvasBoundary[];
  removeBoundaryIds?: string[];
  memberships?: Record<string, string | null>;
  notes?: CanvasNote[];
  removeNoteIds?: string[];
  edgeRoutes?: Record<string, CanvasEdgeRoute | null>;
};
type WorkspaceStore = {
  project: ArchitectureProject | null;
  projects: Record<string, ArchitectureProject>;
  pending: ArchitecturePatch | null;
  conversations: Record<string, AgentMessage[]>;
  drafting: boolean;
  draftingProjectId: string | null;
  draftError: string | null;
  setProject: (project: ArchitectureProject) => void;
  beginDraft: () => void;
  applyDraftSnapshot: (project: ArchitectureProject, complete: boolean) => void;
  finishDraft: () => void;
  failDraft: (message: string) => void;
  dispatch: (
    command: ArchitectureCommand | ArchitectureCommand[],
    metadata?: Partial<CommandMetadata>,
  ) => void;
  saveNode: (node: ArchitectureNode) => void;
  setNodePosition: (nodeId: string, position: CanvasPosition) => void;
  setCanvasLayout: (positions: Record<string, CanvasPosition>) => void;
  updateCanvas: (patch: CanvasLayoutPatch) => void;
  removeNode: (nodeId: string) => void;
  saveRelationship: (edge: Relationship) => void;
  removeRelationship: (id: string) => void;
  saveDecision: (decision: Decision) => void;
  removeDecision: (id: string) => void;
  propose: (nodeId: string, rule: string) => void;
  setPending: (patch: ArchitecturePatch) => void;
  reject: () => void;
  apply: () => void;
  sendAgentMessage: (scope: AgentScope, prompt: string) => Promise<void>;
};

function scopeKey(scope: AgentScope) {
  if (scope.type === "node") return `node:${scope.nodeId}`;
  if (scope.type === "subsystem")
    return `subsystem:${scope.nodeIds.slice().sort().join(",")}`;
  return "project";
}

export const useWorkspace = create<WorkspaceStore>((set, get) => {
  // Frontend interaction state only. Persistence belongs to the backend phase.
  function commit(project: ArchitectureProject, clearPending = false) {
    const parsed = parsePersistableProject(project);
    set({
      project: parsed,
      projects: { ...get().projects, [parsed.id]: parsed },
      ...(clearPending ? { pending: null } : {}),
    });
  }
  function current() {
    const project = get().project;
    if (!project) throw new Error("Open a project first.");
    return project;
  }
  function dispatch(
    command: ArchitectureCommand | ArchitectureCommand[],
    metadata: Partial<CommandMetadata> = {},
  ) {
    const commands = Array.isArray(command) ? command : [command];
    const result = executeArchitectureCommands(current(), commands, {
      actor: metadata.actor ?? "manual",
      title: metadata.title ?? "Updated architecture",
      reason: metadata.reason,
      patchId: metadata.patchId,
    });
    commit(result.project, true);
  }
  function updateCanvas(patch: CanvasLayoutPatch) {
    const project = current();
    const canvas: CanvasLayout = {
      presentation: "freeform-v1",
      positions: { ...project.canvas?.positions },
      sizes: { ...project.canvas?.sizes },
      boundaries: [...(project.canvas?.boundaries ?? [])],
      memberships: { ...project.canvas?.memberships },
      notes: [...(project.canvas?.notes ?? [])],
      edgeRoutes: { ...project.canvas?.edgeRoutes },
    };
    for (const [id, position] of Object.entries(patch.positions ?? {}))
      if (Object.hasOwn(project.nodes, id)) canvas.positions[id] = position;
    for (const [id, size] of Object.entries(patch.sizes ?? {}))
      if (Object.hasOwn(project.nodes, id)) canvas.sizes![id] = size;
    for (const boundary of patch.boundaries ?? [])
      canvas.boundaries = [
        ...canvas.boundaries!.filter((item) => item.id !== boundary.id),
        boundary,
      ];
    if (patch.removeBoundaryIds?.length) {
      const removed = new Set(patch.removeBoundaryIds);
      canvas.boundaries = canvas.boundaries!.filter(
        (item) => !removed.has(item.id),
      );
      for (const [nodeId, boundaryId] of Object.entries(canvas.memberships!))
        if (removed.has(boundaryId)) delete canvas.memberships![nodeId];
    }
    for (const [id, boundaryId] of Object.entries(patch.memberships ?? {})) {
      if (!Object.hasOwn(project.nodes, id)) continue;
      if (boundaryId) canvas.memberships![id] = boundaryId;
      else delete canvas.memberships![id];
    }
    for (const note of patch.notes ?? [])
      canvas.notes = [
        ...canvas.notes!.filter((item) => item.id !== note.id),
        note,
      ];
    if (patch.removeNoteIds?.length) {
      const removed = new Set(patch.removeNoteIds);
      canvas.notes = canvas.notes!.filter((item) => !removed.has(item.id));
    }
    for (const [edgeId, route] of Object.entries(patch.edgeRoutes ?? {})) {
      if (!project.edges.some((edge) => edge.id === edgeId)) continue;
      if (route) canvas.edgeRoutes![edgeId] = route;
      else delete canvas.edgeRoutes![edgeId];
    }
    commit({ ...project, canvas });
  }
  function applyCanvasAction(action: CanvasAction) {
    const project = current();
    if (action.type === "arrange") {
      commit({
        ...project,
        canvas: {
          presentation: "freeform-v1",
          positions: {},
          sizes: project.canvas?.sizes,
          notes: project.canvas?.notes,
        },
      });
      return;
    }
    if (action.type === "remove_from_boundary") {
      updateCanvas({
        memberships: Object.fromEntries(
          action.nodeIds.map((nodeId) => [nodeId, null]),
        ),
      });
      return;
    }
    const normalized = action.boundaryLabel.trim().toLowerCase();
    const presentationGroups = deriveArchitecturePresentation(
      project,
      "system",
    ).groups;
    const existing =
      (project.canvas?.boundaries ?? []).find(
        (boundary) => boundary.label.toLowerCase() === normalized,
      ) ??
      presentationGroups
        .filter((group) => group.label.toLowerCase() === normalized)
        .map((group) => ({
          id: group.id,
          label: group.label,
          description: group.description,
        }))[0];
    const patch: CanvasLayoutPatch = { memberships: {} };
    let boundaryId = existing?.id;
    if (!boundaryId) {
      boundaryId = crypto.randomUUID();
      const anchor = action.nodeIds
        .map((nodeId) => project.canvas?.positions[nodeId])
        .find((position) => position !== undefined);
      patch.boundaries = [
        {
          id: boundaryId,
          label: action.boundaryLabel.trim(),
          description: "",
          x: (anchor?.x ?? 0) - 40,
          y: (anchor?.y ?? 0) - 80,
          w: 520,
          h: 280,
        },
      ];
    }
    for (const nodeId of action.nodeIds)
      patch.memberships![nodeId] = boundaryId;
    updateCanvas(patch);
  }
  return {
    project: null,
    projects: {},
    pending: null,
    conversations: {},
    drafting: false,
    draftingProjectId: null,
    draftError: null,
    setProject: (project) => {
      const latest = get().projects[project.id] ?? project;
      commit(latest, true);
    },
    beginDraft: () =>
      set({ drafting: true, draftingProjectId: null, draftError: null }),
    applyDraftSnapshot: (project, complete) => {
      const state = get();
      const existing =
        state.projects[project.id] ??
        (state.project?.id === project.id ? state.project : undefined);
      const canvas =
        existing?.id === project.id ? existing.canvas : project.canvas;
      let next: ArchitectureProject;
      if (existing?.id === project.id && existing.version > 1) {
        const nodes = { ...existing.nodes };
        for (const [id, node] of Object.entries(project.nodes))
          if (!Object.hasOwn(nodes, id)) nodes[id] = node;
        const seen = new Set(
          existing.edges.map(
            (edge) => `${edge.source}:${edge.relation}:${edge.target}`,
          ),
        );
        const edges = [...existing.edges];
        for (const edge of project.edges) {
          const key = `${edge.source}:${edge.relation}:${edge.target}`;
          if (seen.has(key)) continue;
          seen.add(key);
          edges.push(edge);
        }
        next = {
          ...existing,
          nodes,
          edges,
          canvas: existing.canvas,
        };
      } else next = canvas ? { ...project, canvas } : project;
      const parsed = parsePersistableProject(next);
      const opening = state.draftingProjectId == null;
      const viewing = state.project;
      const follow = opening || viewing?.id === parsed.id;
      set({
        projects: { ...state.projects, [parsed.id]: parsed },
        project: follow ? parsed : viewing,
        drafting: !complete,
        draftingProjectId: complete ? null : parsed.id,
        draftError: null,
      });
    },
    finishDraft: () => set({ drafting: false, draftingProjectId: null }),
    failDraft: (message) => set({ drafting: false, draftError: message }),
    dispatch,
    saveNode: (node) =>
      dispatch(
        { type: "upsert_node", node },
        {
          title: `${Object.hasOwn(current().nodes, node.id) ? "Updated" : "Added"} ${node.name}`,
        },
      ),
    setNodePosition: (id, position) => {
      if (!Object.hasOwn(current().nodes, id))
        throw new Error("Component not found.");
      updateCanvas({ positions: { [id]: position } });
    },
    setCanvasLayout: (positions) => updateCanvas({ positions }),
    updateCanvas,
    removeNode: (nodeId) => {
      const node = current().nodes[nodeId];
      if (!node) throw new Error("Component not found.");
      dispatch(
        { type: "delete_node", nodeId },
        { title: `Removed ${node.name} and its relationships` },
      );
    },
    saveRelationship: (edge) =>
      dispatch({ type: "upsert_edge", edge }, { title: "Saved relationship" }),
    removeRelationship: (edgeId) =>
      dispatch(
        { type: "delete_edge", edgeId },
        { title: "Removed relationship" },
      ),
    saveDecision: (decision) =>
      dispatch(
        { type: "upsert_decision", decision },
        { title: `Saved decision: ${decision.title}` },
      ),
    removeDecision: (decisionId) =>
      dispatch(
        { type: "delete_decision", decisionId },
        { title: "Removed decision" },
      ),
    propose: (nodeId, rule) => {
      const project = current();
      const node = project.nodes[nodeId];
      if (!node) throw new Error("This component is no longer available.");
      if (node.rules.includes(rule.trim()))
        throw new Error("This rule is already recorded.");
      const command: ArchitectureCommand = {
        type: "add_node_item",
        nodeId,
        field: "rules",
        value: rule.trim(),
      };
      set({
        pending: patchSchema.parse({
          id: crypto.randomUUID(),
          baseVersion: project.version,
          title: `Add rule to ${node.name}`,
          reason: "Manual business rule proposal",
          source: "manual",
          rule,
          updates: [{ nodeId, rule: rule.trim() }],
          commands: [command],
          impact: calculateArchitectureImpact(project, [nodeId]),
        }),
      });
    },
    setPending: (patch) => set({ pending: patchSchema.parse(patch) }),
    reject: () => set({ pending: null }),
    apply: () => {
      const { pending } = get();
      const project = current();
      if (!pending) return;
      const patch = patchSchema.parse(pending);
      if (patch.baseVersion !== project.version)
        throw new Error(
          "Architecture changed. Close this review and draft the change again.",
        );
      const commands =
        patch.commands.length > 0
          ? patch.commands
          : patch.updates.map<ArchitectureCommand>((update) => ({
              type: "add_node_item",
              nodeId: update.nodeId,
              field: "rules",
              value: update.rule,
            }));
      const result = executeArchitectureCommands(project, commands, {
        actor: patch.source === "ai" ? "ai" : "manual",
        title: patch.title,
        reason: patch.reason,
        patchId: patch.id,
      });
      commit(result.project, true);
    },
    sendAgentMessage: async (scope, prompt) => {
      const project = current();
      const text = prompt.trim();
      if (!text) return;
      const key = scopeKey(scope);
      const userMessage: AgentMessage = {
        id: crypto.randomUUID(),
        role: "user",
        content: text,
        createdAt: new Date().toISOString(),
        scope,
      };
      const local = interpretLocalArchitectureAction(project, scope, text);
      const prior = get().conversations[key] ?? [];
      set({
        conversations: {
          ...get().conversations,
          [key]: [...prior, userMessage].slice(-100),
        },
      });
      const reply = local
        ? local.reply
        : await askArchitecture({
            prompt: text,
            messages: prior.slice(-12).map((message) => ({
              role: message.role,
              content: message.content,
            })),
            context: serializeAgentContext(buildAgentContext(project, scope)),
          });
      if (local?.commands)
        dispatch(local.commands, {
          actor: "ai",
          title: `Structor AI updated ${scope.type === "node" ? (project.nodes[scope.nodeId]?.name ?? "architecture") : "architecture"}`,
          reason: text,
        });
      if (local?.patch) set({ pending: local.patch });
      if (local?.canvas) applyCanvasAction(local.canvas);
      const assistantMessage: AgentMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: reply,
        createdAt: new Date().toISOString(),
        scope,
      };
      set({
        conversations: {
          ...get().conversations,
          [key]: [...(get().conversations[key] ?? []), assistantMessage].slice(
            -100,
          ),
        },
      });
    },
  };
});
