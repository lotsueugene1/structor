import {
  createBindingId,
  createShapeId,
  renderPlaintextFromRichText,
  toRichText,
  type Editor,
  type TLArrowBinding,
  type TLArrowShape,
  type TLBindingCreate,
  type TLNoteShape,
  type TLParentId,
  type TLShape,
  type TLShapeId,
  type TLTextShape,
} from "tldraw";

import {
  ARCHITECTURE_BOUNDARY,
  ARCHITECTURE_NODE,
  CARD,
  CHILD_CARD,
  defaultNodeSpec,
  type ArchitectureBoundaryShape,
  type ArchitectureNodeShape,
} from "@/components/architecture/shapes";
import {
  deriveArchitecturePresentation,
  type CanvasProjection,
} from "@/lib/architecture/presentation";
import {
  deriveNodeDelta,
  type ArchitectureNode,
  type ArchitectureProject,
  type CanvasBoundary,
  type CanvasNote,
  type CanvasPosition,
  type CanvasSize,
} from "@/lib/architecture/schema";

export const NODE_GAP_X = 32;
export const NODE_GAP_Y = 28;
export const BOUNDARY_PADDING = 32;
export const BOUNDARY_HEADER = 72;
export const BOUNDARY_GAP = 88;
const MAX_COLUMNS = 3;
const ENTITY_HEADER = 60;
const ENTITY_PADDING = 18;

export type CanvasViewState = {
  projection: CanvasProjection;
  selected: string | null;
  focus: boolean;
  affected: string[];
  impacted: string[];
  scopeId: string | null;
  expanded: string[];
};

export type LayoutBoundary = CanvasBoundary & {
  tone: string;
  count: number;
  members: string[];
  /** Set when the boundary is an expanded architecture entity. */
  nodeId?: string;
};

export type CanvasLayoutModel = {
  boundaries: LayoutBoundary[];
  positions: Map<string, CanvasPosition>;
  sizes: Map<string, CanvasSize>;
  membership: Map<string, string | null>;
  nodes: ArchitectureNode[];
  edges: ArchitectureProject["edges"];
  breadcrumbs: ArchitectureNode[];
  scopeId: string | null;
  childCounts: Map<string, number>;
  notice?: string;
};

export function nodeShapeId(nodeId: string) {
  return createShapeId(`node-${nodeId}`);
}
export function boundaryShapeId(boundaryId: string) {
  return createShapeId(`boundary-${boundaryId}`);
}
export function entityBoundaryId(nodeId: string) {
  return `entity:${nodeId}`;
}
export function edgeShapeId(edgeId: string) {
  return createShapeId(`edge-${edgeId}`);
}
export function noteShapeId(noteId: string) {
  return createShapeId(`note-${noteId}`);
}
function edgeBindingId(edgeId: string, terminal: "start" | "end") {
  return createBindingId(`edge-${edgeId}-${terminal}`);
}

export function nodeIdFromShape(shape: TLShape | undefined) {
  return shape?.type === ARCHITECTURE_NODE
    ? (shape as ArchitectureNodeShape).props.nodeId
    : null;
}
export function boundaryIdFromShape(shape: TLShape | undefined) {
  return shape?.type === ARCHITECTURE_BOUNDARY
    ? (shape as ArchitectureBoundaryShape).props.boundaryId
    : null;
}
/** The architecture entity an expanded container represents, if any. */
export function entityIdFromBoundaryShape(shape: TLShape | undefined) {
  if (shape?.type !== ARCHITECTURE_BOUNDARY) return null;
  const nodeId = (shape as ArchitectureBoundaryShape).props.nodeId;
  return nodeId === "" ? null : nodeId;
}

function nodeSize(
  node: ArchitectureNode,
  sizes: Record<string, CanvasSize> | undefined,
) {
  return sizes?.[node.id] ?? { ...defaultNodeSpec() };
}

type GridResult = {
  positions: Map<string, CanvasPosition>;
  width: number;
  height: number;
};

