"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  ArrowUpRight,
  Boxes,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  CornerDownRight,
  Hand,
  LayoutGrid,
  Maximize2,
  Minus,
  MousePointer2,
  Plus,
  Spline,
  Sparkles,
  SquareDashed,
  StickyNote,
  Type,
  Trash2,
} from "lucide-react";
import {
  Tldraw,
  UserRecordType,
  atom,
  createShapeId,
  createUserId,
  isShape,
  stopEventPropagation,
  useEditor,
  useTldrawCurrentUser,
  useValue,
  type Editor,
  type TLArrowBinding,
  type TLArrowShape,
  type TLComponents,
  type TLEventInfo,
  type TLNoteShape,
  type TLShape,
  type TLShapeId,
  type TLTextShape,
  type TLUser,
  type TLUserPreferences,
  type TLUserStore,
} from "tldraw";

import {
  buildLayoutModel,
  boundaryIdFromShape,
  entityIdFromBoundaryShape,
  nodeIdFromShape,
  nodeShapeId,
  noteFromShape,
  relationVisual,
  syncCanvas,
  type CanvasViewState,
} from "@/components/architecture/canvas-sync";
import {
  ARCHITECTURE_BOUNDARY,
  ARCHITECTURE_NODE,
  architectureShapeUtils,
  kindIcons,
  registerShapeCallbacks,
  type ArchitectureBoundaryShape,
  type ArchitectureNodeShape,
} from "@/components/architecture/shapes";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  canvasProjections,
  type CanvasProjection,
} from "@/lib/architecture/presentation";
import {
  childrenOf,
  type ArchitectureProject,
  type CanvasBoundary,
  type NodeKind,
} from "@/lib/architecture/schema";
import type { CanvasLayoutPatch } from "@/lib/architecture/store";
import { cn } from "@/lib/utils";
import "tldraw/tldraw.css";

const addableKinds: Array<[NodeKind, string]> = [
  ["feature", "Feature"],
  ["service", "Service"],
  ["page", "Page"],
  ["data", "Data model"],
  ["api", "API"],
  ["actor", "Actor"],
  ["event", "Event"],
  ["integration", "Integration"],
  ["infrastructure", "Infrastructure"],
  ["security", "Security boundary"],
  ["custom", "Custom concept"],
];

export type CanvasProps = {
  project: ArchitectureProject;
  licenseKey?: string;
  projection: CanvasProjection;
  selected: string | null;
  /** Entity the canvas has entered; null is the project root. */
  scopeId: string | null;
  /** Entities expanded in place. */
  expanded: string[];
  onProjectionChange: (projection: CanvasProjection) => void;
  onSelect: (id: string) => void;
  onAskAI: (id: string) => void;
  onEditNode: (id: string) => void;
  onClearSelection: () => void;
  onAddComponent: (kind: NodeKind, parentId?: string | null) => void;
  onConnect: (source: string, target: string) => void;
  onEditRelationship: (id: string) => void;
  onDeleteRelationship: (id: string) => void;
  onDeleteNode: (id: string) => void;
  onUpdateCanvas: (patch: CanvasLayoutPatch) => void;
  onRenameBoundary: (boundary: CanvasBoundary) => void;
  onEnter: (id: string | null) => void;
  onToggleExpanded: (id: string) => void;
  onReparent: (nodeId: string, parentId: string | null) => void;
  affected?: string[];
  impacted?: string[];
  focus?: boolean;
};

const canvasComponents: TLComponents = {
  MenuPanel: null,
  Toolbar: null,
  StylePanel: null,
  NavigationPanel: null,
  PageMenu: null,
  HelpMenu: null,
  DebugPanel: null,
  DebugMenu: null,
  ZoomMenu: null,
  MainMenu: null,
  ActionsMenu: null,
  QuickActions: null,
  HelperButtons: null,
  SharePanel: null,
  TopPanel: null,
  ContextMenu: null,
  Minimap: null,
  KeyboardShortcutsDialog: null,
};

type ToolId = "select" | "hand" | "arrow" | "note" | "text";

