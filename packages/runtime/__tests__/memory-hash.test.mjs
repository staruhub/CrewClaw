import assert from "node:assert/strict";

import {
  MEMORY_STATE_HASH_SCHEMA,
  computeMemoryStateHash,
  estimateInjectionTokens,
  normalizeMemoryText,
} from "../memory-hash.mjs";

const baseItems = [
  {
    category: "reliable_sources",
    text: "https://www.volcengine.com/product/ark",
    confidence: "high",
    status: "active",
    savedAt: "2026-07-01T00:00:00.000Z",
  },
  {
    category: "project_facts",
    text: "Seed 2.1 调研已交付有效结果",
    confidence: "medium",
    status: "active",
    savedAt: "2026-07-02T00:00:00.000Z",
  },
];

const base = computeMemoryStateHash(baseItems);
assert.equal(base.memory_hash_schema, MEMORY_STATE_HASH_SCHEMA);
assert.match(base.memory_state_hash, /^sha256:[a-f0-9]{64}$/);
assert.equal(base.active_item_count, 2);
assert.ok(base.estimated_injection_tokens > 0);

// 1. 对象字段顺序变化 → hash 不变
const reorderedFields = baseItems.map(item => {
  const entries = Object.entries(item).reverse();
  return Object.fromEntries(entries);
});
assert.equal(
  computeMemoryStateHash(reorderedFields).memory_state_hash,
  base.memory_state_hash,
  "object key order must not affect the hash"
);

// 2. volatile 时间变化 → hash 不变
const touchedTimestamps = baseItems.map(item => ({
  ...item,
  savedAt: "2030-01-01T00:00:00.000Z",
  read_count: 42,
  learned_at: "2030-01-01T00:00:00.000Z",
}));
assert.equal(
  computeMemoryStateHash(touchedTimestamps).memory_state_hash,
  base.memory_state_hash,
  "volatile bookkeeping fields must not affect the hash"
);

// 3. 记忆文本变化 → hash 改变
const editedText = baseItems.map((item, index) =>
  index === 0 ? { ...item, text: `${item.text}?utm=changed` } : item
);
assert.notEqual(
  computeMemoryStateHash(editedText).memory_state_hash,
  base.memory_state_hash,
  "text changes must change the hash"
);

// 4. active 状态变化 → hash 改变
const superseded = baseItems.map((item, index) =>
  index === 0 ? { ...item, status: "superseded" } : item
);
const supersededState = computeMemoryStateHash(superseded);
assert.notEqual(
  supersededState.memory_state_hash,
  base.memory_state_hash,
  "status changes must change the hash"
);
assert.equal(supersededState.active_item_count, 1);

// 5. 条目排序变化 → hash 不变
assert.equal(
  computeMemoryStateHash([...baseItems].reverse()).memory_state_hash,
  base.memory_state_hash,
  "on-disk item order must not affect the hash"
);

// 缺失 status 的 legacy 条目按 active 处理（backfill 前后 hash 一致）。
const noStatus = baseItems.map(({ status: _status, ...rest }) => rest);
assert.equal(
  computeMemoryStateHash(noStatus).memory_state_hash,
  base.memory_state_hash,
  "missing status counts as active (legacy compatibility)"
);

// 文本规范化固定：NFC + trim + 内部空白折叠。
assert.equal(normalizeMemoryText("  a\t\tb  \n c  "), "a b c");
assert.equal(
  computeMemoryStateHash([
    { ...baseItems[0], text: `  ${baseItems[0].text}  ` },
  ]).memory_state_hash,
  computeMemoryStateHash([baseItems[0]]).memory_state_hash,
  "surrounding whitespace never changes the hash"
);

// token 估算确定性 + 明示 estimate 语义（CJK 每字 1，其余每 4 字符 1）。
assert.equal(estimateInjectionTokens("abcd"), 1);
assert.equal(estimateInjectionTokens("调研"), 2);
// "调研 abcd" → 2 wide + 5 narrow (" abcd") → 2 + ceil(5/4) = 4
assert.equal(estimateInjectionTokens("调研 abcd"), 4);

// 空集也有稳定哈希（当前评测绑定的就是它）。
const empty = computeMemoryStateHash([]);
assert.equal(empty.active_item_count, 0);
assert.equal(empty.estimated_injection_tokens, 0);
assert.equal(
  empty.memory_state_hash,
  computeMemoryStateHash([]).memory_state_hash
);

console.log("memory-hash.test.mjs passed");
