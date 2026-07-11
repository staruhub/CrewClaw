import assert from "node:assert/strict";

import {
  FAILURE_PLAYBOOK,
  RESEARCH_FIELDS,
  formatDeliverable,
  generateQueries,
  nextRecovery,
} from "../search-harness.mjs";

const generated = generateQueries({
  entity: "Seed 2.1",
  officialDomains: ["volcengine.com"],
  aliases: ["豆包"],
});

assert.equal(generated[0], "Seed 2.1");
assert.equal(generated.includes("site:volcengine.com Seed 2.1"), true);
assert.equal(generated.includes("豆包"), true);
assert.throws(() => generateQueries({}));
assert.equal(FAILURE_PLAYBOOK.length, 11);
assert.equal(nextRecovery(0).step, "exact_phrase");
assert.equal(nextRecovery(99), null);
assert.equal(
  RESEARCH_FIELDS.some(
    field => field.key === "price" && field.required === true
  ),
  true
);

const deliverable = formatDeliverable({
  official_name: "Doubao-Seed-2.1",
  price: "6/30 元",
});

assert.equal(typeof deliverable, "string");
assert.equal(deliverable.includes("官方名称"), true);
assert.equal(deliverable.includes("unknown"), true);

console.log("search-harness tests passed");