/** Lays entities out in rows; coordinates are relative to the container's top-left. */
function gridLayout(
  members: ArchitectureNode[],
  size: (node: ArchitectureNode) => CanvasSize,
  header: number,
  padding: number,
  minColumns = 1,
): GridResult {
  const positions = new Map<string, CanvasPosition>();
  const columns = Math.min(MAX_COLUMNS, Math.max(1, members.length));
  const rows: ArchitectureNode[][] = [];
  for (let index = 0; index < members.length; index += columns)
    rows.push(members.slice(index, index + columns));
  const rowWidths = rows.map((row) =>
    row.reduce(
      (sum, node, index) => sum + size(node).w + (index > 0 ? NODE_GAP_X : 0),
      0,
    ),
  );
  const width = Math.max(
    Math.max(0, ...rowWidths) + padding * 2,
    Math.max(minColumns, Math.min(2, members.length)) * CARD.w + padding * 2,
  );
  let rowY = header;
  rows.forEach((row, rowIndex) => {
    const rowHeight = Math.max(...row.map((node) => size(node).h));
    let x = padding + (width - padding * 2 - rowWidths[rowIndex]) / 2;
    for (const node of row) {
      positions.set(node.id, { x, y: rowY });
      x += size(node).w + NODE_GAP_X;
    }
    rowY += rowHeight + NODE_GAP_Y;
  });
  const height = Math.max(rowY - NODE_GAP_Y + padding, header + 60);
  return { positions, width, height };
}

