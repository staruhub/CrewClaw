import { useCallback, useEffect, useMemo, useState } from "react";
import type { EmployeeManifest } from "@contracts/manifest";

const SUBMISSIONS_STORAGE_KEY = "crewclaw.submissions.v1";

export type SubmissionStatus = "draft" | "submitted" | "rejected" | "published";

export type SubmissionManifestFields = {
  id: string;
  name: string;
  role: string;
  version: string;
  creator: string;
  description: string;
  identity: string;
  soul: string;
  skills: string[];
  tools: string[];
  permissions: string[];
  input_examples: string[];
  output_examples: string[];
  limitations: string[];
  install_requirements: string[];
};

export type CreatorSubmission = {
  submission_id: string;
  manifest: SubmissionManifestFields;
  contract_manifest: EmployeeManifest;
  status: SubmissionStatus;
  verified: boolean;
  disabled: boolean;
  high_risk_permissions: string[];
  created_at: string;
  updated_at: string;
  submitted_at: string | null;
  reviewed_at: string | null;
  disabled_at: string | null;
  rejection_reason: string | null;
};

export type SubmissionActionResult = {
  ok: boolean;
  message: string;
  submission?: CreatorSubmission;
  missingFields?: string[];
};

export const EMPTY_MANIFEST_FIELDS: SubmissionManifestFields = {
  id: "",
  name: "",
  role: "",
  version: "0.1.0",
  creator: "",
  description: "",
  identity: "",
  soul: "",
  skills: [],
  tools: [],
  permissions: [],
  input_examples: [],
  output_examples: [],
  limitations: [],
  install_requirements: [],
};

const REQUIRED_TEXT_FIELDS: Array<keyof SubmissionManifestFields> = [
  "id",
  "name",
  "role",
  "version",
  "creator",
  "description",
  "identity",
  "soul",
];

const REQUIRED_LIST_FIELDS: Array<keyof SubmissionManifestFields> = [
  "skills",
  "tools",
  "permissions",
  "input_examples",
  "output_examples",
  "limitations",
  "install_requirements",
];

function nowIso() {
  return new Date().toISOString();
}

function normalizeText(value: string) {
  return value.trim();
}

function normalizeList(values: string[]) {
  return values.map((value) => value.trim()).filter(Boolean);
}

function normalizeManifest(manifest: SubmissionManifestFields): SubmissionManifestFields {
  return {
    id: normalizeText(manifest.id),
    name: normalizeText(manifest.name),
    role: normalizeText(manifest.role),
    version: normalizeText(manifest.version),
    creator: normalizeText(manifest.creator),
    description: normalizeText(manifest.description),
    identity: normalizeText(manifest.identity),
    soul: normalizeText(manifest.soul),
    skills: normalizeList(manifest.skills),
    tools: normalizeList(manifest.tools),
    permissions: normalizeList(manifest.permissions),
    input_examples: normalizeList(manifest.input_examples),
    output_examples: normalizeList(manifest.output_examples),
    limitations: normalizeList(manifest.limitations),
    install_requirements: normalizeList(manifest.install_requirements),
  };
}

export function findHighRiskPermissions(permissions: string[]) {
  return normalizeList(permissions).filter((permission) => {
    const value = permission.toLowerCase();

    return (
      value === "mailbox:send" ||
      value === "contacts:write" ||
      value.endsWith(":delete") ||
      value.includes(":delete:") ||
      value.includes("delete") ||
      value.includes("付款") ||
      value.includes("支付") ||
      value.includes("payment") ||
      value.includes("pay:") ||
      value.includes("billing:charge") ||
      value.includes("invoice:pay")
    );
  });
}

export function validateSubmissionManifest(manifest: SubmissionManifestFields) {
  const normalized = normalizeManifest(manifest);
  const missingFields: string[] = [];

  for (const field of REQUIRED_TEXT_FIELDS) {
    if (!normalized[field]) missingFields.push(field);
  }

  for (const field of REQUIRED_LIST_FIELDS) {
    const value = normalized[field];
    if (Array.isArray(value) && value.length === 0) missingFields.push(field);
  }

  return {
    ok: missingFields.length === 0,
    missingFields,
    manifest: normalized,
  };
}

