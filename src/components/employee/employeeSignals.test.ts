import { describe, expect, it } from "vitest";
import {
  acceptanceLabel,
  averageCostLabel,
  employeeMatchesEvidenceFilter,
  hireHandoffUrl,
  kpiStateLabel,
  matchesEmployeeQuery,
  runtimeSummary,
  taskCountLabel,
} from "./employeeSignals";
import { getEmployee } from "@/data/employees";
import type { LocalEmployeePerformance } from "@contracts/local-performance";

const employee = getEmployee("macao-networking-agent");

const performance = {
  employee_id: "macao-networking-agent",
  kpi: {
    state: "available",
    contract: "crewclaw.kpi/v2",
    tasks: 4,
    successful: 4,
    completed: 4,
    accepted: 3,
    auto_accepted: 0,
    correctly_blocked: 1,
    rejected: 0,
    revision_requested: 1,
    failed: 0,
    chat_turns: 0,
    artifact_actions: 0,
    total_cost: 1.2,
    cost_currency: "USD",
    average_cost: 0.3,
    average_duration_ms: 90_000,
    evidence_coverage: 0.75,
    permission_violations: 0,
    safety_violations: 0,
    first_hired_at: 1,
    outcomes_count: 4,
    legacy_unclassified_tasks: 0,
    legacy_accepted_claims: 0,
    legacy_total_cost: 0,
  },
  evaluation: {
    state: "absent",
    score: null,
    verdict: null,
    mock: null,
    certified: false,
    model: null,
    evaluated_at: null,
  },
  proof_pack: {
    state: "available",
    generated_at: null,
    evidence_level: "C1",
    package_status: "validated",
    lab_status: "untested",
    field_status: "insufficient",
    credential_id: null,
    profile_id: null,
    sample_size: null,
    success_rate: null,
    success_confidence_low: null,
    correct_stop_rate: null,
    evidence_coverage: 0.75,
    content_hash: null,
    warnings: [],
  },
  accepted_tasks: [],
  verified_reviews: [],
  warnings: [],
} satisfies LocalEmployeePerformance;

describe("employee marketplace signals", () => {
  it("uses receipt-backed KPI values only when local performance is available", () => {
    expect(taskCountLabel(performance)).toBe("4");
    expect(acceptanceLabel(performance)).toBe("75%");
    expect(averageCostLabel(performance)).toBe("$0.3");
    expect(kpiStateLabel(performance)).toBe("Receipt-backed local KPI");

    expect(taskCountLabel(null)).toBe("Unavailable");
    expect(acceptanceLabel(null)).toBe("Unavailable");
    expect(averageCostLabel(null)).toBe("Unavailable");
  });

  it("matches query and evidence filters from existing employee data", () => {
    expect(employee).toBeDefined();
    expect(matchesEmployeeQuery(employee!, "fintech")).toBe(true);
    expect(employeeMatchesEvidenceFilter(employee!, "package-validated")).toBe(
      true
    );
    expect(employeeMatchesEvidenceFilter(employee!, "lab-certified")).toBe(
      false
    );
  });

  it("builds hire handoff params without changing the current route", () => {
    expect(employee).toBeDefined();
    const url = hireHandoffUrl(employee!, "test");
    expect(url).toMatch(/^\/hire\/macao-networking-agent\?/);
    expect(url).toContain("task=");
    expect(url).toContain("budget=free-preview");
    expect(url).toContain("runtime=crewclaw.runtime");
  });

  it("summarizes runtime availability without invented compatibility levels", () => {
    expect(employee).toBeDefined();
    expect(runtimeSummary(employee!).label).toContain("runtime-backed");
  });
});
