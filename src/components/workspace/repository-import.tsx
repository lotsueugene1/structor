"use client";

import { useEffect, useRef, useState } from "react";

import {
  Archive,
  ArrowRight,
  Check,
  FileArchive,
  LoaderCircle,
  Upload,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  projectSchema,
  type ArchitectureProject,
} from "@/lib/architecture/schema";
import {
  repositoryImportResponseSchema,
  type RepositoryImportSuccess,
} from "@/lib/repository";

const MAX_REPOSITORY_SIZE = 20 * 1024 * 1024;

type ImportStatus = "idle" | "uploading" | "scanning" | "ready";

type RepositoryResult = RepositoryImportSuccess;

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function parseResult(value: unknown): RepositoryResult {
  const response = repositoryImportResponseSchema.safeParse(value);
  if (!response.success) {
    throw new Error("The repository response was incomplete. Try again.");
  }
  if (!response.data.ok) {
    throw new Error(response.data.error.message);
  }

  const parsedProject = projectSchema.safeParse(response.data.project);
  if (!parsedProject.success) {
    throw new Error("The repository did not produce a valid architecture.");
  }
  return { ...response.data, project: parsedProject.data };
}

function validateFile(file: File) {
  if (!file.name.toLowerCase().endsWith(".zip")) {
    return "Choose a repository ZIP file.";
  }
  if (file.size === 0) return "This ZIP file is empty.";
  if (file.size > MAX_REPOSITORY_SIZE) {
    return "Choose a repository ZIP no larger than 20 MB.";
  }
  return "";
}

