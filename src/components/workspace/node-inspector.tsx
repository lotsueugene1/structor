"use client";

import { useState } from "react";

import {
  ArrowUpRight,
  Check,
  ChevronRight,
  CircleHelp,
  CornerDownRight,
  FileCode2,
  Layers,
  Pencil,
  Plus,
  ShieldCheck,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { ZodError } from "zod";

import { kindLabels } from "@/components/architecture/shapes";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  buildAgentContext,
  reviewArchitectureNode,
} from "@/lib/architecture/agent";
import { tasksForNode } from "@/lib/architecture/plan";
import {
  ancestorsOf,
  childrenOf,
  deriveNodeDelta,
  type ArchitectureNode,
  type ArchitectureProject,
  type IntentChange,
  type NodeListField,
  type TaskStatus,
} from "@/lib/architecture/schema";
import { useWorkspace } from "@/lib/architecture/store";
import { cn } from "@/lib/utils";

const provenanceLabels = {
  observed: "Observed in code",
  inferred: "Inferred by Structor",
  defined: "Defined by you",
};

const listSections: Array<{
  field: NodeListField;
  title: string;
  empty: string;
  action: string;
}> = [
  {
    field: "requirements",
    title: "Requirements",
    empty: "No requirements recorded.",
    action: "Add requirement",
  },
  {
    field: "rules",
    title: "Business rules",
    empty: "No business rules recorded.",
    action: "Add business rule",
  },
  {
    field: "constraints",
    title: "Constraints",
    empty: "No constraints recorded.",
    action: "Add constraint",
  },
  {
    field: "events",
    title: "Events",
    empty: "No events recorded.",
    action: "Add event",
  },
];

const taskStatusLabels: Record<TaskStatus, string> = {
  PLANNED: "Planned",
  READY: "Ready",
  IN_PROGRESS: "In progress",
  BLOCKED: "Blocked",
  IMPLEMENTED: "Implemented",
  VERIFIED: "Verified",
};

const intentFieldLabels: Record<IntentChange["field"], string> = {
  name: "Name",
  summary: "Summary",
  intent: "Purpose",
  requirements: "Requirement",
  rules: "Business rule",
  constraints: "Constraint",
  security: "Security",
  permissions: "Permission",
  events: "Event",
};

function HierarchyPanel({
  node,
  project,
  onSelect,
  onEnter,
  onAddChild,
}: {
  node: ArchitectureNode;
  project: ArchitectureProject;
  onSelect: (id: string) => void;
  onEnter: (id: string) => void;
  onAddChild: () => void;
}) {
  const parent = node.parentId ? project.nodes[node.parentId] : null;
  const children = childrenOf(project, node.id);
  const path = ancestorsOf(project, node.id);
  return (
    <section>
      <h3>
        Structure <span>{children.length}</span>
      </h3>
      <div className="inspector-path">
        <button type="button" onClick={() => onEnter("")}>
          {project.name}
        </button>
        {path.map((ancestor) => (
          <span key={ancestor.id}>
            <ChevronRight size={11} aria-hidden="true" />
            <button type="button" onClick={() => onSelect(ancestor.id)}>
              {ancestor.name}
            </button>
          </span>
        ))}
        <span>
          <ChevronRight size={11} aria-hidden="true" />
          <strong>{node.name}</strong>
        </span>
      </div>
      {parent && (
        <p>
          Part of{" "}
          <button
            type="button"
            className="inline-link"
            onClick={() => onSelect(parent.id)}
          >
            {parent.name}
          </button>
          .
        </p>
      )}
      {children.length > 0 ? (
        <div className="dependency-list">
          {children.map((child) => {
            const delta = deriveNodeDelta(child);
            return (
              <button key={child.id} onClick={() => onSelect(child.id)}>
                <span>{child.name}</span>
                <small>
                  {kindLabels[child.kind]}
                  {delta ? ` · ${delta.toLowerCase()}` : ""}
                </small>
                <ArrowUpRight size={13} />
              </button>
            );
          })}
        </div>
      ) : (
        <p>Nothing is contained in {node.name} yet.</p>
      )}
      <div className="inspector-actions">
        <Button size="sm" variant="outline" onClick={onAddChild}>
          <Plus data-icon="inline-start" />
          Add inside
        </Button>
        {children.length > 0 && (
          <Button size="sm" variant="ghost" onClick={() => onEnter(node.id)}>
            <CornerDownRight data-icon="inline-start" />
            Enter {node.name}
          </Button>
        )}
      </div>
    </section>
  );
}

