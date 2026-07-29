import { describe, expect, it } from "vitest";

import {
  buildDoctorChecks,
  buildPermissionAreas,
  buildTrialSummary,
  doctorPassed,
} from "./HireConfirm";
import {
  getEmployee,
  isToolCapabilityEnabledByDefault,
} from "@/data/employees";

function mustEmployee(id: string) {
  const employee = getEmployee(id);
  if (!employee) throw new Error(`missing fixture employee: ${id}`);
  return employee;
}

describe("HireConfirm safety gate helpers", () => {
  it("separates required, optional, budget, and approval access", () => {
    const employee = mustEmployee("macao-networking-agent");
    const defaults = employee.tool_capabilities
      .filter(isToolCapabilityEnabledByDefault)
      .map(capability => capability.capability);

    const areas = buildPermissionAreas(
      employee.tool_capabilities,
      defaults,
      "Free",
      "$0"
    );

    const tools = areas.find(area => area.key === "tools");
    const budget = areas.find(area => area.key === "budget");
    const approval = areas.find(area => area.key === "approval");

    expect(tools?.required.join("\n")).toContain("web.search");
    expect(tools?.optional.join("\n")).toContain("Enabled: places.search");
    expect(tools?.optional.join("\n")).toContain("Off: contacts.read");
    expect(tools?.unavailable.join("\n")).toContain("crm.write");
    expect(budget?.required.join("\n")).toContain("Free");
    expect(approval?.required.join("\n")).toContain("Doctor checks");
  });

  it("blocks Doctor success when selected capabilities need unavailable adapters", () => {
    const employee = mustEmployee("macao-networking-agent");
    const defaults = employee.tool_capabilities
      .filter(isToolCapabilityEnabledByDefault)
      .map(capability => capability.capability);

    const checks = buildDoctorChecks({
      employee,
      selectedCapabilityIds: defaults,
      doctorStarted: true,
      planName: "Free",
    });

    expect(doctorPassed(checks)).toBe(false);
    expect(checks.find(check => check.id === "tools")).toMatchObject({
      status: "fail",
    });
  });

  it("allows Doctor success after adapter-only optional capabilities are off", () => {
    const employee = mustEmployee("macao-networking-agent");
    const selected = employee.tool_capabilities
      .filter(capability => capability.necessity === "required")
      .map(capability => capability.capability);

    const checks = buildDoctorChecks({
      employee,
      selectedCapabilityIds: selected,
      doctorStarted: true,
      planName: "Free",
    });

    expect(doctorPassed(checks)).toBe(true);
  });

  it("summarizes bounded trial evidence, artifacts, cost, duration, and approval", () => {
    const employee = mustEmployee("macao-networking-agent");
    const selected = employee.tool_capabilities
      .filter(capability => capability.necessity === "required")
      .map(capability => capability.capability);

    const summary = buildTrialSummary({
      employee,
      selectedCapabilityIds: selected,
      planName: "Free",
      planPrice: "$0",
      accepted: true,
    });

    expect(summary.evidence.join("\n")).toContain("source.verify");
    expect(summary.artifacts.join("\n")).toContain("artifact.report");
    expect(summary.cost).toContain("$0");
    expect(summary.duration).toContain(employee.lifecycle.trial_period);
    expect(summary.approval).toContain("Accepted");
  });
});
