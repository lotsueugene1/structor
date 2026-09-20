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
