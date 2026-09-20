"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

import {
  ArrowLeft,
  ArrowUpRight,
  Blocks,
  Boxes,
  Braces,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Copy,
  Database,
  Download,
  FileCode2,
  FolderUp,
  GitBranch,
  Globe2,
  History,
  Layers,
  LayoutGrid,
  List,
  ListChecks,
  LoaderCircle,
  Menu,
  Network,
  PanelLeftClose,
  PanelLeftOpen,
  PanelTop,
  Plug,
  Plus,
  Pencil,
  RadioTower,
  Route,
  Search,
  Server,
  Shapes,
  ShieldCheck,
  Spline,
  Square,
  UserRound,
  Zap,
  type LucideIcon,
  X,
} from "lucide-react";
import { toast } from "sonner";

import {
  BoundaryEditor,
  ComponentEditor,
  DecisionEditor,
  RelationshipEditor,
} from "./editors";
import { NodeInspector } from "./node-inspector";

import { Brand } from "@/components/brand";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Textarea } from "@/components/ui/textarea";
import {
  deriveArchitecturePresentation,
  type CanvasProjection,
} from "@/lib/architecture/presentation";
import type {
  ArchitectureNode,
  ArchitecturePatch,
  ArchitectureProject,
  CanvasBoundary,
  ImplementationTask,
  NodeKind,
  TaskStatus,
} from "@/lib/architecture/schema";
import { useWorkspace } from "@/lib/architecture/store";
import { cn } from "@/lib/utils";

// tldraw is browser-only; skipping SSR avoids double module evaluation and hydration drift.
const ArchitectureCanvas = dynamic(
  () =>
    import("@/components/architecture/canvas").then(
      (module) => module.ArchitectureCanvas,
    ),
  {
    ssr: false,
    loading: () => <div className="canvas-loading">Preparing canvas…</div>,
  },
);

const projectionByView = {
  architecture: "system",
  flows: "flow",
  data: "data",
  security: "security",
  infrastructure: "infrastructure",
} as const satisfies Record<string, CanvasProjection>;

type CanvasView = keyof typeof projectionByView;
type WorkspaceView = CanvasView | "decisions" | "plan" | "context";

const viewByProjection: Record<CanvasProjection, CanvasView> = {
  system: "architecture",
  flow: "flows",
  data: "data",
  security: "security",
  infrastructure: "infrastructure",
};

const overviewIcons: Record<NodeKind, LucideIcon> = {
  application: Globe2,
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
  security: ShieldCheck,
  custom: Shapes,
};

const views: Array<{
  id: WorkspaceView;
  title: string;
  icon: typeof Network;
}> = [
  { id: "architecture", title: "Architecture", icon: Network },
  { id: "flows", title: "User Flow", icon: GitBranch },
  { id: "data", title: "Data", icon: Database },
  { id: "security", title: "Security", icon: ShieldCheck },
  { id: "infrastructure", title: "Infrastructure", icon: Server },
  { id: "decisions", title: "Decisions", icon: Layers },
  { id: "plan", title: "Implementation plan", icon: ListChecks },
  { id: "context", title: "Context", icon: Blocks },
];

type SidebarEntry = {
  id: string;
  title: string;
  description: string;
  icon: typeof Network;
  view?: WorkspaceView;
  href?: string;
  action?: "search" | "history";
};

const sidebarSections: Array<{ label: string; entries: SidebarEntry[] }> = [
  {
    label: "Workspace",
    entries: [
      {
        id: "canvas",
        title: "Canvas",
        description: "Explore and edit your architecture",
        icon: LayoutGrid,
        view: "architecture",
      },
      {
        id: "activity",
        title: "Activity",
        description: "Recent changes and updates",
        icon: History,
        action: "history",
      },
    ],
  },
  {
    label: "Build",
    entries: [
      {
        id: "import",
        title: "Import",
        description: "Analyze your repository",
        icon: FolderUp,
        href: "/start?mode=repository",
      },
      {
        id: "context",
        title: "Agent context",
        description: "Share architecture with coding agents",
        icon: Blocks,
        view: "context",
      },
    ],
  },
  {
    label: "Analyze",
    entries: [
      {
        id: "security",
        title: "Security",
        description: "Trust boundaries and access",
        icon: ShieldCheck,
        view: "security",
      },
      {
        id: "plan",
        title: "Implementation plan",
        description: "Work implied by intended changes",
        icon: ListChecks,
        view: "plan",
      },
      {
        id: "decisions",
        title: "Decisions",
        description: "Architectural decisions and ADRs",
        icon: Layers,
        view: "decisions",
      },
    ],
  },
];

export function Workspace() {
  const router = useRouter();
  const project = useWorkspace((s) => s.project);
  useEffect(() => {
    if (!project) router.replace("/start");
  }, [project, router]);

  if (!project) {
    return (
      <div className="start-page">
        <main id="main-content" className="start-main">
          <p role="status">Opening project setup…</p>
        </main>
      </div>
    );
  }
  return <ProjectWorkspace key={project.id} project={project} />;
}

