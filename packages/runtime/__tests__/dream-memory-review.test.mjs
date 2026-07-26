import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  assessDreamFromWorkspace,
  generateDreamCandidate,
} from "../dream-controller.mjs";
import { addMemory } from "../memory-store.mjs";
import { buildReflection, writeReflection } from "../reflect.mjs";

const now = Date.parse("2026-07-16T08:00:00.000Z");

function seedTrustedReflection(root, employeeId) {
  const reflection = buildReflection(
    {
      id: "task-review",
      employee_id: employeeId,
      status: "accepted",
      output_valid: true,
      artifact: "artifact-review",
      user_feedback: "verified",
      started_at: "2026-07-16T07:00:00.000Z",
      updated_at: "2026-07-16T07:01:00.000Z",
    },
    { evidenceIds: ["evidence-review"], createdAt: new Date(now).toISOString() }
  );
  assert.equal(writeReflection(root, reflection).ok, true);
}

async function generateWithMemory(items, curate, dreamId) {
  const root = mkdtempSync(join(tmpdir(), "crew-dream-memory-review-"));
  const employeeId = "memory-review-agent";
  try {
    seedTrustedReflection(root, employeeId);
    for (const item of items) {
      assert.equal(addMemory(root, employeeId, item).ok, true);
    }
    const assessment = assessDreamFromWorkspace(root, employeeId, {
      now,
      manualTrigger: true,
    });
    assert.equal(assessment.recommended, true);
    return await generateDreamCandidate(root, assessment, {
      dreamId,
      curate,
      modelId: "deterministic-review-curator",
      now,
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const unsupportedChange = input => ({
  value: {
    summary: "新增一条记忆，但故意不处理强制复核项。",
    entries: [
      {
        op: "add",
        reason: "用于验证 fail-closed",
        confidence: "high",
        source_task_ids: [input.reflections[0].task_id],
        evidence_ids: input.reflections[0].evidence_ids,
        item: {
          category: "verified_sops",
          text: "提交前执行一次独立复核。",
          confidence: "high",
        },
      },
    ],
  },
});

test("Dream curator must explicitly review every expired valid_until item", async () => {
  let required = [];
  const result = await generateWithMemory(
    [
      {
        category: "project_facts",
        text: "旧版接口将在七月继续可用。",
        confidence: "high",
        valid_until: "2026-07-15T00:00:00.000Z",
      },
    ],
    async input => {
      required = input.review_required_memory_keys;
      return unsupportedChange(input);
    },
    "dream-expired-review"
  );
  assert.equal(required.length, 1);
  assert.equal(result.ok, false);
  assert.match(result.reason, /skipped required stale\/conflict review/);
});

test("Dream curator must resolve both sides of a supersedes conflict", async () => {
  let required = [];
  const result = await generateWithMemory(
    [
      {
        category: "project_facts",
        text: "发布窗口是周二。",
        confidence: "high",
      },
      {
        category: "project_facts",
        text: "发布窗口是周四。",
        confidence: "high",
        supersedes: "发布窗口是周二。",
      },
    ],
    async input => {
      required = input.review_required_memory_keys;
      return unsupportedChange(input);
    },
    "dream-conflict-review"
  );
  assert.equal(required.length, 2);
  assert.equal(result.ok, false);
  assert.match(result.reason, /skipped required stale\/conflict review/);
});

test("Dream curator may replace both conflict sides with one explicit winner", async () => {
  const result = await generateWithMemory(
    [
      {
        category: "project_facts",
        text: "发布窗口是周二。",
        confidence: "high",
      },
      {
        category: "project_facts",
        text: "发布窗口是周四。",
        confidence: "high",
        supersedes: "发布窗口是周二。",
      },
    ],
    async input => ({
      value: {
        summary: "显式选择周四并同时处理新旧两侧。",
        entries: [
          {
            op: "replace",
            reason: "新事实已取代旧事实",
            confidence: "high",
            source_task_ids: [input.reflections[0].task_id],
            evidence_ids: input.reflections[0].evidence_ids,
            replaces: input.review_required_memory_keys,
            item: {
              category: "project_facts",
              text: "发布窗口是周四。",
              confidence: "high",
              supersedes: "发布窗口是周二。",
            },
          },
        ],
      },
    }),
    "dream-conflict-resolved"
  );
  assert.equal(result.ok, true);
  assert.equal(result.candidate.items.length, 1);
  assert.equal(result.candidate.items[0].text, "发布窗口是周四。");
});

test("Dream curator rejects relative dates in new memory text", async () => {
  const result = await generateWithMemory(
    [],
    async input => ({
      value: {
        summary: "故意输出相对日期。",
        entries: [
          {
            op: "add",
            reason: "验证日期绝对化门禁",
            confidence: "high",
            source_task_ids: [input.reflections[0].task_id],
            evidence_ids: input.reflections[0].evidence_ids,
            item: {
              category: "project_facts",
              text: "下周发布新版接口。",
              confidence: "high",
              valid_until: "2026-08-01T00:00:00.000Z",
            },
          },
        ],
      },
    }),
    "dream-relative-date-rejected"
  );
  assert.equal(result.ok, false);
  assert.match(result.reason, /contains a relative date/);
});

test("Dream curator requires RFC 3339 UTC valid_until", async () => {
  const result = await generateWithMemory(
    [],
    async input => ({
      value: {
        summary: "故意输出无时区日期。",
        entries: [
          {
            op: "add",
            reason: "验证 UTC 时间格式门禁",
            confidence: "high",
            source_task_ids: [input.reflections[0].task_id],
            evidence_ids: input.reflections[0].evidence_ids,
            item: {
              category: "project_facts",
              text: "新版接口将在 2026-07-23 发布。",
              confidence: "high",
              valid_until: "2026-08-01",
            },
          },
        ],
      },
    }),
    "dream-valid-until-rejected"
  );
  assert.equal(result.ok, false);
  assert.match(result.reason, /valid_until must be RFC 3339 UTC/);
});

test("Dream curator cannot keep memory whose provenance no longer resolves", async () => {
  let invalidReferences = [];
  const result = await generateWithMemory(
    [
      {
        category: "project_facts",
        text: "旧结论来自已经删除的任务证据。",
        confidence: "high",
        source_task_ids: ["task-deleted"],
        evidence_ids: ["evidence-deleted"],
      },
    ],
    async input => {
      invalidReferences = input.invalid_reference_memory_keys;
      return {
        value: {
          summary: "故意保留失效引用。",
          entries: [
            {
              op: "keep",
              reason: "验证失效引用不得原样保留",
              confidence: "high",
              source_task_ids: [input.reflections[0].task_id],
              evidence_ids: input.reflections[0].evidence_ids,
              replaces: input.invalid_reference_memory_keys,
            },
          ],
        },
      };
    },
    "dream-invalid-reference-kept"
  );
  assert.equal(invalidReferences.length, 1);
  assert.equal(result.ok, false);
  assert.match(result.reason, /kept memory with invalid provenance/);
});

test("Dream curator may replace memory with dangling provenance", async () => {
  const result = await generateWithMemory(
    [
      {
        category: "project_facts",
        text: "旧结论来自已经删除的任务证据。",
        confidence: "high",
        source_task_ids: ["task-deleted"],
        evidence_ids: ["evidence-deleted"],
      },
    ],
    async input => ({
      value: {
        summary: "用当前受信任务重新建立 provenance。",
        entries: [
          {
            op: "replace",
            reason: "旧引用已失效，改用当前可复验依据",
            confidence: "high",
            source_task_ids: [input.reflections[0].task_id],
            evidence_ids: input.reflections[0].evidence_ids,
            replaces: input.invalid_reference_memory_keys,
            item: {
              category: "project_facts",
              text: "结论已于 2026-07-16 重新核验。",
              confidence: "high",
            },
          },
        ],
      },
    }),
    "dream-invalid-reference-replaced"
  );
  assert.equal(result.ok, true);
  assert.deepEqual(result.candidate.items[0].source_task_ids, ["task-review"]);
  assert.deepEqual(result.candidate.items[0].evidence_ids, ["evidence-review"]);
});
