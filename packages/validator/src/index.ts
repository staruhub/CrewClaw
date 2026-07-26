import { type Stats } from "node:fs";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import { z } from "zod";
import {
  EmployeeManifestSchema,
  type EmployeeManifest,
} from "../../../contracts/manifest";
import {
  EmployeeSpecSchema,
  type EmployeeSpec,
} from "../../../contracts/employee-spec";
import {
  TOOL_CAPABILITIES,
  type ToolCapability,
} from "../../../contracts/tool-catalog";
import {
  containsForbiddenSecret,
  EMPLOYEE_PACKAGE_LIMITS,
  isForbiddenPath,
  isSafePortablePackagePath,
  portablePathComparisonKey,
} from "../../../contracts/forbidden-paths";
import {
  getAvailableExperts,
  resolveExpertSource,
} from "../../registry/src/index";
// The spec file uses dotted map keys (tool_needs: web.search / artifact.report), which this
// module's hand-rolled parseYaml silently drops (its key regex is [A-Za-z0-9_]+). Parse the spec
// with the runtime's YAML module instead — it already handles the whale prototype end to end.
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

const HERMES_MINIMUM_REQUIREMENT = ">=0.18.2";
// Deliberately narrow allowlist of Hermes 0.18.2 bundles that CrewClaw currently knows how to
// derive from employee capabilities. This is not a claim to enumerate every upstream toolset.
const CREWCLAW_KNOWN_HERMES_TOOLSETS = new Set([
  "web",
  "search",
  "terminal",
  "file",
  "browser",
  "skills",
]);
const HERMES_SAFE_STANDALONE_TOOLSETS = new Set(["web", "search"]);
const HERMES_FORBIDDEN_TOOL_EXPANSIONS: Record<string, string[]> = {
  browser: ["browser_click", "browser_type"],
  code_execution: ["execute_code"],
  file: ["write_file", "patch"],
  skills: ["skill_manage"],
  terminal: ["terminal"],
};
const HERMES_REQUIRED_DISABLED_TOOLSETS = Object.keys(
  HERMES_FORBIDDEN_TOOL_EXPANSIONS
).sort();
const HERMES_SAFE_CAPABILITIES = new Set([
  "web.extract",
  "web.fetch",
  "web.fetch_extract",
  "web.search",
]);

const distributionSchema = z.object({
  name: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  description: z.string().min(20),
  hermes_requires: z.string().min(1),
  author: z.string().min(1),
  license: z.string().min(1),
});

type Distribution = z.infer<typeof distributionSchema>;

function isOfficialHermesToolset(value: string) {
  return (
    CREWCLAW_KNOWN_HERMES_TOOLSETS.has(value) ||
    /^mcp-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)
  );
}

