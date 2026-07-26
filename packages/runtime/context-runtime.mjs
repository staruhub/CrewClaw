import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";

import {
  computeMemoryStateHash,
  estimateInjectionTokens,
  normalizeMemoryText,
} from "./memory-hash.mjs";
import { loadMemory } from "./memory-store.mjs";
import {
  readStateFileGuarded,
  resolveStatePath,
  withStateLock,
  writeJsonAtomic,
} from "./state-lock.mjs";
import yaml from "./yaml.mjs";

export const SKILL_DESCRIPTION_LIMIT = 1536;
export const DEFAULT_CONTEXT_TOKENS = 200_000;
export const DEFAULT_MEMORY_INDEX_TOKENS = 1_000;

export const contextToolSchemas = [
  {
    type: "function",
    function: {
      name: "use_skill",
      description:
        "Load the complete instructions for one installed employee skill after selecting it from the system skill index.",
      parameters: {
        type: "object",
        properties: {
          id: {
            type: "string",
            description: "Exact skill id from the installed skill index.",
          },
        },
        required: ["id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "recall_memory",
      description:
        "Recall full employee memory by exact id or search query after consulting the system memory index.",
      parameters: {
        type: "object",
        properties: {
          id: {
            type: "string",
            description: "Exact memory id from the memory index.",
          },
          query: {
            type: "string",
            description:
              "Text query used when an exact memory id is not known. Provide id or query (at least one).",
          },
        },
        // NOTE: no top-level anyOf/oneOf here — OpenAI-compatible gateways
        // (ZENMUX/xAI verified 2026-07-17) reject non-object union roots with
        // HTTP 400, which killed every request. The id-or-query rule is
        // enforced by the runtime handler instead.
      },
    },
  },
];

const SAFE_EMPLOYEE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SAFE_SKILL_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CONFIDENCE_RANK = { high: 3, medium: 2, low: 1 };

function booleanFrontmatter(metadata, key, fallback) {
  if (metadata[key] === undefined) return fallback;
  if (typeof metadata[key] !== "boolean") {
    throw new Error(`SKILL.md frontmatter ${key} must be a boolean`);
  }
  return metadata[key];
}

function splitAllowedToolString(value) {
  const entries = [];
  let current = "";
  let depth = 0;
  for (const character of String(value || "")) {
    if (/\s/.test(character) && depth === 0) {
      if (current.trim()) entries.push(current.trim());
      current = "";
      continue;
    }
    if (character === "(") depth += 1;
    if (character === ")") {
      depth -= 1;
      if (depth < 0)
        throw new Error("SKILL.md allowed-tools has unbalanced parentheses");
    }
    current += character;
  }
  if (depth !== 0)
    throw new Error("SKILL.md allowed-tools has unbalanced parentheses");
  if (current.trim()) entries.push(current.trim());
  return entries;
}

function normalizeAllowedTools(value) {
  if (value === undefined) return null;
  const entries = Array.isArray(value)
    ? value.map(item => String(item || "").trim()).filter(Boolean)
    : typeof value === "string"
      ? splitAllowedToolString(value)
      : null;
  if (!entries) {
    throw new Error(
      "SKILL.md frontmatter allowed-tools must be a string or list"
    );
  }
  if (entries.length > 64 || entries.some(entry => entry.length > 160)) {
    throw new Error(
      "SKILL.md allowed-tools exceeds the bounded declaration size"
    );
  }
  const seen = new Set();
  return entries.filter(entry => {
    if (/[\r\n\0]/.test(entry)) {
      throw new Error("SKILL.md allowed-tools contains a control character");
    }
    const key = entry.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function allowedToolMatches(declaration, toolName) {
  const base = String(declaration || "")
    .split("(", 1)[0]
    .trim()
    .toLowerCase();
  const tool = String(toolName || "")
    .trim()
    .toLowerCase();
  return base === "*" || base === tool;
}

function parseFrontmatter(text) {
  const match = String(text || "").match(
    /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/
  );
  if (!match) throw new Error("SKILL.md is missing YAML frontmatter");
  const parsed = yaml.load(match[1]);
  if (!parsed || typeof parsed !== "object") {
    throw new Error("SKILL.md frontmatter must be an object");
  }
  return parsed;
}

export function buildSkillCatalog(skillFiles = []) {
  const seen = new Set();
  return skillFiles.map((file, index) => {
    const metadata = parseFrontmatter(file?.text);
    const id = String(metadata.name || "").trim();
    const description = String(metadata.description || "").trim();
    if (!SAFE_SKILL_ID.test(id)) {
      throw new Error(
        `invalid skill id in ${file?.relativePath || index}: ${id || "missing"}`
      );
    }
    if (!description) {
      throw new Error(
        `missing skill description in ${file?.relativePath || id}`
      );
    }
    if (seen.has(id)) throw new Error(`duplicate skill id: ${id}`);
    seen.add(id);
    const userInvocable = booleanFrontmatter(metadata, "user-invocable", true);
    const disableModelInvocation = booleanFrontmatter(
      metadata,
      "disable-model-invocation",
      false
    );
    return {
      id,
      name: id,
      description,
      allowedTools: normalizeAllowedTools(metadata["allowed-tools"]),
      userInvocable,
      modelInvocable: !disableModelInvocation,
      relativePath: file.relativePath,
      text: file.text,
    };
  });
}

// `allowed-tools` is compatible with Agent Skills frontmatter, but CrewClaw deliberately treats
// it as an activation-time upper bound rather than a self-issued grant. Returning `allowed:true`
// here never authorizes a call; the normal Gateway/P0-P4 decision still runs afterwards.
export function activeSkillToolPolicy(
  catalog = [],
  activeSkillIds = [],
  toolName
) {
  if (toolName === "use_skill") return { allowed: true, scopedSkills: [] };
  const active = new Set(activeSkillIds);
  const scoped = catalog.filter(
    skill => active.has(skill.id) && Array.isArray(skill.allowedTools)
  );
  if (scoped.length === 0) return { allowed: true, scopedSkills: [] };
  const allowed = scoped.some(skill =>
    skill.allowedTools.some(declaration =>
      allowedToolMatches(declaration, toolName)
    )
  );
  return {
    allowed,
    scopedSkills: scoped.map(skill => skill.id),
    declarations: scoped.flatMap(skill => skill.allowedTools),
  };
}

function usagePath(root, employeeId) {
  if (!SAFE_EMPLOYEE_ID.test(String(employeeId || ""))) {
    throw new Error("invalid skill usage employee id");
  }
  return resolveStatePath(
    join(root, ".crewclaw", "skill-usage", `${employeeId}.json`),
    root
  );
}

export function loadSkillUsage(root, employeeId) {
  try {
    const file = usagePath(root, employeeId);
    if (!existsSync(file)) return {};
    const parsed = JSON.parse(
      readStateFileGuarded(file, { root }).toString("utf8")
    );
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return {};
    return Object.fromEntries(
      Object.entries(parsed)
        .filter(
          ([id, value]) =>
            SAFE_SKILL_ID.test(id) &&
            Number.isSafeInteger(value?.count) &&
            value.count >= 0
        )
        .map(([id, value]) => [id, value])
    );
  } catch {
    return {};
  }
}

export function recordSkillUse(root, employeeId, skillId) {
  if (!SAFE_SKILL_ID.test(String(skillId || ""))) {
    throw new Error("invalid skill id");
  }
  const file = usagePath(root, employeeId);
  return withStateLock(
    `${file}.lock`,
    () => {
      const usage = loadSkillUsage(root, employeeId);
      const previous = usage[skillId];
      usage[skillId] = {
        count: (Number(previous?.count) || 0) + 1,
        last_used_at: new Date().toISOString(),
      };
      writeJsonAtomic(file, usage, { root });
      return usage[skillId];
    },
    { root }
  );
}

export function buildSkillIndex(
  catalog = [],
  { contextTokens = DEFAULT_CONTEXT_TOKENS, usage = {} } = {}
) {
  const budgetTokens = Math.max(1, Math.floor(contextTokens * 0.01));
  const hidden = catalog.filter(skill => skill.modelInvocable === false);
  const candidates = catalog
    .filter(skill => skill.modelInvocable !== false)
    .map(skill => ({
      ...skill,
      indexDescription: String(skill.description || "").slice(
        0,
        SKILL_DESCRIPTION_LIMIT
      ),
      useCount: Number(usage[skill.id]?.count) || 0,
    }))
    .sort((left, right) => {
      if (right.useCount !== left.useCount)
        return right.useCount - left.useCount;
      return left.id.localeCompare(right.id, "en");
    });
  const header =
    "# Installed Skills (index)\nSelect a relevant skill, then call use_skill({id}) before following its full instructions.";
  const included = [];
  const headerTokens = estimateInjectionTokens(header);
  if (headerTokens > budgetTokens) {
    return {
      text: "",
      included: [],
      dropped: [...hidden, ...candidates],
      estimatedTokens: 0,
      budgetTokens,
    };
  }
  let estimatedTokens = headerTokens;
  for (const skill of candidates) {
    const tools = Array.isArray(skill.allowedTools)
      ? ` [tools: ${skill.allowedTools.join(", ") || "none"}]`
      : "";
    const line = `- ${skill.id}: ${skill.indexDescription}${tools}`;
    const tokens = estimateInjectionTokens(line);
    if (estimatedTokens + tokens > budgetTokens) continue;
    included.push(skill);
    estimatedTokens += tokens;
  }
  return {
    text: included.length
      ? `${header}\n${included
          .sort((left, right) => left.id.localeCompare(right.id, "en"))
          .map(skill => {
            const tools = Array.isArray(skill.allowedTools)
              ? ` [tools: ${skill.allowedTools.join(", ") || "none"}]`
              : "";
            return `- ${skill.id}: ${skill.indexDescription}${tools}`;
          })
          .join("\n")}`
      : "",
    included,
    dropped: [
      ...hidden,
      ...candidates.filter(skill => !included.includes(skill)),
    ],
    estimatedTokens: included.length ? estimatedTokens : 0,
    budgetTokens,
  };
}

export function memoryId(item) {
  const semantic = `${String(item?.category || "unknown")}\n${normalizeMemoryText(item?.text)}`;
  return `mem-${createHash("sha256").update(semantic).digest("hex").slice(0, 16)}`;
}

function memorySummary(text, maxCharacters = 96) {
  const normalized = normalizeMemoryText(text).replace(/^[-*#]+\s*/, "");
  if (normalized.length <= maxCharacters) return normalized;
  return `${normalized.slice(0, maxCharacters - 1).trimEnd()}…`;
}

function activeMemoryItems(items, now = Date.now()) {
  return (Array.isArray(items) ? items : []).filter(item => {
    if (!item || typeof item.text !== "string" || !item.text.trim())
      return false;
    if (item.status !== undefined && item.status !== "active") return false;
    if (!item.valid_until) return true;
    const validUntil = Date.parse(item.valid_until);
    return !Number.isFinite(validUntil) || validUntil >= now;
  });
}

export function buildMemoryIndex(
  items = [],
  { budgetTokens = DEFAULT_MEMORY_INDEX_TOKENS, now = Date.now() } = {}
) {
  const header =
    "# Memory (index)\nThis is a summary index, not the full memory. Call recall_memory({id}) or recall_memory({query}) before relying on details.";
  const candidates = activeMemoryItems(items, now)
    .map(item => ({
      item,
      id: memoryId(item),
      category: String(item.category || "unknown"),
      summary: memorySummary(item.text),
      confidence:
        typeof item.confidence === "string" && item.confidence.trim()
          ? item.confidence.trim().toLowerCase()
          : "unknown",
      fullEstimatedTokens: estimateInjectionTokens(item.text),
    }))
    .sort((left, right) => {
      const confidence =
        (CONFIDENCE_RANK[right.confidence] ?? 0) -
        (CONFIDENCE_RANK[left.confidence] ?? 0);
      if (confidence !== 0) return confidence;
      const rightTime = Date.parse(right.item.savedAt || "") || 0;
      const leftTime = Date.parse(left.item.savedAt || "") || 0;
      if (rightTime !== leftTime) return rightTime - leftTime;
      return left.id.localeCompare(right.id, "en");
    });
  const included = [];
  let estimatedTokens = estimateInjectionTokens(header);
  for (const entry of candidates) {
    const line = `- [${entry.category}] ${entry.id}: ${entry.summary}`;
    const tokens = estimateInjectionTokens(line);
    if (estimatedTokens + tokens > budgetTokens) continue;
    included.push(entry);
    estimatedTokens += tokens;
  }
  return {
    text: included.length
      ? `${header}\n${included
          .map(entry => `- [${entry.category}] ${entry.id}: ${entry.summary}`)
          .join("\n")}`
      : "",
    included,
    dropped: candidates.filter(entry => !included.includes(entry)),
    estimatedTokens,
    fullEstimatedTokens: candidates.reduce(
      (sum, entry) => sum + entry.fullEstimatedTokens,
      0
    ),
    budgetTokens,
  };
}

export function recallMemory(items, { id, query, now = Date.now() } = {}) {
  const exactId = String(id || "").trim();
  const normalizedQuery = normalizeMemoryText(query).toLowerCase();
  if (!exactId && !normalizedQuery) {
    throw new Error("recall_memory requires id or query");
  }
  const active = activeMemoryItems(items, now).map(item => ({
    id: memoryId(item),
    item,
  }));
  const matches = exactId
    ? active.filter(entry => entry.id === exactId)
    : active
        .map(entry => ({
          ...entry,
          score: normalizeMemoryText(
            `${entry.item.category} ${entry.item.text}`
          )
            .toLowerCase()
            .split(normalizedQuery).length,
        }))
        .filter(entry => entry.score > 1)
        .sort((left, right) => right.score - left.score)
        .slice(0, 5);
  if (matches.length === 0) return "（没有匹配的记忆）";
  return matches
    .map(
      entry =>
        `## ${entry.id}\ncategory: ${entry.item.category}\nconfidence: ${entry.item.confidence || "unknown"}\n\n${String(entry.item.text).trim()}`
    )
    .join("\n\n---\n\n");
}

export function buildIndexedSystem({
  soul,
  degradedPrompt = "",
  skillCatalog = [],
  root,
  employeeId,
  contextTokens = DEFAULT_CONTEXT_TOKENS,
  memoryBudgetTokens = DEFAULT_MEMORY_INDEX_TOKENS,
} = {}) {
  const skillIndex = buildSkillIndex(skillCatalog, {
    contextTokens,
    usage: root && employeeId ? loadSkillUsage(root, employeeId) : {},
  });
  const memory =
    root && employeeId ? loadMemory(root, employeeId) : { items: [] };
  const memoryIndex = buildMemoryIndex(memory.items, {
    budgetTokens: memoryBudgetTokens,
  });
  const memoryState = computeMemoryStateHash(memory.items);
  const parts = [String(soul || "").trim()];
  if (skillIndex.text) parts.push(skillIndex.text);
  if (memoryIndex.text) parts.push(memoryIndex.text);
  if (degradedPrompt) parts.push(String(degradedPrompt).trim());
  return {
    system: parts.filter(Boolean).join("\n\n"),
    skillIndex,
    memoryIndex,
    memoryState,
  };
}

export function loadRecalledMemory(root, employeeId, args) {
  const memory = loadMemory(root, employeeId);
  return recallMemory(memory.items, args);
}
