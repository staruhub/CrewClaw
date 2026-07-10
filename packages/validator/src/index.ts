import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { z } from "zod";
import { EmployeeManifestSchema, type EmployeeManifest } from "../../../contracts/manifest";
import { EmployeeSpecSchema, type EmployeeSpec } from "../../../contracts/employee-spec";
import { isForbiddenPath } from "../../../contracts/forbidden-paths";
import { getAvailableExperts } from "../../registry/src/index";
// The spec file uses dotted map keys (tool_needs: web.search / artifact.report), which this
// module's hand-rolled parseYaml silently drops (its key regex is [A-Za-z0-9_]+). Parse the spec
// with the runtime's YAML module instead — it already handles the whale prototype end to end.
// @ts-expect-error — untyped runtime .mjs module.
import runtimeYaml from "../../runtime/yaml.mjs";

const requiredFiles = [
  "distribution.yaml",
  "README.md",
  "SOUL.md",
  "config.yaml",
  "mcp.json",
  ".env.EXAMPLE",
  "CERTIFICATION.md",
  "EXAMPLES.md",
  "EVALS.md",
  "CHANGELOG.md",
];

const secretPatterns = [
  /sk-[A-Za-z0-9_-]{20,}/,
  /gh[pousr]_[A-Za-z0-9_]{20,}/,
  /sk-ant-[A-Za-z0-9_-]{20,}/,
  /Bearer\s+[A-Za-z0-9._-]{20,}/i,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
];

const distributionSchema = z.object({
  name: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  description: z.string().min(20),
  hermes_requires: z.string().min(1),
  author: z.string().min(1),
  license: z.string().min(1),
});

export type ValidationResult = {
  name: string;
  root: string;
  ok: boolean;
  errors: string[];
  warnings: string[];
};

export type ValidateAllResult = {
  ok: boolean;
  results: ValidationResult[];
};

type RegistryExpertForValidation = {
  name: string;
  version: string | null;
  local_source: string | null;
};

function parseScalar(value: string) {
  const trimmed = value.trim();
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  // Inline empty collections are valid YAML (e.g. `env: []` for an expert needing no env vars);
  // without this they parse as the literal string "[]" and fail array-typed schema fields.
  if (trimmed === "[]") return [];
  if (trimmed === "{}") return {};
  if (trimmed.startsWith("\"") && trimmed.endsWith("\"")) return trimmed.slice(1, -1);
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) return trimmed.slice(1, -1);
  return trimmed;
}

type YamlLine = {
  indent: number;
  text: string;
};

function parseYamlLines(raw: string): YamlLine[] {
  return raw
    .split(/\r?\n/)
    .filter((line) => line.trim() && !line.trimStart().startsWith("#"))
    .map((line) => ({
      indent: line.match(/^ */)?.[0].length ?? 0,
      text: line.trim(),
    }));
}

function parseYamlBlock(lines: YamlLine[], index: number, indent: number): [unknown, number] {
  if (lines[index]?.text.startsWith("- ")) return parseYamlArray(lines, index, indent);
  return parseYamlObject(lines, index, indent);
}

function parseYamlArray(lines: YamlLine[], index: number, indent: number): [unknown[], number] {
  const output: unknown[] = [];
  while (index < lines.length && lines[index].indent === indent && lines[index].text.startsWith("- ")) {
    const item = lines[index].text.slice(2).trim();
    index += 1;
    if (item) {
      const inlineObjectItem = item.match(/^([A-Za-z0-9_]+):(?:\s+(.*)|\s*)$/);
      if (inlineObjectItem) {
        const [, key, value = ""] = inlineObjectItem;
        const objectItem: Record<string, unknown> = {
          [key]: parseScalar(value),
        };
        if (index < lines.length && lines[index].indent > indent) {
          const [continuation, nextIndex] = parseYamlBlock(lines, index, lines[index].indent);
          if (continuation && typeof continuation === "object" && !Array.isArray(continuation)) {
            Object.assign(objectItem, continuation);
            index = nextIndex;
          }
        }
        output.push(objectItem);
      } else {
        output.push(parseScalar(item));
      }
    } else {
      const [nested, nextIndex] = parseYamlBlock(lines, index, indent + 2);
      output.push(nested);
      index = nextIndex;
    }
  }
  return [output, index];
}

