import { createHash, randomUUID } from "node:crypto";
import path from "node:path";

import { SCANNER_VERSION } from "./constants";
import type { ScannedRepository, ScannedTextFile } from "./scanner";
import {
  repositoryImportSuccessSchema,
  type RepositoryImportSuccess,
} from "./schema";
import {
  analyzeSourceFile,
  humanizeSymbol,
  isTypeOnlyFile,
  type FileAnalysis,
} from "./symbols";

import {
  projectSchema,
  type ArchitectureNode,
  type ArchitectureProject,
} from "@/lib/architecture/schema";

type Evidence = Map<string, Set<string>>;

const FRAMEWORK_DEPENDENCIES: Record<string, string> = {
  next: "Next.js",
  "@remix-run/react": "Remix",
  "@sveltejs/kit": "SvelteKit",
  nuxt: "Nuxt",
  astro: "Astro",
  "@angular/core": "Angular",
  "@nestjs/core": "NestJS",
  express: "Express",
  fastify: "Fastify",
  hono: "Hono",
  vue: "Vue",
  react: "React",
};

const DATA_DEPENDENCIES: Record<string, string> = {
  "@prisma/client": "Prisma",
  prisma: "Prisma",
  "drizzle-orm": "Drizzle ORM",
  typeorm: "TypeORM",
  sequelize: "Sequelize",
  mongoose: "MongoDB",
  mongodb: "MongoDB",
  pg: "PostgreSQL",
  postgres: "PostgreSQL",
  mysql2: "MySQL",
  "better-sqlite3": "SQLite",
  sqlite3: "SQLite",
  redis: "Redis",
  ioredis: "Redis",
};

const INTEGRATION_DEPENDENCIES: Record<string, string> = {
  "@anthropic-ai/sdk": "Anthropic",
  "@aws-sdk/client-s3": "Amazon S3",
  "@clerk/nextjs": "Clerk",
  "@sentry/nextjs": "Sentry",
  "@sentry/node": "Sentry",
  "@supabase/supabase-js": "Supabase",
  "@vercel/blob": "Vercel Blob",
  "@vercel/postgres": "Vercel Postgres",
  "@auth/core": "Auth.js",
  firebase: "Firebase",
  "next-auth": "Auth.js",
  openai: "OpenAI",
  "posthog-js": "PostHog",
  "posthog-node": "PostHog",
  resend: "Resend",
  stripe: "Stripe",
  twilio: "Twilio",
};