function toContractManifest(manifest: SubmissionManifestFields): EmployeeManifest {
  const safe = normalizeManifest(manifest);

  return {
    apiVersion: "crewclaw/v1",
    kind: "Employee",
    metadata: {
      id: safe.id || "draft-employee",
      name: safe.name || "Draft Employee",
      mascot: "employee",
      version: safe.version || "0.1.0",
      certification: "unverified",
      published_by: safe.creator || "local-creator",
      creator: safe.creator || "local-creator",
    },
    identity: {
      title: safe.role || "Draft role",
      description: safe.identity || safe.description || "Draft identity",
      reports_to: "team-owner",
      location: "remote",
    },
    soul: safe.soul || "Draft working principles.",
    skills: safe.skills.length > 0 ? safe.skills : ["draft-skill"],
    tools: safe.tools.length > 0 ? safe.tools : ["manual-review"],
    permissions: safe.permissions.length > 0 ? safe.permissions : ["read-only"],
    requires: {
      hermes: ">=0.1.0",
      runtime: "local",
      env: safe.install_requirements.length > 0 ? safe.install_requirements : ["none"],
    },
    examples: {
      inputs: safe.input_examples.length > 0 ? safe.input_examples : ["Draft input example"],
      outputs: safe.output_examples.length > 0 ? safe.output_examples : ["Draft output example"],
    },
    limitations: safe.limitations.length > 0 ? safe.limitations : ["Draft limitation"],
    sla: {
      response_time: "best-effort",
      availability: "local-demo",
      escalation: "human-owner",
    },
    lifecycle: {
      hireable: true,
      fireable: true,
      trial_period: "7d",
    },
    safety_notes: findHighRiskPermissions(safe.permissions).map(
      (permission) => `High-risk permission requires operator review: ${permission}`,
    ),
  };
}

function createSubmission(manifest?: Partial<SubmissionManifestFields>): CreatorSubmission {
  const timestamp = nowIso();
  const nextManifest = normalizeManifest({
    ...EMPTY_MANIFEST_FIELDS,
    ...manifest,
  });

  return {
    submission_id: `submission:${timestamp}:${Math.random().toString(36).slice(2, 8)}`,
    manifest: nextManifest,
    contract_manifest: toContractManifest(nextManifest),
    status: "draft",
    verified: false,
    disabled: false,
    high_risk_permissions: findHighRiskPermissions(nextManifest.permissions),
    created_at: timestamp,
    updated_at: timestamp,
    submitted_at: null,
    reviewed_at: null,
    disabled_at: null,
    rejection_reason: null,
  };
}

function hydrateSubmission(value: CreatorSubmission): CreatorSubmission {
  const manifest = normalizeManifest({
    ...EMPTY_MANIFEST_FIELDS,
    ...value.manifest,
  });

  return {
    ...value,
    manifest,
    contract_manifest: toContractManifest(manifest),
    high_risk_permissions: findHighRiskPermissions(manifest.permissions),
    disabled: Boolean(value.disabled),
    submitted_at: value.submitted_at ?? null,
    reviewed_at: value.reviewed_at ?? null,
    disabled_at: value.disabled_at ?? null,
    rejection_reason: value.rejection_reason ?? null,
  };
}

function readStoredSubmissions(): CreatorSubmission[] {
  if (typeof window === "undefined") return [];

  const raw = window.localStorage.getItem(SUBMISSIONS_STORAGE_KEY);
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map((item) => hydrateSubmission(item)) : [];
  } catch {
    return [];
  }
}

