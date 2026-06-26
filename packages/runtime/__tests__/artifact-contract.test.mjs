import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  assertCreated,
  revealStrategy,
  writeArtifact,
} from '../artifact-contract.mjs';

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

test('writeArtifact writes a real artifact file with required metadata', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'crewclaw-artifact-contract-'));

  try {
    const content = '# Artifact Contract\n\nCreated content.\n';
    const artifact = await writeArtifact({
      name: 'contract.md',
      kind: 'markdown',
      content,
      taskRunId: 'run-001',
      root,
      createdAt: 0,
    });

    const expectedPath = path.resolve(
      root,
      '.crewclaw',
      'artifacts',
      'run-001',
      'contract.md',
    );

    assert.equal(artifact.task_run_id, 'run-001');
    assert.equal(artifact.name, 'contract.md');
    assert.equal(artifact.kind, 'markdown');
    assert.equal(artifact.status, 'draft');
    assert.equal(artifact.version, 1);
    assert.equal(artifact.path, expectedPath);
    assert.equal(artifact.bytes, Buffer.byteLength(content));
    assert.equal(artifact.created_at, 0);
    assert.match(artifact.artifact_id, /^[0-9a-f-]{36}$/i);

    const written = await readFile(artifact.path, 'utf8');
    assert.equal(written, content);

    const fileStat = await stat(artifact.path);
    assert.equal(fileStat.isFile(), true);
    assert.equal(fileStat.size, artifact.bytes);
    assert.equal(assertCreated(artifact), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('revealStrategy returns a command or structured fallback without opening anything', () => {
  const filePath = path.resolve(os.tmpdir(), 'crewclaw-artifact-contract', 'contract.md');
  const strategy = revealStrategy(filePath);

  assert.equal(typeof strategy.platform, 'string');
  assert.equal(typeof strategy.available, 'boolean');

  if (strategy.available) {
    assert.equal(typeof strategy.command, 'string');
    assert.equal(Array.isArray(strategy.args), true);
    assert.equal(strategy.fallback, undefined);
  } else {
    assert.equal(strategy.command, undefined);
    assert.equal(strategy.args, undefined);
    assert.equal(strategy.fallback.absolute_path, filePath);
    assert.equal(strategy.fallback.copy_action, true);
    assert.equal(typeof strategy.fallback.manual_command, 'string');
  }
});

test('assertCreated rejects bare objects without real artifact evidence', () => {
  assert.equal(assertCreated({ name: 'contract.md' }), false);
  assert.equal(assertCreated({ path: path.resolve(os.tmpdir(), 'missing.md'), bytes: 10 }), false);
  assert.equal(assertCreated({ path: path.resolve(os.tmpdir(), 'empty.md'), bytes: 0 }), false);
});

let failed = 0;

for (const { name, fn } of tests) {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`not ok - ${name}`);
    console.error(error);
  }
}

if (failed > 0) {
  process.exitCode = 1;
}
