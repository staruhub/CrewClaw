import { describe, expect, it } from "vitest";

import {
  CertificationCredentialSchema,
  CertificationProfileSchema,
  GoodEmployeeStateSchema,
} from "../certification";

const hash = `sha256:${"a".repeat(64)}`;
const profile = {
  contract: "crewclaw.certification-profile/v1",
  profile_id: "ai-adoption-whale/v1",
  version: "1.0.0",
  role_id: "ai-adoption-consultant",
  authority: "CrewClaw",
  description: "Repeated role certification.",
  runtime: {
    adapter: "crewclaw-reference",
    minimum_version: "0.18.0",
    required_level: "L3",
  },
  execution: {
    repetitions: 3,
    independent_judge_required: true,
    mock_allowed: false,
  },
  thresholds: {
    min_total_runs: 3,
    min_overall_success_rate: 0.8,
    min_case_success_rate: 0.66,
    min_evidence_coverage: 0.9,
    min_correct_stop_rate: 1,
    max_permission_violations: 0,
    max_safety_violations: 0,
  },
  cases: [
    {
      id: "official-research",
      category: "capability",
      task: "Research a model from official sources.",
      acceptance: ["Cites an official source."],
      expected_terminal: "completed",
      hard_gate: false,
      visibility: "public",
      required_evidence: ["official source"],
    },
  ],
  holdout: { mode: "authority-owned", dream_access: false },
} as const;

const run = {
  receipt_id: "receipt-1",
  case_id: "official-research",
  repetition: 1,
  passed: true,
  terminal: "completed",
  expected_terminal: "completed",
  score: 100,
  evidence_coverage: 1,
  permission_violations: 0,
  safety_violations: 0,
  cost: 0.1,
  cost_source: "runtime_estimate",
  duration_ms: 100,
  evidence: [
    {
      kind: "runtime_terminal",
      ref: "task.completed",
      sha256: hash,
    },
  ],
  checks: [
    {
      criterion: "fixture acceptance",
      passed: true,
      reason: "fixture evidence passes",
    },
  ],
  mock: false,
} as const;

const credential = {
  contract: "crewclaw.certification-credential/v1",
  credential_id: "credential-1",
  employee_id: "ai-adoption-whale",
  subject_hash: hash,
  memory_state_hash: hash,
  status: "certified",
  profile: { id: profile.profile_id, version: profile.version, hash },
  runtime: {
    adapter: "crewclaw-reference",
    version: "0.18.0",
    capability_level: "L3",
    endpoint_id: hash,
  },
  execution: {
    worker_model: "worker/model",
    judge_model: "judge/model",
    independent_judge: true,
  },
  issued_at: "2026-07-15T00:00:00Z",
  expires_at: null,
  mock: false,
  sample_size: 1,
  metrics: {
    success_rate: 1,
    success_confidence_low: 0.2,
    success_confidence_high: 1,
    correct_stop_rate: 1,
    evidence_coverage: 1,
    cost_p50: 0.1,
    cost_p95: 0.1,
    duration_p50_ms: 100,
    duration_p95_ms: 100,
  },
  hard_gates: {
    passed: true,
    permission_violations: 0,
    safety_violations: 0,
    failures: [],
  },
  runs: [run],
  proof_pack_hash: hash,
  issuer: {
    id: "crewclaw-test",
    key_id: "test-key",
    algorithm: "Ed25519",
    public_key: "public-key",
    signature: "signature",
  },
  status_reason: null,
} as const;

describe("Good Employee Standard v1", () => {
  it("accepts authority-owned repeated profiles", () => {
    expect(CertificationProfileSchema.parse(profile).profile_id).toBe(
      profile.profile_id
    );
  });

  it("rejects impossible minimum sample sizes", () => {
    expect(() =>
      CertificationProfileSchema.parse({
        ...profile,
        thresholds: { ...profile.thresholds, min_total_runs: 4 },
      })
    ).toThrow(/min_total_runs/);
  });

  it("derives C-level from evidence instead of author claims", () => {
    expect(() =>
      GoodEmployeeStateSchema.parse({
        contract: "crewclaw.good-employee-state/v1",
        package_status: "validated",
        lab_status: "untested",
        field_status: "insufficient",
        derived_level: "C2",
      })
    ).toThrow(/derived_level/);
  });

  it("requires signed, non-mock certified credentials", () => {
    expect(CertificationCredentialSchema.parse(credential).status).toBe(
      "certified"
    );
    expect(() =>
      CertificationCredentialSchema.parse({ ...credential, mock: true })
    ).toThrow();
    expect(() =>
      CertificationCredentialSchema.parse({ ...credential, issuer: null })
    ).toThrow(/signed/);
    expect(() =>
      CertificationCredentialSchema.parse({ ...credential, sample_size: 2 })
    ).toThrow(/runs.length/);
  });
});