function writeStoredSubmissions(submissions: CreatorSubmission[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(SUBMISSIONS_STORAGE_KEY, JSON.stringify(submissions));
}

export function useSubmissions() {
  const [submissions, setSubmissions] = useState<CreatorSubmission[]>(() =>
    readStoredSubmissions(),
  );

  useEffect(() => {
    writeStoredSubmissions(submissions);
  }, [submissions]);

  const list = useCallback(() => submissions, [submissions]);

  const get = useCallback(
    (id: string) => submissions.find((submission) => submission.submission_id === id),
    [submissions],
  );

  const createDraft = useCallback((manifest?: Partial<SubmissionManifestFields>) => {
    const draft = createSubmission(manifest);
    setSubmissions((current) => [draft, ...current]);
    return draft;
  }, []);

  const updateDraft = useCallback(
    (id: string, patch: Partial<SubmissionManifestFields>): SubmissionActionResult => {
      let updatedSubmission: CreatorSubmission | undefined;

      setSubmissions((current) =>
        current.map((submission) => {
          if (submission.submission_id !== id) return submission;
          if (submission.status !== "draft" && submission.status !== "rejected") return submission;

          const manifest = normalizeManifest({
            ...submission.manifest,
            ...patch,
          });
          updatedSubmission = {
            ...submission,
            manifest,
            contract_manifest: toContractManifest(manifest),
            high_risk_permissions: findHighRiskPermissions(manifest.permissions),
            status: submission.status === "rejected" ? "draft" : submission.status,
            verified: false,
            disabled: false,
            updated_at: nowIso(),
            reviewed_at: null,
            disabled_at: null,
            rejection_reason: null,
          };

          return updatedSubmission;
        }),
      );

      if (!updatedSubmission) {
        return {
          ok: false,
          message: "Only draft or rejected submissions can be edited.",
        };
      }

      return {
        ok: true,
        message: "Draft saved.",
        submission: updatedSubmission,
      };
    },
    [],
  );

  const submit = useCallback(
    (id: string, patch?: Partial<SubmissionManifestFields>): SubmissionActionResult => {
    let result: SubmissionActionResult = {
      ok: false,
      message: "Submission not found.",
    };

    setSubmissions((current) =>
      current.map((submission) => {
        if (submission.submission_id !== id) return submission;

        if (submission.status !== "draft" && submission.status !== "rejected") {
          result = {
            ok: false,
            message: "Only draft or rejected employees can be submitted.",
            submission,
          };
          return submission;
        }

        const manifest = patch
          ? normalizeManifest({
              ...submission.manifest,
              ...patch,
            })
          : submission.manifest;
        const validation = validateSubmissionManifest(manifest);
        if (!validation.ok) {
          result = {
            ok: false,
            message: "Required manifest fields are missing.",
            submission: {
              ...submission,
              manifest: validation.manifest,
              contract_manifest: toContractManifest(validation.manifest),
              high_risk_permissions: findHighRiskPermissions(validation.manifest.permissions),
            },
            missingFields: validation.missingFields,
          };
          return submission;
        }

        const timestamp = nowIso();
        const submitted: CreatorSubmission = {
          ...submission,
          manifest: validation.manifest,
          contract_manifest: toContractManifest(validation.manifest),
          status: "submitted",
          verified: false,
          disabled: false,
          high_risk_permissions: findHighRiskPermissions(validation.manifest.permissions),
          updated_at: timestamp,
          submitted_at: timestamp,
          reviewed_at: null,
          disabled_at: null,
          rejection_reason: null,
        };

        result = {
          ok: true,
          message: "Employee submitted for review.",
          submission: submitted,
        };
        return submitted;
      }),
    );

    return result;
    },
    [],
  );

  const approve = useCallback((id: string): SubmissionActionResult => {
    let result: SubmissionActionResult = {
      ok: false,
      message: "Submission not found.",
    };

    setSubmissions((current) =>
      current.map((submission) => {
        if (submission.submission_id !== id) return submission;
        if (submission.status !== "submitted") {
          result = {
            ok: false,
            message: "Only pending submissions can be approved.",
            submission,
          };
          return submission;
        }

        const timestamp = nowIso();
        const approved: CreatorSubmission = {
          ...submission,
          status: "published",
          verified: true,
          disabled: false,
          updated_at: timestamp,
          reviewed_at: timestamp,
          disabled_at: null,
          rejection_reason: null,
        };

        result = {
          ok: true,
          message: "Verified Employee published.",
          submission: approved,
        };
        return approved;
      }),
    );

    return result;
  }, []);

  const reject = useCallback((id: string, reason = "Rejected by platform review.") => {
    let result: SubmissionActionResult = {
      ok: false,
      message: "Submission not found.",
    };

    setSubmissions((current) =>
      current.map((submission) => {
        if (submission.submission_id !== id) return submission;
        if (submission.status !== "submitted") {
          result = {
            ok: false,
            message: "Only pending submissions can be rejected.",
            submission,
          };
          return submission;
        }

        const timestamp = nowIso();
        const rejected: CreatorSubmission = {
          ...submission,
          status: "rejected",
          verified: false,
          disabled: false,
          updated_at: timestamp,
          reviewed_at: timestamp,
          disabled_at: null,
          rejection_reason: reason.trim() || "Rejected by platform review.",
        };

        result = {
          ok: true,
          message: "Employee returned to creator with review notes.",
          submission: rejected,
        };
        return rejected;
      }),
    );

    return result;
  }, []);

  const disable = useCallback((id: string): SubmissionActionResult => {
    let result: SubmissionActionResult = {
      ok: false,
      message: "Submission not found.",
    };

    setSubmissions((current) =>
      current.map((submission) => {
        if (submission.submission_id !== id) return submission;
        if (submission.status !== "published") {
          result = {
            ok: false,
            message: "Only published employees can be disabled.",
            submission,
          };
          return submission;
        }

        const timestamp = nowIso();
        const disabled: CreatorSubmission = {
          ...submission,
          verified: false,
          disabled: true,
          updated_at: timestamp,
          disabled_at: timestamp,
        };

        result = {
          ok: true,
          message: "Employee disabled and removed from the public bench.",
          submission: disabled,
        };
        return disabled;
      }),
    );

    return result;
  }, []);

  return useMemo(
    () => ({
      createDraft,
      updateDraft,
      submit,
      list,
      get,
      approve,
      reject,
      disable,
    }),
    [approve, createDraft, disable, get, list, reject, submit, updateDraft],
  );
}