function parseYamlObject(lines: YamlLine[], index: number, indent: number): [Record<string, unknown>, number] {
  const output: Record<string, unknown> = {};
  while (index < lines.length && lines[index].indent === indent && !lines[index].text.startsWith("- ")) {
    const match = lines[index].text.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (!match) {
      index += 1;
      continue;
    }
    const [, key, value] = match;
    index += 1;
    if (value) {
      output[key] = parseScalar(value);
    } else {
      const [nested, nextIndex] = parseYamlBlock(lines, index, indent + 2);
      output[key] = nested;
      index = nextIndex;
    }
  }
  return [output, index];
}

export function parseYaml(raw: string): unknown {
  const lines = parseYamlLines(raw);
  if (lines.length === 0) return {};
  return parseYamlBlock(lines, 0, lines[0].indent)[0];
}

function parseTopLevelYaml(raw: string): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith("#") || line.startsWith(" ")) continue;
    const match = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (!match) continue;
    data[match[1]] = parseScalar(match[2]);
  }
  return data;
}

function parseFrontmatter(raw: string): Record<string, unknown> | null {
  if (!raw.startsWith("---\n")) return null;
  const end = raw.indexOf("\n---", 4);
  if (end < 0) return null;
  return parseTopLevelYaml(raw.slice(4, end));
}

async function walkFiles(root: string): Promise<string[]> {
  const output: string[] = [];
  async function visit(dir: string) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.name.startsWith("._")) continue;
      const absolute = join(dir, entry.name);
      const rel = relative(root, absolute).replace(/\\/g, "/");
      output.push(rel);
      if (entry.isDirectory()) await visit(absolute);
    }
  }
  await visit(root);
  return output;
}

function hasPotentialSecret(content: string) {
  return secretPatterns.some((pattern) => pattern.test(content));
}