const CONFIG_FRAMEWORKS: Array<[RegExp, string]> = [
  [/(^|\/)next\.config\.[^/]+$/i, "Next.js"],
  [/(^|\/)nuxt\.config\.[^/]+$/i, "Nuxt"],
  [/(^|\/)svelte\.config\.[^/]+$/i, "SvelteKit"],
  [/(^|\/)astro\.config\.[^/]+$/i, "Astro"],
  [/(^|\/)angular\.json$/i, "Angular"],
  [/(^|\/)vite\.config\.[^/]+$/i, "Vite"],
  [/(^|\/)schema\.prisma$/i, "Prisma"],
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function addEvidence(target: Evidence, name: string, filePath: string) {
  const paths = target.get(name) ?? new Set<string>();
  paths.add(filePath);
  target.set(name, paths);
}

function directoryOf(filePath: string) {
  const directory = path.posix.dirname(filePath);
  return directory === "." ? "." : directory;
}

function packageManifests(files: ScannedTextFile[]) {
  return files
    .filter(
      (file) => path.posix.basename(file.path).toLowerCase() === "package.json",
    )
    .flatMap((file) => {
      try {
        const value: unknown = JSON.parse(file.text);
        if (!isRecord(value)) return [];
        const dependencies = new Set<string>();
        for (const key of [
          "dependencies",
          "devDependencies",
          "peerDependencies",
          "optionalDependencies",
        ]) {
          const group = value[key];
          if (!isRecord(group)) continue;
          for (const dependency of Object.keys(group))
            dependencies.add(dependency);
        }
        return [
          {
            path: file.path,
            root: directoryOf(file.path),
            name: typeof value.name === "string" ? value.name : undefined,
            dependencies,
          },
        ];
      } catch {
        return [];
      }
    });
}

function cleanProjectName(value: string, fallback: string) {
  const unscoped = value.includes("/")
    ? (value.split("/").at(-1) ?? value)
    : value;
  const cleaned = unscoped.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return (cleaned || fallback).slice(0, 80);
}

function analyzeTechnology(files: ScannedTextFile[]) {
  const frameworks: Evidence = new Map();
  const data: Evidence = new Map();
  const integrations: Evidence = new Map();
  const manifests = packageManifests(files);

  for (const manifest of manifests) {
    for (const dependency of manifest.dependencies) {
      const framework = FRAMEWORK_DEPENDENCIES[dependency];
      const datastore = DATA_DEPENDENCIES[dependency];
      const integration = INTEGRATION_DEPENDENCIES[dependency];
      if (framework) addEvidence(frameworks, framework, manifest.path);
      if (datastore) addEvidence(data, datastore, manifest.path);
      if (integration) addEvidence(integrations, integration, manifest.path);
    }
  }

  for (const file of files) {
    for (const [pattern, framework] of CONFIG_FRAMEWORKS) {
      if (pattern.test(file.path))
        addEvidence(frameworks, framework, file.path);
    }

    const basename = path.posix.basename(file.path).toLowerCase();
    const content = file.text.toLowerCase();
    if (basename === "requirements.txt" || basename === "pyproject.toml") {
      if (/\bdjango\b/.test(content))
        addEvidence(frameworks, "Django", file.path);
      if (/\bfastapi\b/.test(content))
        addEvidence(frameworks, "FastAPI", file.path);
      if (/\bflask\b/.test(content))
        addEvidence(frameworks, "Flask", file.path);
      if (/\b(psycopg|asyncpg)\b/.test(content))
        addEvidence(data, "PostgreSQL", file.path);
      if (/\bsqlalchemy\b/.test(content))
        addEvidence(data, "SQLAlchemy", file.path);
    }
    if (basename === "gemfile") {
      if (/gem\s+["']rails["']/.test(content))
        addEvidence(frameworks, "Rails", file.path);
      if (/gem\s+["']pg["']/.test(content))
        addEvidence(data, "PostgreSQL", file.path);
    }
    if (basename === "go.mod") {
      if (/github\.com\/gin-gonic\/gin/.test(content))
        addEvidence(frameworks, "Gin", file.path);
      if (/github\.com\/gofiber\/fiber/.test(content))
        addEvidence(frameworks, "Fiber", file.path);
      if (/postgres|pgx/.test(content))
        addEvidence(data, "PostgreSQL", file.path);
    }
    if (basename === "cargo.toml") {
      if (/\baxum\b/.test(content)) addEvidence(frameworks, "Axum", file.path);
      if (/\bactix-web\b/.test(content))
        addEvidence(frameworks, "Actix Web", file.path);
    }
    if (
      ["pom.xml", "build.gradle", "build.gradle.kts"].includes(basename) &&
      /spring-boot/.test(content)
    )
      addEvidence(frameworks, "Spring Boot", file.path);
  }

  if (frameworks.has("Next.js")) frameworks.delete("React");
  if (frameworks.has("Nuxt")) frameworks.delete("Vue");
  if (frameworks.has("SvelteKit")) frameworks.delete("Svelte");

  const primaryManifest = [...manifests].sort((a, b) => {
    if (a.root === ".") return -1;
    if (b.root === ".") return 1;
    return a.path.length - b.path.length;
  })[0];
  const projectName = cleanProjectName(
    primaryManifest?.name ?? "",
    "Imported repository",
  );
  const appRoots = [
    ...new Set(
      files
        .filter((file) => file.type === "manifest")
        .map((file) => directoryOf(file.path)),
    ),
  ]
    .sort((a, b) => a.length - b.length || a.localeCompare(b))
    .slice(0, 20);

  return {
    appRoots: appRoots.length > 0 ? appRoots : ["."],
    data,
    frameworks,
    integrations,
    manifests,
    projectName,
  };
}

function stableId(prefix: string, key: string) {
  const digest = createHash("sha256").update(`${prefix}:${key}`).digest("hex");
  return `${prefix}-${digest.slice(0, 12)}`;
}

function node(
  id: string,
  name: string,
  kind: ArchitectureNode["kind"],
  summary: string,
  implementation: Iterable<string>,
  questions: string[] = [],
  assumptions: string[] = [],
  options: {
    parentId?: string;
    references?: ArchitectureNode["sourceReferences"];
    rules?: string[];
    security?: string[];
    events?: string[];
    provenance?: ArchitectureNode["provenance"];
  } = {},
): ArchitectureNode {
  const paths = [...new Set(implementation)].sort().slice(0, 40);
  return {
    id,
    ...(options.parentId ? { parentId: options.parentId } : {}),
    name: name.slice(0, 80),
    kind,
    summary,
    intent: "",
    provenance: options.provenance ?? "inferred",
    intended: true,
    observed: true,
    intentChanges: [],
    requirements: [],
    rules: options.rules ?? [],
    constraints: [],
    security: options.security ?? [],
    permissions: [],
    events: options.events ?? [],
    implementation: paths,
    sourceReferences:
      options.references ??
      paths.map((filePath) => ({
        path: filePath,
        provenance: "observed" as const,
      })),
    questions,
    assumptions,
  };
}

function displayName(value: string) {
  const spaced = value
    .replace(/[-_]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

type SemanticArea = {
  key: string;
  name: string;
  paths: Set<string>;
  hasApi: boolean;
  hasFeature: boolean;
  hasPage: boolean;
};

function normalizeAreaKey(value: string) {
  return value
    .replace(/\.[^.]+$/, "")
    .split(".", 1)[0]
    .replace(/^\((.+)\)$/, "$1")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

function routeArea(filePath: string) {
  const parts = filePath.split("/");
  const markers = ["app", "pages", "routes"];
  let markerIndex = -1;
  for (let index = 0; index < parts.length; index += 1) {
    if (markers.includes(parts[index].toLowerCase())) markerIndex = index;
  }

  const routeParts = parts.slice(markerIndex + 1);
  if (routeParts[0]?.toLowerCase() === "api") routeParts.shift();
  const ignored = new Set([
    "api",
    "page",
    "route",
    "index",
    "layout",
    "loading",
    "error",
    "not-found",
    "_app",
    "_document",
  ]);
  for (const part of routeParts) {
    if (/^\[.*\]$/.test(part) || /^\(.*\)$/.test(part)) continue;
    const key = normalizeAreaKey(part);
    if (key && !ignored.has(key)) return key;
  }
  return "";
}

function semanticAreaGroups(files: ScannedTextFile[]) {
  const groups = new Map<string, SemanticArea>();
  const interfacePaths = new Set<string>();
  const pageAreas = new Map<string, Set<string>>();

  function areaFor(key: string) {
    const existing = groups.get(key);
    if (existing) return existing;
    const created: SemanticArea = {
      key,
      name: displayName(key),
      paths: new Set(),
      hasApi: false,
      hasFeature: false,
      hasPage: false,
    };
    groups.set(key, created);
    return created;
  }

  for (const file of files) {
    const feature = file.path.match(
      /(?:^|\/)(?:features|modules|domains)\/([^/]+)(?:\/|$)/i,
    );
    if (feature) {
      const key = normalizeAreaKey(feature[1]);
      if (key) {
        const area = areaFor(key);
        area.hasFeature = true;
        area.paths.add(file.path);
      }
    }

    if (file.type === "page") {
      const key = routeArea(file.path);
      if (!key) interfacePaths.add(file.path);
      else {
        const paths = pageAreas.get(key) ?? new Set<string>();
        paths.add(file.path);
        pageAreas.set(key, paths);
      }
      continue;
    }
    if (file.type !== "api-route") continue;
    const area = areaFor(routeArea(file.path) || "api");
    area.hasApi = true;
    area.paths.add(file.path);
  }

  for (const [key, paths] of pageAreas) {
    const area = groups.get(key);
    if (!area) {
      for (const filePath of paths) interfacePaths.add(filePath);
      continue;
    }
    area.hasPage = true;
    for (const filePath of paths) area.paths.add(filePath);
  }

  return {
    areas: [...groups.values()]
      .sort(
        (a, b) => b.paths.size - a.paths.size || a.name.localeCompare(b.name),
      )
      .slice(0, 30),
    interfacePaths,
  };
}

function addEdge(
  project: Pick<ArchitectureProject, "edges">,
  source: string,
  target: string,
  relation: ArchitectureProject["edges"][number]["relation"],
) {
  const key = `${source}:${relation}:${target}`;
  if (
    project.edges.some(
      (edge) =>
        edge.source === source &&
        edge.target === target &&
        edge.relation === relation,
    )
  )
    return;
  project.edges.push({ id: stableId("edge", key), source, target, relation });
}

function listNames(names: string[]) {
  const shown = names.slice(0, 4);
  const rest = names.length - shown.length;
  const joined =
    shown.length <= 1
      ? shown.join("")
      : `${shown.slice(0, -1).join(", ")} and ${shown.at(-1)}`;
  return rest > 0 ? `${joined} (+${rest} more)` : joined;
}

function reference(
  analysis: FileAnalysis,
  symbol?: string,
  startLine?: number,
  endLine?: number,
): ArchitectureNode["sourceReferences"][number] {
  return {
    path: analysis.path,
    ...(symbol ? { symbol } : {}),
    ...(startLine ? { startLine } : {}),
    ...(endLine && startLine && endLine >= startLine ? { endLine } : {}),
    language: analysis.language,
    provenance: "observed",
  };
}

/** Which semantic area a module specifier resolves into, if any. */
function areaForSpecifier(
  specifier: string,
  fromPath: string,
  areaByPath: Map<string, string>,
) {
  let resolved: string | null = null;
  if (specifier.startsWith("@/") || specifier.startsWith("~/"))
    resolved = `src/${specifier.slice(2)}`;
  else if (specifier.startsWith("."))
    resolved = path.posix.normalize(
      path.posix.join(path.posix.dirname(fromPath), specifier),
    );
  if (!resolved) return null;
  for (const [filePath, areaKey] of areaByPath) {
    const withoutExtension = filePath.replace(/\.[^./]+$/, "");
    if (
      withoutExtension === resolved ||
      withoutExtension === `${resolved}/index` ||
      filePath.startsWith(`${resolved}/`)
    )
      return areaKey;
  }
  const feature = resolved.match(
    /(?:^|\/)(?:features|modules|domains)\/([^/]+)/i,
  );
  return feature ? normalizeAreaKey(feature[1]) : null;
}

function enrichArchitecture(
  project: ArchitectureProject,
  scanned: ScannedRepository,
  areas: SemanticArea[],
  interfacePaths: Set<string>,
  ids: {
    rootId: string;
    interfaceId?: string;
    dataModelId?: string;
    integrationIds: Map<string, string>;
  },
) {
  const analyses = new Map<string, FileAnalysis>();
  for (const file of scanned.files)
    if (
      [
        "source",
        "feature",
        "api-route",
        "page",
        "data-schema",
        "state-store",
      ].includes(file.type)
    )
      analyses.set(file.path, analyzeSourceFile(file));

  const areaByPath = new Map<string, string>();
  for (const area of areas)
    for (const filePath of area.paths) areaByPath.set(filePath, area.key);
  const areaNodeId = (key: string) => stableId("area", key);
  const packageIntegration = new Map<string, string>();
  for (const [dependency, name] of Object.entries(INTEGRATION_DEPENDENCIES))
    if (ids.integrationIds.has(name))
      packageIntegration.set(dependency, ids.integrationIds.get(name)!);

  // Data models discovered inside schema files become children of the data model node.
  const modelNodeIds = new Map<string, string>();
  if (ids.dataModelId)
    for (const analysis of analyses.values())
      for (const model of analysis.prismaModels.slice(0, 60)) {
        const id = stableId("model", `${analysis.path}:${model.name}`);
        modelNodeIds.set(model.name.toLowerCase(), id);
        project.nodes[id] = node(
          id,
          model.name,
          "data",
          `${model.name} record${model.fields.length > 0 ? ` with ${model.fields.length} field${model.fields.length === 1 ? "" : "s"} (${listNames(model.fields)})` : ""}.`,
          [analysis.path],
          [],
          [],
          {
            parentId: ids.dataModelId,
            provenance: "observed",
            references: [
              reference(analysis, model.name, model.line, model.endLine),
            ],
          },
        );
      }

  // Pages become children of the web interface.
  if (ids.interfaceId)
    for (const filePath of [...interfacePaths].sort()) {
      const analysis = analyses.get(filePath);
      if (!analysis || !analysis.routePath) continue;
      const id = stableId("page", filePath);
      const label =
        analysis.routePath === "/"
          ? "Home"
          : displayName(
              analysis.routePath.split("/").filter(Boolean).at(-1) ?? "Page",
            );
      project.nodes[id] = node(
        id,
        label,
        "page",
        `${label} page served at ${analysis.routePath}.`,
        [filePath],
        [],
        [],
        {
          parentId: ids.interfaceId,
          provenance: "observed",
          references: [reference(analysis)],
        },
      );
    }

  for (const area of areas) {
    const parentId = areaNodeId(area.key);
    const parent = project.nodes[parentId];
    if (!parent) continue;
    const capabilityNames: string[] = [];
    const endpointNames: string[] = [];
    const observedSecurity = new Set<string>();
    const observedRules = new Set<string>();
    const dependencyAreas = new Set<string>();

    for (const filePath of [...area.paths].sort()) {
      const analysis = analyses.get(filePath);
      if (!analysis) continue;

      for (const handler of analysis.routeHandlers) {
        const route = analysis.routePath ?? filePath;
        const name = `${handler.method} ${route}`;
        const id = stableId("endpoint", `${filePath}:${handler.method}`);
        const security = analysis.authChecks.map(
          (check) => `Requires an authenticated caller (observed: ${check}).`,
        );
        project.nodes[id] = node(
          id,
          name,
          "api",
          `Accepts ${handler.method} requests at ${route}.`,
          [filePath],
          security.length === 0
            ? [
                "Who is allowed to call this endpoint, and how is the caller authenticated?",
              ]
            : [],
          [],
          {
            parentId,
            provenance: "observed",
            references: [
              reference(
                analysis,
                handler.method,
                handler.line,
                handler.endLine,
              ),
            ],
            security,
          },
        );
        endpointNames.push(name);
      }

      if (!isTypeOnlyFile(analysis))
        for (const symbol of analysis.exports) {
          if (symbol.kind === "type" || symbol.isDefault) continue;
          if (/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.test(symbol.name))
            continue;
          if (
            symbol.kind === "const" &&
            symbol.literalEntries.length === 0 &&
            !/schema$/i.test(symbol.name)
          )
            continue;
          const label = humanizeSymbol(symbol.name);
          const id = stableId("capability", `${filePath}:${symbol.name}`);
          const rules = symbol.literalEntries.map(
            ([key, value]) =>
              `${humanizeSymbol(key)}: ${value} (observed in ${symbol.name}).`,
          );
          const summary =
            symbol.kind === "class"
              ? `${label} is a class ${area.name} exposes as ${symbol.name}.`
              : symbol.literalEntries.length > 0
                ? `${label} is configuration ${area.name} exposes as ${symbol.name}.`
                : analysis.validationSchemas.includes(symbol.name)
                  ? `${label} validates input for ${area.name}.`
                  : `${label} is behavior ${area.name} exposes as ${symbol.name}().`;
          project.nodes[id] = node(
            id,
            label,
            "capability",
            summary,
            [filePath],
            [],
            [],
            {
              parentId,
              provenance: "observed",
              references: [
                reference(analysis, symbol.name, symbol.line, symbol.endLine),
              ],
              rules,
            },
          );
          for (const rule of rules) observedRules.add(rule);
          capabilityNames.push(label);
        }

      for (const check of analysis.authChecks)
        observedSecurity.add(
          `Requires an authenticated caller (observed: ${check}).`,
        );

      for (const item of analysis.imports) {
        const target = areaForSpecifier(item.specifier, filePath, areaByPath);
        if (target && target !== area.key && project.nodes[areaNodeId(target)])
          dependencyAreas.add(target);
      }
      for (const packageName of analysis.packages) {
        const integrationId = packageIntegration.get(packageName);
        if (integrationId) addEdge(project, parentId, integrationId, "calls");
      }
      for (const access of analysis.dataAccess) {
        const modelId = modelNodeIds.get(access.model.toLowerCase());
        if (modelId)
          addEdge(
            project,
            parentId,
            modelId,
            access.access === "write" ? "writes_to" : "reads_from",
          );
        else if (ids.dataModelId)
          addEdge(
            project,
            parentId,
            ids.dataModelId,
            access.access === "write" ? "writes_to" : "reads_from",
          );
      }
      for (const event of analysis.emittedEvents)
        if (!parent.events.includes(event)) parent.events.push(event);
    }

    for (const target of dependencyAreas)
      addEdge(project, parentId, areaNodeId(target), "depends_on");
    for (const security of observedSecurity)
      if (!parent.security.includes(security)) parent.security.push(security);

    const owned = [...capabilityNames, ...endpointNames];
    if (owned.length > 0) parent.summary = `Owns ${listNames(owned)}.`;
    if (parent.security.length > 0)
      parent.questions = parent.questions.filter(
        (question) => !/authentication requirements apply/.test(question),
      );
  }
}

function buildProject(scanned: ScannedRepository, importedAt: string) {
  const technology = analyzeTechnology(scanned.files);
  const detectedProjectName =
    technology.projectName === "Imported repository"
      ? scanned.suggestedName
      : technology.projectName;
  const frameworks = [
    ...new Set([...technology.frameworks.keys(), ...technology.data.keys()]),
  ].slice(0, 12);
  const project: ArchitectureProject = {
    id: `repository-${randomUUID()}`,
    name: detectedProjectName,
    description: `Repository architecture derived from ${scanned.files.length} analyzed source and configuration files.`,
    version: 1,
    source: "repository",
    repository: {
      fileName: scanned.archiveName.slice(0, 255),
      repositoryRoot: scanned.repositoryRoot,
      scannerVersion: SCANNER_VERSION,
      importedAt,
      filesDiscovered: scanned.stats.filesDiscovered,
      analyzedFiles: scanned.stats.analyzedFiles,
      frameworks,
      appRoots: technology.appRoots,
    },
    nodes: {},
    edges: [],
    decisions: [],
    history: [
      {
        version: 1,
        title: "Repository imported",
        date: importedAt,
      },
    ],
  };

  const semanticAreas = semanticAreaGroups(scanned.files);
  const rootId = stableId("application", detectedProjectName);
  const rootEvidence = scanned.files
    .filter((file) => file.type === "manifest" || file.type === "config")
    .map((file) => file.path);
  project.nodes[rootId] = node(
    rootId,
    detectedProjectName,
    "application",
    frameworks.length > 0
      ? `The ${frameworks[0]} application and its deployable boundary.`
      : "The application and its deployable boundary.",
    rootEvidence.length > 0
      ? rootEvidence
      : scanned.files.slice(0, 1).map((file) => file.path),
    [
      "Which runtime and deployment target should Structor treat as authoritative?",
    ],
    ["Repository directory boundaries are treated as application boundaries."],
  );

  let interfaceId: string | undefined;
  if (semanticAreas.interfacePaths.size > 0) {
    interfaceId = stableId("application", "web-interface");
    project.nodes[interfaceId] = node(
      interfaceId,
      "Web interface",
      "application",
      "What people see and use in the product.",
      semanticAreas.interfacePaths,
      ["Which user journeys and access requirements belong to this interface?"],
    );
    addEdge(project, rootId, interfaceId, "depends_on");
  }

  for (const area of semanticAreas.areas) {
    const id = stableId("area", area.key);
    const summary =
      area.hasApi && !area.hasFeature
        ? `Handles ${area.name.toLowerCase()} requests for the product.`
        : area.hasPage
          ? `${area.name} capability with its own screens and logic.`
          : `${area.name} capability of the product.`;
    project.nodes[id] = node(
      id,
      area.name,
      area.hasApi && !area.hasFeature ? "api" : "feature",
      summary,
      area.paths,
      area.hasApi
        ? [
            "Which callers, validation, and authentication requirements apply here?",
          ]
        : ["What behavior and invariants define this boundary?"],
    );
    addEdge(project, rootId, id, "depends_on");
  }

  const dataSchemaPaths = scanned.files
    .filter((file) => file.type === "data-schema")
    .map((file) => file.path);
  const modeledDataTechnologies = new Set<string>();
  let dataModelId: string | undefined;
  if (dataSchemaPaths.length > 0) {
    const modelTechnology = [
      "Prisma",
      "Drizzle ORM",
      "TypeORM",
      "Sequelize",
    ].find((name) => technology.data.has(name));
    if (modelTechnology) modeledDataTechnologies.add(modelTechnology);
    const modelEvidence = modelTechnology
      ? [...(technology.data.get(modelTechnology) ?? [])]
      : [];
    dataModelId = stableId("data", dataSchemaPaths.join("|"));
    project.nodes[dataModelId] = node(
      dataModelId,
      modelTechnology ? `${modelTechnology} data model` : "Data model",
      "data",
      "The persistent records the product stores and relies on.",
      [...dataSchemaPaths, ...modelEvidence],
      [
        "Which schema is authoritative when generated and handwritten models differ?",
      ],
    );
    addEdge(project, rootId, dataModelId, "depends_on");
  }

  const statePaths = scanned.files
    .filter((file) => file.type === "state-store")
    .map((file) => file.path);
  if (statePaths.length > 0) {
    const id = stableId("data", `state:${statePaths.join("|")}`);
    project.nodes[id] = node(
      id,
      "Application state",
      "data",
      "In-memory state the interface keeps while people use it.",
      statePaths,
      ["Which state is durable, server-owned, or local to the client?"],
    );
    addEdge(project, rootId, id, "depends_on");
  }

  const dataAccessLibraries = new Set([
    "Prisma",
    "Drizzle ORM",
    "TypeORM",
    "Sequelize",
    "SQLAlchemy",
  ]);
  for (const [name, evidence] of [...technology.data].slice(0, 12)) {
    if (modeledDataTechnologies.has(name)) continue;
    const id = stableId("data", name);
    const library = dataAccessLibraries.has(name);
    if (!project.nodes[id])
      project.nodes[id] = node(
        id,
        name,
        library ? "data" : "infrastructure",
        library
          ? `${name} is how the product reads and writes its data.`
          : `${name} stores data for the product.`,
        evidence,
        [
          "Which data does this dependency own, and where is its schema managed?",
        ],
      );
    addEdge(project, rootId, id, "depends_on");
  }

  const integrationIds = new Map<string, string>();
  for (const [name, evidence] of [...technology.integrations].slice(0, 15)) {
    const id = stableId("integration", name);
    integrationIds.set(name, id);
    project.nodes[id] = node(
      id,
      name,
      "integration",
      `${name} is a third-party service the product relies on.`,
      evidence,
      [
        "Which environment owns this integration's configuration and lifecycle?",
      ],
    );
    addEdge(project, rootId, id, "depends_on");
  }

  enrichArchitecture(
    project,
    scanned,
    semanticAreas.areas,
    semanticAreas.interfacePaths,
    { rootId, interfaceId, dataModelId, integrationIds },
  );

  return {
    frameworks,
    project: projectSchema.parse(project),
    projectName: detectedProjectName,
    appRoots: technology.appRoots,
  };
}

export function buildRepositoryImport(
  scanned: ScannedRepository,
): RepositoryImportSuccess {
  const importedAt = new Date().toISOString();
  const built = buildProject(scanned, importedAt);

  return repositoryImportSuccessSchema.parse({
    ok: true,
    project: built.project,
    manifest: {
      project: built.projectName,
      repositoryRoot: scanned.repositoryRoot,
      frameworks: built.frameworks,
      appRoots: built.appRoots,
      files: scanned.files.map(({ path: filePath, type, size }) => ({
        path: filePath,
        type,
        size,
      })),
    },
    stats: scanned.stats,
  });
}
