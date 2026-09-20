import { timingSafeEqual, createHash } from "node:crypto";

import {
  parsePersistableProject,
  type ArchitectureProject,
} from "@/lib/architecture/schema";

type ShareRecord = {
  project: ArchitectureProject;
  tokenHash: Buffer;
  updatedAt: number;
  revisions: number;
};

type ShareRegistry = Map<string, ShareRecord>;

const TTL_MS = 30 * 60 * 1000;
const MAX_PROJECTS = 32;

const store: ShareRegistry =
  (globalThis as { __structorMcpShares?: ShareRegistry }).__structorMcpShares ??
  new Map();
(globalThis as { __structorMcpShares?: ShareRegistry }).__structorMcpShares =
  store;

function hashToken(token: string) {
  return createHash("sha256").update(token).digest();
}

function sweep() {
  const cutoff = Date.now() - TTL_MS;
  for (const [id, record] of store)
    if (record.updatedAt < cutoff) store.delete(id);
}

export function publishProject(project: unknown, token: unknown) {
  if (typeof token !== "string" || token.length < 24 || token.length > 256)
    throw new Error("Share tokens must be between 24 and 256 characters.");
  const parsed = parsePersistableProject(project);
  sweep();
  if (!store.has(parsed.id) && store.size >= MAX_PROJECTS) {
    const oldest = [...store.entries()].sort(
      (left, right) => left[1].updatedAt - right[1].updatedAt,
    )[0];
    if (oldest) store.delete(oldest[0]);
  }
  const existing = store.get(parsed.id);
  if (existing && !timingSafeEqual(existing.tokenHash, hashToken(token)))
    throw new Error("This project is already shared with a different token.");
  store.set(parsed.id, {
    project: parsed,
    tokenHash: hashToken(token),
    updatedAt: Date.now(),
    revisions: (existing?.revisions ?? 0) + 1,
  });
  return {
    projectId: parsed.id,
    version: parsed.version,
    revisions: (existing?.revisions ?? 0) + 1,
  };
}

export function deleteProject(projectId: unknown, token: unknown) {
  if (typeof projectId !== "string" || typeof token !== "string")
    throw new Error("A project id and token are required.");
  const existing = projectId ? store.get(projectId) : undefined;
  if (!existing) return { deleted: false };
  if (
    existing.tokenHash.length !== hashToken(token).length ||
    !timingSafeEqual(existing.tokenHash, hashToken(token))
  )
    throw new Error("Invalid share token.");
  store.delete(projectId);
  return { deleted: true };
}

/** No token, no architecture. Shared projects require a bearer token. */
export function readSharedProject(
  authorization: string | null,
): ArchitectureProject {
  if (!authorization) throw new Error("Authorize with the share token.");
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) throw new Error("Authorize with a Bearer share token.");
  const token = match[1];
  sweep();
  const hashed = hashToken(token);
  for (const record of store.values()) {
    try {
      if (
        hashed.length === record.tokenHash.length &&
        timingSafeEqual(hashed, record.tokenHash)
      ) {
        record.updatedAt = Date.now();
        return record.project;
      }
    } catch {
      // Length mismatch already handled; treat any failure as a miss.
    }
  }
  const perProject = authorization
    .replace(/^Bearer\s+/i, "")
    .match(/^(.+):(.+)$/);
  if (perProject) {
    const record = store.get(perProject[1]);
    if (record) {
      const scoped = hashToken(perProject[2]);
      if (
        scoped.length === record.tokenHash.length &&
        timingSafeEqual(scoped, record.tokenHash)
      ) {
        record.updatedAt = Date.now();
        return record.project;
      }
    }
  }
  throw new Error("No project is currently shared for this token.");
}
