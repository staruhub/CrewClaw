// Visual reveal pacing for the Ratatui stream. Provider SSE chunks are transport details and can
// be a whole paragraph or a fraction of a code point; the UI contract is a stable 30 ms cadence
// with 2–4 visible graphemes per tick.

const DEFAULT_INTERVAL_MS = 30;
const DEFAULT_MIN_GRAPHEMES = 2;
const DEFAULT_MAX_GRAPHEMES = 4;

const segmenter =
  typeof Intl?.Segmenter === "function"
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : null;

export function visibleGraphemes(value) {
  const text = String(value || "");
  if (!text) return [];
  if (!segmenter) return Array.from(text);
  return [...segmenter.segment(text)].map(item => item.segment);
}

export function createRevealPacer({
  emit,
  intervalMs = DEFAULT_INTERVAL_MS,
  minGraphemes = DEFAULT_MIN_GRAPHEMES,
  maxGraphemes = DEFAULT_MAX_GRAPHEMES,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  if (typeof emit !== "function")
    throw new TypeError("reveal pacer requires emit");
  if (!Number.isInteger(intervalMs) || intervalMs < 0)
    throw new TypeError("intervalMs must be a non-negative integer");
  if (
    !Number.isInteger(minGraphemes) ||
    !Number.isInteger(maxGraphemes) ||
    minGraphemes < 1 ||
    maxGraphemes < minGraphemes
  )
    throw new TypeError("invalid reveal grapheme range");

  let queue = [];
  let timer = null;
  let nextSize = minGraphemes;
  let stopped = false;
  let failure = null;
  const waiters = [];

  const settle = () => {
    if (timer !== null || queue.length > 0) return;
    for (const { resolve, reject } of waiters.splice(0)) {
      if (failure) reject(failure);
      else resolve();
    }
  };

  const schedule = () => {
    if (stopped || timer !== null || queue.length === 0) {
      settle();
      return;
    }
    timer = setTimer(tick, intervalMs);
  };

  const tick = () => {
    timer = null;
    if (stopped || queue.length === 0) {
      settle();
      return;
    }
    const count = Math.min(queue.length, nextSize);
    const chunk = queue.splice(0, count).join("");
    nextSize =
      nextSize >= maxGraphemes
        ? minGraphemes
        : Math.min(maxGraphemes, nextSize + 1);
    try {
      emit(chunk);
    } catch (error) {
      failure = error instanceof Error ? error : new Error(String(error));
      queue = [];
      stopped = true;
    }
    schedule();
  };

  return {
    push(value) {
      if (stopped) return false;
      const additions = visibleGraphemes(value);
      if (additions.length === 0) return true;
      queue.push(...additions);
      schedule();
      return true;
    },

    drain() {
      if (failure) return Promise.reject(failure);
      if (timer === null && queue.length === 0) return Promise.resolve();
      return new Promise((resolve, reject) =>
        waiters.push({ resolve, reject })
      );
    },

    cancel() {
      stopped = true;
      queue = [];
      if (timer !== null) clearTimer(timer);
      timer = null;
      settle();
    },

    get pendingGraphemes() {
      return queue.length;
    },
  };
}

export const REVEAL_INTERVAL_MS = DEFAULT_INTERVAL_MS;
