"use client";

import type { ComponentType } from "react";

import {
  Boxes,
  Braces,
  Database,
  Globe,
  Layers,
  Network,
  PanelTop,
  Plug,
  RadioTower,
  Route,
  Server,
  Shapes,
  Shield,
  UserRound,
  Zap,
  type LucideProps,
} from "lucide-react";
import {
  BaseBoxShapeUtil,
  BaseFrameLikeShapeUtil,
  Group2d,
  HTMLContainer,
  Rectangle2d,
  T,
  resizeBox,
  useEditor,
  useValue,
  type TLBaseShape,
  type TLResizeInfo,
  type TLShape,
} from "tldraw";

import { ArchitectureMark } from "@/components/architecture/brand-mark";
import type { NodeKind, Provenance } from "@/lib/architecture/schema";
import { cn } from "@/lib/utils";

export const ARCHITECTURE_NODE = "architecture-node" as const;
export const ARCHITECTURE_BOUNDARY = "architecture-boundary" as const;

export type ArchitectureNodeProps = {
  w: number;
  h: number;
  nodeId: string;
  kind: NodeKind;
  name: string;
  summary: string;
  provenance: Provenance;
  /** Number of contained entities (children) not currently drawn. */
  children: number;
  /** Intended vs observed difference, if any. */
  delta: "" | "CREATE" | "UPDATE" | "REMOVE";
  emphasis: "normal" | "selected" | "affected" | "impacted";
  interactive: boolean;
};

export type ArchitectureBoundaryProps = {
  w: number;
  h: number;
  boundaryId: string;
  /** Set when the boundary represents an expanded architecture entity. */
  nodeId: string;
  label: string;
  description: string;
  count: number;
  tone: string;
  muted: boolean;
};

export type ArchitectureNodeShape = TLBaseShape<
  typeof ARCHITECTURE_NODE,
  ArchitectureNodeProps
>;
export type ArchitectureBoundaryShape = TLBaseShape<
  typeof ARCHITECTURE_BOUNDARY,
  ArchitectureBoundaryProps
>;

declare module "tldraw" {
  export interface TLGlobalShapePropsMap {
    [ARCHITECTURE_NODE]: ArchitectureNodeProps;
    [ARCHITECTURE_BOUNDARY]: ArchitectureBoundaryProps;
  }
}

export const kindIcons: Record<NodeKind, ComponentType<LucideProps>> = {
  application: Globe,
  domain: Layers,
  feature: Boxes,
  capability: Zap,
  service: Network,
  page: PanelTop,
  flow: Route,
  data: Database,
  api: Braces,
  actor: UserRound,
  event: RadioTower,
  integration: Plug,
  infrastructure: Server,
  security: Shield,
  custom: Shapes,
};

export const kindLabels: Record<NodeKind, string> = {
  application: "Application",
  domain: "Domain",
  feature: "Feature",
  capability: "Capability",
  service: "Service",
  page: "Page",
  flow: "User flow",
  data: "Data model",
  api: "API",
  actor: "Actor",
  event: "Event",
  integration: "Integration",
  infrastructure: "Infrastructure",
  security: "Security boundary",
  custom: "Concept",
};

type ShapeSpec = { w: number; h: number; minW: number; minH: number };

/** One card size for every kind; children inside expanded entities use the compact size. */
export const CARD = { w: 232, h: 92, minW: 160, minH: 64 };
export const CHILD_CARD = { w: 200, h: 64 };
export const BOUNDARY_HEADER_HEIGHT = 44;

export function defaultNodeSpec(): ShapeSpec {
  return { ...CARD };
}

export type NodeShapeCallbacks = {
  onOpen: (nodeId: string) => void;
  onMoved: (nodeId: string, shape: ArchitectureNodeShape) => void;
  onResized: (nodeId: string, shape: ArchitectureNodeShape) => void;
  onBoundaryChanged: (shape: ArchitectureBoundaryShape) => void;
  onBoundaryOpen: (boundaryId: string) => void;
};

const callbackRegistry = new WeakMap<object, NodeShapeCallbacks>();

export function registerShapeCallbacks(
  editor: object,
  callbacks: NodeShapeCallbacks,
) {
  callbackRegistry.set(editor, callbacks);
}

