import assert from "node:assert/strict";
import { HOST_SPEC, SPEC_VECTORS, runSpecVector } from "../spec-vectors.mjs";

assert.equal(
  SPEC_VECTORS.length,
  10,
  "Spec Vectors must contain exactly 10 vectors"
);
assert.ok(HOST_SPEC.length >= 4, "Host Spec must contain at least 4 clauses");

const requiredPendingIds = new Set([4, 5, 7, 8, 9, 10]);
const results = [];

for (const vector of SPEC_VECTORS) {
  const result = await runSpecVector(vector, {
    env: {},
    pendingActions: [{ key: "1", label: "Accept" }],
  });

  assert.equal(
    result.id,
    vector.id,
    `vector ${vector.id}: result id should match`
  );
  assert.equal(
    result.pass,
    true,
    `vector ${vector.id}: verifiable checks should pass`
  );
  assert.ok(
    Array.isArray(result.checks),
    `vector ${vector.id}: checks should be an array`
  );
  assert.ok(
    Array.isArray(result.pending),
    `vector ${vector.id}: pending should be an array`
  );

  if (requiredPendingIds.has(vector.id)) {
    assert.ok(
      result.pending.length > 0,
      `vector ${vector.id}: expected pending host-level checks`
    );
  }

  results.push({
    id: result.id,
    pass: result.pass,
    checks: result.checks.length,
    pending: result.pending.length,
  });
}

console.table(results);
console.log(`spec-vectors tests passed (${SPEC_VECTORS.length} vectors)`);
