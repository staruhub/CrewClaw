export const DREAM_CONTRACT = "crewclaw.dream/v1";

const MEMORY_CATEGORIES = new Set([
  "user_prefs",
  "project_facts",
  "successful_toolchains",
  "failure_paths",
  "reliable_sources",
  "verified_sops",
]);
const CONFIDENCE = new Set(["low", "medium", "high"]);
const MAX_DELIVERABLE_CHARS = 24_000;
const MAX_EXISTING_MEMORY = 100;
const MAX_CANDIDATES = 20;
const MAX_TEXT_CHARS = 2_000;
const MAX_STEPS = 16;
const MAX_MODEL_RESPONSE_CHARS = 64 * 1024;
const MAX_MODEL_INPUT_CHARS = 128 * 1024;

export function extractSources(text) {
  if (typeof text !== "string") return [];
  const seen = new Set();
  const sources = [];
  for (const match of text.matchAll(/https?:\/\/[^\s)]+/g)) {
    const url = match[0];
    if (!seen.has(url)) {
      seen.add(url);
      sources.push(url);
    }
  }
  return sources;
}

function exactKeys(value, allowed) {
  return Object.keys(value).every(key => allowed.has(key));
}

function cleanText(value, label, { max = MAX_TEXT_CHARS } = {}) {
  if (typeof value !== "string") throw new Error(`${label} must be a string`);
  const text = value.trim();
  if (text.length > MAX_MODEL_RESPONSE_CHARS) {
    throw new Error("dream model response exceeds 64 KiB");
  }
  if (
    !text ||
    text.length > max ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)
  ) {
    throw new Error(`${label} is empty, oversized, or contains control bytes`);
  }
  return text;
}

function parseModelJson(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value !== "string") {
    throw new Error("dream model did not return a JSON object");
  }
  const text = value.trim();
  if (!text.startsWith("{") || !text.endsWith("}")) {
    throw new Error("dream model response must be a single JSON object");
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("dream model returned invalid JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("dream model did not return a JSON object");
  }
  return parsed;
}

function validateMemoryCandidate(candidate, index) {
  if (
    !candidate ||
    typeof candidate !== "object" ||
    Array.isArray(candidate) ||
    !exactKeys(candidate, new Set(["category", "text", "confidence"]))
  ) {
    throw new Error(`dream memory candidate ${index} has an invalid shape`);
  }
  if (!MEMORY_CATEGORIES.has(candidate.category)) {
    throw new Error(`dream memory candidate ${index} has an invalid category`);
  }
  if (!CONFIDENCE.has(candidate.confidence)) {
    throw new Error(`dream memory candidate ${index} has invalid confidence`);
  }
  return {
    category: candidate.category,
    text: cleanText(candidate.text, `dream memory candidate ${index}`),
    confidence: candidate.confidence,
  };
}

function validatePlaybookCandidate(candidate, index) {
  if (
    !candidate ||
    typeof candidate !== "object" ||
    Array.isArray(candidate) ||
    !exactKeys(candidate, new Set(["title", "steps"])) ||
    !Array.isArray(candidate.steps) ||
    candidate.steps.length === 0 ||
    candidate.steps.length > MAX_STEPS
  ) {
    throw new Error(`dream playbook candidate ${index} has an invalid shape`);
  }
  return {
    title: cleanText(candidate.title, `dream playbook title ${index}`, {
      max: 240,
    }),
    steps: candidate.steps.map((step, stepIndex) =>
      cleanText(step, `dream playbook ${index} step ${stepIndex}`, { max: 500 })
    ),
  };
}

export function validateDreamReview(value, { taskRunId } = {}) {
  const review = parseModelJson(value);
  const allowed = new Set([
    "summary",
    "new_memory_candidates",
    "new_playbook_candidates",
    "confidence",
    "needs_user_review",
  ]);
  if (!exactKeys(review, allowed) || Object.keys(review).length !== allowed.size) {
    throw new Error("dream model response does not match the closed contract");
  }
  if (
    !Array.isArray(review.new_memory_candidates) ||
    review.new_memory_candidates.length > MAX_CANDIDATES
  ) {
    throw new Error("dream memory candidates exceed the contract limit");
  }
  if (
    !Array.isArray(review.new_playbook_candidates) ||
    review.new_playbook_candidates.length > MAX_CANDIDATES
  ) {
    throw new Error("dream playbook candidates exceed the contract limit");
  }
  if (!CONFIDENCE.has(review.confidence)) {
    throw new Error("dream confidence is invalid");
  }
  if (review.needs_user_review !== true) {
    throw new Error("dream candidates must require user review");
  }
  const id = cleanText(taskRunId, "dream source task id", { max: 256 });
  return {
    contract: DREAM_CONTRACT,
    source_task_ids: [id],
    summary: cleanText(review.summary, "dream summary", { max: 4_000 }),
    new_memory_candidates: review.new_memory_candidates.map(
      validateMemoryCandidate
    ),
    new_playbook_candidates: review.new_playbook_candidates.map(
      validatePlaybookCandidate
    ),
    confidence: review.confidence,
    needs_user_review: true,
  };
}