export function buildLayoutModel(
  project: ArchitectureProject,
  view: CanvasViewState,
): CanvasLayoutModel {
  const presentation = deriveArchitecturePresentation(
    project,
    view.projection,
    { scopeId: view.scopeId, expanded: view.expanded },
  );
  const freeform = view.projection === "system";
  const canvas = project.canvas;
  const containerByNode = new Map(
    presentation.containers.map((container) => [container.node.id, container]),
  );
  const childCounts = new Map<string, number>();
  for (const node of Object.values(project.nodes))
    if (node.parentId)
      childCounts.set(node.parentId, (childCounts.get(node.parentId) ?? 0) + 1);

  // Expanded entities become containers sized around their children.
  const entityFrames = new Map<
    string,
    GridResult & { boundary: LayoutBoundary }
  >();
  const sizeOf = (node: ArchitectureNode): CanvasSize => {
    const frame = entityFrames.get(node.id);
    if (frame) return { w: frame.width, h: frame.height };
    return nodeSize(node, freeform ? canvas?.sizes : undefined);
  };
  for (const container of presentation.containers) {
    const grid = gridLayout(
      container.children,
      () => ({ ...CHILD_CARD }),
      ENTITY_HEADER,
      ENTITY_PADDING,
    );
    entityFrames.set(container.node.id, {
      ...grid,
      boundary: {
        id: entityBoundaryId(container.node.id),
        nodeId: container.node.id,
        label: container.node.name,
        description: container.node.summary,
        tone: "entity",
        count: container.children.length,
        members: container.children.map((child) => child.id),
        x: 0,
        y: 0,
        w: grid.width,
        h: grid.height,
      },
    });
  }

  // Keep small diagrams linear, but balance dense multi-group architectures
  // across two columns. A single tall stack forces the camera to zoom so far
  // out that node labels become unreadable on repository-sized projects.
  const automaticPositions = new Map<string, CanvasPosition>();
  const groupBoundaries: LayoutBoundary[] = [];
  const groupLayouts = presentation.groups.map((group) => ({
    group,
    grid: gridLayout(group.nodes, sizeOf, BOUNDARY_HEADER, BOUNDARY_PADDING, 2),
  }));
  const columnCount = groupLayouts.length >= 3 ? 2 : 1;
  const columnWidth = Math.max(
    0,
    ...groupLayouts.map(({ grid }) => grid.width),
  );
  const totalWidth =
    columnWidth * columnCount + BOUNDARY_GAP * (columnCount - 1);
  const columnHeights = Array.from({ length: columnCount }, () => 0);

  for (const { group, grid } of groupLayouts) {
    const column = columnHeights.reduce(
      (shortest, height, index, heights) =>
        height < heights[shortest] ? index : shortest,
      0,
    );
    const x =
      -totalWidth / 2 +
      column * (columnWidth + BOUNDARY_GAP) +
      (columnWidth - grid.width) / 2;
    const y = columnHeights[column];
    for (const [nodeId, position] of grid.positions)
      automaticPositions.set(nodeId, {
        x: x + position.x,
        y: y + position.y,
      });
    groupBoundaries.push({
      id: group.id,
      label: group.label,
      description: group.description,
      tone: group.tone,
      count: group.nodes.length,
      members: group.nodes.map((node) => node.id),
      x,
      y,
      w: grid.width,
      h: grid.height,
    });
    columnHeights[column] += grid.height + BOUNDARY_GAP;
  }

  let levelNodes = presentation.groups.flatMap((group) => group.nodes);
  let edges = presentation.edges;
  const overview =
    view.projection === "system" &&
    !view.selected &&
    view.affected.length === 0 &&
    view.impacted.length === 0;
  // The overview communicates structure through grouping. Free arrows only
  // appear where they are contextual: a selection, an impact review, or a
  // curated projection. Unfiltered cross-group edges would be illegible.
  if (overview && !view.focus) edges = [];
  if (
    view.projection === "system" &&
    view.selected &&
    view.affected.length === 0 &&
    view.impacted.length === 0
  )
    edges = edges.filter(
      (edge) => edge.source === view.selected || edge.target === view.selected,
    );
  if (view.focus && view.selected) {
    const ids = new Set([view.selected]);
    for (const edge of project.edges) {
      if (edge.source === view.selected) ids.add(edge.target);
      if (edge.target === view.selected) ids.add(edge.source);
    }
    levelNodes = levelNodes.filter((node) => ids.has(node.id));
    edges = edges.filter(
      (edge) => ids.has(edge.source) && ids.has(edge.target),
    );
  }
  const levelIds = new Set(levelNodes.map((node) => node.id));

  const membership = new Map<string, string | null>();
  for (const boundary of groupBoundaries)
    for (const member of boundary.members)
      if (levelIds.has(member)) membership.set(member, boundary.id);
  if (freeform && view.scopeId === null)
    for (const [nodeId, boundaryId] of Object.entries(
      canvas?.memberships ?? {},
    ))
      if (levelIds.has(nodeId)) membership.set(nodeId, boundaryId);

  const boundaryMap = new Map<string, LayoutBoundary>();
  for (const boundary of groupBoundaries)
    boundaryMap.set(boundary.id, { ...boundary, members: [] });
  if (freeform && view.scopeId === null)
    for (const saved of canvas?.boundaries ?? []) {
      const existing = boundaryMap.get(saved.id);
      boundaryMap.set(saved.id, {
        ...(existing ?? {
          tone: "custom",
          count: 0,
          members: [],
          description: "",
        }),
        ...saved,
        members: [],
      });
    }
  for (const [nodeId, boundaryId] of membership) {
    if (!boundaryId) continue;
    const boundary = boundaryMap.get(boundaryId);
    if (boundary) boundary.members.push(nodeId);
    else membership.set(nodeId, null);
  }

  const positions = new Map<string, CanvasPosition>();
  const sizes = new Map<string, CanvasSize>();
  const nodes: ArchitectureNode[] = [];
  const boundaries: LayoutBoundary[] = [...boundaryMap.values()]
    .map((boundary) => ({ ...boundary, count: boundary.members.length }))
    .filter(
      (boundary) =>
        boundary.count > 0 ||
        (freeform &&
          view.scopeId === null &&
          (canvas?.boundaries ?? []).some((item) => item.id === boundary.id)),
    );

  for (const node of levelNodes) {
    const saved = freeform ? canvas?.positions[node.id] : undefined;
    const position = saved ?? automaticPositions.get(node.id) ?? { x: 0, y: 0 };
    const frame = entityFrames.get(node.id);
    if (frame && containerByNode.has(node.id)) {
      // The expanded entity is drawn as a container; its children sit inside it.
      boundaries.push({ ...frame.boundary, x: position.x, y: position.y });
      for (const child of containerByNode.get(node.id)!.children) {
        const local = frame.positions.get(child.id) ?? { x: 0, y: 0 };
        positions.set(child.id, {
          x: position.x + local.x,
          y: position.y + local.y,
        });
        sizes.set(child.id, { ...CHILD_CARD });
        membership.set(child.id, frame.boundary.id);
        nodes.push(child);
      }
      continue;
    }
    positions.set(node.id, position);
    sizes.set(node.id, sizeOf(node));
    nodes.push(node);
  }

  return {
    boundaries,
    positions,
    sizes,
    membership,
    nodes,
    edges: edges.filter(
      (edge) => positions.has(edge.source) && positions.has(edge.target),
    ),
    breadcrumbs: presentation.breadcrumbs,
    scopeId: presentation.scopeId,
    childCounts,
    notice: presentation.notice,
  };
}

