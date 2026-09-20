import { converseArchitectureDraft } from "./bedrock";
import { ArchitectureGenerateError } from "./errors";
import { hydrateArchitectureDraft } from "./hydrate";

import type { ArchitectureProject } from "@/lib/architecture/schema";

export async function generateArchitectureFromDescription(
  description: string,
  signal?: AbortSignal,
): Promise<ArchitectureProject> {
  const trimmed = description.trim();
  if (!trimmed)
    throw new ArchitectureGenerateError(
      "INVALID_REQUEST",
      "Describe what you want to build.",
      400,
    );
  const draft = await converseArchitectureDraft(trimmed, signal);
  return hydrateArchitectureDraft(draft, trimmed);
}