function formatZodIssues(error: z.ZodError) {
  return error.issues.map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`).join("; ");
}

function isHighRiskPermission(permission: string) {
  const normalized = permission.toLowerCase();
  return (
    normalized === "mailbox:send" ||
    normalized === "contacts:write" ||
    normalized.endsWith(":delete") ||
    normalized.includes("payment") ||
    normalized.includes("payments") ||
    normalized.includes("billing") ||
    normalized.includes("charge")
  );
}

function displayPackageSource(cwd: string, root: string) {
  const relativePath = relative(cwd, root);
  return relativePath && !relativePath.startsWith("..") && !resolve(relativePath).startsWith("..")
    ? relativePath.replace(/\\/g, "/")
    : root;
}

function validateRegistryConsistency(
  manifest: EmployeeManifest,
  root: string,
  registryExpert: RegistryExpertForValidation,
  cwd: string,
  errors: string[],
) {
  if (registryExpert.name !== manifest.metadata.id) {
    errors.push(`Registry name mismatch: registry=${registryExpert.name} hire.yaml=${manifest.metadata.id}`);
  }
  if (registryExpert.version !== manifest.metadata.version) {
    errors.push(`Registry version mismatch: registry=${registryExpert.version} hire.yaml=${manifest.metadata.version}`);
  }
  const registrySource = registryExpert.local_source;
  if (registrySource) {
    const registryRoot = resolve(cwd, registrySource);
    if (registryRoot !== root) {
      errors.push(`Registry local_source mismatch: registry=${registrySource} package=${displayPackageSource(cwd, root)}`);
    }
  }
}

export async function validateExpert(
  inputRoot: string,
  registryExpert?: RegistryExpertForValidation,
  cwd = process.cwd(),
): Promise<ValidationResult> {
  const root = resolve(inputRoot);
  const name = root.split(/[\\/]/).at(-1) ?? root;
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const file of requiredFiles) {
    if (!existsSync(join(root, file))) errors.push(`Missing required file: ${file}`);
  }

  const allPaths = existsSync(root) ? await walkFiles(root) : [];
  for (const path of allPaths) {
    if (isForbiddenPath(path)) errors.push(`Forbidden path found: ${path}`);
  }

  const distributionPath = join(root, "distribution.yaml");
  let distributionVersion: string | null = null;
  if (existsSync(distributionPath)) {
    const raw = await readFile(distributionPath, "utf8");
    const parsed = distributionSchema.safeParse(parseTopLevelYaml(raw));
    if (!parsed.success) errors.push("Invalid distribution.yaml");
    else distributionVersion = parsed.data.version;
  }

  // v0.18 A4: the two-file employee standard is MANDATORY for available experts — a listed
  // employee without its hiring contract or runtime spec used to pass silently (if-exists).
  const hirePath = join(root, "hire.yaml");
  if (!existsSync(hirePath)) {
    errors.push("Missing required file: hire.yaml");
  } else {
    const raw = await readFile(hirePath, "utf8");
    const parsed = EmployeeManifestSchema.safeParse(parseYaml(raw));
    if (!parsed.success) {
      errors.push(`Invalid hire.yaml: ${formatZodIssues(parsed.error)}`);
    } else {
      const highRiskPermissions = parsed.data.permissions.filter(isHighRiskPermission);
      if (highRiskPermissions.length > 0) {
        warnings.push(`High-risk permissions declared in hire.yaml: ${highRiskPermissions.join(", ")}`);
      }
      if (registryExpert) validateRegistryConsistency(parsed.data, root, registryExpert, cwd, errors);
      if (distributionVersion && distributionVersion !== parsed.data.metadata.version) {
        errors.push(
          `Version mismatch: distribution.yaml=${distributionVersion} hire.yaml=${parsed.data.metadata.version}`,
        );
      }
    }
  }

  const specPath = join(root, "crewclaw.employee.yaml");
  if (!existsSync(specPath)) {
    errors.push("Missing required file: crewclaw.employee.yaml");
  } else {
    const raw = await readFile(specPath, "utf8");
    let specDoc: unknown;
    try {
      specDoc = (runtimeYaml as { load(raw: string): unknown }).load(raw);
    } catch (error) {
      specDoc = null;
      errors.push(`Unparseable crewclaw.employee.yaml: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (specDoc !== null) {
      const parsed = EmployeeSpecSchema.safeParse(specDoc);
      if (!parsed.success) {
        errors.push(`Invalid crewclaw.employee.yaml: ${formatZodIssues(parsed.error)}`);
      } else {
        const spec: EmployeeSpec = parsed.data;
        if (registryExpert && spec.identity.id !== registryExpert.name) {
          errors.push(`Spec identity.id mismatch: registry=${registryExpert.name} spec=${spec.identity.id}`);
        }
        if (registryExpert && registryExpert.version && spec.identity.version !== registryExpert.version) {
          errors.push(
            `Version mismatch: registry=${registryExpert.version} crewclaw.employee.yaml=${spec.identity.version}`,
          );
        }
      }
    }
  }

  const mcpPath = join(root, "mcp.json");
  if (existsSync(mcpPath)) {
    try {
      const parsed = JSON.parse(await readFile(mcpPath, "utf8")) as { mcp_servers?: Record<string, unknown> };
      for (const [serverName, serverConfig] of Object.entries(parsed.mcp_servers ?? {})) {
        const tools = (serverConfig as { tools?: { include?: unknown; exclude?: unknown } }).tools;
        if (!tools?.include && !tools?.exclude) errors.push(`MCP server must declare tool allowlist or denylist: ${serverName}`);
      }
    } catch {
      errors.push("Invalid mcp.json");
    }
  }

  const skillFiles = allPaths.filter((path) => path.endsWith("SKILL.md"));
  if (skillFiles.length === 0) warnings.push("No SKILL.md files found");
  for (const skillPath of skillFiles) {
    const raw = await readFile(join(root, skillPath), "utf8");
    const frontmatter = parseFrontmatter(raw);
    if (
      !frontmatter ||
      typeof frontmatter.name !== "string" ||
      typeof frontmatter.description !== "string" ||
      !frontmatter.description.startsWith("Use when")
    ) {
      errors.push(`Invalid skill frontmatter: ${skillPath}`);
    }
    if (raw.length > 20_000) warnings.push(`Large skill file: ${skillPath}`);
  }

  for (const path of allPaths) {
    const absolute = join(root, path);
    const info = await stat(absolute);
    if (!info.isFile() || info.size > 512_000) continue;
    const content = await readFile(absolute, "utf8");
    if (hasPotentialSecret(content)) errors.push(`Potential secret found: ${path}`);
  }

  return { name, root, ok: errors.length === 0, errors, warnings };
}

export async function validateAllExperts(cwd = process.cwd()): Promise<ValidateAllResult> {
  const results = await Promise.all(
    getAvailableExperts().map((expert) => validateExpert(join(cwd, expert.local_source ?? ""), expert, cwd)),
  );
  return { ok: results.every((result) => result.ok), results };
}