type RelationVisual = {
  color: TLArrowShape["props"]["color"];
  dash: TLArrowShape["props"]["dash"];
  size: TLArrowShape["props"]["size"];
  arrowheadEnd: TLArrowShape["props"]["arrowheadEnd"];
  label: string;
};

export function relationVisual(
  relation: ArchitectureProject["edges"][number]["relation"],
): RelationVisual {
  if (relation === "calls")
    return {
      color: "black",
      dash: "solid",
      size: "s",
      arrowheadEnd: "arrow",
      label: "uses",
    };
  if (relation === "emits")
    return {
      color: "violet",
      dash: "dotted",
      size: "s",
      arrowheadEnd: "arrow",
      label: "notifies",
    };
  if (relation === "reads_from")
    return {
      color: "blue",
      dash: "dotted",
      size: "s",
      arrowheadEnd: "none",
      label: "reads",
    };
  if (relation === "writes_to")
    return {
      color: "blue",
      dash: "dashed",
      size: "s",
      arrowheadEnd: "arrow",
      label: "writes",
    };
  if (relation === "protects")
    return {
      color: "red",
      dash: "dashed",
      size: "s",
      arrowheadEnd: "none",
      label: "guards",
    };
  return {
    color: "grey",
    dash: "solid",
    size: "s",
    arrowheadEnd: "none",
    label: "depends on",
  };
}

function emphasisFor(nodeId: string, view: CanvasViewState) {
  if (view.affected.includes(nodeId)) return "affected" as const;
  if (view.impacted.includes(nodeId)) return "impacted" as const;
  if (view.selected === nodeId) return "selected" as const;
  return "normal" as const;
}

function contextIds(project: ArchitectureProject, view: CanvasViewState) {
  const impactMode = view.affected.length > 0 || view.impacted.length > 0;
  const ids = new Set(
    impactMode
      ? [...view.affected, ...view.impacted]
      : view.selected
        ? [view.selected]
        : [],
  );
  if (view.selected && !impactMode)
    for (const edge of project.edges) {
      if (edge.source === view.selected) ids.add(edge.target);
      if (edge.target === view.selected) ids.add(edge.source);
    }
  return { ids, dimming: impactMode || Boolean(view.selected) };
}

export type SyncOptions = {
  skipShapeIds?: Set<TLShapeId>;
};