export function RepositoryImport({
  onOpen,
}: {
  onOpen: (project: ArchitectureProject) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const requestRef = useRef<XMLHttpRequest | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<ImportStatus>("idle");
  const [progress, setProgress] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<RepositoryResult | null>(null);

  const busy = status === "uploading" || status === "scanning";

  useEffect(() => {
    return () => {
      const request = requestRef.current;
      if (!request) return;
      request.onreadystatechange = null;
      request.onload = null;
      request.onerror = null;
      request.onabort = null;
      request.ontimeout = null;
      request.upload.onprogress = null;
      request.upload.onload = null;
      request.abort();
    };
  }, []);

  function chooseFile(nextFile: File | undefined) {
    if (!nextFile) return;
    const validationError = validateFile(nextFile);
    setError(validationError);
    setResult(null);
    setProgress(0);
    setStatus("idle");
    setFile(validationError ? null : nextFile);
    if (validationError && inputRef.current) inputRef.current.value = "";
  }

  function removeFile() {
    setFile(null);
    setResult(null);
    setProgress(0);
    setError("");
    setStatus("idle");
    if (inputRef.current) inputRef.current.value = "";
  }

  function analyze() {
    if (!file || busy) return;

    setError("");
    setResult(null);
    setProgress(0);
    setStatus("uploading");

    const request = new XMLHttpRequest();
    const body = new FormData();
    body.append("repository", file);
    requestRef.current = request;
    request.open("POST", "/api/repositories/import");
    request.timeout = 45_000;

    request.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      setProgress(
        Math.min(100, Math.round((event.loaded / event.total) * 100)),
      );
    };
    request.upload.onload = () => {
      setProgress(100);
      setStatus("scanning");
    };
    request.onerror = () => {
      requestRef.current = null;
      setStatus("idle");
      setError("The upload failed. Check your connection and try again.");
    };
    request.onabort = () => {
      requestRef.current = null;
      setStatus("idle");
      setProgress(0);
    };
    request.ontimeout = () => {
      requestRef.current = null;
      setStatus("idle");
      setError("Repository analysis timed out. Try a smaller ZIP.");
    };
    request.onload = () => {
      requestRef.current = null;
      try {
        let payload: unknown;
        try {
          payload = JSON.parse(request.responseText);
        } catch {
          throw new Error(
            "The server returned an unreadable response. Try again.",
          );
        }
        if (request.status < 200 || request.status >= 300) {
          const apiError = payload as { error?: { message?: unknown } };
          const message = apiError.error?.message;
          throw new Error(
            typeof message === "string" && message.trim()
              ? message
              : "The repository could not be analyzed.",
          );
        }
        const nextResult = parseResult(payload);
        setResult(nextResult);
        setStatus("ready");
      } catch (responseError) {
        setStatus("idle");
        setError(
          responseError instanceof Error
            ? responseError.message
            : "The repository could not be analyzed.",
        );
      }
    };
    request.send(body);
  }

  const areas = result ? Object.values(result.project.nodes) : [];

  return (
    <div className="repository-import" aria-busy={busy}>
      {!file ? (
        <div
          className="repository-dropzone"
          data-dragging={dragging}
          onDragEnter={(event) => {
            event.preventDefault();
            if (!busy) setDragging(true);
          }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={(event) => {
            const relatedTarget = event.relatedTarget;
            if (
              !(relatedTarget instanceof Node) ||
              !event.currentTarget.contains(relatedTarget)
            ) {
              setDragging(false);
            }
          }}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            if (!busy) chooseFile(event.dataTransfer.files[0]);
          }}
        >
          <span className="repository-dropzone-icon" aria-hidden="true">
            <Archive />
          </span>
          <div>
            <p>Drop a repository ZIP here</p>
            <span id="repository-upload-help">ZIP only · 20 MB max</span>
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={() => inputRef.current?.click()}
          >
            <Upload data-icon="inline-start" />
            Choose ZIP
          </Button>
          <input
            ref={inputRef}
            className="sr-only"
            type="file"
            accept=".zip,application/zip,application/x-zip-compressed"
            tabIndex={-1}
            aria-label="Choose repository ZIP"
            aria-describedby="repository-upload-help"
            onChange={(event) => chooseFile(event.target.files?.[0])}
          />
        </div>
      ) : (
        <div className="repository-file">
          <span className="repository-file-icon" aria-hidden="true">
            <FileArchive />
          </span>
          <span className="repository-file-copy">
            <strong>{file.name}</strong>
            <span>{formatBytes(file.size)}</span>
          </span>
          {!busy && status !== "ready" && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Remove ${file.name}`}
              onClick={removeFile}
            >
              <X />
            </Button>
          )}
        </div>
      )}

      <div className="repository-live-region">
        {status === "uploading" && (
          <div className="repository-status">
            <div
              className="repository-status-heading"
              role="status"
              aria-live="polite"
            >
              <span>Uploading repository</span>
              <span aria-hidden="true">{progress}%</span>
            </div>
            <progress
              value={progress}
              max={100}
              aria-label="Repository upload progress"
            />
          </div>
        )}
        {status === "scanning" && (
          <div
            className="repository-status repository-status-scanning"
            role="status"
          >
            <LoaderCircle aria-hidden="true" />
            <div>
              <strong>Scanning repository</strong>
              <span>Reading source files and detecting system boundaries.</span>
            </div>
          </div>
        )}
        {status === "ready" && result && (
          <div className="repository-ready" role="status">
            <div className="repository-ready-heading">
              <span aria-hidden="true">
                <Check />
              </span>
              <div>
                <strong>Architecture draft ready</strong>
                <p>{result.project.name}</p>
              </div>
            </div>
            <dl className="repository-stats">
              <div>
                <dt>Files found</dt>
                <dd>{result.stats.filesDiscovered}</dd>
              </div>
              <div>
                <dt>Analyzed</dt>
                <dd>{result.stats.analyzedFiles}</dd>
              </div>
              <div>
                <dt>Skipped</dt>
                <dd>{result.stats.ignoredFiles}</dd>
              </div>
              <div>
                <dt>Framework</dt>
                <dd>
                  {result.manifest.frameworks.length
                    ? result.manifest.frameworks.join(" + ")
                    : "Not detected"}
                </dd>
              </div>
            </dl>
            {areas.length > 0 && (
              <div className="repository-areas">
                <span>Detected areas</span>
                <ul>
                  {areas.slice(0, 6).map((area) => (
                    <li key={area.id}>{area.name}</li>
                  ))}
                  {areas.length > 6 && <li>+{areas.length - 6} more</li>}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      <div className="repository-actions">
        {busy ? (
          <Button
            type="button"
            variant="outline"
            onClick={() => requestRef.current?.abort()}
          >
            {status === "uploading" ? "Cancel upload" : "Stop waiting"}
          </Button>
        ) : status === "ready" && result ? (
          <Button
            type="button"
            size="lg"
            onClick={() => onOpen(result.project)}
          >
            Open architecture
            <ArrowRight data-icon="inline-end" />
          </Button>
        ) : (
          <Button type="button" size="lg" disabled={!file} onClick={analyze}>
            {error && file ? "Retry analysis" : "Analyze repository"}
            <ArrowRight data-icon="inline-end" />
          </Button>
        )}
      </div>
    </div>
  );
}
