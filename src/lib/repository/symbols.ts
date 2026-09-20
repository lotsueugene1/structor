import path from "node:path";

import type { ScannedTextFile } from "./scanner";

/**
 * Deterministic structural evidence extracted from source text. Everything here
 * answers "what exists?"; interpretation happens later and stays marked inferred.
 */
export type ExportedSymbol = {
  name: string;
  kind: "function" | "class" | "const" | "type";
  line: number;
  endLine?: number;
  isDefault: boolean;
  isAsync: boolean;
  /** Top-level literal entries when the export is a plain object literal. */
  literalEntries: Array<[string, string]>;
};

export type RouteHandler = {
  method: string;
  line: number;
  endLine?: number;
};

export type PrismaModel = {
  name: string;
  fields: string[];
  line: number;
  endLine: number;
};

export type FileAnalysis = {
  path: string;
  language: string;
  exports: ExportedSymbol[];
  routeHandlers: RouteHandler[];
  routePath: string | null;
  imports: Array<{ specifier: string; names: string[]; line: number }>;
  packages: string[];
  dataAccess: Array<{
    model: string;
    operation: string;
    access: "read" | "write";
  }>;
  authChecks: string[];
  validationSchemas: string[];
  emittedEvents: string[];
  isServerAction: boolean;
  isClientComponent: boolean;
  prismaModels: PrismaModel[];
};

const LANGUAGES: Record<string, string> = {
  ".ts": "TypeScript",
  ".tsx": "TypeScript",
  ".mts": "TypeScript",
  ".cts": "TypeScript",
  ".js": "JavaScript",
  ".jsx": "JavaScript",
  ".mjs": "JavaScript",
  ".cjs": "JavaScript",
  ".prisma": "Prisma",
  ".py": "Python",
  ".go": "Go",
  ".rb": "Ruby",
  ".rs": "Rust",
};

const READ_OPERATIONS = new Set([
  "findMany",
  "findUnique",
  "findFirst",
  "findUniqueOrThrow",
  "findFirstOrThrow",
  "count",
  "aggregate",
  "groupBy",
]);
const WRITE_OPERATIONS = new Set([
  "create",
  "createMany",
  "update",
  "updateMany",
  "upsert",
  "delete",
  "deleteMany",
]);

