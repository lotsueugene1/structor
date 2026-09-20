"use client";

import {
  architectureGenerateErrorSchema,
  architectureGenerateStreamEventSchema,
} from "@/lib/ai/schema";
import type { ArchitectureProject } from "@/lib/architecture/schema";
import { useWorkspace } from "@/lib/architecture/store";

let activeAbort: AbortController | null = null;

async function readSse(response: Response, onEvent: (value: unknown) => void) {
  if (!response.body)
    throw new Error("The architecture could not be generated. Try again.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      const line = part.split("\n").find((entry) => entry.startsWith("data:"));
      if (!line) continue;
      const json = line.slice(5).trim();
      if (json) onEvent(JSON.parse(json) as unknown);
    }
  }
}

export function startArchitectureDraft(description: string) {
  activeAbort?.abort();
  const controller = new AbortController();
  activeAbort = controller;
  const store = useWorkspace.getState();
  store.beginDraft();

  return new Promise<ArchitectureProject>((resolve, reject) => {
    let opened = false;
    let failed = false;
    void (async () => {
      try {
        const response = await fetch("/api/architecture/generate", {
          method: "POST",
          headers: {
            Accept: "text/event-stream",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ description }),
          signal: controller.signal,
        });
        const contentType = response.headers.get("content-type") ?? "";
        if (!contentType.includes("text/event-stream")) {
          let json: unknown;
          try {
            json = await response.json();
          } catch {
            throw new Error(
              "The architecture could not be generated. Try again.",
            );
          }
          const parsed = architectureGenerateErrorSchema.safeParse(json);
          const message = parsed.success
            ? parsed.data.error.message
            : "The architecture could not be generated. Try again.";
          failed = true;
          store.failDraft(message);
          throw new Error(message);
        }
        await readSse(response, (value) => {
          const event = architectureGenerateStreamEventSchema.safeParse(value);
          if (!event.success) return;
          if (event.data.type === "error") {
            failed = true;
            store.failDraft(event.data.error.message);
            if (!opened) {
              opened = true;
              reject(new Error(event.data.error.message));
            }
            return;
          }
          store.applyDraftSnapshot(event.data.project, event.data.complete);
          if (!opened) {
            opened = true;
            resolve(event.data.project);
          }
        });
        if (!failed) store.finishDraft();
        if (!opened)
          reject(
            new Error("The architecture could not be generated. Try again."),
          );
      } catch (error) {
        if (controller.signal.aborted) {
          if (!opened)
            reject(
              error instanceof DOMException
                ? error
                : new DOMException("Aborted", "AbortError"),
            );
          return;
        }
        const message =
          error instanceof Error
            ? error.message
            : "The architecture could not be generated. Try again.";
        store.failDraft(message);
        if (!opened) reject(error);
      } finally {
        if (activeAbort === controller) activeAbort = null;
      }
    })();
  });
}