function validateHermesConfig(raw: string, errors: string[]) {
  let document: unknown;
  try {
    document = (runtimeYaml as { load(raw: string): unknown }).load(raw);
  } catch (error) {
    errors.push(
      `Invalid config.yaml: ${error instanceof Error ? error.message : String(error)}`
    );
    return null;
  }
  if (!document || typeof document !== "object" || Array.isArray(document)) {
    errors.push("Invalid config.yaml: expected a YAML mapping");
    return null;
  }
  const config = document as Record<string, unknown>;
  if (config.model !== undefined && typeof config.model !== "string") {
    errors.push(
      "Invalid config.yaml: model must be a scalar string; legacy model.default is not supported"
    );
  }
  if (!Array.isArray(config.toolsets)) {
    errors.push(
      "Invalid config.yaml: toolsets must be an array of official Hermes toolset names; legacy toolsets.default is not supported"
    );
  } else {
    const invalid = config.toolsets.filter(
      value => typeof value !== "string" || !isOfficialHermesToolset(value)
    );
    if (invalid.length > 0) {
      errors.push(
        `Invalid config.yaml: unknown Hermes toolset(s): ${invalid.map(String).join(", ")}`
      );
    }
    const unsafe = config.toolsets.filter(
      (value): value is string =>
        typeof value === "string" && !HERMES_SAFE_STANDALONE_TOOLSETS.has(value)
    );
    for (const toolset of unsafe) {
      const expansion = HERMES_FORBIDDEN_TOOL_EXPANSIONS[toolset];
      errors.push(
        expansion
          ? `Unsafe standalone Hermes toolset: ${toolset} expands to forbidden tools ${expansion.join(", ")}`
          : `Unsafe standalone Hermes toolset: ${toolset} is not an audited read-only bundle`
      );
    }
    if (new Set(config.toolsets.map(String)).size !== config.toolsets.length)
      errors.push("Invalid config.yaml: toolsets must not contain duplicates");
  }
  const platformToolsets = config.platform_toolsets;
  const cliToolsets =
    platformToolsets &&
    typeof platformToolsets === "object" &&
    !Array.isArray(platformToolsets) &&
    Array.isArray((platformToolsets as Record<string, unknown>).cli)
      ? ((platformToolsets as Record<string, unknown>).cli as unknown[])
      : null;
  if (!cliToolsets) {
    errors.push(
      "Invalid config.yaml: platform_toolsets.cli must explicitly pin the standalone CLI toolsets"
    );
  } else {
    const invalidCli = cliToolsets.filter(
      value =>
        typeof value !== "string" ||
        (value !== "no_mcp" && !isOfficialHermesToolset(value))
    );
    if (invalidCli.length > 0)
      errors.push(
        `Invalid config.yaml: unknown platform_toolsets.cli entries: ${invalidCli.map(String).join(", ")}`
      );
    if (!cliToolsets.includes("no_mcp"))
      errors.push(
        "Invalid config.yaml: platform_toolsets.cli must include no_mcp to prevent inherited MCP tools"
      );
    const effectiveCli = cliToolsets.filter(value => value !== "no_mcp").sort();
    const rootToolsets = Array.isArray(config.toolsets)
      ? [...config.toolsets].sort()
      : [];
    if (JSON.stringify(effectiveCli) !== JSON.stringify(rootToolsets))
      errors.push(
        "Invalid config.yaml: platform_toolsets.cli must match toolsets (apart from no_mcp)"
      );
  }
  if (config.coding_context !== "off")
    errors.push(
      "Invalid config.yaml: coding_context must be off for employee profiles"
    );
  const agent = config.agent as Record<string, unknown> | undefined;
  const disabledToolsets = Array.isArray(agent?.disabled_toolsets)
    ? agent.disabled_toolsets.map(String)
    : [];
  const missingDisabled = HERMES_REQUIRED_DISABLED_TOOLSETS.filter(
    toolset => !disabledToolsets.includes(toolset)
  );
  if (missingDisabled.length > 0)
    errors.push(
      `Invalid config.yaml: agent.disabled_toolsets must include ${missingDisabled.join(", ")}`
    );
  const plugins = config.plugins as Record<string, unknown> | undefined;
  if (!Array.isArray(plugins?.enabled) || plugins.enabled.length !== 0)
    errors.push(
      "Invalid config.yaml: plugins.enabled must be an explicit empty allowlist"
    );
  const approvals = config.approvals;
  if (
    !approvals ||
    typeof approvals !== "object" ||
    Array.isArray(approvals) ||
    (approvals as Record<string, unknown>).mode !== "manual"
  ) {
    errors.push(
      "Invalid config.yaml: approvals.mode must be manual for employee profiles"
    );
  }
  return Array.isArray(config.toolsets)
    ? config.toolsets.filter(
        (value): value is string => typeof value === "string"
      )
    : null;
}

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
  if (trimmed.startsWith('"') && trimmed.endsWith('"'))
    return trimmed.slice(1, -1);
  if (trimmed.startsWith("'") && trimmed.endsWith("'"))
    return trimmed.slice(1, -1);
  return trimmed;
}

type YamlLine = {
  indent: number;
  text: string;
};

function parseYamlLines(raw: string): YamlLine[] {
  return raw
    .split(/\r?\n/)
    .filter(line => line.trim() && !line.trimStart().startsWith("#"))
    .map(line => ({
      indent: line.match(/^ */)?.[0].length ?? 0,
      text: line.trim(),
    }));
}

