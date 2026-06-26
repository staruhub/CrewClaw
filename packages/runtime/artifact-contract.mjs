import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const ARTIFACT_KINDS = Object.freeze([
  'markdown',
  'table',
  'spreadsheet',
  'document',
  'deck',
  'code',
  'report',
  'evidence',
  'checklist',
]);

export const ARTIFACT_STATUSES = Object.freeze([
  'draft',
  'ready',
  'needs_revision',
  'accepted',
  'rejected',
]);

export function writeArtifact({
  name,
  kind,
  content,
  taskRunId,
  root = process.cwd(),
  createdAt = 0,
}) {
  if (!taskRunId || typeof taskRunId !== 'string') {
    throw new TypeError('writeArtifact requires a string taskRunId');
  }

  if (!name || typeof name !== 'string') {
    throw new TypeError('writeArtifact requires a string name');
  }

  if (!ARTIFACT_KINDS.includes(kind)) {
    throw new TypeError(`Unsupported artifact kind: ${kind}`);
  }

  if (content === undefined || content === null) {
    throw new TypeError('writeArtifact requires content');
  }

  const artifactRoot = path.resolve(root, '.crewclaw', 'artifacts', taskRunId);
  const artifactPath = path.resolve(artifactRoot, name);
  const relativePath = path.relative(artifactRoot, artifactPath);

  if (
    path.isAbsolute(name) ||
    relativePath === '' ||
    relativePath.startsWith('..') ||
    path.isAbsolute(relativePath)
  ) {
    throw new Error('Artifact name must resolve inside the task artifact directory');
  }

  mkdirSync(path.dirname(artifactPath), { recursive: true });
  writeFileSync(artifactPath, content);

  const fileStat = statSync(artifactPath);

  return {
    artifact_id: randomUUID(),
    task_run_id: taskRunId,
    name,
    kind,
    path: artifactPath,
    status: 'draft',
    version: 1,
    bytes: fileStat.size,
    created_at: createdAt,
  };
}

export function revealStrategy(targetPath, env = process.env) {
  const absolutePath = path.resolve(String(targetPath || ''));
  const platform = detectRevealPlatform(env);

  if (!targetPath) {
    return unavailableStrategy(absolutePath, platform);
  }

  if (platform === 'win32') {
    return {
      available: true,
      command: 'explorer',
      args: [`/select,${absolutePath}`],
      platform,
    };
  }

  if (platform === 'wsl') {
    return {
      available: true,
      command: 'sh',
      args: ['-lc', 'explorer.exe /select,"$(wslpath -w "$1")"', 'crewclaw-reveal', absolutePath],
      platform,
    };
  }

  if (platform === 'darwin') {
    return {
      available: true,
      command: 'open',
      args: ['-R', absolutePath],
      platform,
    };
  }

  if (platform === 'linux') {
    return {
      available: true,
      command: 'xdg-open',
      args: [path.dirname(absolutePath)],
      platform,
    };
  }

  return unavailableStrategy(absolutePath, platform);
}

export function assertCreated(artifact) {
  if (!artifact || typeof artifact !== 'object') {
    return false;
  }

  if (!artifact.path || typeof artifact.path !== 'string') {
    return false;
  }

  if (!Number.isFinite(artifact.bytes) || artifact.bytes <= 0) {
    return false;
  }

  try {
    const fileStat = statSync(artifact.path);
    return fileStat.isFile() && fileStat.size === artifact.bytes && fileStat.size > 0;
  } catch {
    return false;
  }
}

function detectRevealPlatform(env) {
  const platform = os.platform();

  if (platform === 'linux' && isWsl(env)) {
    return 'wsl';
  }

  return platform;
}

function isWsl(env) {
  if (env.WSL_DISTRO_NAME || env.WSL_INTEROP || env.IS_WSL) {
    return true;
  }

  try {
    if (!existsSync('/proc/version')) {
      return false;
    }

    return /microsoft|wsl/i.test(readFileSync('/proc/version', 'utf8'));
  } catch {
    return false;
  }
}

function unavailableStrategy(absolutePath, platform) {
  return {
    available: false,
    platform,
    fallback: {
      absolute_path: absolutePath,
      copy_action: true,
      manual_command: manualRevealCommand(absolutePath, platform),
    },
  };
}

function manualRevealCommand(absolutePath, platform) {
  if (platform === 'win32') {
    return `explorer /select,${quoteForManualCommand(absolutePath)}`;
  }

  if (platform === 'wsl') {
    return `explorer.exe /select,"$(wslpath -w ${quoteForManualCommand(absolutePath)})"`;
  }

  if (platform === 'darwin') {
    return `open -R ${quoteForManualCommand(absolutePath)}`;
  }

  return `xdg-open ${quoteForManualCommand(path.dirname(absolutePath))}`;
}

function quoteForManualCommand(value) {
  return `"${String(value).replaceAll('"', '\\"')}"`;
}