function fitArchitecture(editor: Editor, readable = false) {
  const bounds = editor.getCurrentPageBounds();
  if (!bounds) return;
  const viewport = editor.getViewportScreenBounds();
  const inset = 120;
  const fitZoom = Math.min(
    (viewport.width - inset) / bounds.w,
    (viewport.height - inset) / bounds.h,
  );
  const zoom = Math.min(0.9, Math.max(readable ? 0.62 : 0, fitZoom));
  const centerX = bounds.x + bounds.w / 2;
  const centerY = bounds.y + bounds.h / 2;
  const viewportCenter = editor.getViewportScreenCenter();
  editor.setCamera(
    {
      x: viewportCenter.x / zoom - centerX,
      y: viewportCenter.y / zoom - centerY,
      z: zoom,
    },
    { animation: { duration: 220 } },
  );
}

function ToolStrip() {
  const editor = useEditor();
  const tool = useValue("tool", () => editor.getCurrentToolId(), [editor]);
  const tools: Array<[ToolId, string, typeof Hand]> = [
    ["select", "Select", MousePointer2],
    ["hand", "Pan", Hand],
    ["arrow", "Connect", Spline],
    ["note", "Note", StickyNote],
    ["text", "Text", Type],
  ];
  return (
    <div className="canvas-tools" onPointerDown={stopEventPropagation}>
      <ToggleGroup
        type="single"
        value={tool}
        variant="outline"
        size="sm"
        spacing={0}
        aria-label="Canvas tools"
        onValueChange={(value) => {
          if (value) editor.setCurrentTool(value);
        }}
      >
        {tools.map(([id, label, Icon]) => (
          <ToggleGroupItem
            key={id}
            value={id}
            aria-label={label}
            title={label}
            data-tool={id}
          >
            <Icon />
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  );
}

function ZoomStrip() {
  const editor = useEditor();
  return (
    <div className="canvas-zoom" onPointerDown={stopEventPropagation}>
      <Button
        size="icon-sm"
        variant="outline"
        aria-label="Zoom in"
        onClick={() =>
          editor.zoomIn(undefined, { animation: { duration: 160 } })
        }
      >
        <Plus />
      </Button>
      <Button
        size="icon-sm"
        variant="outline"
        aria-label="Zoom out"
        onClick={() =>
          editor.zoomOut(undefined, { animation: { duration: 160 } })
        }
      >
        <Minus />
      </Button>
      <Button
        size="icon-sm"
        variant="outline"
        aria-label="Fit architecture"
        onClick={() => fitArchitecture(editor)}
      >
        <Maximize2 />
      </Button>
    </div>
  );
}

function SelectionToolbar({
  project,
  expanded,
  onSelect,
  onAskAI,
  onEditNode,
  onDeleteNode,
  onDeleteRelationship,
  onEditRelationship,
  onRenameBoundary,
  onUpdateCanvas,
  onAddComponent,
  onEnter,
  onToggleExpanded,
  onReparent,
}: Pick<
  CanvasProps,
  | "project"
  | "expanded"
  | "onSelect"
  | "onAskAI"
  | "onEditNode"
  | "onDeleteNode"
  | "onDeleteRelationship"
  | "onEditRelationship"
  | "onRenameBoundary"
  | "onUpdateCanvas"
  | "onAddComponent"
  | "onEnter"
  | "onToggleExpanded"
  | "onReparent"
>) {
  const editor = useEditor();
  const selection = useValue(
    "selection",
    () => {
      const ids = editor.getSelectedShapeIds();
      if (ids.length !== 1) return null;
      const shape = editor.getShape(ids[0]);
      const bounds = editor.getSelectionRotatedScreenBounds();
      if (!shape || !bounds) return null;
      if (editor.getCurrentToolId() !== "select") return null;
      if (editor.inputs.isDragging || editor.inputs.isPointing) return null;
      return { shape, bounds };
    },
    [editor],
  );
  if (!selection) return null;
  const { shape, bounds } = selection;
  const entityBoundary = entityIdFromBoundaryShape(shape);
  const nodeId = nodeIdFromShape(shape) ?? entityBoundary;
  const boundaryId = entityBoundary ? null : boundaryIdFromShape(shape);
  const edgeId =
    shape.type === "arrow" && String(shape.id).startsWith("shape:edge-")
      ? String(shape.id).slice("shape:edge-".length)
      : null;
  if (!nodeId && !boundaryId && !edgeId) return null;
  const node = nodeId ? project.nodes[nodeId] : null;
  const childCount = nodeId ? childrenOf(project, nodeId).length : 0;
  const isExpanded = nodeId ? expanded.includes(nodeId) : false;
  const style = {
    left: bounds.x + bounds.w / 2,
    top: Math.max(12, bounds.y - 52),
  };
  return (
    <div
      className="canvas-selection-toolbar"
      style={style}
      onPointerDown={stopEventPropagation}
      role="toolbar"
      aria-label={
        node
          ? `${node.name} actions`
          : boundaryId
            ? "Boundary actions"
            : "Relationship actions"
      }
    >
      {node && nodeId && (
        <>
          <span className="canvas-selection-title">{node.name}</span>
          <Button size="sm" variant="ghost" onClick={() => onSelect(nodeId)}>
            Open
          </Button>
          {childCount > 0 && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onToggleExpanded(nodeId)}
            >
              {isExpanded ? (
                <ChevronsDownUp data-icon="inline-start" />
              ) : (
                <ChevronsUpDown data-icon="inline-start" />
              )}
              {isExpanded ? "Collapse" : `Expand (${childCount})`}
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => onEnter(nodeId)}>
            <CornerDownRight data-icon="inline-start" />
            Enter
          </Button>
          <Button size="sm" variant="ghost" onClick={() => onAskAI(nodeId)}>
            <Sparkles data-icon="inline-start" />
            Ask AI
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon-sm" variant="ghost" aria-label="More actions">
                •••
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuGroup>
                <DropdownMenuItem
                  onSelect={() => editor.setCurrentTool("arrow")}
                >
                  <Spline />
                  Connect to another component
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => onAddComponent("feature", nodeId)}
                >
                  <Plus />
                  Add component inside
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onEditNode(nodeId)}>
                  Edit details
                </DropdownMenuItem>
                {node.parentId && (
                  <DropdownMenuItem onSelect={() => onReparent(nodeId, null)}>
                    Move to project root
                  </DropdownMenuItem>
                )}
                {!entityBoundary && (
                  <DropdownMenuItem
                    onSelect={() =>
                      onUpdateCanvas({ memberships: { [nodeId]: null } })
                    }
                  >
                    Remove from boundary
                  </DropdownMenuItem>
                )}
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={() => onDeleteNode(nodeId)}
                >
                  <Trash2 />
                  Delete component
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      )}
      {boundaryId && (
        <>
          <span className="canvas-selection-title">
            {(shape as ArchitectureBoundaryShape).props.label}
          </span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              const boundary = shape as ArchitectureBoundaryShape;
              const bounds = editor.getShapePageBounds(boundary.id);
              onRenameBoundary({
                id: boundaryId,
                label: boundary.props.label,
                description: boundary.props.description,
                x: bounds?.x ?? boundary.x,
                y: bounds?.y ?? boundary.y,
                w: boundary.props.w,
                h: boundary.props.h,
              });
            }}
          >
            Rename
          </Button>
          {!(project.canvas?.boundaries ?? []).some(
            (item) => item.id === boundaryId,
          ) ? null : (
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                onUpdateCanvas({ removeBoundaryIds: [boundaryId] })
              }
            >
              <Trash2 data-icon="inline-start" />
              Dissolve
            </Button>
          )}
        </>
      )}
      {edgeId && (
        <>
          <span className="canvas-selection-title">
            {
              relationVisual(
                project.edges.find((edge) => edge.id === edgeId)?.relation ??
                  "depends_on",
              ).label
            }
          </span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onEditRelationship(edgeId)}
          >
            Edit
          </Button>
          {project.canvas?.edgeRoutes?.[edgeId]?.routing === "pinned" && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onUpdateCanvas({ edgeRoutes: { [edgeId]: null } })}
            >
              Reset line
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onDeleteRelationship(edgeId)}
          >
            <Trash2 data-icon="inline-start" />
            Remove
          </Button>
        </>
      )}
    </div>
  );
}

