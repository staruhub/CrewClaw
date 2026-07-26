import { describe, expect, it } from "vitest";

import {
  employeeEvidenceBadge,
  employeeEvidenceLevel,
  employees,
  hasPublishedLabCredential,
  type Employee,
} from "../../src/data/employees";

describe("employee evidence labels", () => {
  const packageValidated = employees.find(
    employee => employee.evidence_state.package_status === "validated"
  );

  it("labels a C1 package as registry validation, not certification", () => {
    expect(packageValidated).toBeDefined();
    expect(employeeEvidenceBadge(packageValidated!)).toBe(
      "Package validated · registry"
    );
    expect(employeeEvidenceLevel(packageValidated!)).toBe(
      "C1 · package · registry"
    );
    expect(hasPublishedLabCredential(packageValidated!)).toBe(false);
  });

  it("requires mock:false, signature, and source before showing lab certified", () => {
    expect(packageValidated).toBeDefined();
    const labCertified = {
      ...packageValidated!,
      certification: "C2",
      evidence_state: {
        ...packageValidated!.evidence_state,
        lab_status: "certified",
      },
      certified_evaluation: {
        mock: false,
        signature: "signed-fixture",
        source: "certification/fixture/credential.json",
      },
    } as Employee;

    expect(hasPublishedLabCredential(labCertified)).toBe(true);
    expect(employeeEvidenceBadge(labCertified)).toBe(
      "Lab certified · registry"
    );

    const missingSignature = {
      ...labCertified,
      certified_evaluation: {
        ...labCertified.certified_evaluation!,
        signature: "",
      },
    };
    expect(hasPublishedLabCredential(missingSignature)).toBe(false);
    expect(employeeEvidenceBadge(missingSignature)).toBe(
      "Package validated · registry"
    );
  });
});