export function syncCanvas(
  editor: Editor,
  project: ArchitectureProject,
  view: CanvasViewState,
  model: CanvasLayoutModel,
  options: SyncOptions = {},
) {
  const pageId = editor.getCurrentPageId();
  const context = contextIds(project, view);
  const freeform = view.projection === "system";
  const existing = new Map(
    editor.getCurrentPageShapes().map((shape) => [shape.id, shape]),
  );
  const keep = new Set<TLShapeId>();
  const skip = options.skipShapeIds ?? new Set<TLShapeId>();

  editor.store.mergeRemoteChanges(() => {
    editor.run(
      () => {
        for (const boundary of model.boundaries) {
          const id = boundaryShapeId(boundary.id);
          keep.add(id);
          const muted =
            context.dimming &&
            !boundary.members.some((member) => context.ids.has(member));
          const props = {
            w: boundary.w,
            h: boundary.h,
            boundaryId: boundary.id,
            nodeId: boundary.nodeId ?? "",
            label: boundary.label,
            description: boundary.description,
            count: boundary.count,
            tone: boundary.tone,
            muted,
          };
          const current = existing.get(id) as
            | ArchitectureBoundaryShape
            | undefined;
          if (!current)
            editor.createShapes<ArchitectureBoundaryShape>([
              {
                id,
                type: ARCHITECTURE_BOUNDARY,
                parentId: pageId,
                x: boundary.x,
                y: boundary.y,
                isLocked: !freeform,
                props,
              },
            ]);
          else if (!skip.has(id))
            editor.updateShapes<ArchitectureBoundaryShape>([
              {
                id,
                type: ARCHITECTURE_BOUNDARY,
                parentId: pageId,
                x: boundary.x,
                y: boundary.y,
                isLocked: !freeform,
                props,
              },
            ]);
          else
            editor.updateShapes<ArchitectureBoundaryShape>([
              { id, type: ARCHITECTURE_BOUNDARY, props },
            ]);
        }

        const boundaryPositions = new Map(
          model.boundaries.map((boundary) => [boundary.id, boundary]),
        );
        for (const node of model.nodes) {
          const id = nodeShapeId(node.id);
          keep.add(id);
          const position = model.positions.get(node.id)!;
          const size = model.sizes.get(node.id)!;
          const boundaryId = model.membership.get(node.id) ?? null;
          const boundary = boundaryId
            ? boundaryPositions.get(boundaryId)
            : null;
          const parentId: TLParentId = boundary
            ? boundaryShapeId(boundary.id)
            : pageId;
          const local = boundary
            ? { x: position.x - boundary.x, y: position.y - boundary.y }
            : position;
          const dimmed = context.dimming && !context.ids.has(node.id);
          const idleOpacity = dimmed ? 0.12 : 1;
          const props = {
            w: size.w,
            h: size.h,
            nodeId: node.id,
            kind: node.kind,
            name: node.name,
            summary: node.summary,
            provenance: node.provenance,
            children: model.childCounts.get(node.id) ?? 0,
            delta: (deriveNodeDelta(node) ??
              "") as ArchitectureNodeShape["props"]["delta"],
            emphasis: emphasisFor(node.id, view),
            interactive: freeform,
          };
          const current = existing.get(id) as ArchitectureNodeShape | undefined;
          if (!current)
            editor.createShapes<ArchitectureNodeShape>([
              {
                id,
                type: ARCHITECTURE_NODE,
                parentId,
                x: local.x,
                y: local.y,
                opacity: idleOpacity,
                props,
              },
            ]);
          else if (!skip.has(id))
            editor.updateShapes<ArchitectureNodeShape>([
              {
                id,
                type: ARCHITECTURE_NODE,
                parentId,
                x: local.x,
                y: local.y,
                opacity: idleOpacity,
                props,
              },
            ]);
          else
            editor.updateShapes<ArchitectureNodeShape>([
              {
                id,
                type: ARCHITECTURE_NODE,
                opacity: idleOpacity,
                props,
              },
            ]);
        }

        const pairCounts = new Map<string, number>();
        for (const edge of model.edges) {
          const id = edgeShapeId(edge.id);
          keep.add(id);
          const visual = relationVisual(edge.relation);
          const active =
            !context.dimming ||
            view.selected === edge.source ||
            view.selected === edge.target ||
            view.affected.includes(edge.source) ||
            view.affected.includes(edge.target);
          const dimmed = !active;
          const source = model.positions.get(edge.source)!;
          const target = model.positions.get(edge.target)!;
          const pair = [edge.source, edge.target].sort().join("→");
          const pairIndex = pairCounts.get(pair) ?? 0;
          pairCounts.set(pair, pairIndex + 1);
          const route = project.canvas?.edgeRoutes?.[edge.id];
          const pinned = route?.routing === "pinned";
          const flexibleBend =
            pairIndex === 0
              ? 0
              : (pairIndex % 2 === 1 ? 1 : -1) * Math.ceil(pairIndex / 2) * 28;
          const props: Partial<TLArrowShape["props"]> = {
            kind: "elbow",
            color: view.selected && active ? "green" : visual.color,
            labelColor: "grey",
            dash: visual.dash,
            size: active && context.dimming ? "m" : visual.size,
            arrowheadStart: "none",
            arrowheadEnd: visual.arrowheadEnd,
            fill: "none",
            start: { x: 0, y: 0 },
            end: { x: target.x - source.x, y: target.y - source.y },
            // Relation meaning lives in stroke style and the node workspace;
            // floating text per edge becomes noise at scale.
            richText: toRichText(""),
            bend: pinned ? (route?.bend ?? 0) : flexibleBend,
          };
          const current = existing.get(id);
          if (!current) {
            editor.createShapes<TLArrowShape>([
              {
                id,
                type: "arrow",
                parentId: pageId,
                x: source.x,
                y: source.y,
                opacity: dimmed
                  ? 0.12
                  : edge.relation === "depends_on"
                    ? 0.55
                    : 0.9,
                props,
              },
            ]);
            const bindings: TLBindingCreate<TLArrowBinding>[] = (
              ["start", "end"] as const
            ).map((terminal) => ({
              id: edgeBindingId(edge.id, terminal),
              type: "arrow",
              fromId: id,
              toId: nodeShapeId(
                terminal === "start" ? edge.source : edge.target,
              ),
              props: {
                terminal,
                normalizedAnchor: { x: 0.5, y: 0.5 },
                isExact: false,
                isPrecise: false,
                snap: "none",
              },
            }));
            editor.createBindings(bindings);
          } else {
            editor.updateShapes<TLArrowShape>([
              {
                id,
                type: "arrow",
                opacity: dimmed
                  ? 0.12
                  : edge.relation === "depends_on"
                    ? 0.55
                    : 0.9,
                props: {
                  color: props.color,
                  dash: props.dash,
                  size: props.size,
                  arrowheadEnd: props.arrowheadEnd,
                  richText: props.richText,
                  // Flexible routes recompute on every sync; pinned routes keep
                  // the user's adjustment.
                  ...(pinned ? {} : { bend: props.bend }),
                },
              },
            ]);
          }
        }

        if (freeform)
          for (const note of project.canvas?.notes ?? []) {
            const id = noteShapeId(note.id);
            keep.add(id);
            if (existing.has(id) || skip.has(id)) continue;
            if (note.kind === "text")
              editor.createShapes<TLTextShape>([
                {
                  id,
                  type: "text",
                  parentId: pageId,
                  x: note.x,
                  y: note.y,
                  props: { richText: toRichText(note.text), size: "s" },
                },
              ]);
            else
              editor.createShapes<TLNoteShape>([
                {
                  id,
                  type: "note",
                  parentId: pageId,
                  x: note.x,
                  y: note.y,
                  props: {
                    richText: toRichText(note.text),
                    color: "yellow",
                    size: "s",
                  },
                },
              ]);
          }

        const stale = [...existing.keys()].filter((id) => {
          if (keep.has(id)) return false;
          const shape = existing.get(id)!;
          if (
            shape.type === ARCHITECTURE_NODE ||
            shape.type === ARCHITECTURE_BOUNDARY
          )
            return true;
          if (shape.type === "arrow" && String(id).startsWith("shape:edge-"))
            return true;
          if (
            (shape.type === "note" || shape.type === "text") &&
            String(id).startsWith("shape:note-") &&
            !skip.has(id)
          )
            return true;
          return false;
        });
        if (stale.length > 0) editor.deleteShapes(stale);
      },
      { history: "ignore", ignoreShapeLock: true },
    );
  });
}

export function noteFromShape(
  editor: Editor,
  shape: TLNoteShape | TLTextShape,
): CanvasNote | null {
  const id = String(shape.id);
  if (!id.startsWith("shape:note-")) return null;
  const bounds = editor.getShapePageBounds(shape.id);
  return {
    id: id.slice("shape:note-".length),
    kind: shape.type === "text" ? "text" : "note",
    text: renderPlaintextFromRichText(editor, shape.props.richText),
    x: bounds?.x ?? shape.x,
    y: bounds?.y ?? shape.y,
  };
}
