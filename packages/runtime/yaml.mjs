import { createRequire } from "node:module";

let nativeYaml = null;
try {
  nativeYaml = createRequire(import.meta.url)("js-yaml");
} catch {
  nativeYaml = null;
}

function stripComment(line) {
  let quote = null;
  for (let index = 0; index < line.length; index += 1) {
    const ch = line[index];
    if ((ch === '"' || ch === "'") && line[index - 1] !== "\\") {
      quote = quote === ch ? null : quote || ch;
      continue;
    }
    if (ch === "#" && !quote && (index === 0 || /\s/.test(line[index - 1]))) {
      return line.slice(0, index).trimEnd();
    }
  }
  return line.trimEnd();
}

function yamlLines(raw) {
  return String(raw)
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map(stripComment)
    .filter(line => line.trim().length > 0)
    .map(line => ({
      indent: line.match(/^ */)?.[0].length || 0,
      text: line.trim(),
    }));
}

function splitKeyValue(text) {
  const match = text.match(/^([^:[\]{}][^:]*):(.*)$/);
  if (!match) return null;
  const rest = match[2];
  if (rest.length > 0 && !/^\s/.test(rest)) return null;
  return [match[1].trim(), rest.trim()];
}

function splitInlineItems(text) {
  const items = [];
  let quote = null;
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const ch = text[index];
    if ((ch === '"' || ch === "'") && text[index - 1] !== "\\") {
      quote = quote === ch ? null : quote || ch;
    } else if (ch === "," && !quote) {
      items.push(text.slice(start, index).trim());
      start = index + 1;
    }
  }
  items.push(text.slice(start).trim());
  return items.filter(Boolean);
}

function parseScalar(value) {
  const text = String(value).trim();
  if (text === "") return "";
  if (text === "null" || text === "~") return null;
  if (text === "true") return true;
  if (text === "false") return false;
  if (/^-?\d+(?:\.\d+)?$/.test(text)) return Number(text);
  if (
    (text.startsWith('"') && text.endsWith('"')) ||
    (text.startsWith("'") && text.endsWith("'"))
  ) {
    return text.slice(1, -1);
  }
  if (text.startsWith("[") && text.endsWith("]")) {
    return splitInlineItems(text.slice(1, -1)).map(parseScalar);
  }
  return text;
}

function parseValue(lines, index, indent) {
  if (index >= lines.length) return [{}, index];
  if (lines[index].indent < indent) return [{}, index];
  if (lines[index].text === "-" || lines[index].text.startsWith("- ")) {
    return parseArray(lines, index, lines[index].indent);
  }
  return parseObject(lines, index, lines[index].indent);
}

function parseObject(lines, index, indent) {
  const object = {};
  let cursor = index;

  while (cursor < lines.length) {
    const line = lines[cursor];
    if (line.indent < indent) break;
    if (line.indent > indent) break;
    if (line.text.startsWith("- ")) break;

    const pair = splitKeyValue(line.text);
    if (!pair) {
      cursor += 1;
      continue;
    }

    const [key, rest] = pair;
    if (rest.length > 0) {
      object[key] = parseScalar(rest);
      cursor += 1;
      continue;
    }

    if (cursor + 1 < lines.length && lines[cursor + 1].indent > line.indent) {
      const [nested, next] = parseValue(
        lines,
        cursor + 1,
        lines[cursor + 1].indent
      );
      object[key] = nested;
      cursor = next;
    } else {
      object[key] = {};
      cursor += 1;
    }
  }

  return [object, cursor];
}

function parseArrayObject(lines, cursor, parentIndent, firstPair) {
  const object = {};
  const [key, rest] = firstPair;
  object[key] = rest.length > 0 ? parseScalar(rest) : {};
  let next = cursor + 1;

  if (
    rest.length === 0 &&
    next < lines.length &&
    lines[next].indent > parentIndent
  ) {
    const [nested, nestedNext] = parseValue(lines, next, lines[next].indent);
    object[key] = nested;
    next = nestedNext;
  }

  while (next < lines.length && lines[next].indent > parentIndent) {
    const [nested, nestedNext] = parseObject(lines, next, lines[next].indent);
    Object.assign(object, nested);
    next = nestedNext;
  }

  return [object, next];
}

function parseArray(lines, index, indent) {
  const array = [];
  let cursor = index;

  while (cursor < lines.length) {
    const line = lines[cursor];
    if (
      line.indent !== indent ||
      (line.text !== "-" && !line.text.startsWith("- "))
    )
      break;

    const rest = line.text.slice(1).trim();
    if (rest.length === 0) {
      const [nested, next] =
        cursor + 1 < lines.length && lines[cursor + 1].indent > indent
          ? parseValue(lines, cursor + 1, lines[cursor + 1].indent)
          : [{}, cursor + 1];
      array.push(nested);
      cursor = next;
      continue;
    }

    // A quoted item is always a scalar — `- "0.1.0: note"` must not be split into a mapping.
    const pair =
      rest.startsWith('"') || rest.startsWith("'") ? null : splitKeyValue(rest);
    if (pair) {
      const [item, next] = parseArrayObject(lines, cursor, indent, pair);
      array.push(item);
      cursor = next;
      continue;
    }

    array.push(parseScalar(rest));
    cursor += 1;
  }

  return [array, cursor];
}

function loadFallback(raw) {
  const lines = yamlLines(raw);
  if (lines.length === 0) return {};
  return parseValue(lines, 0, lines[0].indent)[0];
}

function scalarForDump(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  const text = String(value);
  return /[:#\n]|^\s|\s$/.test(text) ? JSON.stringify(text) : text;
}

function dumpValue(value, indent = 0) {
  const pad = "  ".repeat(indent);
  if (Array.isArray(value)) {
    return value.flatMap(item => {
      if (item && typeof item === "object") {
        const nested = dumpValue(item, indent + 1);
        return [`${pad}-`, ...nested];
      }
      return [`${pad}- ${scalarForDump(item)}`];
    });
  }
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, item]) => {
      if (item && typeof item === "object")
        return [`${pad}${key}:`, ...dumpValue(item, indent + 1)];
      return [`${pad}${key}: ${scalarForDump(item)}`];
    });
  }
  return [`${pad}${scalarForDump(value)}`];
}

function dumpFallback(value) {
  return `${dumpValue(value).join("\n")}\n`;
}

export default {
  load(raw) {
    return nativeYaml?.load ? nativeYaml.load(raw) : loadFallback(raw);
  },
  dump(value, options) {
    return nativeYaml?.dump
      ? nativeYaml.dump(value, options)
      : dumpFallback(value);
  },
};
