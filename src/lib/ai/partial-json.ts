function skipSpace(source: string, index: number) {
  while (index < source.length && /\s/.test(source[index])) index += 1;
  return index;
}

function findJsonArray(source: string, key: string) {
  const pattern = new RegExp(`"${key}"\\s*:`);
  const match = pattern.exec(source);
  if (!match) return -1;
  const index = skipSpace(source, match.index + match[0].length);
  return source[index] === "[" ? index + 1 : -1;
}

function readJsonValue(source: string, start: number) {
  const opener = source[start];
  if (opener !== "{" && opener !== "[") return null;
  const closer = opener === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (inString) {
      if (escape) escape = false;
      else if (character === "\\") escape = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      continue;
    }
    if (character === opener) depth += 1;
    else if (character === closer) {
      depth -= 1;
      if (depth === 0) {
        try {
          return {
            value: JSON.parse(source.slice(start, index + 1)) as unknown,
            end: index + 1,
          };
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

export function extractCompleteJsonArray(source: string, key: string) {
  let index = findJsonArray(source, key);
  if (index < 0) return [];
  const items: unknown[] = [];
  while (index < source.length) {
    index = skipSpace(source, index);
    if (source[index] === "]") break;
    if (source[index] === ",") {
      index += 1;
      continue;
    }
    if (source[index] !== "{" && source[index] !== "[") break;
    const parsed = readJsonValue(source, index);
    if (!parsed) break;
    items.push(parsed.value);
    index = parsed.end;
  }
  return items;
}

function extractInProgressRecord(source: string, key: string) {
  let index = findJsonArray(source, key);
  if (index < 0) return null;
  while (index < source.length) {
    index = skipSpace(source, index);
    if (!source[index] || source[index] === "]") return null;
    if (source[index] === ",") {
      index += 1;
      continue;
    }
    if (source[index] !== "{") return null;
    const parsed = readJsonValue(source, index);
    if (parsed) {
      index = parsed.end;
      continue;
    }
    const fragment = source.slice(index);
    const name = extractJsonStringField(fragment, "name");
    if (!name) return null;
    const id = extractJsonStringField(fragment, "id");
    const kind = extractJsonStringField(fragment, "kind");
    const summary = extractJsonStringField(fragment, "summary");
    return {
      ...(id ? { id } : {}),
      name,
      ...(kind ? { kind } : {}),
      ...(summary ? { summary } : {}),
    };
  }
  return null;
}

export function extractJsonArray(source: string, key: string) {
  const items = extractCompleteJsonArray(source, key);
  const inProgress = extractInProgressRecord(source, key);
  const name =
    typeof inProgress?.name === "string" ? inProgress.name.trim() : "";
  if (!inProgress || !name) return items;
  const id =
    typeof inProgress.id === "string" && inProgress.id.trim()
      ? inProgress.id.trim()
      : name;
  const last = asRecord(items[items.length - 1]);
  if (last && last.id === id) return items;
  return [...items, { ...inProgress, id, name }];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function extractJsonStringField(source: string, key: string) {
  const pattern = new RegExp(`"${key}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`);
  const match = pattern.exec(source);
  if (!match) return undefined;
  try {
    return JSON.parse(`"${match[1]}"`) as string;
  } catch {
    return match[1];
  }
}
