"use client";

import { useState } from "react";

import { toast } from "sonner";
import { ZodError } from "zod";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  canvasBoundarySchema,
  edgeSchema,
  subtreeOf,
  type ArchitectureNode,
  type ArchitectureProject,
  type CanvasBoundary,
} from "@/lib/architecture/schema";
import { useWorkspace } from "@/lib/architecture/store";

function message(error: unknown) {
  return error instanceof ZodError
    ? error.issues[0].message
    : error instanceof Error
      ? error.message
      : "Your changes could not be saved.";
}
const listFields = [
  ["requirements", "Requirements"],
  ["rules", "Business rules"],
  ["constraints", "Constraints"],
  ["security", "Security requirements"],
  ["permissions", "Permissions"],
  ["events", "Events"],
  ["questions", "Open questions"],
  ["assumptions", "Assumptions"],
  ["implementation", "Implementation references"],
] as const;

export const nodeKinds: Array<[ArchitectureNode["kind"], string]> = [
  ["domain", "Domain"],
  ["application", "Application"],
  ["feature", "Feature"],
  ["capability", "Capability"],
  ["service", "Service"],
  ["page", "Page"],
  ["flow", "User flow"],
  ["data", "Data model"],
  ["api", "API"],
  ["actor", "Actor"],
  ["event", "Event"],
  ["integration", "Integration"],
  ["infrastructure", "Infrastructure"],
  ["security", "Security boundary"],
  ["custom", "Custom concept"],
];