function ProjectWorkspace({ project }: { project: ArchitectureProject }) {
  const params = useSearchParams();
  const projects = useWorkspace((s) => s.projects);
  const setProject = useWorkspace((s) => s.setProject);
  const updateCanvas = useWorkspace((s) => s.updateCanvas);
  const removeRelationship = useWorkspace((s) => s.removeRelationship);
  const dispatch = useWorkspace((s) => s.dispatch);
  const pending = useWorkspace((s) => s.pending);
  const drafting = useWorkspace((s) => s.drafting);
  const draftError = useWorkspace((s) => s.draftError);
  const apply = useWorkspace((s) => s.apply);
  const reject = useWorkspace((s) => s.reject);
  const propose = useWorkspace((s) => s.propose);
  const [componentEditor, setComponentEditor] = useState<{
    node?: ArchitectureNode;
    kind?: NodeKind;
    parentId?: string | null;
    confirmDelete?: boolean;
  } | null>(null);
  const [scopeId, setScopeId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string[]>([]);
  const [boundaryEditor, setBoundaryEditor] = useState<CanvasBoundary | null>(
    null,
  );
  const [inspectorTab, setInspectorTab] = useState<"overview" | "ai">(
    "overview",
  );
  const [relationshipEditor, setRelationshipEditor] = useState<{
    edge?: ArchitectureProject["edges"][number];
    source?: string;
    target?: string;
    relation?: ArchitectureProject["edges"][number]["relation"];
  } | null>(null);
  const [decisionEditor, setDecisionEditor] = useState<
    ArchitectureProject["decisions"][number] | "new" | null
  >(null);
  const requestedView = params.get("view");
  const [view, setView] = useState<WorkspaceView>(
    views.some((item) => item.id === requestedView)
      ? (requestedView as WorkspaceView)
      : "architecture",
  );
  const [selected, setSelected] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showProjects, setShowProjects] = useState(false);
  const [listView, setListView] = useState(false);
  const [focus, setFocus] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const [sidebarExpanded, setSidebarExpanded] = useState(false);
  const [openGroups, setOpenGroups] = useState<string[]>([]);
  const [modifying, setModifying] = useState(false);
  const [modifiedRule, setModifiedRule] = useState("");
  const [shareToken, setShareToken] = useState<string | null>(null);
  const [shareState, setShareState] = useState<
    "idle" | "publishing" | "live" | "error"
  >("idle");

  const toggleShare = useCallback(async () => {
    if (shareToken) {
      try {
        await fetch("/api/mcp/share", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId: project.id, token: shareToken }),
        });
      } finally {
        setShareToken(null);
        setShareState("idle");
        toast.success("Agent sharing stopped.");
      }
      return;
    }
    setShareState("publishing");
    const token = crypto.randomUUID() + crypto.randomUUID();
    try {
      const response = await fetch("/api/mcp/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project, token }),
      });
      const payload: unknown = await response.json();
      if (!response.ok || !(payload as { ok?: boolean }).ok)
        throw new Error(
          (payload as { error?: string }).error ??
            "Could not share the architecture.",
        );
      setShareToken(token);
      setShareState("live");
      toast.success(
        "Agents can now read this architecture until you stop sharing.",
      );
    } catch (error) {
      setShareState("error");
      toast.error(
        error instanceof Error ? error.message : "Could not start sharing.",
      );
    }
  }, [project, shareToken]);

  useEffect(() => {
    if (!shareToken) return;
    if (shareState === "publishing") return;
    const timer = setTimeout(() => {
      fetch("/api/mcp/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project, token: shareToken }),
      }).catch(() => setShareState("error"));
    }, 400);
    return () => clearTimeout(timer);
  }, [project, shareToken, shareState]);

  useEffect(() => {
    return () => {
      if (!shareToken) return;
      navigator.sendBeacon(
        "/api/mcp/share",
        new Blob(
          [
            JSON.stringify({
              projectId: project.id,
              token: shareToken,
              stop: true,
            }),
          ],
          { type: "application/json" },
        ),
      );
    };
  }, [project.id, shareToken]);

  useEffect(() => {
    setListView(window.innerWidth < 640);
  }, []);
  useEffect(() => {
    function shortcut(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setShowSearch((value) => !value);
      }
    }
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, []);
  useEffect(() => {
    if (!mobileNav) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setMobileNav(false);
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [mobileNav]);
  const nodes = Object.values(project.nodes);
  const listPresentation = useMemo(
    () =>
      deriveArchitecturePresentation(project, "system", {
        scopeId,
      }),
    [project, scopeId],
  );
  useEffect(() => {
    setOpenGroups((current) =>
      current.length > 0
        ? current.filter((id) =>
            listPresentation.groups.some((group) => group.id === id),
          )
        : listPresentation.groups.slice(0, 1).map((group) => group.id),
    );
  }, [listPresentation.groups]);
  const affected = useMemo(
    () =>
      pending
        ? [
            ...new Set([
              ...pending.impact.primary,
              ...pending.updates.map((update) => update.nodeId),
            ]),
          ]
        : [],
    [pending],
  );
  const impacted = useMemo(
    () =>
      pending
        ? pending.impact.secondary.filter((id) => !affected.includes(id))
        : [],
    [affected, pending],
  );
  const impactReasons = useMemo(() => {
    const reasons = new Map<string, string[]>();
    for (const item of pending?.impact.reasons ?? [])
      reasons.set(item.nodeId, [
        ...(reasons.get(item.nodeId) ?? []),
        item.reason,
      ]);
    return reasons;
  }, [pending]);
  const questionCount = nodes.reduce(
    (count, node) => count + node.questions.length,
    0,
  );
  const selectedNode = selected ? project.nodes[selected] : null;
  const canvasProjection = Object.hasOwn(projectionByView, view)
    ? projectionByView[view as CanvasView]
    : null;
  const context = JSON.stringify(
    {
      project: {
        name: project.name,
        intent: project.description,
        version: project.version,
      },
      nodes: project.nodes,
      relationships: project.edges,
      decisions: project.decisions,
    },
    null,
    2,
  );
  const results = nodes.filter((node) =>
    `${node.name} ${node.summary} ${node.rules.join(" ")}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );

  function selectNode(id: string) {
    setSelected(id);
    setShowSearch(false);
    setMobileNav(false);
  }
  const clearSelection = useCallback(() => {
    setSelected(null);
    setFocus(false);
  }, []);
  const enterScope = useCallback((id: string | null) => {
    setScopeId(id);
    setExpanded([]);
    setFocus(false);
    setSelected(null);
    setView("architecture");
    setListView(false);
  }, []);
  const toggleExpanded = useCallback((id: string) => {
    setExpanded((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id],
    );
  }, []);
  const reparent = useCallback(
    (nodeId: string, parentId: string | null) => {
      const node = project.nodes[nodeId];
      if (!node || (node.parentId ?? null) === parentId) return;
      try {
        dispatch(
          { type: "reparent_node", nodeId, parentId },
          {
            title: `Moved ${node.name} into ${parentId ? (project.nodes[parentId]?.name ?? "another component") : "the project root"}`,
          },
        );
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Could not move component.",
        );
      }
    },
    [dispatch, project.nodes],
  );
  const scopeNode = scopeId ? project.nodes[scopeId] : null;
  useEffect(() => {
    if (scopeId && !project.nodes[scopeId]) setScopeId(null);
  }, [project.nodes, scopeId]);
  function exportProject() {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(project, null, 2)], {
        type: "application/json",
      }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `${project.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-architecture-v${project.version}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Architecture exported.");
  }

  return (
    <div
      className={cn("workspace", selectedNode && "workspace-inspector-open")}
    >
      <header className="workspace-header">
        <Brand />
        <Button
          variant="ghost"
          size="icon-sm"
          className="workspace-sidebar-toggle"
          aria-label={
            sidebarExpanded
              ? "Collapse workspace navigation"
              : "Expand workspace navigation"
          }
          aria-expanded={sidebarExpanded}
          onClick={() => setSidebarExpanded((value) => !value)}
        >
          {sidebarExpanded ? <PanelLeftClose /> : <PanelLeftOpen />}
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          className="workspace-menu"
          aria-label="Toggle workspace navigation"
          aria-expanded={mobileNav}
          onClick={() => setMobileNav(!mobileNav)}
        >
          <Menu />
        </Button>
        <div className="workspace-breadcrumb">
          <strong>{project.name}</strong>
          <Badge variant="secondary">
            <GitBranch aria-hidden="true" />
            {project.source === "repository" ? "Repository" : "Project"}
          </Badge>
        </div>
        <div className="workspace-header-actions">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Search architecture"
            onClick={() => setShowSearch(true)}
          >
            <Search />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowHistory(true)}
          >
            <History data-icon="inline-start" />
            <span className="hide-mobile">History</span>
          </Button>
          <Button variant="outline" size="sm" onClick={exportProject}>
            <Download data-icon="inline-start" />
            <span className="hide-mobile">Export</span>
          </Button>
        </div>
      </header>
      <div className="workspace-layout">
        {mobileNav && (
          <button
            type="button"
            className="workspace-sidebar-backdrop"
            aria-label="Close workspace navigation"
            onClick={() => setMobileNav(false)}
          />
        )}
        <aside
          className={cn(
            "workspace-sidebar",
            sidebarExpanded && "workspace-sidebar-expanded",
            mobileNav && "workspace-sidebar-open",
          )}
          role={mobileNav ? "dialog" : undefined}
          aria-modal={mobileNav || undefined}
          aria-label={mobileNav ? "Workspace menu" : undefined}
        >
          <button
            className="workspace-project"
            aria-label="Switch project"
            title={!sidebarExpanded ? project.name : undefined}
            onClick={() => setShowProjects(true)}
          >
            <span className="project-monogram">
              {project.name.charAt(0).toUpperCase()}
            </span>
            <div>
              <strong>{project.name}</strong>
              <small>Your system architecture</small>
            </div>
            <ChevronRight size={13} className="ml-auto shrink-0" />
          </button>
          <Button
            variant="outline"
            size="sm"
            className="workspace-search"
            aria-label="Find anything"
            title={!sidebarExpanded ? "Find anything" : undefined}
            onClick={() => setShowSearch(true)}
          >
            <Search data-icon="inline-start" />
            Find anything<kbd>⌘ K</kbd>
          </Button>
          <nav aria-label="Workspace navigation" className="sidebar-sections">
            {sidebarSections.map((section) => (
              <div key={section.label} className="sidebar-section">
                <span className="eyebrow">{section.label.toUpperCase()}</span>
                {section.entries.map((entry) => {
                  const Icon = entry.icon;
                  const active =
                    entry.view !== undefined &&
                    (entry.view === view ||
                      (entry.view === "architecture" &&
                        canvasProjection !== null &&
                        view !== "security"));
                  const content = (
                    <>
                      <Icon size={16} strokeWidth={1.6} />
                      <span>
                        <strong>{entry.title}</strong>
                        <small>{entry.description}</small>
                      </span>
                    </>
                  );
                  if (entry.href)
                    return (
                      <Link
                        key={entry.id}
                        href={entry.href}
                        className="workspace-nav-item"
                        aria-label={entry.title}
                        title={!sidebarExpanded ? entry.title : undefined}
                      >
                        {content}
                      </Link>
                    );
                  return (
                    <button
                      key={entry.id}
                      type="button"
                      aria-current={active ? "page" : undefined}
                      aria-label={entry.title}
                      title={!sidebarExpanded ? entry.title : undefined}
                      className={cn("workspace-nav-item", active && "active")}
                      onClick={() => {
                        if (entry.action === "history") setShowHistory(true);
                        else if (entry.action === "search") setShowSearch(true);
                        else if (entry.view) setView(entry.view);
                        setMobileNav(false);
                      }}
                    >
                      {content}
                    </button>
                  );
                })}
              </div>
            ))}
          </nav>
          <div className="sidebar-bottom">
            <Button variant="outline" size="sm" asChild className="w-full">
              <Link
                href="/start"
                aria-label="New project"
                title={!sidebarExpanded ? "New project" : undefined}
              >
                <Plus data-icon="inline-start" />
                <span>New project</span>
              </Link>
            </Button>

            <Link
              href="/"
              aria-label="Back to Structor"
              title={!sidebarExpanded ? "Back to Structor" : undefined}
            >
              <span>Back to Structor</span> <ArrowUpRight size={12} />
            </Link>
          </div>
        </aside>
        <main id="main-content" className="workspace-main">
          <div className="workspace-toolbar">
            <div className="workspace-toolbar-copy">
              <h1>
                {canvasProjection
                  ? "Architecture"
                  : views.find((v) => v.id === view)?.title}
              </h1>
              <div className="workspace-toolbar-meta">
                <span className="workspace-toolbar-description">
                  {canvasProjection
                    ? focus && selectedNode
                      ? `Around ${selectedNode.name}`
                      : scopeNode
                        ? `Inside ${scopeNode.name} — ${scopeNode.summary}`
                        : "Visualize, understand, and evolve your system"
                    : "The thinking behind your system"}
                </span>
                {canvasProjection && (
                  <span
                    className="workspace-stats"
                    aria-label={`${nodes.length} components, ${project.edges.length} relationships, ${questionCount} open questions`}
                  >
                    <span title={`${nodes.length} components`}>
                      <Boxes aria-hidden="true" />
                      {nodes.length}
                    </span>
                    <span title={`${project.edges.length} relationships`}>
                      <Spline aria-hidden="true" />
                      {project.edges.length}
                    </span>
                    {questionCount > 0 && (
                      <span title={`${questionCount} open questions`}>
                        <CircleHelp aria-hidden="true" />
                        {questionCount}
                      </span>
                    )}
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {view === "flows" && nodes.length > 0 && (
                <Button
                  size="sm"
                  onClick={() => setRelationshipEditor({ relation: "calls" })}
                >
                  <Plus data-icon="inline-start" />
                  Add flow
                </Button>
              )}
              {view === "decisions" && (
                <Button size="sm" onClick={() => setDecisionEditor("new")}>
                  <Plus data-icon="inline-start" />
                  Record decision
                </Button>
              )}
              {view === "architecture" && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setListView(!listView)}
                >
                  {listView ? (
                    <Network data-icon="inline-start" />
                  ) : (
                    <List data-icon="inline-start" />
                  )}
                  {listView ? "Canvas" : "Overview"}
                </Button>
              )}
              {canvasProjection && focus && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setFocus(false)}
                >
                  <ArrowLeft data-icon="inline-start" />
                  All systems
                </Button>
              )}
              <Badge variant="outline">v{project.version}</Badge>
            </div>
          </div>
          {canvasProjection ? (
            <div className="workspace-canvas-area">
              {drafting && (
                <div className="workspace-drafting" role="status">
                  <LoaderCircle aria-hidden="true" />
                  <span>Adding remaining components…</span>
                </div>
              )}
              {draftError && !drafting && (
                <div
                  className="workspace-drafting workspace-drafting-error"
                  role="status"
                >
                  {draftError}
                </div>
              )}
              {nodes.length ? (
                view === "architecture" && listView ? (
                  <div className="architecture-overview">
                    <header className="architecture-overview-intro">
                      <div>
                        <span className="eyebrow">SYSTEM OVERVIEW</span>
                        <h2>
                          {scopeNode
                            ? `Inside ${scopeNode.name}`
                            : `${project.name} at a glance`}
                        </h2>
                        <p>
                          Browse the architecture by responsibility. Open a
                          group to inspect its components.
                        </p>
                      </div>
                      <span className="architecture-updated">
                        <i /> Updated {formatUpdatedAt(project)}
                      </span>
                    </header>
                    <div className="architecture-groups">
                      {listPresentation.groups.map((group) => (
                        <details
                          className="architecture-group"
                          key={group.id}
                          open={openGroups.includes(group.id)}
                          onToggle={(event) => {
                            const isOpen = event.currentTarget.open;
                            setOpenGroups((current) =>
                              isOpen
                                ? [...new Set([...current, group.id])]
                                : current.filter((id) => id !== group.id),
                            );
                          }}
                        >
                          <summary>
                            <span>
                              <strong>{group.label}</strong>
                              <small>{group.description}</small>
                            </span>
                            <Badge variant="secondary">
                              {group.nodes.length}
                            </Badge>
                            <ChevronDown aria-hidden="true" />
                          </summary>
                          <div className="architecture-list">
                            {group.nodes.map((node) => {
                              const Icon = overviewIcons[node.kind];
                              return (
                                <button
                                  key={node.id}
                                  onClick={() => selectNode(node.id)}
                                >
                                  <span
                                    className={cn(
                                      "node-icon",
                                      node.kind === "data" && "node-icon-data",
                                      [
                                        "integration",
                                        "infrastructure",
                                      ].includes(node.kind) &&
                                        "node-icon-integration",
                                    )}
                                  >
                                    <Icon size={18} />
                                  </span>
                                  <div className="architecture-list-copy">
                                    <strong>{node.name}</strong>
                                    <p>{node.summary}</p>
                                    <span>
                                      <Badge variant="secondary">
                                        {node.kind}
                                      </Badge>
                                      {node.sourceReferences.length > 0 && (
                                        <small>
                                          {node.sourceReferences.length} source
                                          {node.sourceReferences.length === 1
                                            ? ""
                                            : "s"}
                                        </small>
                                      )}
                                    </span>
                                  </div>
                                  <ArrowUpRight
                                    className="architecture-list-arrow"
                                    size={15}
                                  />
                                </button>
                              );
                            })}
                          </div>
                        </details>
                      ))}
                    </div>
                  </div>
                ) : (
                  <ArchitectureCanvas
                    project={project}
                    projection={canvasProjection}
                    selected={selected}
                    onProjectionChange={(nextProjection) => {
                      setView(viewByProjection[nextProjection]);
                      setListView(false);
                      setFocus(false);
                    }}
                    onSelect={selectNode}
                    onAskAI={(id) => {
                      setInspectorTab("ai");
                      selectNode(id);
                    }}
                    onEditNode={(id) => {
                      const node = project.nodes[id];
                      if (node) setComponentEditor({ node });
                    }}
                    onClearSelection={clearSelection}
                    onAddComponent={(kind, parentId) =>
                      setComponentEditor({ kind, parentId: parentId ?? null })
                    }
                    scopeId={scopeId}
                    expanded={expanded}
                    onEnter={enterScope}
                    onToggleExpanded={toggleExpanded}
                    onReparent={reparent}
                    onConnect={(source, target) =>
                      setRelationshipEditor({ source, target })
                    }
                    onEditRelationship={(id) => {
                      const edge = project.edges.find((item) => item.id === id);
                      if (edge) setRelationshipEditor({ edge });
                    }}
                    onDeleteRelationship={(id) => {
                      try {
                        removeRelationship(id);
                        toast.success("Relationship removed.");
                      } catch (error) {
                        toast.error(
                          error instanceof Error
                            ? error.message
                            : "Could not remove the relationship.",
                        );
                      }
                    }}
                    onDeleteNode={(id) => {
                      const node = project.nodes[id];
                      if (node)
                        setComponentEditor({ node, confirmDelete: true });
                    }}
                    onUpdateCanvas={updateCanvas}
                    onRenameBoundary={(boundary) => setBoundaryEditor(boundary)}
                    affected={affected}
                    impacted={impacted}
                    focus={focus}
                  />
                )
              ) : (
                <div className="workspace-empty">
                  <EmptyState
                    title="Define your first component"
                    text={
                      project.description ||
                      "Add the first component of your system, then define how it connects."
                    }
                  />
                  <Button
                    onClick={() => setComponentEditor({ kind: "feature" })}
                  >
                    <Plus data-icon="inline-start" />
                    Create first component
                  </Button>
                </div>
              )}
            </div>
          ) : (
            <div className="workspace-document">
              {view === "decisions" && (
                <>
                  <span className="eyebrow">PRESERVE THE WHY</span>
                  <h2>Decisions that shape {project.name}.</h2>
                  <p className="document-lead">
                    The reasoning belongs to the architecture, even when the
                    implementation changes.
                  </p>
                  {project.decisions.length ? (
                    project.decisions.map((decision, index) => (
                      <article className="decision-row" key={decision.id}>
                        <span className="mono">ADR / 00{index + 1}</span>
                        <h3>{decision.title}</h3>
                        <p>{decision.reason}</p>
                        {decision.alternative && (
                          <details>
                            <summary>Alternative considered</summary>
                            <p>{decision.alternative}</p>
                          </details>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setDecisionEditor(decision)}
                        >
                          <Pencil data-icon="inline-start" />
                          Edit decision
                        </Button>
                      </article>
                    ))
                  ) : (
                    <EmptyState
                      title="No decisions captured yet"
                      text="Define your system and record the reasoning behind each choice."
                    />
                  )}
                </>
              )}
              {view === "plan" && (
                <ImplementationPlanView
                  project={project}
                  onSelect={selectNode}
                />
              )}
              {view === "context" && (
                <>
                  <span className="eyebrow">AGENT ACCESS</span>
                  <h2>One architecture, served live.</h2>
                  <p className="document-lead">
                    Sharing publishes the same canonical architecture you see —
                    hierarchy, intent, rules, evidence, and the implementation
                    plan — to authorized MCP clients over this server. Nothing
                    is stored when sharing stops.
                  </p>
                  <Alert>
                    <Blocks />
                    <AlertTitle>
                      {shareToken
                        ? shareState === "live"
                          ? "Live and current"
                          : "Having trouble reaching the server"
                        : "Agents are offline"}
                    </AlertTitle>
                    <AlertDescription>
                      {shareToken
                        ? shareState === "live"
                          ? `Version ${project.version} is readable right now; every change is pushed automatically.`
                          : "The last update did not reach the server. Try again, or stop sharing."
                        : "Turn sharing on to give an MCP client read access until you close this project or stop sharing."}
                    </AlertDescription>
                  </Alert>
                  <div className="context-actions">
                    <Button
                      onClick={toggleShare}
                      disabled={shareState === "publishing"}
                    >
                      {shareToken ? (
                        <>
                          <Square data-icon="inline-start" />
                          Stop sharing
                        </>
                      ) : (
                        <>
                          <Plug data-icon="inline-start" />
                          Share with agents
                        </>
                      )}
                    </Button>
                    {shareToken && (
                      <>
                        <Button
                          variant="outline"
                          onClick={async () => {
                            try {
                              await navigator.clipboard.writeText(shareToken);
                              toast.success("Share token copied.");
                            } catch {
                              toast.error("Clipboard access was denied.");
                            }
                          }}
                        >
                          <Copy data-icon="inline-start" />
                          Copy token
                        </Button>
                        <Button
                          variant="outline"
                          onClick={async () => {
                            try {
                              await navigator.clipboard.writeText(
                                [
                                  `url: ${window.location.origin}/api/mcp`,
                                  `headers: Authorization: Bearer ${project.id}:${shareToken}`,
                                ].join("\n"),
                              );
                              toast.success("MCP configuration copied.");
                            } catch {
                              toast.error("Clipboard access was denied.");
                            }
                          }}
                        >
                          <FileCode2 data-icon="inline-start" />
                          Copy client config
                        </Button>
                      </>
                    )}
                    <Button
                      variant="ghost"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(context);
                          toast.success("Project context copied.");
                        } catch {
                          toast.error(
                            "Clipboard access was denied. Use Export to download your context.",
                          );
                        }
                      }}
                    >
                      <Copy data-icon="inline-start" />
                      Copy snapshot
                    </Button>
                    <Button variant="ghost" onClick={exportProject}>
                      <Download data-icon="inline-start" />
                      Export JSON
                    </Button>
                  </div>
                  {shareToken && (
                    <div className="context-code">
                      <div>
                        <FileCode2 size={14} />
                        <span>Read-only MCP tools available to clients</span>
                        <Badge variant="secondary">live</Badge>
                      </div>
                      <pre className="context-tools">
                        {[
                          "get_project",
                          "list_entities",
                          "get_entity",
                          "get_children",
                          "get_subtree",
                          "get_relationships",
                          "search_architecture",
                          "get_implementation_plan",
                          "get_architecture_delta",
                        ].join("\n")}
                      </pre>
                    </div>
                  )}
                  <div className="context-code">
                    <div>
                      <FileCode2 size={14} />
                      <span>structor-context.json</span>
                      <Badge variant="secondary">v{project.version}</Badge>
                    </div>
                    <pre>{context}</pre>
                  </div>
                </>
              )}
            </div>
          )}
        </main>
        {selectedNode && (
          <NodeInspector
            key={`${selectedNode.id}:${inspectorTab}`}
            node={selectedNode}
            project={project}
            initialTab={inspectorTab}
            onEdit={() => setComponentEditor({ node: selectedNode })}
            onClose={() => {
              setSelected(null);
              setFocus(false);
              setInspectorTab("overview");
            }}
            onFocus={() => {
              setView("architecture");
              setFocus(true);
              setListView(false);
            }}
            onSelect={selectNode}
            onEnter={enterScope}
            onAddChild={(parentId) =>
              setComponentEditor({ kind: "capability", parentId })
            }
          />
        )}
      </div>
      <Dialog open={showProjects} onOpenChange={setShowProjects}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Your projects</DialogTitle>
            <DialogDescription>
              Projects opened in this session.
            </DialogDescription>
          </DialogHeader>
          <div className="search-results">
            {Object.values({ ...projects, [project.id]: project }).map(
              (saved) => (
                <button
                  key={saved.id}
                  onClick={() => {
                    try {
                      setProject(saved);
                    } catch (error) {
                      toast.error(
                        error instanceof Error
                          ? error.message
                          : "Could not open project.",
                      );
                      return;
                    }
                    setSelected(null);
                    setFocus(false);
                    setView("architecture");
                    setShowProjects(false);
                    setMobileNav(false);
                  }}
                >
                  <span className="project-monogram">
                    {saved.name.charAt(0).toUpperCase()}
                  </span>
                  <div>
                    <strong>{saved.name}</strong>
                    <span>
                      {Object.keys(saved.nodes).length} systems · Version{" "}
                      {saved.version}
                    </span>
                  </div>
                  {saved.id === project.id ? (
                    <Check size={15} />
                  ) : (
                    <ArrowUpRight size={15} />
                  )}
                </button>
              ),
            )}
          </div>
          <Button variant="outline" asChild>
            <Link href="/start">
              <Plus data-icon="inline-start" />
              New project
            </Link>
          </Button>
        </DialogContent>
      </Dialog>
      <Dialog open={showSearch} onOpenChange={setShowSearch}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Search architecture</DialogTitle>
            <DialogDescription>
              Find a system, requirement, or business rule.
            </DialogDescription>
          </DialogHeader>
          <InputGroup>
            <InputGroupAddon>
              <Search />
            </InputGroupAddon>
            <InputGroupInput
              aria-label="Search systems"
              placeholder="Search your architecture…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </InputGroup>
          <div className="search-results">
            {results.length ? (
              results.map((node) => (
                <button
                  key={node.id}
                  onClick={() => {
                    selectNode(node.id);
                    setView("architecture");
                  }}
                >
                  <Network size={17} />
                  <div>
                    <strong>{node.name}</strong>
                    <span>{node.summary}</span>
                  </div>
                  <ArrowUpRight size={15} />
                </button>
              ))
            ) : (
              <EmptyState
                title="No systems found"
                text="Try a component name or a word from a business rule."
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={showHistory} onOpenChange={setShowHistory}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Architecture history</DialogTitle>
            <DialogDescription>Changes made to this project.</DialogDescription>
          </DialogHeader>
          <div className="history-list">
            {[...project.history].reverse().map((item) => (
              <div key={item.version}>
                <Badge variant="outline">v{item.version}</Badge>
                <div>
                  <strong>{item.title}</strong>
                  <span>
                    {new Date(item.date).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
      <Dialog
        open={Boolean(pending)}
        onOpenChange={(open) => {
          if (!open) {
            reject();
            setModifying(false);
          }
        }}
      >
        <DialogContent className="patch-dialog">
          <DialogHeader>
            <div className="patch-eyebrow">
              <GitBranch size={16} />
              <span>PROPOSED ARCHITECTURE CHANGE</span>
            </div>
            <DialogTitle>{pending?.title}</DialogTitle>
            <DialogDescription>
              {pending?.source === "ai"
                ? "Structor AI proposed this change. Nothing is applied until you approve it."
                : "Review the exact change you entered before it becomes canonical architecture."}
              {pending?.reason ? ` Why: ${pending.reason}` : ""}
            </DialogDescription>
          </DialogHeader>
          {pending && (
            <>
              {modifying && pending.updates.length > 0 ? (
                <form
                  className="flex flex-col gap-4"
                  onSubmit={(e) => {
                    e.preventDefault();
                    try {
                      propose(pending.updates[0].nodeId, modifiedRule);
                      setModifying(false);
                    } catch {
                      toast.error("Please enter a valid rule.");
                    }
                  }}
                >
                  <FieldGroup>
                    <Field>
                      <FieldLabel htmlFor="modified-rule">
                        Revised requirement
                      </FieldLabel>
                      <Textarea
                        id="modified-rule"
                        required
                        maxLength={2000}
                        rows={4}
                        value={modifiedRule}
                        onChange={(e) => setModifiedRule(e.target.value)}
                      />
                    </Field>
                  </FieldGroup>
                  <Button type="submit">Update proposal</Button>
                </form>
              ) : (
                <>
                  <div className="patch-changes">
                    {pending.updates.map((update) => (
                      <div key={update.nodeId}>
                        <span>
                          <Plus size={14} />
                          {project.nodes[update.nodeId]?.name}
                        </span>
                        <p>{update.rule}</p>
                      </div>
                    ))}
                    {pending.commands.map((command, index) => (
                      <div key={`${command.type}-${index}`}>
                        <span>
                          <Plus size={14} />
                          {describeCommand(command, project)}
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className="patch-implications">
                    {pending.resolvedQuestions.map((item) => (
                      <p
                        key={`${item.nodeId}-${item.question}`}
                        className="text-primary mb-3 text-xs"
                      >
                        Resolves open question: {item.question}
                      </p>
                    ))}
                    <h3>Affected architecture</h3>
                    {affected.length + impacted.length > 0 ? (
                      <ul className="patch-impact-list">
                        {[...affected, ...impacted].map((nodeId) => (
                          <li key={nodeId}>
                            <strong>
                              {project.nodes[nodeId]?.name ?? "New component"}
                            </strong>
                            <span>
                              {affected.includes(nodeId)
                                ? "Changes directly"
                                : (impactReasons.get(nodeId) ?? []).join(" ")}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p>No connected systems are affected by this proposal.</p>
                    )}
                    <p>
                      Affected systems are highlighted on the canvas while this
                      proposal is open.
                    </p>
                  </div>
                  <div className="patch-actions">
                    <Button variant="ghost" onClick={reject}>
                      <X data-icon="inline-start" />
                      Reject
                    </Button>
                    {pending.updates.length > 0 && (
                      <Button
                        variant="outline"
                        onClick={() => {
                          setModifiedRule(pending.rule);
                          setModifying(true);
                        }}
                      >
                        Modify
                      </Button>
                    )}
                    <Button
                      onClick={() => {
                        try {
                          apply();
                          toast.success("Architecture updated.");
                        } catch (e) {
                          toast.error(
                            e instanceof Error
                              ? e.message
                              : "Unable to apply this change.",
                          );
                        }
                      }}
                    >
                      <Check data-icon="inline-start" />
                      Apply changes
                    </Button>
                  </div>
                </>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
      {componentEditor && (
        <ComponentEditor
          node={componentEditor.node}
          kind={componentEditor.kind ?? (view === "data" ? "data" : "feature")}
          parentId={componentEditor.parentId ?? scopeId}
          confirmDelete={componentEditor.confirmDelete}
          onClose={() => setComponentEditor(null)}
          onSaved={selectNode}
        />
      )}
      {boundaryEditor && (
        <BoundaryEditor
          boundary={boundaryEditor}
          onClose={() => setBoundaryEditor(null)}
          onSave={(boundary) => {
            updateCanvas({ boundaries: [boundary] });
            setBoundaryEditor(null);
          }}
        />
      )}
      {relationshipEditor && (
        <RelationshipEditor
          project={project}
          edge={relationshipEditor.edge}
          source={relationshipEditor.source}
          target={relationshipEditor.target}
          relation={relationshipEditor.relation}
          onClose={() => setRelationshipEditor(null)}
        />
      )}
      {decisionEditor && (
        <DecisionEditor
          decision={decisionEditor === "new" ? undefined : decisionEditor}
          onClose={() => setDecisionEditor(null)}
        />
      )}
    </div>
  );
}

function formatUpdatedAt(project: ArchitectureProject) {
  const latest = project.history.at(-1)?.date;
  if (!latest) return "just now";
  const elapsed = Date.now() - new Date(latest).getTime();
  const minutes = Math.round(elapsed / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  return new Date(latest).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

const planStatusLabels: Record<TaskStatus, string> = {
  PLANNED: "Planned",
  READY: "Ready",
  IN_PROGRESS: "In progress",
  BLOCKED: "Blocked",
  IMPLEMENTED: "Implemented",
  VERIFIED: "Verified",
};

const planOperationLabels: Record<
  ImplementationTask["operation"],
  { label: string; tone: string }
> = {
  CREATE: { label: "Create", tone: "plan-operation-create" },
  UPDATE: { label: "Update", tone: "plan-operation-update" },
  REMOVE: { label: "Remove", tone: "plan-operation-remove" },
};

function ImplementationPlanView({
  project,
  onSelect,
}: {
  project: ArchitectureProject;
  onSelect: (id: string) => void;
}) {
  const dispatch = useWorkspace((s) => s.dispatch);
  const plan = project.plan;
  const tasks = plan?.tasks ?? [];
  const byOperation = {
    CREATE: tasks.filter((task) => task.operation === "CREATE"),
    UPDATE: tasks.filter((task) => task.operation === "UPDATE"),
    REMOVE: tasks.filter((task) => task.operation === "REMOVE"),
  };
  return (
    <>
      <span className="eyebrow">FROM INTENT TO CODE</span>
      <h2>Implementation plan</h2>
      <p className="document-lead">
        The work implied by the difference between what this project should do
        and what the implementation currently shows. Tasks follow the
        architecture: change intent and the plan updates.
      </p>
      {tasks.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ListChecks />
            </EmptyMedia>
            <EmptyTitle>Nothing pending</EmptyTitle>
            <EmptyDescription>
              Intended architecture and observed implementation are aligned. Add
              a feature or change behavior to see implementation work here.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        (["CREATE", "UPDATE", "REMOVE"] as const).map((operation) =>
          byOperation[operation].length === 0 ? null : (
            <section key={operation} className="plan-section">
              <h3>
                <span
                  className={cn(
                    "plan-operation",
                    planOperationLabels[operation].tone,
                  )}
                >
                  {planOperationLabels[operation].label}
                </span>
                {byOperation[operation].length} task
                {byOperation[operation].length === 1 ? "" : "s"}
              </h3>
              <div className="plan-tasks">
                {byOperation[operation].map((task) => {
                  const node = project.nodes[task.nodeId];
                  const dependencies = task.dependencies
                    .map((id) =>
                      project.plan?.tasks.find((item) => item.id === id),
                    )
                    .filter((item) => item !== undefined);
                  return (
                    <article key={task.id} className="plan-task">
                      <header>
                        <button
                          type="button"
                          className="plan-task-title"
                          onClick={() => node && onSelect(node.id)}
                        >
                          {task.title}
                        </button>
                        <select
                          aria-label={`Status for ${task.title}`}
                          value={task.status}
                          onChange={(event) => {
                            try {
                              dispatch(
                                {
                                  type: "update_task",
                                  taskId: task.id,
                                  changes: {
                                    status: event.target.value as TaskStatus,
                                  },
                                },
                                {
                                  title: `${task.title}: ${planStatusLabels[event.target.value as TaskStatus]}`,
                                },
                              );
                            } catch (error) {
                              toast.error(
                                error instanceof Error
                                  ? error.message
                                  : "Could not update the task.",
                              );
                            }
                          }}
                        >
                          {Object.entries(planStatusLabels).map(
                            ([value, label]) => (
                              <option key={value} value={value}>
                                {label}
                              </option>
                            ),
                          )}
                        </select>
                      </header>
                      <p>{task.goal}</p>
                      {task.acceptanceCriteria.length > 0 && (
                        <ul className="plain-list">
                          {task.acceptanceCriteria.map((criterion) => (
                            <li key={criterion}>{criterion}</li>
                          ))}
                        </ul>
                      )}
                      <footer>
                        {task.securityRequirements.length > 0 && (
                          <span>
                            <ShieldCheck size={11} />
                            {task.securityRequirements.length} security
                            requirement
                            {task.securityRequirements.length === 1 ? "" : "s"}
                          </span>
                        )}
                        {task.affectedEntities.length > 0 && (
                          <span>
                            {task.affectedEntities.length} related component
                            {task.affectedEntities.length === 1 ? "" : "s"}
                          </span>
                        )}
                        {dependencies.length > 0 && (
                          <span>
                            after{" "}
                            {dependencies.map((item) => item.title).join(", ")}
                          </span>
                        )}
                        {node && (
                          <span className="plan-task-node">in {node.name}</span>
                        )}
                      </footer>
                    </article>
                  );
                })}
              </div>
            </section>
          ),
        )
      )}
    </>
  );
}

function describeCommand(
  command: ArchitecturePatch["commands"][number],
  project: ArchitectureProject,
) {
  const nodeName = (nodeId: string) =>
    project.nodes[nodeId]?.name ?? "New component";
  if (command.type === "upsert_node")
    return `${project.nodes[command.node.id] ? "Update" : "Create"} ${command.node.kind} “${command.node.name}”`;
  if (command.type === "update_node")
    return `Update ${nodeName(command.nodeId)} (${Object.keys(command.changes).join(", ")})`;
  if (command.type === "delete_node")
    return `Delete ${nodeName(command.nodeId)}`;
  if (command.type === "add_node_item")
    return `Add ${command.field.replaceAll("_", " ")} to ${nodeName(command.nodeId)}: ${command.value}`;
  if (command.type === "update_node_item")
    return `Update ${command.field.replaceAll("_", " ")} on ${nodeName(command.nodeId)}`;
  if (command.type === "delete_node_item")
    return `Remove ${command.field.replaceAll("_", " ")} from ${nodeName(command.nodeId)}`;
  if (command.type === "upsert_edge")
    return `Connect ${nodeName(command.edge.source)} → ${nodeName(command.edge.target)} (${command.edge.relation.replaceAll("_", " ")})`;
  if (command.type === "delete_edge") return "Remove a relationship";
  if (command.type === "attach_source_reference")
    return `Attach ${command.reference.path} to ${nodeName(command.nodeId)}`;
  if (command.type === "delete_source_reference")
    return `Remove a source reference from ${nodeName(command.nodeId)}`;
  if (command.type === "upsert_decision")
    return `Record decision “${command.decision.title}”`;
  return "Remove a decision";
}

function EmptyState({ title, text }: { title: string; text: string }) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Network />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{text}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