function buildMockReview({ taskRun, deliverable, existingMemory }) {
  const newMemoryCandidates = [];
  const newPlaybookCandidates = [];
  const existingTexts = new Set(
    existingMemory.map(item => String(item.text || "").trim())
  );
  for (const url of extractSources(deliverable).slice(0, MAX_CANDIDATES - 1)) {
    if (url.length > MAX_TEXT_CHARS) continue;
    if (!existingTexts.has(url.trim())) {
      newMemoryCandidates.push({
        category: "reliable_sources",
        text: url,
        confidence: "high",
      });
    }
  }
  if (taskRun.output_valid === true) {
    newMemoryCandidates.push({
      category: "project_facts",
      text: `任务「${String(taskRun.user_goal || "").slice(0, 1_800)}」已交付有效结果`,
      confidence: "medium",
    });
  }
  if (
    Array.isArray(taskRun.tool_invocations) &&
    taskRun.tool_invocations.length > 0
  ) {
    newPlaybookCandidates.push({
      title: String(taskRun.user_goal || taskRun.id).slice(0, 240),
      steps: taskRun.tool_invocations
        .slice(0, MAX_STEPS)
        .map(t => String(t.tool_name || "unknown").slice(0, 500)),
    });
  }
  const validated = validateDreamReview(
    {
    summary: "显式 mock 模式的确定性复盘，仅用于验证 Dream 管道。",
    new_memory_candidates: newMemoryCandidates,
    new_playbook_candidates: newPlaybookCandidates,
    confidence: taskRun.effective
      ? "high"
      : taskRun.output_valid
        ? "medium"
        : "low",
    needs_user_review: true,
    },
    { taskRunId: taskRun.id }
  );
  return {
    ...validated,
    mock: true,
    model: "mock",
    generated_at: Date.now(),
  };
}

function safeDreamPolicy(policy) {
  if (!policy || typeof policy !== "object" || Array.isArray(policy)) return null;
  return {
    after_task: Array.isArray(policy.after_task)
      ? policy.after_task
          .slice(0, 20)
          .map(item => String(item).slice(0, 500))
      : [],
    retention:
      typeof policy.retention === "string"
        ? policy.retention.slice(0, MAX_TEXT_CHARS)
        : "",
  };
}

export function dreamModelInput({ taskRun, deliverable, existingMemory, policy }) {
  return {
    contract: DREAM_CONTRACT,
    task: {
      id: String(taskRun.id || "").slice(0, 256),
      employee_id: String(taskRun.employee_id || "").slice(0, 128),
      user_goal: String(taskRun.user_goal || "").slice(0, MAX_TEXT_CHARS),
      output_valid: taskRun.output_valid === true,
      effective: taskRun.effective === true,
      degraded: taskRun.degraded === true,
      tools: Array.isArray(taskRun.tool_invocations)
        ? taskRun.tool_invocations.slice(0, 100).map(item => ({
            tool_name: String(item?.tool_name || "").slice(0, 128),
            status: String(item?.status || "").slice(0, 128),
            decision: String(item?.decision || "").slice(0, 128),
          }))
        : [],
    },
    deliverable: String(deliverable || "").slice(0, MAX_DELIVERABLE_CHARS),
    existing_memory: (Array.isArray(existingMemory) ? existingMemory : [])
      .slice(0, MAX_EXISTING_MEMORY)
      .map(item => ({
        category: String(item?.category || "").slice(0, 128),
        text: String(item?.text || "").slice(0, 500),
      })),
    dream_policy: safeDreamPolicy(policy),
  };
}

/** Real mode has no heuristic fallback: missing/invalid model output rejects Dream. */
export async function reviewTaskRun({
  taskRun,
  deliverable = "",
  existingMemory = [],
  policy = null,
  mock = false,
  model,
  modelId,
}) {
  if (!taskRun || typeof taskRun !== "object" || !taskRun.id) {
    throw new Error("dream requires a concrete TaskRun");
  }
  if (mock === true) {
    return buildMockReview({ taskRun, deliverable, existingMemory });
  }
  if (typeof model !== "function") {
    throw new Error(
      "real dream requires an explicit model; refusing heuristic downgrade"
    );
  }
  const input = dreamModelInput({ taskRun, deliverable, existingMemory, policy });
  if (JSON.stringify(input).length > MAX_MODEL_INPUT_CHARS) {
    throw new Error("dream model input exceeds 128 KiB");
  }
  const raw = await model(input);
  const review = validateDreamReview(raw, { taskRunId: taskRun.id });
  return {
    ...review,
    mock: false,
    model: cleanText(modelId, "dream model id", { max: 256 }),
    generated_at: Date.now(),
  };
}