function ImplementationStatePanel({
  node,
  project,
}: {
  node: ArchitectureNode;
  project: ArchitectureProject;
}) {
  const dispatch = useWorkspace((s) => s.dispatch);
  const delta = deriveNodeDelta(node);
  const tasks = tasksForNode(project, node.id);
  function setIntended(intended: boolean) {
    try {
      dispatch(
        { type: "update_node", nodeId: node.id, changes: { intended } },
        {
          title: intended
            ? `${node.name} is part of the intended architecture`
            : `${node.name} removed from the intended architecture`,
        },
      );
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }
  function setObserved(observed: boolean) {
    try {
      dispatch(
        { type: "update_node", nodeId: node.id, changes: { observed } },
        {
          title: observed
            ? `${node.name} marked as observed in the implementation`
            : `${node.name} marked as not observed`,
        },
      );
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }
  return (
    <section className="implementation-state">
      <h3>
        Implementation state
        {delta && <Badge variant="outline">{delta}</Badge>}
      </h3>
      <div className="state-grid">
        <div>
          <span>Intended</span>
          <strong>{node.intended ? "Yes" : "No"}</strong>
          <small>
            {node.intended
              ? "Part of the architecture you want."
              : "Should no longer exist."}
          </small>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setIntended(!node.intended)}
          >
            {node.intended ? "Remove from intent" : "Restore to intent"}
          </Button>
        </div>
        <div>
          <span>Observed</span>
          <strong>{node.observed ? "Yes" : "No"}</strong>
          <small>
            {node.observed
              ? `${node.sourceReferences.length} source reference${node.sourceReferences.length === 1 ? "" : "s"} back this.`
              : "No implementation evidence yet."}
          </small>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setObserved(!node.observed)}
          >
            {node.observed ? "Mark not observed" : "Mark as observed"}
          </Button>
        </div>
      </div>
      {delta === null && (
        <p>Intended architecture and observed implementation are aligned.</p>
      )}
      {node.intentChanges.length > 0 && (
        <>
          <h4>Intended changes not yet observed</h4>
          <ul className="plain-list">
            {node.intentChanges.map((change) => (
              <li key={change.id}>
                <strong>{intentFieldLabels[change.field]}:</strong>{" "}
                {change.value}
              </li>
            ))}
          </ul>
        </>
      )}
      {tasks.length > 0 && (
        <>
          <h4>Implementation tasks</h4>
          <div className="task-list">
            {tasks.map((task) => (
              <div key={task.id} className="task-row">
                <div>
                  <strong>{task.title}</strong>
                  <small>{task.goal}</small>
                </div>
                <select
                  aria-label={`Status for ${task.title}`}
                  value={task.status}
                  onChange={(event) => {
                    try {
                      dispatch(
                        {
                          type: "update_task",
                          taskId: task.id,
                          changes: { status: event.target.value as TaskStatus },
                        },
                        {
                          title: `${task.title}: ${taskStatusLabels[event.target.value as TaskStatus]}`,
                        },
                      );
                    } catch (error) {
                      toast.error(errorMessage(error));
                    }
                  }}
                >
                  {Object.entries(taskStatusLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

const securitySections: Array<{
  field: NodeListField;
  title: string;
  empty: string;
  action: string;
}> = [
  {
    field: "security",
    title: "Security requirements",
    empty: "No security requirements recorded.",
    action: "Add security requirement",
  },
  {
    field: "permissions",
    title: "Permissions",
    empty: "No permissions recorded.",
    action: "Add permission",
  },
];

const knowledgeSections: Array<{
  field: NodeListField;
  title: string;
  empty: string;
  action: string;
}> = [
  {
    field: "questions",
    title: "Open questions",
    empty: "No open questions recorded.",
    action: "Add open question",
  },
  {
    field: "assumptions",
    title: "Assumptions",
    empty: "No assumptions recorded.",
    action: "Add assumption",
  },
];

function errorMessage(error: unknown) {
  return error instanceof ZodError
    ? error.issues[0].message
    : error instanceof Error
      ? error.message
      : "The architecture could not be updated.";
}

function EditableList({
  node,
  field,
  title,
  empty,
  action,
}: {
  node: ArchitectureNode;
  field: NodeListField;
  title: string;
  empty: string;
  action: string;
}) {
  const dispatch = useWorkspace((s) => s.dispatch);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<number | null>(null);
  const [editValue, setEditValue] = useState("");
  const items = node[field];
  const fieldLabel = title.toLowerCase();

  function run(action: () => void, success: string) {
    try {
      action();
      toast.success(success);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  return (
    <section className="workspace-list-section">
      <h3>
        {title} <span>{items.length}</span>
      </h3>
      {items.length ? (
        <ul className="editable-list">
          {items.map((item, index) => (
            <li key={`${index}-${item}`}>
              {editing === index ? (
                <form
                  className="editable-list-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    run(
                      () =>
                        dispatch(
                          {
                            type: "update_node_item",
                            nodeId: node.id,
                            field,
                            index,
                            value: editValue.trim(),
                          },
                          { title: `Updated ${fieldLabel} for ${node.name}` },
                        ),
                      `${title} updated.`,
                    );
                    setEditing(null);
                  }}
                >
                  <Textarea
                    aria-label={`Edit ${fieldLabel}`}
                    rows={2}
                    maxLength={2000}
                    value={editValue}
                    onChange={(event) => setEditValue(event.target.value)}
                  />
                  <div className="editable-list-actions">
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => setEditing(null)}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="submit"
                      size="sm"
                      disabled={!editValue.trim()}
                    >
                      Save
                    </Button>
                  </div>
                </form>
              ) : (
                <>
                  <Check size={13} />
                  <span>{item}</span>
                  <Button
                    type="button"
                    size="icon-xs"
                    variant="ghost"
                    aria-label={`Edit ${fieldLabel}: ${item}`}
                    onClick={() => {
                      setEditing(index);
                      setEditValue(item);
                    }}
                  >
                    <Pencil />
                  </Button>
                  <Button
                    type="button"
                    size="icon-xs"
                    variant="ghost"
                    aria-label={`Delete ${fieldLabel}: ${item}`}
                    onClick={() =>
                      run(
                        () =>
                          dispatch(
                            {
                              type: "delete_node_item",
                              nodeId: node.id,
                              field,
                              index,
                            },
                            {
                              title: `Removed ${fieldLabel} from ${node.name}`,
                            },
                          ),
                        `${title} removed.`,
                      )
                    }
                  >
                    <Trash2 />
                  </Button>
                </>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p>{empty}</p>
      )}
      <form
        className="editable-list-form"
        onSubmit={(event) => {
          event.preventDefault();
          run(
            () =>
              dispatch(
                {
                  type: "add_node_item",
                  nodeId: node.id,
                  field,
                  value: draft.trim(),
                },
                { title: `Added ${fieldLabel} to ${node.name}` },
              ),
            `${title} added.`,
          );
          setDraft("");
        }}
      >
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor={`${node.id}-${field}`}>{action}</FieldLabel>
            <Textarea
              id={`${node.id}-${field}`}
              rows={2}
              maxLength={2000}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
            />
          </Field>
        </FieldGroup>
        <Button
          type="submit"
          size="sm"
          variant="outline"
          disabled={!draft.trim()}
        >
          <Plus data-icon="inline-start" />
          {action}
        </Button>
      </form>
    </section>
  );
}

function PurposeEditor({ node }: { node: ArchitectureNode }) {
  const dispatch = useWorkspace((s) => s.dispatch);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(node.intent);
  if (!editing)
    return (
      <section>
        <h3>Purpose</h3>
        <p>{node.intent || "No purpose recorded."}</p>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setValue(node.intent);
            setEditing(true);
          }}
        >
          <Pencil data-icon="inline-start" />
          Edit purpose
        </Button>
      </section>
    );
  return (
    <section>
      <form
        className="editable-list-form"
        onSubmit={(event) => {
          event.preventDefault();
          try {
            dispatch(
              {
                type: "update_node",
                nodeId: node.id,
                changes: { intent: value.trim(), provenance: "defined" },
              },
              { title: `Updated purpose for ${node.name}` },
            );
            setEditing(false);
            toast.success("Purpose updated.");
          } catch (error) {
            toast.error(errorMessage(error));
          }
        }}
      >
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor={`${node.id}-purpose`}>Purpose</FieldLabel>
            <Textarea
              id={`${node.id}-purpose`}
              rows={4}
              maxLength={10000}
              value={value}
              onChange={(event) => setValue(event.target.value)}
            />
          </Field>
        </FieldGroup>
        <div className="editable-list-actions">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setEditing(false)}
          >
            Cancel
          </Button>
          <Button type="submit" size="sm">
            Save purpose
          </Button>
        </div>
      </form>
    </section>
  );
}

function SourceReferences({ node }: { node: ArchitectureNode }) {
  const dispatch = useWorkspace((s) => s.dispatch);
  const projectSource = useWorkspace((s) => s.project?.source);
  const [path, setPath] = useState("");
  const [symbol, setSymbol] = useState("");
  return (
    <section>
      <h3>
        <FileCode2 size={15} />
        Source references <span>{node.sourceReferences.length}</span>
      </h3>
      <p>
        {node.sourceReferences.length
          ? projectSource === "repository"
            ? "Lightweight references from the repository scan. Structor keeps paths and symbols, never source contents."
            : "Recorded references. They are not verified against a repository."
          : "No source references recorded."}
      </p>
      <div className="source-list">
        {node.sourceReferences.map((reference, index) => (
          <div key={`${reference.path}-${index}`}>
            <FileCode2 size={15} />
            <code>
              {reference.path}
              {reference.symbol ? `#${reference.symbol}` : ""}
              {reference.startLine
                ? `:${reference.startLine}${reference.endLine ? `-${reference.endLine}` : ""}`
                : ""}
            </code>
            <Badge variant="outline">
              {provenanceLabels[reference.provenance]}
            </Badge>
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label={`Remove source reference ${reference.path}`}
              onClick={() => {
                try {
                  dispatch(
                    {
                      type: "delete_source_reference",
                      nodeId: node.id,
                      index,
                    },
                    { title: `Removed source reference from ${node.name}` },
                  );
                  toast.success("Source reference removed.");
                } catch (error) {
                  toast.error(errorMessage(error));
                }
              }}
            >
              <Trash2 />
            </Button>
          </div>
        ))}
      </div>
      <form
        className="editable-list-form"
        onSubmit={(event) => {
          event.preventDefault();
          try {
            dispatch(
              {
                type: "attach_source_reference",
                nodeId: node.id,
                reference: {
                  path: path.trim(),
                  symbol: symbol.trim() || undefined,
                  provenance: "defined",
                },
              },
              { title: `Attached source reference to ${node.name}` },
            );
            setPath("");
            setSymbol("");
            toast.success("Source reference attached.");
          } catch (error) {
            toast.error(errorMessage(error));
          }
        }}
      >
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor={`${node.id}-reference-path`}>
              File path
            </FieldLabel>
            <Input
              id={`${node.id}-reference-path`}
              maxLength={500}
              value={path}
              onChange={(event) => setPath(event.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor={`${node.id}-reference-symbol`}>
              Symbol (optional)
            </FieldLabel>
            <Input
              id={`${node.id}-reference-symbol`}
              maxLength={300}
              value={symbol}
              onChange={(event) => setSymbol(event.target.value)}
            />
          </Field>
        </FieldGroup>
        <Button
          type="submit"
          size="sm"
          variant="outline"
          disabled={!path.trim()}
        >
          <Plus data-icon="inline-start" />
          Attach reference
        </Button>
      </form>
    </section>
  );
}

function NodeAgentPanel({
  node,
  project,
}: {
  node: ArchitectureNode;
  project: ArchitectureProject;
}) {
  const storedConversation = useWorkspace(
    (s) => s.conversations[`node:${node.id}`],
  );
  const conversation = storedConversation ?? [];
  const sendAgentMessage = useWorkspace((s) => s.sendAgentMessage);
  const [prompt, setPrompt] = useState("");
  const context = buildAgentContext(project, { type: "node", nodeId: node.id });
  return (
    <section className="node-agent">
      <h3>
        <Sparkles size={15} />
        Structor AI
      </h3>
      <p>
        Scoped to {node.name}: {context.relationships.length} relationships,{" "}
        {context.neighbors.length} connected systems, and{" "}
        {context.findings.length} review findings are already in context.
      </p>
      <div className="node-agent-thread" aria-live="polite">
        {conversation.length ? (
          conversation.map((message) => (
            <div
              key={message.id}
              className={cn("node-agent-message", `node-agent-${message.role}`)}
            >
              <span>{message.role === "user" ? "You" : "Structor"}</span>
              <p>{message.content}</p>
            </div>
          ))
        ) : (
          <p className="node-agent-empty">
            Ask about this component, or say “add requirement …”, “set purpose
            to …”, or “create feature …”.
          </p>
        )}
      </div>
      <form
        className="editable-list-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!prompt.trim()) return;
          try {
            sendAgentMessage({ type: "node", nodeId: node.id }, prompt);
            setPrompt("");
          } catch (error) {
            toast.error(errorMessage(error));
          }
        }}
      >
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor={`${node.id}-agent-prompt`}>
              Ask Structor about {node.name}
            </FieldLabel>
            <Textarea
              id={`${node.id}-agent-prompt`}
              rows={2}
              maxLength={4000}
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
            />
          </Field>
        </FieldGroup>
        <Button type="submit" size="sm" disabled={!prompt.trim()}>
          <Sparkles data-icon="inline-start" />
          Send
        </Button>
      </form>
    </section>
  );
}

export function NodeInspector({
  node,
  project,
  initialTab = "overview",
  onClose,
  onFocus,
  onSelect,
  onEdit,
  onEnter,
  onAddChild,
}: {
  node: ArchitectureNode;
  project: ArchitectureProject;
  initialTab?: "overview" | "security" | "knowledge" | "implementation" | "ai";
  onClose: () => void;
  onFocus: () => void;
  onSelect: (id: string) => void;
  onEdit: () => void;
  onEnter: (id: string | null) => void;
  onAddChild: (parentId: string) => void;
}) {
  const propose = useWorkspace((s) => s.propose);
  const [rule, setRule] = useState("");
  const related = project.edges.filter(
    (edge) => edge.source === node.id || edge.target === node.id,
  );
  const findings = reviewArchitectureNode(project, node.id);
  return (
    <aside className="node-inspector" aria-label={`${node.name} workspace`}>
      <header className="inspector-top">
        <span className="eyebrow">NODE WORKSPACE</span>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Close node workspace"
          onClick={onClose}
        >
          <X />
        </Button>
      </header>
      <div className="inspector-title">
        <span className="node-icon">
          <Layers size={22} />
        </span>
        <div>
          <div className="inspector-badges">
            <Badge variant="secondary">{node.kind}</Badge>
            <Badge variant="outline">{provenanceLabels[node.provenance]}</Badge>
          </div>
          <h2>{node.name}</h2>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Edit ${node.name}`}
          onClick={onEdit}
        >
          <Pencil />
        </Button>
      </div>
      <p className="inspector-description">{node.summary}</p>
      <Tabs defaultValue={initialTab} className="inspector-tabs">
        <TabsList variant="line" className="w-full">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="security">Security</TabsTrigger>
          <TabsTrigger value="knowledge">Knowledge</TabsTrigger>
          <TabsTrigger value="implementation">Code</TabsTrigger>
          <TabsTrigger value="ai">AI</TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="inspector-content">
          <PurposeEditor node={node} />
          <HierarchyPanel
            node={node}
            project={project}
            onSelect={onSelect}
            onEnter={(id) => onEnter(id === "" ? null : id)}
            onAddChild={() => onAddChild(node.id)}
          />
          {listSections.map((section) => (
            <EditableList key={section.field} node={node} {...section} />
          ))}
          <section>
            <h3>
              Connected components <span>{related.length}</span>
            </h3>
            {related.length ? (
              <div className="dependency-list">
                {related.map((edge) => {
                  const outgoing = edge.source === node.id;
                  const id = outgoing ? edge.target : edge.source;
                  return (
                    <button key={edge.id} onClick={() => onSelect(id)}>
                      <span>{project.nodes[id].name}</span>
                      <small>
                        {outgoing ? "→" : "←"}{" "}
                        {edge.relation.replaceAll("_", " ")}
                      </small>
                      <ArrowUpRight size={13} />
                    </button>
                  );
                })}
              </div>
            ) : (
              <p>
                No relationships recorded. Drag ports on the canvas to connect
                systems.
              </p>
            )}
          </section>
        </TabsContent>
        <TabsContent value="security" className="inspector-content">
          <section>
            <h3>
              <ShieldCheck size={14} />
              Trust boundary
            </h3>
            <p>
              Security and permission decisions are canonical architecture, so
              edits here are visible to the canvas, exports, and Structor AI.
            </p>
          </section>
          {securitySections.map((section) => (
            <EditableList key={section.field} node={node} {...section} />
          ))}
        </TabsContent>
        <TabsContent value="knowledge" className="inspector-content">
          <section className={findings.length ? "questions-box" : undefined}>
            <h3>
              <CircleHelp size={15} />
              Review findings <span>{findings.length}</span>
            </h3>
            {findings.length ? (
              <ul className="plain-list">
                {findings.map((finding) => (
                  <li key={finding.id}>
                    <strong>{finding.title}.</strong> {finding.detail}
                  </li>
                ))}
              </ul>
            ) : (
              <p>No unresolved review findings for this component.</p>
            )}
          </section>
          {knowledgeSections.map((section) => (
            <EditableList key={section.field} node={node} {...section} />
          ))}
        </TabsContent>
        <TabsContent value="implementation" className="inspector-content">
          <ImplementationStatePanel node={node} project={project} />
          <SourceReferences node={node} />
          <EditableList
            node={node}
            field="implementation"
            title="Implementation references"
            empty="No implementation references recorded."
            action="Add implementation reference"
          />
        </TabsContent>
        <TabsContent value="ai" className="inspector-content">
          <NodeAgentPanel node={node} project={project} />
        </TabsContent>
      </Tabs>
      <div className="inspector-bottom">
        <Button variant="ghost" size="sm" onClick={onFocus}>
          Focus on this component
          <ArrowUpRight data-icon="inline-end" />
        </Button>
        <Separator />
        <form
          onSubmit={(event) => {
            event.preventDefault();
            try {
              propose(node.id, rule);
              setRule("");
            } catch (error) {
              toast.error(errorMessage(error));
            }
          }}
        >
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="node-rule">
                Propose a business rule
              </FieldLabel>
              <Textarea
                id="node-rule"
                required
                maxLength={2000}
                rows={2}
                value={rule}
                onChange={(event) => setRule(event.target.value)}
              />
            </Field>
          </FieldGroup>
          <Button
            type="submit"
            size="sm"
            variant="outline"
            disabled={!rule.trim()}
          >
            Review rule
            <ArrowUpRight data-icon="inline-end" />
          </Button>
        </form>
      </div>
    </aside>
  );
}