function CanvasOverlay(props: CanvasProps & { onArrange: () => void }) {
  const editor = useEditor();
  const projection = props.projection;
  const activeProjection =
    canvasProjections.find((item) => item.id === projection) ??
    canvasProjections[0];
  const model = useMemo(
    () =>
      buildLayoutModel(props.project, {
        projection,
        selected: props.selected,
        focus: props.focus ?? false,
        affected: props.affected ?? [],
        impacted: props.impacted ?? [],
        scopeId: props.scopeId,
        expanded: props.expanded,
      }),
    [
      props.project,
      projection,
      props.selected,
      props.focus,
      props.affected,
      props.impacted,
      props.scopeId,
      props.expanded,
    ],
  );
  return (
    <>
      <div
        className="canvas-projection-panel"
        onPointerDown={stopEventPropagation}
      >
        {model.breadcrumbs.length > 0 && (
          <nav className="canvas-breadcrumbs" aria-label="Architecture scope">
            <button type="button" onClick={() => props.onEnter(null)}>
              {props.project.name}
            </button>
            {model.breadcrumbs.map((crumb, index) => (
              <span key={crumb.id} className="canvas-breadcrumb-segment">
                <ChevronRight size={12} aria-hidden="true" />
                {index === model.breadcrumbs.length - 1 ? (
                  <strong aria-current="location">{crumb.name}</strong>
                ) : (
                  <button type="button" onClick={() => props.onEnter(crumb.id)}>
                    {crumb.name}
                  </button>
                )}
              </span>
            ))}
          </nav>
        )}
        <ToggleGroup
          type="single"
          value={projection}
          variant="outline"
          size="sm"
          spacing={0}
          aria-label="Architecture projection"
          onValueChange={(value) => {
            if (value) props.onProjectionChange(value as CanvasProjection);
          }}
        >
          {canvasProjections.map((item) => (
            <ToggleGroupItem
              key={item.id}
              value={item.id}
              aria-label={item.label}
              title={item.description}
              data-projection={item.id}
            >
              {item.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <span className="sr-only">{activeProjection.description}</span>
      </div>
      <div className="canvas-actions" onPointerDown={stopEventPropagation}>
        <Button size="sm" variant="outline" onClick={props.onArrange}>
          <LayoutGrid data-icon="inline-start" />
          Arrange
        </Button>
        {projection === "system" && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm">
                <Plus data-icon="inline-start" />
                Add component
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuGroup>
                <DropdownMenuLabel>Add architecture</DropdownMenuLabel>
                {addableKinds.map(([kind, label]) => {
                  const Icon = kindIcons[kind];
                  return (
                    <DropdownMenuItem
                      key={kind}
                      onSelect={() => props.onAddComponent(kind, props.scopeId)}
                    >
                      <Icon />
                      {label}
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuLabel>Canvas</DropdownMenuLabel>
                <DropdownMenuItem
                  onSelect={() => {
                    const center = editor.getViewportPageBounds().center;
                    const id = crypto.randomUUID();
                    props.onUpdateCanvas({
                      boundaries: [
                        {
                          id,
                          label: "New boundary",
                          description: "",
                          x: center.x - 260,
                          y: center.y - 140,
                          w: 520,
                          h: 280,
                        },
                      ],
                    });
                  }}
                >
                  <SquareDashed />
                  Boundary
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => editor.setCurrentTool("note")}
                >
                  <StickyNote />
                  Note
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => editor.setCurrentTool("text")}
                >
                  <Type />
                  Text
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      <div className="canvas-bottom-left">
        <ToolStrip />
        <ZoomStrip />
        {model.edges.length > 0 && (
          <ul
            className="canvas-relation-legend"
            aria-label="Relationship meaning"
          >
            {[
              ...new Map(
                model.edges.map((edge) => {
                  const visual = relationVisual(edge.relation);
                  return [visual.label, visual] as const;
                }),
              ).values(),
            ].map((visual) => (
              <li
                key={visual.label}
                data-dash={visual.dash}
                data-color={visual.color}
              >
                <i aria-hidden="true" />
                {visual.label}
              </li>
            ))}
          </ul>
        )}
      </div>
      {model.notice && (
        <div className="canvas-projection-notice">{model.notice}</div>
      )}
      <SelectionToolbar {...props} />
    </>
  );
}

function isUserShape(shape: TLShape) {
  const id = String(shape.id);
  return (
    !id.startsWith("shape:node-") &&
    !id.startsWith("shape:boundary-") &&
    !id.startsWith("shape:edge-") &&
    !id.startsWith("shape:note-")
  );
}

export function ArchitectureCanvas(props: CanvasProps) {
  const {
    project,
    projection,
    selected,
    scopeId,
    expanded,
    onSelect,
    onClearSelection,
    onConnect,
    onDeleteNode,
    onDeleteRelationship,
    onUpdateCanvas,
    onRenameBoundary,
    onReparent,
    affected = [],
    impacted = [],
    focus = false,
  } = props;
  const [editor, setEditor] = useState<Editor | null>(null);
  // In-memory user identity and preferences keep tldraw from writing to localStorage.
  const [userPreferences, setUserPreferences] = useState<TLUserPreferences>(
    () => ({ id: "structor-local", colorScheme: "light" }),
  );
  const user = useTldrawCurrentUser({ userPreferences, setUserPreferences });
  const users = useMemo<TLUserStore>(
    () => ({
      currentUser: atom<TLUser | null>(
        "structorUser",
        UserRecordType.create({
          id: createUserId("structor-local"),
          name: "You",
          color: "#648d67",
        }),
      ),
    }),
    [],
  );
  const latest = useRef({
    project,
    projection,
    selected,
    scopeId,
    onSelect,
    onClearSelection,
    onConnect,
    onDeleteNode,
    onDeleteRelationship,
    onUpdateCanvas,
    onRenameBoundary,
    onReparent,
  });
  latest.current = {
    project,
    projection,
    selected,
    scopeId,
    onSelect,
    onClearSelection,
    onConnect,
    onDeleteNode,
    onDeleteRelationship,
    onUpdateCanvas,
    onRenameBoundary,
    onReparent,
  };
  const view: CanvasViewState = useMemo(
    () => ({
      projection,
      selected,
      focus,
      affected,
      impacted,
      scopeId,
      expanded,
    }),
    [projection, selected, focus, affected, impacted, scopeId, expanded],
  );
  const model = useMemo(() => buildLayoutModel(project, view), [project, view]);
  const previousSignature = useRef("");

  const commitNodeGeometry = useCallback(
    (shapes: ArchitectureNodeShape[], instance: Editor) => {
      const patch: CanvasLayoutPatch = {
        positions: {},
        sizes: {},
        memberships: {},
      };
      const reparents: Array<[string, string | null]> = [];
      for (const shape of shapes) {
        const bounds = instance.getShapePageBounds(shape.id);
        if (!bounds) continue;
        const node = latest.current.project.nodes[shape.props.nodeId];
        const parent = instance.getShape(shape.parentId);
        const droppedInto = entityIdFromBoundaryShape(parent);
        const currentParent = node?.parentId ?? null;
        if (droppedInto && droppedInto !== currentParent) {
          // Dropping into an expanded entity changes containment, not just layout.
          reparents.push([shape.props.nodeId, droppedInto]);
          continue;
        }
        if (
          !droppedInto &&
          currentParent &&
          currentParent !== latest.current.scopeId &&
          instance.getShape(createShapeId(`boundary-entity:${currentParent}`))
        ) {
          // Dragged out of its expanded parent: it now belongs to the current scope.
          reparents.push([shape.props.nodeId, latest.current.scopeId]);
        }
        patch.positions![shape.props.nodeId] = { x: bounds.x, y: bounds.y };
        patch.sizes![shape.props.nodeId] = {
          w: shape.props.w,
          h: shape.props.h,
        };
        patch.memberships![shape.props.nodeId] = droppedInto
          ? null
          : boundaryIdFromShape(parent);
      }
      if (Object.keys(patch.positions!).length > 0)
        latest.current.onUpdateCanvas(patch);
      for (const [nodeId, parentId] of reparents)
        latest.current.onReparent(nodeId, parentId);
    },
    [],
  );

  useEffect(() => {
    if (!editor) return;
    registerShapeCallbacks(editor, {
      onOpen: (nodeId) => latest.current.onSelect(nodeId),
      onMoved: (_nodeId, shape) => {
        if (latest.current.projection !== "system") return;
        const selectedNodes = editor
          .getSelectedShapes()
          .filter(
            (item): item is ArchitectureNodeShape =>
              item.type === ARCHITECTURE_NODE,
          );
        commitNodeGeometry(
          selectedNodes.some((item) => item.id === shape.id)
            ? selectedNodes
            : [shape],
          editor,
        );
      },
      onResized: (_nodeId, shape) => {
        if (latest.current.projection !== "system") return;
        commitNodeGeometry([shape], editor);
      },
      onBoundaryChanged: (shape) => {
        if (latest.current.projection !== "system") return;
        const bounds = editor.getShapePageBounds(shape.id);
        if (!bounds) return;
        const children = editor
          .getSortedChildIdsForParent(shape.id)
          .map((id) => editor.getShape(id))
          .filter(
            (item): item is ArchitectureNodeShape =>
              item?.type === ARCHITECTURE_NODE,
          );
        const patch: CanvasLayoutPatch = {
          boundaries: [
            {
              id: shape.props.boundaryId,
              label: shape.props.label,
              description: shape.props.description,
              x: bounds.x,
              y: bounds.y,
              w: shape.props.w,
              h: shape.props.h,
            },
          ],
          positions: {},
        };
        for (const child of children) {
          const childBounds = editor.getShapePageBounds(child.id);
          if (childBounds)
            patch.positions![child.props.nodeId] = {
              x: childBounds.x,
              y: childBounds.y,
            };
        }
        latest.current.onUpdateCanvas(patch);
      },
      onBoundaryOpen: (boundaryId) => {
        const shape = editor.getShape(
          createShapeId(`boundary-${boundaryId}`),
        ) as ArchitectureBoundaryShape | undefined;
        if (!shape) return;
        const bounds = editor.getShapePageBounds(shape.id);
        latest.current.onRenameBoundary({
          id: boundaryId,
          label: shape.props.label,
          description: shape.props.description,
          x: bounds?.x ?? shape.x,
          y: bounds?.y ?? shape.y,
          w: shape.props.w,
          h: shape.props.h,
        });
      },
    });
  }, [commitNodeGeometry, editor]);

  useEffect(() => {
    if (!editor) return;
    const instance = editor;
    const removeDeleteGuard = instance.sideEffects.registerBeforeDeleteHandler(
      "shape",
      (shape, source) => {
        if (source !== "user") return;
        const nodeId = nodeIdFromShape(shape);
        if (nodeId) {
          queueMicrotask(() => latest.current.onDeleteNode(nodeId));
          return false;
        }
        const id = String(shape.id);
        if (shape.type === "arrow" && id.startsWith("shape:edge-")) {
          // Removing a canonical relationship is an architecture change; the
          // line stays where it is until the relationship is actually deleted.
          queueMicrotask(() =>
            latest.current.onDeleteRelationship(id.slice("shape:edge-".length)),
          );
          return false;
        }
        if (shape.type === ARCHITECTURE_BOUNDARY) {
          const boundaryId = boundaryIdFromShape(shape);
          if (boundaryId)
            queueMicrotask(() =>
              latest.current.onUpdateCanvas({
                removeBoundaryIds: [boundaryId],
              }),
            );
          return false;
        }
        if (
          (shape.type === "note" || shape.type === "text") &&
          id.startsWith("shape:note-")
        ) {
          queueMicrotask(() =>
            latest.current.onUpdateCanvas({
              removeNoteIds: [id.slice("shape:note-".length)],
            }),
          );
        }
      },
    );

    const pendingArrows = new Set<TLShapeId>();
    const pendingNotes = new Set<TLShapeId>();
    let flushTimer: ReturnType<typeof setTimeout> | null = null;

    function scheduleFlush() {
      if (flushTimer) return;
      flushTimer = setTimeout(() => {
        flushTimer = null;
        if (instance.inputs.isDragging || instance.inputs.isPointing) {
          scheduleFlush();
          return;
        }
        flush();
      }, 40);
    }

    function flush() {
      const arrowIds = [...pendingArrows];
      pendingArrows.clear();
      const notes = [...pendingNotes]
        .map((id) => instance.getShape(id))
        .filter(
          (shape): shape is TLNoteShape | TLTextShape =>
            shape?.type === "note" || shape?.type === "text",
        );
      pendingNotes.clear();

      for (const arrowId of arrowIds) {
        const arrow = instance.getShape<TLArrowShape>(arrowId);
        if (!arrow) continue;
        const bindings = instance.getBindingsFromShape<TLArrowBinding>(
          arrow.id,
          "arrow",
        );
        const start = bindings.find((item) => item.props.terminal === "start");
        const end = bindings.find((item) => item.props.terminal === "end");
        const source = nodeIdFromShape(
          start ? instance.getShape(start.toId) : undefined,
        );
        const target = nodeIdFromShape(
          end ? instance.getShape(end.toId) : undefined,
        );
        if (source && target && source !== target) {
          instance.store.mergeRemoteChanges(() => {
            instance.run(() => instance.deleteShapes([arrow.id]), {
              history: "ignore",
            });
          });
          latest.current.onConnect(source, target);
        }
      }

      const persisted: CanvasLayoutPatch = { notes: [] };
      for (const shape of notes) {
        if (instance.getEditingShapeId() === shape.id) {
          pendingNotes.add(shape.id);
          continue;
        }
        if (isUserShape(shape)) {
          const noteId = crypto.randomUUID();
          const bounds = instance.getShapePageBounds(shape.id);
          const text = instance.getShapeUtil(shape).getText(shape) ?? "";
          instance.store.mergeRemoteChanges(() => {
            instance.run(
              () => {
                instance.deleteShapes([shape.id]);
                instance.createShapes([
                  {
                    ...shape,
                    id: createShapeId(`note-${noteId}`),
                    parentId: instance.getCurrentPageId(),
                    x: bounds?.x ?? shape.x,
                    y: bounds?.y ?? shape.y,
                  },
                ]);
              },
              { history: "ignore" },
            );
          });
          persisted.notes!.push({
            id: noteId,
            kind: shape.type === "text" ? "text" : "note",
            text,
            x: bounds?.x ?? shape.x,
            y: bounds?.y ?? shape.y,
          });
          continue;
        }
        const note = noteFromShape(instance, shape);
        if (note) persisted.notes!.push(note);
      }
      if (persisted.notes!.length > 0) latest.current.onUpdateCanvas(persisted);
      if (pendingNotes.size > 0) scheduleFlush();
    }

    const cleanupListener = instance.store.listen(
      (entry) => {
        for (const record of Object.values(entry.changes.added)) {
          if (record.typeName === "binding" && record.type === "arrow") {
            const binding = record as TLArrowBinding;
            if (isUserShape({ id: binding.fromId } as TLShape))
              pendingArrows.add(binding.fromId);
            continue;
          }
          if (!isShape(record)) continue;
          if (record.type === "arrow" && isUserShape(record))
            pendingArrows.add(record.id);
          if (record.type === "note" || record.type === "text")
            pendingNotes.add(record.id);
        }
        for (const [from, to] of Object.values(entry.changes.updated)) {
          if (!isShape(to)) continue;
          const id = String(to.id);
          if (to.type === "arrow" && isUserShape(to)) pendingArrows.add(to.id);
          else if (
            to.type === "arrow" &&
            id.startsWith("shape:edge-") &&
            isShape(from) &&
            (from as TLArrowShape).props.bend !==
              (to as TLArrowShape).props.bend
          ) {
            // The user adjusted a connected line: that routing is pinned until
            // they reset it. Endpoints always stay attached.
            const bend = (to as TLArrowShape).props.bend;
            const edgeId = id.slice("shape:edge-".length);
            queueMicrotask(() =>
              latest.current.onUpdateCanvas({
                edgeRoutes: { [edgeId]: { routing: "pinned", bend } },
              }),
            );
          }
          if (to.type === "note" || to.type === "text") pendingNotes.add(to.id);
        }
        if (pendingArrows.size > 0 || pendingNotes.size > 0) scheduleFlush();
      },
      { source: "user", scope: "document" },
    );

    // Canonical relationship arrows keep their endpoints attached: users can
    // reshape the line (pinned routing) but never silently repoint it.
    const removeBindGuard = instance.sideEffects.registerBeforeChangeHandler(
      "binding",
      (previous, next, source) => {
        if (source !== "user") return next;
        if (!String(next.id).startsWith("binding:edge-")) return next;
        if (previous.fromId !== next.fromId || previous.toId !== next.toId)
          return previous;
        return next;
      },
    );

    const onKeyboard = (info: TLEventInfo) => {
      if (
        info.type !== "keyboard" ||
        info.name !== "key_down" ||
        info.key !== "Enter" ||
        instance.getEditingShapeId()
      )
        return;
      const ids = instance.getSelectedShapeIds();
      if (ids.length !== 1) return;
      const nodeId = nodeIdFromShape(instance.getShape(ids[0]));
      if (nodeId) latest.current.onSelect(nodeId);
    };
    instance.on("event", onKeyboard);

    const cleanupSelection = instance.store.listen(
      () => {
        const ids = instance.getSelectedShapeIds();
        if (ids.length === 0) {
          if (latest.current.selected && !instance.inputs.isPointing)
            latest.current.onClearSelection();
          return;
        }
        if (ids.length !== 1) return;
        const nodeId = nodeIdFromShape(instance.getShape(ids[0]));
        if (nodeId && nodeId !== latest.current.selected)
          latest.current.onSelect(nodeId);
      },
      { source: "user", scope: "session" },
    );

    return () => {
      if (flushTimer) clearTimeout(flushTimer);
      instance.off("event", onKeyboard);
      removeDeleteGuard();
      removeBindGuard();
      cleanupListener();
      cleanupSelection();
    };
  }, [editor]);

  useEffect(() => {
    if (!editor) return;
    const skip = new Set<TLShapeId>();
    if (editor.inputs.isDragging || editor.inputs.isPointing)
      for (const id of editor.getSelectedShapeIds()) skip.add(id);
    syncCanvas(editor, project, view, model, { skipShapeIds: skip });
    editor.updateInstanceState({ isReadonly: false });
    const ids = model.nodes.map((node) => node.id);
    const signature = `${projection}:${ids.join("|")}`;
    if (previousSignature.current !== signature) {
      const previous = previousSignature.current;
      previousSignature.current = signature;
      const separator = previous.indexOf(":");
      const previousProjection =
        separator >= 0 ? previous.slice(0, separator) : "";
      const previousIds =
        separator >= 0
          ? previous
              .slice(separator + 1)
              .split("|")
              .filter(Boolean)
          : [];
      const grewFromExisting =
        previousIds.length > 0 &&
        previousIds.every((id) => ids.includes(id)) &&
        ids.length >= previousIds.length;
      if (!previous || previousProjection !== projection || !grewFromExisting)
        requestAnimationFrame(() => fitArchitecture(editor, true));
    }
  }, [editor, model, project, projection, view]);

  useEffect(() => {
    if (!editor) return;
    const nodeIds = selected ? [nodeShapeId(selected)] : [];
    const current = editor.getSelectedShapeIds();
    if (
      nodeIds.length === current.length &&
      nodeIds.every((id, index) => id === current[index])
    )
      return;
    if (editor.inputs.isPointing || editor.inputs.isDragging) return;
    editor.store.mergeRemoteChanges(() => {
      editor.setSelectedShapes(nodeIds.filter((id) => editor.getShape(id)));
    });
  }, [editor, selected]);

  const arrange = useCallback(() => {
    if (!editor) return;
    const automatic = buildLayoutModel(
      { ...project, canvas: undefined },
      { ...view, focus: false },
    );
    const patch: CanvasLayoutPatch = {
      positions: Object.fromEntries(automatic.positions),
      boundaries: automatic.boundaries.map(
        ({ id, label, description, x, y, w, h }) => ({
          id,
          label,
          description,
          x,
          y,
          w,
          h,
        }),
      ),
      memberships: Object.fromEntries(
        [...automatic.membership].map(([nodeId, boundaryId]) => [
          nodeId,
          boundaryId,
        ]),
      ),
    };
    onUpdateCanvas(patch);
    requestAnimationFrame(() => fitArchitecture(editor, true));
  }, [editor, onUpdateCanvas, project, view]);

  return (
    <div
      className={cn("architecture-canvas", `architecture-canvas-${projection}`)}
    >
      <Tldraw
        hideUi
        licenseKey={props.licenseKey}
        shapeUtils={architectureShapeUtils}
        components={canvasComponents}
        user={user}
        users={users}
        onMount={(instance) => {
          instance.setCurrentTool("select");
          setEditor(instance);
        }}
      >
        <CanvasOverlay {...props} onArrange={arrange} />
      </Tldraw>
    </div>
  );
}

export { ArrowUpRight, Boxes };