function useZoomLevel() {
  const editor = useEditor();
  return useValue("zoom", () => editor.getZoomLevel(), [editor]);
}

function NodeBody({ shape }: { shape: ArchitectureNodeShape }) {
  const zoom = useZoomLevel();
  const { kind, name, summary, children, delta } = shape.props;
  const Icon = kindIcons[kind];
  const compact = zoom < 0.45 || shape.props.h < 76;
  return (
    <div className={cn("arch-card", compact && "arch-card-compact")}>
      <ArchitectureMark name={name} kind={kind} fallback={Icon} size={15} />
      <div className="arch-card-body">
        <div className="arch-card-title">
          <strong>{name}</strong>
          {delta && (
            <span className={cn("arch-card-delta", `arch-card-delta-${delta}`)}>
              {delta === "CREATE"
                ? "New"
                : delta === "REMOVE"
                  ? "Remove"
                  : "Changed"}
            </span>
          )}
        </div>
        {!compact && <p>{summary || kindLabels[kind]}</p>}
        <div className="arch-card-meta">
          <span>{kindLabels[kind]}</span>
          {children > 0 && (
            <span className="arch-card-children">{children} inside</span>
          )}
        </div>
      </div>
    </div>
  );
}

export class ArchitectureNodeShapeUtil extends BaseBoxShapeUtil<ArchitectureNodeShape> {
  static override type = ARCHITECTURE_NODE;
  static override props = {
    w: T.number,
    h: T.number,
    nodeId: T.string,
    kind: T.string as unknown as T.Validator<NodeKind>,
    name: T.string,
    summary: T.string,
    provenance: T.string as unknown as T.Validator<Provenance>,
    children: T.number,
    delta: T.string as unknown as T.Validator<ArchitectureNodeProps["delta"]>,
    emphasis: T.string as unknown as T.Validator<
      ArchitectureNodeProps["emphasis"]
    >,
    interactive: T.boolean,
  };

  getDefaultProps(): ArchitectureNodeProps {
    return {
      w: CARD.w,
      h: CARD.h,
      nodeId: "",
      kind: "feature",
      name: "Component",
      summary: "",
      provenance: "defined",
      children: 0,
      delta: "",
      emphasis: "normal",
      interactive: true,
    };
  }

  override canEdit() {
    return false;
  }

  override canResize(shape: ArchitectureNodeShape) {
    return shape.props.interactive;
  }

  override hideRotateHandle() {
    return true;
  }

  override isAspectRatioLocked() {
    return false;
  }

  override canBind() {
    return true;
  }

  override getText(shape: ArchitectureNodeShape) {
    return shape.props.name;
  }

  override getAriaDescriptor(shape: ArchitectureNodeShape) {
    return `${shape.props.name}, ${kindLabels[shape.props.kind]}`;
  }

  override onResize(
    shape: ArchitectureNodeShape,
    info: TLResizeInfo<ArchitectureNodeShape>,
  ) {
    const spec = defaultNodeSpec();
    return resizeBox(shape, info, {
      minWidth: spec.minW,
      minHeight: spec.minH,
    });
  }

  override onResizeEnd(
    _initial: ArchitectureNodeShape,
    current: ArchitectureNodeShape,
  ) {
    callbackRegistry.get(this.editor)?.onResized(current.props.nodeId, current);
  }

  override onTranslateEnd(
    _initial: ArchitectureNodeShape,
    current: ArchitectureNodeShape,
  ) {
    callbackRegistry.get(this.editor)?.onMoved(current.props.nodeId, current);
  }

  override onDoubleClick(shape: ArchitectureNodeShape) {
    callbackRegistry.get(this.editor)?.onOpen(shape.props.nodeId);
  }

  component(shape: ArchitectureNodeShape) {
    return (
      <HTMLContainer
        className={cn(
          "arch-node",
          `arch-node-${shape.props.kind}`,
          `arch-node-${shape.props.emphasis}`,
          !shape.props.interactive && "arch-node-readonly",
        )}
        data-node-id={shape.props.nodeId}
        data-node-kind={shape.props.kind}
      >
        <NodeBody shape={shape} />
      </HTMLContainer>
    );
  }

