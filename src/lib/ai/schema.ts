import { z } from "zod";

import { architectureGenerateErrorCodes } from "./errors";

import { projectSchema } from "@/lib/architecture/schema";

export const architectureGenerateRequestSchema = z
  .object({
    description: z.string().trim().min(1).max(10000),
  })
  .strict();

export const architectureDraftKindSchema = z.enum([
  "application",
  "domain",
  "feature",
  "capability",
  "service",
  "page",
  "flow",
  "data",
  "api",
  "actor",
  "event",
  "integration",
  "infrastructure",
  "security",
  "custom",
]);

export const architectureDraftRelationSchema = z.enum([
  "calls",
  "reads_from",
  "writes_to",
  "emits",
  "protects",
  "depends_on",
]);

const draftListSchema = z.array(z.string()).max(12).default([]);

export const architectureDraftNodeSchema = z
  .object({
    id: z.string().trim().min(1).max(128),
    parentId: z
      .string()
      .trim()
      .max(128)
      .optional()
      .transform((value) => (value ? value : undefined)),
    name: z.string().trim().min(1).max(80),
    kind: architectureDraftKindSchema,
    summary: z.string().trim().min(1).max(2000),
    intent: z.string().trim().max(10000).default(""),
    requirements: draftListSchema,
    rules: draftListSchema,
    constraints: draftListSchema,
    security: draftListSchema,
    permissions: draftListSchema,
    events: draftListSchema,
    questions: draftListSchema,
    assumptions: draftListSchema,
  })
  .passthrough();

export const architectureDraftEdgeSchema = z
  .object({
    source: z.string().trim().min(1).max(128),
    target: z.string().trim().min(1).max(128),
    relation: architectureDraftRelationSchema,
  })
  .passthrough();

export const architectureDraftDecisionSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    reason: z.string().trim().min(1).max(10000),
    alternative: z.string().trim().max(10000).default(""),
  })
  .passthrough();

export const architectureDraftSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    description: z.string().trim().max(10000).default(""),
    nodes: z.array(architectureDraftNodeSchema).min(1).max(40),
    edges: z.array(architectureDraftEdgeSchema).max(120).default([]),
    decisions: z.array(architectureDraftDecisionSchema).max(12).default([]),
  })
  .passthrough();

export const architectureGenerateSuccessSchema = z
  .object({
    ok: z.literal(true),
    project: projectSchema,
  })
  .strict();

export const architectureGenerateErrorSchema = z
  .object({
    ok: z.literal(false),
    error: z
      .object({
        code: z.enum(architectureGenerateErrorCodes),
        message: z.string().trim().min(1).max(300),
      })
      .strict(),
  })
  .strict();

export const architectureGenerateResponseSchema = z.discriminatedUnion("ok", [
  architectureGenerateSuccessSchema,
  architectureGenerateErrorSchema,
]);

export type ArchitectureDraft = z.infer<typeof architectureDraftSchema>;
export type ArchitectureGenerateRequest = z.infer<
  typeof architectureGenerateRequestSchema
>;
export type ArchitectureGenerateResponse = z.infer<
  typeof architectureGenerateResponseSchema
>;