function parseYamlBlock(
  lines: YamlLine[],
  index: number,
  indent: number
): [unknown, number] {
  if (lines[index]?.text.startsWith("- "))
    return parseYamlArray(lines, index, indent);
  return parseYamlObject(lines, index, indent);
}

function parseYamlArray(
  lines: YamlLine[],
  index: number,
  indent: number
): [unknown[], number] {
  const output: unknown[] = [];
  while (
    index < lines.length &&
    lines[index].indent === indent &&
    lines[index].text.startsWith("- ")
  ) {
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
          const [continuation, nextIndex] = parseYamlBlock(
            lines,
            index,
            lines[index].indent
          );
          if (
            continuation &&
            typeof continuation === "object" &&
            !Array.isArray(continuation)
          ) {
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

function parseYamlObject(
  lines: YamlLine[],
  index: number,
  indent: number
): [Record<string, unknown>, number] {
  const output: Record<string, unknown> = {};
  while (
    index < lines.length &&
    lines[index].indent === indent &&
    !lines[index].text.startsWith("- ")
  ) {
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
    if (
      !line.trim() ||
      line.trimStart().startsWith("#") ||
      line.startsWith(" ")
    )
      continue;
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

type ValidatedFile = {
  absolute: string;
  metadata: Stats;
};

type PackageWalk = {
  root: string;
  allPaths: string[];
  files: Map<string, ValidatedFile>;
  errors: string[];
};

function pathIsWithin(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return (
    rel === "" ||
    (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
  );
}

function pathsEqual(left: string, right: string): boolean {
  return process.platform === "win32"
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}

function sameFileIdentity(left: Stats, right: Stats): boolean {
  return (
    left.isFile() &&
    right.isFile() &&
    left.nlink === 1 &&
    right.nlink === 1 &&
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs
  );
}

function safeRelativePackagePath(
  root: string,
  absolute: string
): string | null {
  const raw = relative(root, absolute);
  if (!raw || isAbsolute(raw)) return null;
  const segments = raw.split(sep);
  if (
    segments.some(
      segment =>
        !segment ||
        segment === "." ||
        segment === ".." ||
        segment.includes("/") ||
        segment.includes("\\")
    )
  ) {
    return null;
  }
  const normalized = segments.join("/");
  return isSafePortablePackagePath(normalized) ? normalized : null;
}

async function walkPackage(inputRoot: string): Promise<PackageWalk> {
  const requestedRoot = resolve(inputRoot);
  const output: PackageWalk = {
    root: requestedRoot,
    allPaths: [],
    files: new Map(),
    errors: [],
  };

  let rootMetadata: Stats;
  try {
    rootMetadata = await lstat(requestedRoot);
  } catch (error) {
    output.errors.push(
      `Cannot inspect expert root: ${error instanceof Error ? error.message : String(error)}`
    );
    return output;
  }
  if (rootMetadata.isSymbolicLink()) {
    output.errors.push("Expert root must not be a symlink or junction");
    return output;
  }
  if (!rootMetadata.isDirectory()) {
    output.errors.push("Expert root must be a directory");
    return output;
  }

  const canonicalRoot = await realpath(requestedRoot);
  output.root = canonicalRoot;
  if (!pathsEqual(canonicalRoot, requestedRoot)) {
    output.errors.push("Expert root must be a canonical non-link directory");
    return output;
  }

  const portablePaths = new Map<string, string>();

  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.name.startsWith("._")) continue;
      if (output.allPaths.length >= EMPLOYEE_PACKAGE_LIMITS.maxEntries) {
        output.errors.push(
          `Package exceeds ${EMPLOYEE_PACKAGE_LIMITS.maxEntries} entries`
        );
        return;
      }
      const absolute = join(directory, entry.name);
      const rel = safeRelativePackagePath(canonicalRoot, absolute);
      if (rel === null) {
        output.errors.push(`Unsafe non-portable package path: ${entry.name}`);
        continue;
      }
      const portableKey = portablePathComparisonKey(rel);
      const collidingPath = portablePaths.get(portableKey);
      if (collidingPath && collidingPath !== rel) {
        output.errors.push(
          `Case-folding package path collision: ${collidingPath} / ${rel}`
        );
      } else {
        portablePaths.set(portableKey, rel);
      }
      output.allPaths.push(rel);
      if (rel.split("/").length > EMPLOYEE_PACKAGE_LIMITS.maxDepth) {
        output.errors.push(
          `Package path exceeds ${EMPLOYEE_PACKAGE_LIMITS.maxDepth} levels: ${rel}`
        );
        continue;
      }

      const metadata = await lstat(absolute);
      if (metadata.isSymbolicLink()) {
        output.errors.push(`Unsafe symlink or junction found: ${rel}`);
        continue;
      }
      const canonical = await realpath(absolute);
      if (
        !pathIsWithin(canonicalRoot, canonical) ||
        !pathsEqual(canonical, absolute)
      ) {
        output.errors.push(`Path escapes the canonical expert root: ${rel}`);
        continue;
      }
      if (metadata.isDirectory()) {
        await visit(canonical);
      } else if (metadata.isFile()) {
        if (metadata.nlink !== 1) {
          output.errors.push(`Unsafe hardlink found: ${rel}`);
        } else {
          if (output.files.size >= EMPLOYEE_PACKAGE_LIMITS.maxFiles) {
            output.errors.push(
              `Package exceeds ${EMPLOYEE_PACKAGE_LIMITS.maxFiles} files`
            );
            return;
          }
          if (metadata.size > EMPLOYEE_PACKAGE_LIMITS.maxFileBytes) {
            output.errors.push(`Package file exceeds size limit: ${rel}`);
            continue;
          }
          output.files.set(rel, { absolute: canonical, metadata });
        }
      } else {
        output.errors.push(`Unsupported special file found: ${rel}`);
      }
    }
  }

  await visit(canonicalRoot);
  const totalBytes = [...output.files.values()].reduce(
    (sum, file) => sum + file.metadata.size,
    0
  );
  if (totalBytes > EMPLOYEE_PACKAGE_LIMITS.maxTotalBytes)
    output.errors.push(
      `Package exceeds ${EMPLOYEE_PACKAGE_LIMITS.maxTotalBytes} total bytes`
    );
  return output;
}

async function readValidatedBytes(file: ValidatedFile): Promise<Uint8Array> {
  const before = await lstat(file.absolute);
  if (before.isSymbolicLink() || !sameFileIdentity(before, file.metadata)) {
    throw new Error("file identity changed before open");
  }

  const handle = await open(file.absolute, "r");
  try {
    const opened = await handle.stat();
    if (!sameFileIdentity(opened, file.metadata)) {
      throw new Error("file identity changed while opening");
    }
    const content = await handle.readFile();
    const after = await lstat(file.absolute);
    if (after.isSymbolicLink() || !sameFileIdentity(after, opened)) {
      throw new Error("file identity changed while reading");
    }
    return content;
  } finally {
    await handle.close();
  }
}

async function readValidatedText(file: ValidatedFile): Promise<string> {
  return new TextDecoder("utf-8").decode(await readValidatedBytes(file));
}

async function readPackageText(
  fileName: string,
  files: Map<string, ValidatedFile>,
  errors: string[]
): Promise<string | null> {
  const file = files.get(fileName);
  if (!file) return null;
  try {
    return await readValidatedText(file);
  } catch (error) {
    errors.push(
      `Unsafe package file changed during validation: ${fileName} (${error instanceof Error ? error.message : String(error)})`
    );
    return null;
  }
}

async function readPackageBytes(
  fileName: string,
  files: Map<string, ValidatedFile>,
  errors: string[]
): Promise<Uint8Array | null> {
  const file = files.get(fileName);
  if (!file) return null;
  try {
    return await readValidatedBytes(file);
  } catch (error) {
    errors.push(
      `Unsafe package file changed during validation: ${fileName} (${error instanceof Error ? error.message : String(error)})`
    );
    return null;
  }
}

function formatZodIssues(error: z.ZodError) {
  return error.issues
    .map(issue => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
    .join("; ");
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
  return relativePath &&
    !relativePath.startsWith("..") &&
    !resolve(relativePath).startsWith("..")
    ? relativePath.replace(/\\/g, "/")
    : root;
}

function validateRegistryConsistency(
  manifest: EmployeeManifest,
  root: string,
  registryExpert: RegistryExpertForValidation,
  cwd: string,
  errors: string[]
) {
  if (registryExpert.name !== manifest.metadata.id) {
    errors.push(
      `Registry name mismatch: registry=${registryExpert.name} hire.yaml=${manifest.metadata.id}`
    );
  }
  if (registryExpert.version !== manifest.metadata.version) {
    errors.push(
      `Registry version mismatch: registry=${registryExpert.version} hire.yaml=${manifest.metadata.version}`
    );
  }
  const registrySource = registryExpert.local_source;
  if (registrySource) {
    const registryRoot = resolve(cwd, registrySource);
    if (!pathsEqual(registryRoot, root)) {
      errors.push(
        `Registry local_source mismatch: registry=${registrySource} package=${displayPackageSource(cwd, root)}`
      );
    }
  }
}

type EmployeeToolContract = Pick<
  EmployeeSpec,
  "tool_needs" | "permission_policy"
>;

export function validateEmployeeToolContract(
  spec: EmployeeToolContract,
  catalog: ReadonlyMap<string, ToolCapability> = TOOL_CAPABILITIES
): string[] {
  const errors: string[] = [];
  const {
    grants,
    denied,
    human_authorization_required: authorization,
  } = spec.permission_policy;
  const authorizationSet = new Set(authorization);

  for (const [id, need] of Object.entries(spec.tool_needs)) {
    const capability = catalog.get(id);
    if (!capability) {
      errors.push(`Unknown tool capability: ${id}`);
      continue;
    }

    if (
      need.necessity === "required" &&
      capability.runtime_tool === null &&
      capability.provider_bindings.length === 0
    ) {
      errors.push(`Required capability has no executable binding: ${id}`);
    }
    if (need.permission === "readonly" && capability.operation !== "read") {
      errors.push(
        `Readonly permission cannot grant ${capability.operation} capability: ${id}`
      );
    }
    if (need.permission === "write" && capability.operation !== "write") {
      errors.push(
        `Write permission does not match ${capability.operation} capability: ${id}`
      );
    }

    const isGranted = Object.hasOwn(grants, id);
    const isDenied = Object.hasOwn(denied, id);
    if (need.necessity === "disabled" && isGranted) {
      errors.push(`Disabled capability cannot be granted: ${id}`);
    }
    if (need.necessity !== "disabled" && isDenied) {
      errors.push(`Enabled capability cannot be denied: ${id}`);
    }
    if (
      need.permission === "requires_authorization" &&
      !authorizationSet.has(id)
    ) {
      errors.push(`Authorization-required capability is not gated: ${id}`);
    }
    if (
      need.permission !== "requires_authorization" &&
      authorizationSet.has(id)
    ) {
      errors.push(`Authorization gate references an ungated capability: ${id}`);
    }
  }

  for (const id of Object.keys(grants)) {
    if (!catalog.has(id)) errors.push(`Unknown granted capability: ${id}`);
    else if (!Object.hasOwn(spec.tool_needs, id))
      errors.push(`Grant references undeclared capability: ${id}`);
  }
  for (const id of Object.keys(denied)) {
    if (!catalog.has(id)) errors.push(`Unknown denied capability: ${id}`);
    else if (!Object.hasOwn(spec.tool_needs, id))
      errors.push(`Deny references undeclared capability: ${id}`);
  }
  for (const id of authorizationSet) {
    if (!catalog.has(id))
      errors.push(`Unknown authorization-gated capability: ${id}`);
    else if (!Object.hasOwn(spec.tool_needs, id))
      errors.push(`Authorization gate references undeclared capability: ${id}`);
  }

  return [...new Set(errors)];
}

function validateMcpToolAllowlist(
  spec: EmployeeToolContract,
  servers: Record<string, unknown>,
  errors: string[]
) {
  for (const [serverName, serverConfig] of Object.entries(servers)) {
    const tools = (
      serverConfig as { tools?: { include?: unknown; exclude?: unknown } }
    ).tools;
    if (!tools) continue;
    if (!Array.isArray(tools.include)) {
      errors.push(
        `MCP server must use an explicit tool include allowlist: ${serverName}`
      );
      continue;
    }

    const provider = `mcp.${serverName}`;
    for (const rawTool of tools.include) {
      if (typeof rawTool !== "string") {
        errors.push(`MCP tool allowlist contains a non-string: ${serverName}`);
        continue;
      }
      const matchingCapabilities = [...TOOL_CAPABILITIES.values()].filter(
        capability =>
          capability.provider_bindings.some(
            binding =>
              binding.provider === provider && binding.tools.includes(rawTool)
          )
      );
      if (matchingCapabilities.length === 0) {
        errors.push(
          `MCP tool has no catalog capability mapping: ${serverName}.${rawTool}`
        );
        continue;
      }
      const isAllowed = matchingCapabilities.some(capability => {
        const need = spec.tool_needs[capability.id];
        return need && need.necessity !== "disabled";
      });
      if (!isAllowed) {
        errors.push(
          `MCP tool exceeds employee capability contract: ${serverName}.${rawTool}`
        );
      }
    }
  }
}

export async function validateExpert(
  inputRoot: string,
  registryExpert?: RegistryExpertForValidation,
  cwd = process.cwd()
): Promise<ValidationResult> {
  const walked = await walkPackage(inputRoot);
  const root = walked.root;
  const name = basename(root) || root;
  const errors: string[] = [...walked.errors];
  const warnings: string[] = [];
  const allPaths = walked.allPaths;
  const files = walked.files;
  let employeeSpec: EmployeeSpec | null = null;
  let distribution: Distribution | null = null;
  let manifest: EmployeeManifest | null = null;

  for (const file of requiredFiles) {
    if (!files.has(file)) errors.push(`Missing required file: ${file}`);
  }

  for (const path of allPaths) {
    if (isForbiddenPath(path)) errors.push(`Forbidden path found: ${path}`);
  }

  if (files.has("distribution.yaml")) {
    const raw = await readPackageText("distribution.yaml", files, errors);
    if (raw === null) {
      return { name, root, ok: false, errors, warnings };
    }
    const parsed = distributionSchema.safeParse(parseTopLevelYaml(raw));
    if (!parsed.success) errors.push("Invalid distribution.yaml");
    else {
      distribution = parsed.data;
      if (distribution.name !== name) {
        errors.push(
          `Distribution name mismatch: directory=${name} distribution.yaml=${distribution.name}`
        );
      }
      if (registryExpert && distribution.name !== registryExpert.name) {
        errors.push(
          `Distribution name mismatch: registry=${registryExpert.name} distribution.yaml=${distribution.name}`
        );
      }
      if (distribution.hermes_requires !== HERMES_MINIMUM_REQUIREMENT) {
        errors.push(
          `Unsupported Hermes requirement: distribution.yaml=${distribution.hermes_requires} expected=${HERMES_MINIMUM_REQUIREMENT}`
        );
      }
    }
  }

  // v0.18 A4: the two-file employee standard is MANDATORY for available experts — a listed
  // employee without its hiring contract or runtime spec used to pass silently (if-exists).
  if (!files.has("hire.yaml")) {
    errors.push("Missing required file: hire.yaml");
  } else {
    const raw = await readPackageText("hire.yaml", files, errors);
    if (raw === null) {
      return { name, root, ok: false, errors, warnings };
    }
    const parsed = EmployeeManifestSchema.safeParse(parseYaml(raw));
    if (!parsed.success) {
      errors.push(`Invalid hire.yaml: ${formatZodIssues(parsed.error)}`);
    } else {
      manifest = parsed.data;
      const highRiskPermissions =
        parsed.data.permissions.filter(isHighRiskPermission);
      if (highRiskPermissions.length > 0) {
        warnings.push(
          `High-risk permissions declared in hire.yaml: ${highRiskPermissions.join(", ")}`
        );
      }
      if (registryExpert)
        validateRegistryConsistency(
          parsed.data,
          root,
          registryExpert,
          cwd,
          errors
        );
      if (parsed.data.metadata.id !== name) {
        errors.push(
          `Hire identity mismatch: directory=${name} hire.yaml=${parsed.data.metadata.id}`
        );
      }
      if (distribution && distribution.name !== parsed.data.metadata.id) {
        errors.push(
          `Distribution name mismatch: hire.yaml=${parsed.data.metadata.id} distribution.yaml=${distribution.name}`
        );
      }
      if (
        distribution &&
        distribution.version !== parsed.data.metadata.version
      ) {
        errors.push(
          `Version mismatch: distribution.yaml=${distribution.version} hire.yaml=${parsed.data.metadata.version}`
        );
      }
      if (parsed.data.requires.hermes !== HERMES_MINIMUM_REQUIREMENT) {
        errors.push(
          `Unsupported Hermes requirement: hire.yaml=${parsed.data.requires.hermes} expected=${HERMES_MINIMUM_REQUIREMENT}`
        );
      }
      if (
        distribution &&
        distribution.hermes_requires !== parsed.data.requires.hermes
      ) {
        errors.push(
          `Hermes requirement mismatch: distribution.yaml=${distribution.hermes_requires} hire.yaml=${parsed.data.requires.hermes}`
        );
      }
    }
  }

  if (!files.has("crewclaw.employee.yaml")) {
    errors.push("Missing required file: crewclaw.employee.yaml");
  } else {
    const raw = await readPackageText("crewclaw.employee.yaml", files, errors);
    if (raw === null) {
      return { name, root, ok: false, errors, warnings };
    }
    let specDoc: unknown;
    try {
      specDoc = (runtimeYaml as { load(raw: string): unknown }).load(raw);
    } catch (error) {
      specDoc = null;
      errors.push(
        `Unparseable crewclaw.employee.yaml: ${error instanceof Error ? error.message : String(error)}`
      );
    }
    if (specDoc !== null) {
      const parsed = EmployeeSpecSchema.safeParse(specDoc);
      if (!parsed.success) {
        errors.push(
          `Invalid crewclaw.employee.yaml: ${formatZodIssues(parsed.error)}`
        );
      } else {
        const spec: EmployeeSpec = parsed.data;
        employeeSpec = spec;
        errors.push(...validateEmployeeToolContract(spec));
        const hermesTarget = spec.compatibility_targets?.Hermes;
        if (hermesTarget?.level !== "L1") {
          errors.push(
            `Standalone Hermes compatibility must be declared L1 (prompt/playbook only), got ${hermesTarget?.level || "missing"}`
          );
        }
        const unsupportedStandalone = Object.entries(spec.tool_needs)
          .filter(
            ([, need]) =>
              String(need.necessity || "").toLowerCase() === "required"
          )
          .map(([capability]) => capability)
          .filter(capability => !HERMES_SAFE_CAPABILITIES.has(capability))
          .sort();
        if (unsupportedStandalone.length > 0) {
          warnings.push(
            `Standalone Hermes profile is capability-incomplete and requires the CrewClaw gateway: ${unsupportedStandalone.join(", ")}`
          );
        }
        if (spec.identity.id !== name) {
          errors.push(
            `Spec identity.id mismatch: directory=${name} spec=${spec.identity.id}`
          );
        }
        if (manifest && spec.identity.id !== manifest.metadata.id) {
          errors.push(
            `Spec identity.id mismatch: hire.yaml=${manifest.metadata.id} spec=${spec.identity.id}`
          );
        }
        if (distribution && spec.identity.id !== distribution.name) {
          errors.push(
            `Spec identity.id mismatch: distribution.yaml=${distribution.name} spec=${spec.identity.id}`
          );
        }
        if (registryExpert && spec.identity.id !== registryExpert.name) {
          errors.push(
            `Spec identity.id mismatch: registry=${registryExpert.name} spec=${spec.identity.id}`
          );
        }
        if (
          registryExpert &&
          registryExpert.version &&
          spec.identity.version !== registryExpert.version
        ) {
          errors.push(
            `Version mismatch: registry=${registryExpert.version} crewclaw.employee.yaml=${spec.identity.version}`
          );
        }
      }
    }
  }

  if (files.has("config.yaml")) {
    const raw = await readPackageText("config.yaml", files, errors);
    const configToolsets =
      raw === null ? null : validateHermesConfig(raw, errors);
    if (manifest && configToolsets) {
      const hireToolsets = [...manifest.tools].sort();
      const profileToolsets = [...configToolsets].sort();
      if (JSON.stringify(hireToolsets) !== JSON.stringify(profileToolsets)) {
        errors.push(
          `Hermes toolset mismatch: hire.yaml=${hireToolsets.join(",")} config.yaml=${profileToolsets.join(",")}`
        );
      }
    }
  }

  if (files.has("mcp.json")) {
    const raw = await readPackageText("mcp.json", files, errors);
    if (raw === null) {
      return { name, root, ok: false, errors, warnings };
    }
    try {
      const parsed = JSON.parse(raw) as {
        mcp_servers?: Record<string, unknown>;
      };
      for (const [serverName, serverConfig] of Object.entries(
        parsed.mcp_servers ?? {}
      )) {
        const tools = (
          serverConfig as { tools?: { include?: unknown; exclude?: unknown } }
        ).tools;
        if (!tools?.include && !tools?.exclude)
          errors.push(
            `MCP server must declare tool allowlist or denylist: ${serverName}`
          );
      }
      if (employeeSpec) {
        validateMcpToolAllowlist(
          employeeSpec,
          parsed.mcp_servers ?? {},
          errors
        );
      }
    } catch {
      errors.push("Invalid mcp.json");
    }
  }

  const skillFiles = [...files.keys()].filter(path =>
    path.endsWith("SKILL.md")
  );
  const installedSkillNames = new Set<string>();
  if (skillFiles.length === 0) warnings.push("No SKILL.md files found");
  for (const skillPath of skillFiles) {
    const raw = await readPackageText(skillPath, files, errors);
    if (raw === null) continue;
    const frontmatter = parseFrontmatter(raw);
    if (
      !frontmatter ||
      typeof frontmatter.name !== "string" ||
      typeof frontmatter.description !== "string" ||
      !frontmatter.description.startsWith("Use when")
    ) {
      errors.push(`Invalid skill frontmatter: ${skillPath}`);
    } else {
      installedSkillNames.add(frontmatter.name);
      if (frontmatter.description.length > 1536) {
        errors.push(`Skill description exceeds 1536 characters: ${skillPath}`);
      }
    }
    if (raw.length > 20_000) warnings.push(`Large skill file: ${skillPath}`);
  }
  if (manifest) {
    const declared = [...manifest.skills].sort();
    const installed = [...installedSkillNames].sort();
    const missing = declared.filter(name => !installedSkillNames.has(name));
    const undeclared = installed.filter(
      name => !manifest.skills.includes(name)
    );
    if (missing.length > 0 || undeclared.length > 0) {
      errors.push(
        `Skill manifest mismatch: missing SKILL.md=${missing.join(",") || "none"}; undeclared SKILL.md=${undeclared.join(",") || "none"}`
      );
    }
  }

  for (const [path] of files) {
    const content = await readPackageBytes(path, files, errors);
    if (content === null) continue;
    if (containsForbiddenSecret(content))
      errors.push(`Potential secret found: ${path}`);
  }

  return { name, root, ok: errors.length === 0, errors, warnings };
}

export async function validateAllExperts(
  cwd = process.cwd()
): Promise<ValidateAllResult> {
  const experts = getAvailableExperts(resolve(cwd, "registry", "experts.json"));
  const results = await Promise.all(
    experts.map(async expert => {
      try {
        const source = resolveExpertSource(cwd, expert);
        return await validateExpert(source, expert, cwd);
      } catch (error) {
        return {
          name: expert.name,
          root: resolve(cwd, `experts/${expert.name}`),
          ok: false,
          errors: [
            `Unsafe registry local_source: ${error instanceof Error ? error.message : String(error)}`,
          ],
          warnings: [],
        };
      }
    })
  );
  return { ok: results.every(result => result.ok), results };
}
