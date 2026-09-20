"use client";

import { useEffect, useRef, useState } from "react";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

import {
  ArrowLeft,
  ArrowRight,
  FileJson,
  FolderUp,
  LoaderCircle,
  Sparkles,
} from "lucide-react";

import { Brand } from "@/components/brand";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { RepositoryImport } from "@/components/workspace/repository-import";
import { architectureGenerateResponseSchema } from "@/lib/ai/schema";
import {
  projectSchema,
  type ArchitectureProject,
} from "@/lib/architecture/schema";
import { useWorkspace } from "@/lib/architecture/store";

type StartMode = "start" | "repository" | "structor";

function projectNameFromIntent(intent: string) {
  const firstLine =
    intent
      .trim()
      .split(/\n|[.!?]/, 1)[0]
      ?.trim() || "New architecture";
  return firstLine.length <= 80
    ? firstLine
    : `${firstLine.slice(0, 77).trimEnd()}…`;
}

export function StartProject() {
  const router = useRouter();
  const params = useSearchParams();
  const modeParam = params.get("mode");
  const mode: StartMode =
    modeParam === "repository" || modeParam === "import"
      ? "repository"
      : modeParam === "structor"
        ? "structor"
        : "start";
  const previousMode = useRef(mode);
  const generateAbort = useRef<AbortController | null>(null);
  const [intent, setIntent] = useState("");
  const [error, setError] = useState("");
  const [imported, setImported] = useState<ArchitectureProject | null>(null);
  const [reading, setReading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const hasProject = useWorkspace((state) => state.project !== null);
  const setProject = useWorkspace((state) => state.setProject);

  useEffect(() => {
    if (previousMode.current === mode) return;
    previousMode.current = mode;
    setError("");
    setImported(null);
  }, [mode]);

  useEffect(() => {
    return () => {
      generateAbort.current?.abort();
    };
  }, []);

  function openProject(project: ArchitectureProject) {
    try {
      setProject(project);
      router.push("/workspace");
    } catch (projectError) {
      setError(
        projectError instanceof Error
          ? projectError.message
          : "The architecture could not be opened.",
      );
    }
  }

  function createBlankProject(description: string): ArchitectureProject {
    return {
      id: crypto.randomUUID(),
      name: projectNameFromIntent(description),
      description,
      version: 1,
      source: "local",
      nodes: {},
      edges: [],
      decisions: [],
      history: [
        {
          version: 1,
          title: "Project created",
          date: new Date().toISOString(),
        },
      ],
    };
  }

  async function generateArchitecture() {
    const description = intent.trim();
    setError("");
    if (!description) {
      setError("Describe what you want to build.");
      return;
    }
    generateAbort.current?.abort();
    const controller = new AbortController();
    generateAbort.current = controller;
    setGenerating(true);
    try {
      const response = await fetch("/api/architecture/generate", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ description }),
        signal: controller.signal,
      });
      let json: unknown;
      try {
        json = await response.json();
      } catch {
        setError("The architecture could not be generated. Try again.");
        return;
      }
      const parsed = architectureGenerateResponseSchema.safeParse(json);
      if (!parsed.success) {
        setError("The architecture response was incomplete. Try again.");
        return;
      }
      if (!parsed.data.ok) {
        setError(parsed.data.error.message);
        return;
      }
      const project = projectSchema.safeParse(parsed.data.project);
      if (!project.success) {
        setError("The generated architecture could not be opened.");
        return;
      }
      openProject(project.data);
    } catch (generateError) {
      if (
        generateError instanceof DOMException &&
        generateError.name === "AbortError"
      )
        return;
      setError("The architecture could not be generated. Try again.");
    } finally {
      if (generateAbort.current === controller) {
        generateAbort.current = null;
        setGenerating(false);
      }
    }
  }

  function changeMode(nextMode: StartMode) {
    setError("");
    setImported(null);
    if (nextMode === "repository") {
      router.push("/start?mode=repository");
      return;
    }
    if (nextMode === "structor") {
      router.push("/start?mode=structor");
      return;
    }
    router.replace("/start");
  }

  return (
    <div className="start-page">
      <header className="start-header container">
        <Brand />
        <Button variant="ghost" asChild>
          <Link href={hasProject ? "/workspace" : "/"}>
            <ArrowLeft data-icon="inline-start" />
            {hasProject ? "Workspace" : "Back home"}
          </Link>
        </Button>
      </header>

      <main id="main-content" className="start-main">
        <section className="start-surface">
          {mode === "start" ? (
            <>
              <div className="start-heading">
                <h1>What do you want to structure?</h1>
              </div>
              <form
                className="start-intent-form"
                aria-busy={generating}
                onSubmit={(event) => {
                  event.preventDefault();
                  if (generating) return;
                  const description = intent.trim();
                  setError("");
                  if (!description) {
                    setError("Describe what you want to build.");
                    return;
                  }
                  openProject(createBlankProject(description));
                }}
              >
                <Field data-invalid={Boolean(error)} data-disabled={generating}>
                  <FieldLabel className="sr-only" htmlFor="project-intent">
                    Project description
                  </FieldLabel>
                  <Textarea
                    id="project-intent"
                    required
                    rows={6}
                    maxLength={10000}
                    placeholder="Describe what you want to build…"
                    aria-invalid={Boolean(error)}
                    disabled={generating}
                    value={intent}
                    onChange={(event) => setIntent(event.target.value)}
                  />
                  <FieldDescription>
                    Continue opens a blank canvas. Generate architecture drafts
                    components from your description.
                  </FieldDescription>
                </Field>
                {error && (
                  <p className="form-error" role="alert">
                    {error}
                  </p>
                )}
                {generating && (
                  <div
                    className="start-intent-generating"
                    role="status"
                    aria-live="polite"
                  >
                    <LoaderCircle aria-hidden="true" />
                    <div>
                      <strong>Drafting architecture</strong>
                      <span>
                        Structor is proposing components, relationships, and
                        open questions.
                      </span>
                    </div>
                  </div>
                )}
                <div className="start-intent-submit">
                  <Button
                    type="button"
                    variant="outline"
                    size="lg"
                    disabled={generating}
                    onClick={() => {
                      void generateArchitecture();
                    }}
                  >
                    <Sparkles data-icon="inline-start" />
                    Generate architecture
                  </Button>
                  <Button type="submit" size="lg" disabled={generating}>
                    Continue
                    <ArrowRight data-icon="inline-end" />
                  </Button>
                </div>
              </form>

              <div className="start-existing">
                <p className="start-existing-label">
                  Start from an existing project
                </p>
                <div className="start-existing-primary">
                  <div>
                    <strong>Import repository</strong>
                    <p>
                      Upload a repository ZIP and Structor will build an
                      architecture draft.
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => changeMode("repository")}
                  >
                    <FolderUp data-icon="inline-start" />
                    Import repository
                  </Button>
                </div>
                <button
                  className="start-structor-link"
                  type="button"
                  onClick={() => changeMode("structor")}
                >
                  <FileJson aria-hidden="true" />
                  Import a Structor file
                </button>
              </div>
            </>
          ) : (
            <>
              <button
                type="button"
                className="start-back"
                onClick={() => changeMode("start")}
              >
                <ArrowLeft aria-hidden="true" />
                Back
              </button>
              <div className="start-heading start-heading-mode">
                <h1>
                  {mode === "repository"
                    ? "Import repository"
                    : "Import a Structor file"}
                </h1>
                <p>
                  {mode === "repository"
                    ? "Upload a repository ZIP. Structor detects system boundaries and source references."
                    : "Open a Structor JSON export as a separate project."}
                </p>
              </div>

              {mode === "repository" ? (
                <RepositoryImport onOpen={openProject} />
              ) : (
                <div className="structor-import">
                  <FieldGroup>
                    <Field data-invalid={Boolean(error)}>
                      <FieldLabel htmlFor="architecture-file">
                        Structor file
                      </FieldLabel>
                      <Input
                        id="architecture-file"
                        type="file"
                        accept=".json,application/json"
                        aria-invalid={Boolean(error)}
                        aria-describedby="structor-import-help"
                        disabled={reading}
                        onChange={async (event) => {
                          const file = event.target.files?.[0];
                          setError("");
                          setImported(null);
                          if (!file) return;
                          if (file.size > 2 * 1024 * 1024) {
                            setError(
                              "Choose a Structor file smaller than 2 MB.",
                            );
                            return;
                          }
                          setReading(true);
                          try {
                            const json: unknown = JSON.parse(await file.text());
                            const result = projectSchema.safeParse(json);
                            if (!result.success) {
                              setError(
                                "This is not a valid Structor architecture file.",
                              );
                              return;
                            }
                            setImported(result.data);
                          } catch {
                            setError("Choose a valid Structor JSON export.");
                          } finally {
                            setReading(false);
                          }
                        }}
                      />
                      <FieldDescription id="structor-import-help">
                        JSON only · 2 MB max
                      </FieldDescription>
                    </Field>
                  </FieldGroup>
                  {reading && <p role="status">Validating Structor file…</p>}
                  {error && (
                    <p className="form-error" role="alert">
                      {error}
                    </p>
                  )}
                  {imported && (
                    <Alert>
                      <FileJson />
                      <AlertTitle>{imported.name}</AlertTitle>
                      <AlertDescription>
                        {Object.keys(imported.nodes).length} components ·{" "}
                        {imported.edges.length} relationships
                      </AlertDescription>
                    </Alert>
                  )}
                  <Button
                    type="button"
                    size="lg"
                    disabled={!imported || reading}
                    onClick={() => {
                      if (imported) {
                        openProject({ ...imported, id: crypto.randomUUID() });
                      }
                    }}
                  >
                    Open architecture
                    <ArrowRight data-icon="inline-end" />
                  </Button>
                </div>
              )}
            </>
          )}
        </section>
      </main>
    </div>
  );
}
