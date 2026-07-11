import { addEvidence } from "../../evidence-store.mjs";
import { persistEval } from "../../eval-runner.mjs";
import { persistProofPackDurably } from "../../acceptance-transaction.mjs";
import { saveSession } from "../../session-store.mjs";

const [mode, root, id, encodedPayload = ""] = process.argv.slice(2);
const payload = encodedPayload
  ? JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"))
  : null;

let result;
if (mode === "evidence") {
  result = addEvidence(root, "concurrent-task", {
    field: `field-${id}`,
    value: id,
    source_url: `https://example.com/source/${id}`,
    source_type: "official",
    confidence: "high",
    snippet: "parallel evidence",
    ts: "2026-07-11T00:00:00.000Z",
  });
} else if (mode === "eval") {
  result = persistEval(root, payload.result, payload.options);
} else if (mode === "proofpack") {
  result = persistProofPackDurably({ root, taskRunId: id, pack: payload });
} else if (mode === "session") {
  result = saveSession(root, id, payload);
} else {
  throw new Error(`unknown worker mode: ${mode}`);
}

process.stdout.write(`${JSON.stringify(result)}\n`);