export function ComponentEditor({
  node,
  kind = "service",
  parentId,
  confirmDelete: initialConfirmDelete = false,
  onClose,
  onSaved,
}: {
  node?: ArchitectureNode;
  kind?: ArchitectureNode["kind"];
  parentId?: string | null;
  confirmDelete?: boolean;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const [name, setName] = useState(node?.name ?? "");
  const [summary, setSummary] = useState(node?.summary ?? "");
  const [intent, setIntent] = useState(node?.intent ?? "");
  const [type, setType] = useState<ArchitectureNode["kind"]>(
    node?.kind ?? kind,
  );
  const [lists, setLists] = useState(
    () =>
      Object.fromEntries(
        listFields.map(([key]) => [key, node?.[key].join("\n") ?? ""]),
      ) as Record<(typeof listFields)[number][0], string>,
  );
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(
    Boolean(node) && initialConfirmDelete,
  );
  const saveNode = useWorkspace((s) => s.saveNode);
  const removeNode = useWorkspace((s) => s.removeNode);
  const projectSource = useWorkspace((s) => s.project?.source);
  const edgeCount = useWorkspace(
    (s) =>
      s.project?.edges.filter(
        (edge) => edge.source === node?.id || edge.target === node?.id,
      ).length ?? 0,
  );
  const childCount = useWorkspace((s) =>
    s.project && node ? subtreeOf(s.project, node.id).length : 0,
  );
  const parentName = useWorkspace((s) => {
    const id = node?.parentId ?? parentId;
    return id && s.project ? s.project.nodes[id]?.name : undefined;
  });
  const split = (value: string) => [
    ...new Set(
      value
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean),
    ),
  ];
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="editor-dialog">
        <DialogHeader>
          <DialogTitle>
            {confirmDelete
              ? `Remove ${node?.name}?`
              : node
                ? "Edit component"
                : parentName
                  ? `Add component inside ${parentName}`
                  : "Add component"}
          </DialogTitle>
          <DialogDescription>
            {confirmDelete
              ? `This removes the component, ${childCount} contained component${childCount === 1 ? "" : "s"}, and ${edgeCount} relationships. This cannot be undone.`
              : parentName
                ? `The new component becomes part of ${parentName}. It is intended architecture until implementation evidence is observed.`
                : "Record what you know. Optional fields stay empty until you define them."}
          </DialogDescription>
        </DialogHeader>
        {confirmDelete ? (
          <div className="flex flex-col gap-4">
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setConfirmDelete(false)}>
                Keep component
              </Button>
              <Button
                variant="destructive"
                onClick={() => {
                  try {
                    if (node) removeNode(node.id);
                    onClose();
                    toast.success("Component removed.");
                  } catch (e) {
                    setError(message(e));
                  }
                }}
              >
                Remove component
              </Button>
            </div>
          </div>
        ) : (
          <form
            className="editor-form"
            onSubmit={(event) => {
              event.preventDefault();
              setError("");
              try {
                const id = node?.id ?? crypto.randomUUID();
                const resolvedParent = node?.parentId ?? parentId ?? undefined;
                saveNode({
                  id,
                  ...(resolvedParent ? { parentId: resolvedParent } : {}),
                  name: name.trim(),
                  kind: type,
                  summary: summary.trim(),
                  intent: intent.trim(),
                  provenance: node?.provenance ?? "defined",
                  intended: node?.intended ?? true,
                  observed: node?.observed ?? false,
                  intentChanges: node?.intentChanges ?? [],
                  requirements: split(lists.requirements),
                  rules: split(lists.rules),
                  constraints: split(lists.constraints),
                  security: split(lists.security),
                  permissions: split(lists.permissions),
                  events: split(lists.events),
                  questions: split(lists.questions),
                  assumptions: split(lists.assumptions),
                  implementation: split(lists.implementation),
                  sourceReferences: node?.sourceReferences ?? [],
                });
                onSaved(id);
                onClose();
                toast.success(node ? "Component updated." : "Component added.");
              } catch (e) {
                setError(message(e));
              }
            }}
          >
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="component-name">Name</FieldLabel>
                <Input
                  id="component-name"
                  required
                  maxLength={80}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="component-kind">Component type</FieldLabel>
                <Select
                  value={type}
                  onValueChange={(value) =>
                    setType(value as ArchitectureNode["kind"])
                  }
                >
                  <SelectTrigger id="component-kind">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {nodeKinds.map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel htmlFor="component-summary">Summary</FieldLabel>
                <Textarea
                  id="component-summary"
                  required
                  rows={2}
                  maxLength={2000}
                  value={summary}
                  onChange={(e) => setSummary(e.target.value)}
                />
                <FieldDescription>
                  A concise description shown on the architecture canvas.
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="component-purpose">Purpose</FieldLabel>
                <Textarea
                  id="component-purpose"
                  rows={3}
                  maxLength={10000}
                  value={intent}
                  onChange={(e) => setIntent(e.target.value)}
                />
              </Field>
              {listFields.map(([key, label]) => (
                <Field key={key}>
                  <FieldLabel htmlFor={`component-${key}`}>{label}</FieldLabel>
                  <Textarea
                    id={`component-${key}`}
                    rows={3}
                    maxLength={20000}
                    value={lists[key]}
                    onChange={(e) =>
                      setLists({ ...lists, [key]: e.target.value })
                    }
                  />
                  <FieldDescription>
                    {key === "implementation"
                      ? projectSource === "repository"
                        ? "One file path per line. Imported paths came from the repository scan; later edits are manual."
                        : "One file path or reference per line. References are user-authored and not verified against a repository."
                      : "One entry per line. Leave blank if not yet defined."}
                  </FieldDescription>
                </Field>
              ))}
            </FieldGroup>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <div className="editor-actions">
              {node && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setError("");
                    setConfirmDelete(true);
                  }}
                >
                  Remove component
                </Button>
              )}
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit">Save component</Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function RelationshipEditor({
  project,
  edge,
  source: initialSource,
  target: initialTarget,
  relation: initialRelation,
  onClose,
}: {
  project: ArchitectureProject;
  edge?: ArchitectureProject["edges"][number];
  source?: string;
  target?: string;
  relation?: ArchitectureProject["edges"][number]["relation"];
  onClose: () => void;
}) {
  const [source, setSource] = useState(edge?.source ?? initialSource ?? "");
  const [target, setTarget] = useState(edge?.target ?? initialTarget ?? "");
  const [relation, setRelation] = useState<
    ArchitectureProject["edges"][number]["relation"]
  >(edge?.relation ?? initialRelation ?? "depends_on");
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const save = useWorkspace((s) => s.saveRelationship);
  const remove = useWorkspace((s) => s.removeRelationship);
  const nodes = Object.values(project.nodes);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {confirmDelete
              ? "Remove relationship?"
              : edge
                ? "Edit relationship"
                : initialRelation === "calls"
                  ? "Add flow"
                  : "Add relationship"}
          </DialogTitle>
          <DialogDescription>
            {confirmDelete
              ? "Only this connection will be removed. Both components will be kept."
              : initialRelation === "calls"
                ? "Choose how work moves from one product capability to another."
                : "Choose the direction and meaning of this connection."}
          </DialogDescription>
        </DialogHeader>
        <form
          className="editor-form"
          onSubmit={(event) => {
            event.preventDefault();
            setError("");
            try {
              if (confirmDelete && edge) remove(edge.id);
              else {
                if (!source || !target) {
                  setError("Select both components.");
                  return;
                }
                save({
                  id: edge?.id ?? crypto.randomUUID(),
                  source,
                  target,
                  relation,
                });
              }
              onClose();
              toast.success(
                confirmDelete ? "Relationship removed." : "Relationship saved.",
              );
            } catch (e) {
              setError(message(e));
            }
          }}
        >
          {!confirmDelete && (
            <FieldGroup>
              {(
                [
                  ["source", "From component", source, setSource],
                  ["target", "To component", target, setTarget],
                ] as const
              ).map(([id, label, value, change]) => (
                <Field key={id} data-invalid={Boolean(error) && !value}>
                  <FieldLabel htmlFor={id}>{label}</FieldLabel>
                  <Select value={value} onValueChange={change} required>
                    <SelectTrigger
                      id={id}
                      aria-invalid={Boolean(error) && !value}
                    >
                      <SelectValue placeholder="Select a component" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {nodes.map((node) => (
                          <SelectItem key={node.id} value={node.id}>
                            {node.name}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>
              ))}
              <Field>
                <FieldLabel htmlFor="relationship-type">
                  Relationship
                </FieldLabel>
                <Select
                  value={relation}
                  onValueChange={(value) =>
                    setRelation(value as typeof relation)
                  }
                >
                  <SelectTrigger id="relationship-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {edgeSchema.shape.relation.options.map((value) => (
                        <SelectItem key={value} value={value}>
                          {value.replaceAll("_", " ")}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
            </FieldGroup>
          )}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="editor-actions">
            {edge && !confirmDelete && (
              <Button
                type="button"
                variant="ghost"
                onClick={() => setConfirmDelete(true)}
              >
                Remove relationship
              </Button>
            )}
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant={confirmDelete ? "destructive" : "default"}
            >
              {confirmDelete
                ? "Confirm removal"
                : initialRelation === "calls"
                  ? "Save flow"
                  : "Save relationship"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function BoundaryEditor({
  boundary,
  onClose,
  onSave,
}: {
  boundary: CanvasBoundary;
  onClose: () => void;
  onSave: (boundary: CanvasBoundary) => void;
}) {
  const [label, setLabel] = useState(boundary.label);
  const [description, setDescription] = useState(boundary.description);
  const [error, setError] = useState("");
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Name this boundary</DialogTitle>
          <DialogDescription>
            Boundaries group systems on the canvas. They shape the view, not the
            canonical architecture.
          </DialogDescription>
        </DialogHeader>
        <form
          className="editor-form"
          onSubmit={(event) => {
            event.preventDefault();
            setError("");
            try {
              onSave(
                canvasBoundarySchema.parse({
                  ...boundary,
                  label: label.trim(),
                  description: description.trim(),
                }),
              );
              toast.success("Boundary updated.");
            } catch (e) {
              setError(message(e));
            }
          }}
        >
          <FieldGroup>
            <Field data-invalid={Boolean(error)}>
              <FieldLabel htmlFor="boundary-label">Label</FieldLabel>
              <Input
                id="boundary-label"
                required
                maxLength={80}
                value={label}
                aria-invalid={Boolean(error)}
                onChange={(event) => setLabel(event.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="boundary-description">
                Description
              </FieldLabel>
              <Input
                id="boundary-description"
                maxLength={200}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </Field>
          </FieldGroup>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="editor-actions">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit">Save boundary</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function DecisionEditor({
  decision,
  onClose,
}: {
  decision?: ArchitectureProject["decisions"][number];
  onClose: () => void;
}) {
  const [title, setTitle] = useState(decision?.title ?? "");
  const [reason, setReason] = useState(decision?.reason ?? "");
  const [alternative, setAlternative] = useState(decision?.alternative ?? "");
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const save = useWorkspace((s) => s.saveDecision);
  const remove = useWorkspace((s) => s.removeDecision);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="editor-dialog">
        <DialogHeader>
          <DialogTitle>
            {confirmDelete
              ? "Remove decision?"
              : decision
                ? "Edit decision"
                : "Record a decision"}
          </DialogTitle>
          <DialogDescription>
            {confirmDelete
              ? "The decision and its reasoning will be removed. This cannot be undone."
              : "Preserve the choice and the reasoning behind it."}
          </DialogDescription>
        </DialogHeader>
        <form
          className="editor-form"
          onSubmit={(event) => {
            event.preventDefault();
            setError("");
            try {
              if (confirmDelete && decision) remove(decision.id);
              else
                save({
                  id: decision?.id ?? crypto.randomUUID(),
                  title: title.trim(),
                  reason: reason.trim(),
                  alternative: alternative.trim(),
                });
              onClose();
              toast.success(
                confirmDelete ? "Decision removed." : "Decision saved.",
              );
            } catch (e) {
              setError(message(e));
            }
          }}
        >
          {!confirmDelete && (
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="decision-title">Decision</FieldLabel>
                <Input
                  id="decision-title"
                  required
                  maxLength={200}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="decision-reason">Reasoning</FieldLabel>
                <Textarea
                  id="decision-reason"
                  required
                  rows={5}
                  maxLength={10000}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="decision-alternative">
                  Alternatives considered
                </FieldLabel>
                <Textarea
                  id="decision-alternative"
                  rows={3}
                  maxLength={10000}
                  value={alternative}
                  onChange={(e) => setAlternative(e.target.value)}
                />
              </Field>
            </FieldGroup>
          )}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="editor-actions">
            {decision && !confirmDelete && (
              <Button
                type="button"
                variant="ghost"
                onClick={() => setConfirmDelete(true)}
              >
                Remove decision
              </Button>
            )}
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant={confirmDelete ? "destructive" : "default"}
            >
              {confirmDelete ? "Confirm removal" : "Save decision"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
