export const manualEn = {
  "nav.title": "User Handbook",
  "hero.title": "CrewClaw User Handbook",
  "hero.subtitle":
    "Everything you need to discover, hire, supervise, and improve AI employees.",

  "section.what.title": "What is CrewClaw?",
  "section.what.description":
    "CrewClaw is a local-first AI Employee OS. It turns agents into accountable digital employees with verifiable role contracts, scoped capabilities, Doctor preflight checks, bounded trial work, evidence-backed delivery, human approval, and measurable local performance.",
  "section.what.not": "What CrewClaw is not:",
  "section.what.not.chat": "Not a generic AI chat interface",
  "section.what.not.replacement":
    "Not a replacement for OpenWork (CrewClaw hires employees; OpenWork is the desktop workbench)",
  "section.what.not.hosted": "Not a hosted service or SaaS product",
  "section.what.not.paid":
    "Not a paid product—fully Apache-2.0 open source",

  "section.requirements.title": "System Requirements",
  "section.requirements.git": "Git",
  "section.requirements.nodejs": "Node.js 22.22.0 or higher",
  "section.requirements.pnpm": "pnpm 10.33.2 (pinned by package.json)",
  "section.requirements.rust":
    "Stable Rust toolchain with rustfmt and clippy",
  "section.requirements.chromium": "Chromium (for browser end-to-end tests)",
  "section.requirements.hermes":
    "Hermes (only when installing employees or running model tasks)",
  "section.requirements.note":
    "The website prepares local hire intent but does not execute model tasks. Hermes is required only when you hire employees or run tasks that need a model.",

  "section.install.title": "Install from Source",
  "section.install.clone": "Clone the repository:",
  "section.install.setup": "Enable Corepack and install dependencies:",
  "section.install.verify": "Verify the installation:",
  "section.install.build": "Build the project:",
  "section.install.start": "Start the web interface:",
  "section.install.open":
    "Open http://localhost:3000/ in your browser to access the marketplace.",

  "section.hire.title": "Hiring Your First Employee",
  "section.hire.intro":
    "CrewClaw uses the official Hermes profile commands to install employees. The hire flow includes contract review, Doctor checks, and optional trial tasks.",
  "section.hire.list": "List available employees:",
  "section.hire.interactive":
    "Run crewclaw without arguments for an interactive employee selector.",
  "section.hire.direct": "Hire an employee directly (with confirmation):",
  "section.hire.trial": "Hire and run a trial task:",
  "section.hire.check": "Check system readiness:",

  "section.lifecycle.title": "Employee Lifecycle",
  "section.lifecycle.intro":
    "Every AI employee in CrewClaw follows a complete, auditable lifecycle:",
  "section.lifecycle.discover.title": "1. Discover",
  "section.lifecycle.discover.body":
    "Browse the marketplace to find employees by role, certification level, and capability requirements.",
  "section.lifecycle.review.title": "2. Review Contract",
  "section.lifecycle.review.body":
    "Inspect hire.yaml (role, permissions, tools) and crewclaw.employee.yaml (runtime spec, outcome rubric, and evaluation suite).",
  "section.lifecycle.doctor.title": "3. Doctor Check",
  "section.lifecycle.doctor.body":
    "Before work begins, Doctor verifies contract integrity, permission boundaries, tool availability, memory setup, budget limits, runtime compatibility, and evidence capture readiness.",
  "section.lifecycle.trial.title": "4. Trial Work",
  "section.lifecycle.trial.body":
    "New hires can run a first task with scoped permissions to validate their contract and demonstrate core capabilities.",
  "section.lifecycle.supervise.title": "5. Supervise",
  "section.lifecycle.supervise.body":
    "The Node TaskEvent runtime records task events. The Rust/Ratatui Workbench displays actions, costs, evidence, artifacts, and approval gates in real time.",
  "section.lifecycle.approve.title": "6. Approve or Return",
  "section.lifecycle.approve.body":
    "Deliveries without verifiable evidence cannot pass acceptance. Human reviewers inspect artifacts, approve completed work, or return tasks with feedback.",
  "section.lifecycle.improve.title": "7. Review and Improve",
  "section.lifecycle.improve.body":
    "KPIs update after approval. Dream retrospectives capture what worked and what to improve. All data stays local.",

  "section.beta.title": "Beta 0.8 Limitations",
  "section.beta.intro":
    "CrewClaw Beta 0.8 is a prerelease. Interfaces and local state formats may change. Known limitations include:",
  "section.beta.validation":
    "Registry validation (C1) confirms package structure but is not a signed lab certification.",
  "section.beta.openwork":
    "OpenWork v0.1.1 is an unsigned Windows prerelease. Windows may show a publisher warning. macOS and Linux installers are not included in that release.",
  "section.beta.openwork.scope":
    "OpenWork currently provides local desktop tasks, plan approval, Hermes one-shot execution, durable history, package import, workspace selection, memory facts, and a read-only skills index. Browser automation, Office editing, scheduling, and multi-agent orchestration are not part of the current release.",
  "section.beta.stateChanges":
    "Interfaces and local state formats may still change during Beta.",
  "section.beta.modelUsage":
    "Provider and model usage (when configured) is charged by those providers to your own account.",

  "section.support.title": "Support and Security",
  "section.support.intro":
    "CrewClaw is released under Apache-2.0 and does not include commercial support or guaranteed response times.",
  "section.support.bugs": "For reproducible bugs and feature proposals:",
  "section.support.github": "Use GitHub Issues",
  "section.support.before": "Before opening an issue:",
  "section.support.search": "Search existing issues",
  "section.support.doctor": "Run pnpm run crewclaw -- doctor when CLI-related",
  "section.support.info":
    "Include your OS, Node.js version, pnpm version, Rust version, CrewClaw revision, and relevant sanitized logs",
  "section.support.sanitize":
    "Remove credentials, personal data, local paths, and employee work artifacts",
  "section.support.security": "For security vulnerabilities:",
  "section.support.securityNote":
    "Do not report vulnerabilities, leaked credentials, or private user data in a public issue. Follow the instructions in SECURITY.md.",

  "section.resources.title": "Additional Resources",
  "section.resources.readme": "Project README",
  "section.resources.releases": "Release Notes",
  "section.resources.support": "Support Policy",
  "section.resources.security": "Security Policy",
  "section.resources.contributing": "Contributing Guide",
  "section.resources.demo": "57-second concept video",
};