  getIndicatorPath(shape: ArchitectureNodeShape) {
    const path = new Path2D();
    path.roundRect(0, 0, shape.props.w, shape.props.h, 10);
    return { path };
  }
}

function BoundaryBody({ shape }: { shape: ArchitectureBoundaryShape }) {
  const zoom = useZoomLevel();
  const compact = zoom < 0.42;
  const entity = shape.props.nodeId !== "";
  return (
    <div
      className={cn(
        "arch-boundary",
        `arch-boundary-${shape.props.tone}`,
        entity && "arch-boundary-entity",
        shape.props.muted && "arch-boundary-muted",
        compact && "arch-boundary-compact",
      )}
    >
      <header>
        <strong>{shape.props.label}</strong>
        {!compact && shape.props.description && (
          <span>{shape.props.description}</span>
        )}
        <small>{shape.props.count}</small>
      </header>
    </div>
  );
}

export class ArchitectureBoundaryShapeUtil extends BaseFrameLikeShapeUtil<ArchitectureBoundaryShape> {
  static override type = ARCHITECTURE_BOUNDARY;
  static override props = {
    w: T.number,
    h: T.number,
    boundaryId: T.string,
    nodeId: T.string,
    label: T.string,
    description: T.string,
    count: T.number,
    tone: T.string,
    muted: T.boolean,
  };

  getDefaultProps(): ArchitectureBoundaryProps {
    return {
      w: 520,
      h: 260,
      boundaryId: "",
      nodeId: "",
      label: "Boundary",
      description: "",
      count: 0,
      tone: "core",
      muted: false,
    };
  }

  override canEdit() {
    return false;
  }

  override hideRotateHandle() {
    return true;
  }

  override canBind() {
    return false;
  }

  override canReceiveNewChildrenOfType(
    _shape: ArchitectureBoundaryShape,
    type: TLShape["type"],
  ) {
    return type === ARCHITECTURE_NODE || type === "note" || type === "text";
  }

  override shouldClipChild() {
    return false;
  }

  override getClipPath() {
    return undefined;
  }

  override getText(shape: ArchitectureBoundaryShape) {
    return shape.props.label;
  }

  override onResize(
    shape: ArchitectureBoundaryShape,
    info: TLResizeInfo<ArchitectureBoundaryShape>,
  ) {
    return resizeBox(shape, info, { minWidth: 160, minHeight: 100 });
  }

  override onResizeEnd(
    _initial: ArchitectureBoundaryShape,
    current: ArchitectureBoundaryShape,
  ) {
    callbackRegistry.get(this.editor)?.onBoundaryChanged(current);
  }

  override onTranslateEnd(
    _initial: ArchitectureBoundaryShape,
    current: ArchitectureBoundaryShape,
  ) {
    callbackRegistry.get(this.editor)?.onBoundaryChanged(current);
  }

  override onDoubleClick(shape: ArchitectureBoundaryShape) {
    callbackRegistry.get(this.editor)?.onBoundaryOpen(shape.props.boundaryId);
  }

  component(shape: ArchitectureBoundaryShape) {
    return (
      <HTMLContainer
        className="arch-boundary-container"
        data-boundary-id={shape.props.boundaryId}
      >
        <BoundaryBody shape={shape} />
      </HTMLContainer>
    );
  }

  getIndicatorPath(shape: ArchitectureBoundaryShape) {
    const path = new Path2D();
    path.roundRect(0, 0, shape.props.w, shape.props.h, 14);
    return { path };
  }

  override getGeometry(shape: ArchitectureBoundaryShape) {
    // Like tldraw frames: the interior lets clicks through to children, the header selects/drags.
    return new Group2d({
      children: [
        new Rectangle2d({
          width: shape.props.w,
          height: shape.props.h,
          isFilled: false,
        }),
        new Rectangle2d({
          width: shape.props.w,
          height: BOUNDARY_HEADER_HEIGHT,
          isFilled: true,
          isLabel: true,
        }),
      ],
    });
  }
}

export const architectureShapeUtils = [
  ArchitectureNodeShapeUtil,
  ArchitectureBoundaryShapeUtil,
];