const AUTH_PATTERNS: Array<[RegExp, string]> = [
  [/\bgetServerSession\s*\(/, "getServerSession()"],
  [/\bauth\s*\(\s*\)/, "auth()"],
  [/\brequireSession\s*\(/, "requireSession()"],
  [/\brequireUser\s*\(/, "requireUser()"],
  [/\brequireAuth\s*\(/, "requireAuth()"],
  [/\bcurrentUser\s*\(/, "currentUser()"],
  [/\bgetSession\s*\(/, "getSession()"],
  [/\bauthorize\s*\(/, "authorize()"],
  [/\bverifyToken\s*\(/, "verifyToken()"],
  [
    /\bcookies\(\)\.get\(\s*["'][^"']*(session|token)[^"']*["']/i,
    "session cookie",
  ],
  [/redirect\(\s*["']\/(login|sign-?in)["']/i, "redirect to sign-in"],
];

function lineAt(text: string, index: number) {
  let line = 1;
  for (let cursor = 0; cursor < index && cursor < text.length; cursor += 1)
    if (text.charCodeAt(cursor) === 10) line += 1;
  return line;
}

function blockEnd(text: string, openIndex: number) {
  let depth = 0;
  for (let cursor = openIndex; cursor < text.length; cursor += 1) {
    const char = text[cursor];
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return cursor;
    }
  }
  return -1;
}

function literalEntries(text: string, braceIndex: number) {
  const end = blockEnd(text, braceIndex);
  if (end < 0) return [];
  const body = text.slice(braceIndex + 1, end);
  if (body.includes("{")) return [];
  const entries: Array<[string, string]> = [];
  for (const match of body.matchAll(
    /(?:^|[,\n])\s*([A-Za-z_$][\w$]*)\s*:\s*(true|false|-?\d+(?:\.\d+)?|"[^"\n]{0,80}"|'[^'\n]{0,80}')\s*(?=,|\n|$)/g,
  ))
    entries.push([match[1], match[2].replace(/^["']|["']$/g, "")]);
  return entries.slice(0, 20);
}

export function routePathFor(filePath: string) {
  const parts = filePath.split("/");
  const appIndex = parts.findLastIndex(
    (part) => part === "app" || part === "pages",
  );
  if (appIndex < 0) return null;
  const segments = parts
    .slice(appIndex + 1, -1)
    .filter((segment) => !/^\(.*\)$/.test(segment) && segment !== "");
  const file = parts.at(-1) ?? "";
  if (parts[appIndex] === "pages") {
    const name = file.replace(/\.[^.]+$/, "");
    if (name !== "index") segments.push(name);
  }
  const route = `/${segments.join("/")}`.replace(/\/+/g, "/");
  return route === "" ? "/" : route;
}

export function analyzeSourceFile(file: ScannedTextFile): FileAnalysis {
  const extension = path.posix.extname(file.path).toLowerCase();
  const language = LANGUAGES[extension] ?? "Text";
  const text = file.text;
  const analysis: FileAnalysis = {
    path: file.path,
    language,
    exports: [],
    routeHandlers: [],
    routePath: routePathFor(file.path),
    imports: [],
    packages: [],
    dataAccess: [],
    authChecks: [],
    validationSchemas: [],
    emittedEvents: [],
    isServerAction: /^\s*["']use server["']/m.test(text.slice(0, 400)),
    isClientComponent: /^\s*["']use client["']/m.test(text.slice(0, 400)),
    prismaModels: [],
  };

  if (extension === ".prisma") {
    for (const match of text.matchAll(/^\s*model\s+([A-Za-z_]\w*)\s*\{/gm)) {
      const start = match.index ?? 0;
      const end = blockEnd(text, start + match[0].lastIndexOf("{"));
      const body = end > 0 ? text.slice(start + match[0].length, end) : "";
      const fields = [...body.matchAll(/^\s*([a-zA-Z_]\w*)\s+[A-Za-z_]/gm)]
        .map((field) => field[1])
        .filter((field) => !field.startsWith("@"))
        .slice(0, 60);
      analysis.prismaModels.push({
        name: match[1],
        fields,
        line: lineAt(text, start),
        endLine: end > 0 ? lineAt(text, end) : lineAt(text, start),
      });
    }
    return analysis;
  }

  if (!["TypeScript", "JavaScript"].includes(language)) return analysis;

  for (const match of text.matchAll(
    /^\s*import\s+(?:type\s+)?(?:([\w$]+)|\*\s+as\s+([\w$]+)|\{([^}]*)\}|([\w$]+)\s*,\s*\{([^}]*)\})?\s*(?:from\s*)?["']([^"']+)["']/gm,
  )) {
    const specifier = match[6];
    const names = [
      match[1],
      match[2],
      match[4],
      ...(match[3] ?? match[5] ?? "").split(",").map(
        (name) =>
          name
            .trim()
            .replace(/^type\s+/, "")
            .split(/\s+as\s+/)[0],
      ),
    ].filter((name): name is string => Boolean(name));
    analysis.imports.push({
      specifier,
      names,
      line: lineAt(text, match.index ?? 0),
    });
    if (
      !specifier.startsWith(".") &&
      !specifier.startsWith("@/") &&
      !specifier.startsWith("~/")
    ) {
      const packageName = specifier.startsWith("@")
        ? specifier.split("/").slice(0, 2).join("/")
        : specifier.split("/")[0];
      if (!analysis.packages.includes(packageName))
        analysis.packages.push(packageName);
    }
  }

  const exportPattern =
    /^\s*export\s+(default\s+)?(async\s+)?(function\s*\*?|class|const|let|var|type|interface|enum)\s+([A-Za-z_$][\w$]*)/gm;
  for (const match of text.matchAll(exportPattern)) {
    const [, isDefault, isAsync, declaration, name] = match;
    const start = match.index ?? 0;
    const line = lineAt(text, start);
    const kind: ExportedSymbol["kind"] = declaration.startsWith("function")
      ? "function"
      : declaration === "class"
        ? "class"
        : declaration === "type" ||
            declaration === "interface" ||
            declaration === "enum"
          ? "type"
          : "const";
    let endLine: number | undefined;
    let entries: Array<[string, string]> = [];
    const braceIndex = text.indexOf("{", start + match[0].length);
    const statementEnd = text.indexOf("\n", start + match[0].length);
    if (kind === "function" || kind === "class") {
      const end = braceIndex >= 0 ? blockEnd(text, braceIndex) : -1;
      if (end > 0) endLine = lineAt(text, end);
    } else if (kind === "const") {
      const assignment = text.slice(
        start + match[0].length,
        statementEnd < 0 ? undefined : statementEnd,
      );
      if (/=\s*\{\s*$/.test(assignment) || /=\s*\{/.test(assignment)) {
        const objectBrace = text.indexOf("{", start + match[0].length);
        if (objectBrace >= 0) {
          entries = literalEntries(text, objectBrace);
          const end = blockEnd(text, objectBrace);
          if (end > 0) endLine = lineAt(text, end);
        }
      } else if (
        /=\s*(?:async\s*)?\(.*\)\s*=>/.test(assignment) ||
        /=\s*(?:async\s+)?function/.test(assignment)
      ) {
        const end = braceIndex >= 0 ? blockEnd(text, braceIndex) : -1;
        if (end > 0) endLine = lineAt(text, end);
      }
      if (
        /=\s*z\s*\.\s*(object|array|string|number|enum|union|discriminatedUnion)\s*\(/.test(
          assignment,
        )
      )
        analysis.validationSchemas.push(name);
    }
    analysis.exports.push({
      name,
      kind,
      line,
      endLine,
      isDefault: Boolean(isDefault),
      isAsync: Boolean(isAsync),
      literalEntries: entries,
    });
  }

  for (const symbol of analysis.exports) {
    if (
      symbol.kind === "function" &&
      /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.test(symbol.name)
    )
      analysis.routeHandlers.push({
        method: symbol.name,
        line: symbol.line,
        endLine: symbol.endLine,
      });
  }

  for (const match of text.matchAll(
    /\b(?:prisma|db|database|client)\.([a-z][A-Za-z0-9]*)\.(findMany|findUnique|findFirst|findUniqueOrThrow|findFirstOrThrow|count|aggregate|groupBy|create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(/g,
  )) {
    const [, model, operation] = match;
    const access = READ_OPERATIONS.has(operation)
      ? "read"
      : WRITE_OPERATIONS.has(operation)
        ? "write"
        : null;
    if (!access) continue;
    if (
      !analysis.dataAccess.some(
        (item) => item.model === model && item.operation === operation,
      )
    )
      analysis.dataAccess.push({ model, operation, access });
  }

  for (const [pattern, label] of AUTH_PATTERNS)
    if (pattern.test(text) && !analysis.authChecks.includes(label))
      analysis.authChecks.push(label);

  for (const match of text.matchAll(
    /\.(?:emit|publish|dispatch|send)\s*\(\s*["']([A-Za-z][\w.:-]{2,80})["']/g,
  ))
    if (!analysis.emittedEvents.includes(match[1]))
      analysis.emittedEvents.push(match[1]);

  return analysis;
}

export function humanizeSymbol(name: string) {
  const spaced = name
    .replace(/^(handle|use)(?=[A-Z])/, "")
    .replace(/[-_]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .trim()
    .toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function isTypeOnlyFile(analysis: FileAnalysis) {
  return (
    analysis.exports.length > 0 &&
    analysis.exports.every((symbol) => symbol.kind === "type")
  );
}
