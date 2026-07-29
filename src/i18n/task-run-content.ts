import type { TaskRun } from "@/data/task-runs";
import type { Locale } from "./locale";

const seedRunId = "task_1719306072000";

export function localizeTaskRun(run: TaskRun, locale: Locale): TaskRun {
  if (locale !== "en" || run.id !== seedRunId) return run;

  return {
    ...run,
    employee_name: "AI Adoption Whale",
    role: "Enterprise LLM Adoption Advisor",
    user_goal:
      "Research Volcengine Seed 2.1 and assess whether it fits CrewClaw",
    artifacts: run.artifacts.map((artifact, index) => {
      if (index === 0) {
        return {
          ...artifact,
          summary:
            "Official name, pricing, context, capabilities, and adoption recommendation.",
          checks: [
            { label: "Official sources cited", status: "passed" as const },
            {
              label: "Pricing needs pre-launch review",
              status: "warning" as const,
            },
            {
              label: "Output structure is complete",
              status: "passed" as const,
            },
          ],
          preview: [
            "Doubao-Seed-2.1 is part of Volcengine's Seed 2.1 model family.",
            "It is a candidate for CrewClaw research and evaluation workflows; start with a limited rollout.",
            "Key assumption: confirm pricing and context limits against the final official documentation.",
          ].join("\n"),
        };
      }
      if (index === 1) {
        return {
          ...artifact,
          summary: "Structured sources, confidence, and acceptance results.",
          checks: [
            { label: "Includes source URL", status: "passed" as const },
            { label: "Includes confidence", status: "passed" as const },
          ],
        };
      }
      return artifact;
    }),
    pending_actions: [
      { key: "1", label: "Accept deliverable", command: "accept_artifact" },
      { key: "2", label: "Request pricing review", command: "revise_pricing" },
      { key: "3", label: "Export report", command: "export_report" },
    ],
    events: run.events.map((event, index) => ({
      ...event,
      summary:
        [
          "Create research plan",
          "Searching sources: site:volcengine.com Seed 2.1 pricing",
          "Reading www.volcengine.com",
          "Blocked out-of-scope action: write_crm",
          "Extract evidence and cross-check official sources",
          "Acceptance passed; deliver",
        ][index] ?? event.summary,
    })),
    tool_invocations: run.tool_invocations.map((tool, index) => ({
      ...tool,
      input_summary:
        [
          "site:volcengine.com Seed 2.1 pricing",
          "https://www.volcengine.com/product/ark",
          "Write contact to CRM",
        ][index] ?? tool.input_summary,
      action:
        [
          "Searching sources: Seed 2.1 pricing",
          "Reading www.volcengine.com",
          "Blocked out-of-scope action: write_crm",
        ][index] ?? tool.action,
    })),
    deliverable: [
      "## Official name",
      "Doubao-Seed-2.1 (Volcengine Seed 2.1 family).",
      "",
      "## Pricing",
      "Approximately ¥6 input / ¥30 output per million tokens; verify against the official listing.",
      "",
      "## Context",
      "256k tokens.",
      "",
      "## Capabilities",
      "Coding, agents, reasoning, and multimodal work.",
      "",
      "## Source",
      "https://www.volcengine.com/product/ark (official documentation, cross-checked).",
      "",
      "## Confidence",
      "High.",
      "",
      "## Recommendation",
      "Consider it as one CrewClaw candidate and begin with a limited research/evaluation rollout.",
    ].join("\n"),
  };
}
