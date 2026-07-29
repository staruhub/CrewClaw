export const hireEn = {
  permissionPublicWebLabel: "Public web research",
  permissionPublicWebAccess: "Public websites and open web search results.",
  permissionPublicWebConfirmation:
    "No write action. User still reviews final recommendations.",
  permissionPublicWebRisk:
    "Public sources can be outdated, incomplete, or misleading.",
  permissionContactsLabel: "Contacts",
  permissionContactsAccess:
    "Private contact context only if you enable it later.",
  permissionContactsConfirmation:
    "Disabled by default. Enable only when a task needs it.",
  permissionContactsRisk:
    "Contact records may contain private or sensitive relationship data.",
  permissionCrmLabel: "CRM records",
  permissionCrmAccess:
    "CRM records and fields only after explicit future authorization.",
  permissionCrmConfirmation: "Disabled for MVP onboarding.",
  permissionCrmRisk:
    "Incorrect writes could pollute lead records or create follow-up mistakes.",
  permissionOutboundLabel: "Outbound messages",
  permissionOutboundAccess:
    "Drafts for emails, direct messages, or outreach copy.",
  permissionOutboundConfirmation:
    "Human confirmation is required before anything is sent.",
  permissionOutboundRisk:
    "Poorly reviewed outreach can damage trust or contact the wrong person.",
  permissionReadAccess: "Requested read access for this task area.",
  permissionTaskAccess: "Requested task access.",
  permissionHumanConfirmation:
    "Human confirmation is required before the action completes.",
  permissionDisabledConfirmation:
    "Disabled by default. Enable only when needed.",
  permissionNoExtraConfirmation:
    "No extra confirmation beyond hiring this employee.",
  permissionWriteRisk: "Incorrect writes could change user data.",
  permissionReadRisk:
    "Incorrect reads or outdated data could affect recommendations.",
  operationRead: "read access",
  operationWrite: "task-scoped writes",
  operationSend: "external sends",
  operationExecute: "bounded execution",
  capabilityEnabled: "Enabled",
  capabilityOff: "Off",
  areaTools: "Tools",
  areaFiles: "Files and workspace",
  areaBrowser: "Browser",
  areaNetwork: "Network",
  areaBudget: "Budget",
  areaApproval: "Human approval",
  budgetPackageSelected:
    "{planName} package selected ({planPrice}); prototype checkout records intent only.",
  approvalRequired:
    "Activation requires all Doctor checks to pass and a human-accepted bounded trial.",
  limitCallsPerTask: "{count} calls/task",
  limitTimeout: "{ms} ms timeout",
  runtimeTimeout: "{capability}: runtime timeout {ms} ms",
  doctorContractName: "Contract manifest",
  doctorContractPass:
    "{employeeName} has a registry-backed hire contract and version {version}.",
  doctorContractFail:
    "The package is marked invalid by the registry projection.",
  doctorContractPassAction: "No action needed.",
  doctorContractFailAction:
    "Return to the marketplace and choose a validated employee package.",
  doctorRuntimeName: "Runtime compatibility",
  doctorRuntimePass: "{trialPeriod} trial is available before activation.",
  doctorRuntimeFail:
    "This employee is not currently hireable in the registry projection.",
  doctorRuntimeFailAction:
    "Use CLI validation or update the package metadata before hiring.",
  doctorToolsName: "Tool availability",
  doctorToolsPass:
    "{count} selected capabilities avoid policy-disabled or unconfigured adapter paths.",
  doctorToolsFail:
    "{count} selected {capabilityWord} {needWord} configuration: {capabilities}.",
  doctorToolsFailAction:
    "Turn off optional adapter capabilities here, or configure the provider before activating.",
  capabilityWordSingular: "capability",
  capabilityWordPlural: "capabilities",
  needsSingular: "needs",
  needsPlural: "need",
  doctorFilesName: "File and workspace scope",
  doctorFilesPass:
    "Required workspace capabilities are read-only or declare a task scope.",
  doctorFilesFail: "{capabilities} lacks an explicit write scope.",
  doctorFilesFailAction:
    "Add a scope to the employee spec before enabling write access.",
  doctorNetworkName: "Browser and network preflight",
  doctorNetworkPass:
    "{count} selected network/browser {capabilityWord} {beWord} declared for the trial.",
  doctorNetworkFail:
    "No selected capability can gather or verify external evidence.",
  doctorNetworkFailAction:
    "Enable a verified research capability or choose a non-research trial.",
  beSingular: "is",
  bePlural: "are",
  doctorBudgetName: "Budget and duration ceiling",
  doctorBudgetDetail:
    "{planName} is selected; trial duration is capped at {trialPeriod}. Browser checkout is a labeled demo and charges nothing.",
  doctorBudgetFailAction: "Select a package before running the Doctor.",
  doctorApprovalName: "Human approval wiring",
  doctorApprovalPass:
    "Risky selected capabilities are read-only, previewable, or routed through human authorization.",
  doctorApprovalFail:
    "{capabilities} needs an approval marker before activation.",
  doctorApprovalFailAction:
    "Change the employee spec to require approval for high-risk writes.",
  doctorEvidenceName: "Evidence and artifact capture",
  doctorEvidencePass:
    "The trial can produce inspectable evidence and at least one deliverable artifact summary.",
  doctorEvidenceFail:
    "No evidence or artifact path is declared for this employee.",
  doctorEvidenceFailAction:
    "Require evidence.create, artifact.report, or documented example outputs.",
  doctorReadyDetail:
    "Ready to validate this browser-side projection against the declared package facts.",
  trialEvidenceDeclared: "{capability}: declared trial evidence",
  trialEvidenceDemo:
    "Demo evidence summary: no live runtime event is available in this browser.",
  trialArtifactDeclared: "{capability}: bounded trial artifact",
  trialCost:
    "{planName} {planPrice}; trial preview records $0 charged in this prototype.",
  trialDuration:
    "Bounded by {trialPeriod}; no long-running OpenWork task starts from this page.",
  trialApprovalAccepted: "Accepted by human reviewer in this browser session.",
  trialApprovalWaiting: "Waiting for human review before activation.",
  optionalCapabilityRemains: "{count} optional capability remains off",
  optionalCapabilitiesRemain: "{count} optional capabilities remain off",
  conditionalCapabilityOff: "{count} conditional capability is off",
  conditionalCapabilitiesOff: "{count} conditional capabilities are off",
  capabilityHasScope: "{count} capability has an explicit data scope.",
  capabilitiesHaveScope: "{count} capabilities have an explicit data scope.",
  accessWithinScope:
    "Access stays within each capability's declared task scope.",
  overviewAccess:
    "Current selection enables {selectedCount} declared {capabilityWord} ({requiredCount} required). {scopeSentence}{offSentence}",
  authorizationCapabilityPauses:
    "{count} capability pauses for human authorization.",
  authorizationCapabilitiesPause:
    "{count} capabilities pause for human authorization.",
  noCallTimeAuthorization:
    "No selected capability requires call-time human authorization.",
  adapterCapabilityDepends:
    "{count} capability depends on a configured provider adapter.",
  adapterCapabilitiesDepend:
    "{count} capabilities depend on a configured provider adapter.",
  noProviderAdapter: "No selected capability depends on a provider adapter.",
  overviewActions:
    "The selected contract permits {operations}. {authorizationSentence} {adapterSentence}",
  noExternalSideEffects:
    "Selected capabilities declare no external side effects.",
  additionalSideEffect:
    "{count} additional declared side effect is detailed below.",
  additionalSideEffects:
    "{count} additional declared side effects are detailed below.",
  policyDisabledCapabilityRemains:
    "{count} policy-disabled capability remains unavailable.",
  policyDisabledCapabilitiesRemain:
    "{count} policy-disabled capabilities remain unavailable.",
  roleBoundary: "Role boundary: {roleBoundary}",
  overviewRisk:
    "Highest enabled risk tier: {highestRisk}. {sideEffect}{extraSideEffects} {disabledSentence}{roleBoundarySentence}",
  notFoundBadge: "Onboarding",
  notFoundTitle: "Employee not found",
  notFoundBody: "This AI employee is not available in the marketplace.",
  backToMarketplace: "Back to marketplace",
  legacyContext: "Legacy context",
  legacyContextDetail:
    "Declared by legacy package metadata for context only. It cannot grant a runtime capability and cannot be changed here.",
  statusWaiting: "Waiting",
  statusProgress: "Progress",
  statusPass: "Pass",
  statusActionNeeded: "Action needed",
  contractTitle: "Hiring contract",
  contractBody: "Confirm the job boundary before granting any runtime status.",
  contractStage: "Contract stage",
  deliverables: "Deliverables",
  expectations: "Expectations",
  expectationRole: "Role: {role}",
  expectationRuntimePackage: "Runtime package: {employeeId}@{version}",
  expectationCost:
    "Expected cost: {planName} {planPrice}; no real payment in this prototype.",
  expectationTrial: "Trial before activation: {trialPeriod}",
  expectationProof: "Performance proof: {proof}",
  evidenceCertified: "{certification} certified evaluation from {source}",
  evidenceValidated:
    "Package validation is real; certification score is not promoted as live lab proof.",
  evidenceIncomplete:
    "Registry evidence is incomplete; treat marketplace claims as draft.",
  required: "Required",
  optional: "Optional",
  noRequiredAccess: "No required access in this area.",
  noOptionalAccess: "No optional access in this area.",
  policyDisabled: "Policy disabled",
  doctorTitle: "Doctor checks",
  doctorBody:
    "Browser Doctor is a labeled readiness projection from package metadata. The CLI/runtime Doctor remains the source for live credentials, provider health, and workspace execution.",
  runDoctor: "Run Doctor",
  rerunDoctor: "Re-run Doctor",
  doctorPassedTitle: "Doctor passed for this selected contract.",
  doctorFailedTitle: "Doctor found activation blockers.",
  doctorPassedBody: "You can run the bounded trial next.",
  doctorFailedBody:
    "Resolve the actionable failures above before trial acceptance can unlock activation.",
  trialTitle: "Bounded trial summary",
  trialBody:
    "This page does not start a live OpenWork task. It records a representative trial review from declared package facts and keeps activation locked until a human accepts it.",
  trialSummarized: "Trial summarized",
  runBoundedTrial: "Run bounded trial",
  trialAccepted: "Trial accepted",
  acceptTrial: "Accept trial",
  task: "Task",
  costAndDuration: "Cost and duration",
  evidence: "Evidence",
  artifactsAndApproval: "Artifacts and approval",
  hiredBadge: "Hired on this machine",
  readyBadge: "Local hire options ready",
  hiredTitle: "{employeeName} is on your local roster.",
  readyTitle: "Finish hiring on this machine.",
  hiredBody:
    "This browser wrote the durable local roster through the local CrewClaw API. You can still use the CLI commands below on another machine.",
  readyBody:
    "This browser saved your {employeeName} selection and the {planName} package. On this machine you can hire through the local API, or copy a CLI command for another machine.",
  optionThisMachine: "Option 0 / this machine",
  thisMachineBody:
    "When the local CrewClaw site is running against this workspace, hire writes .crewclaw/team.json the same way fire does - no clipboard step required.",
  hiringOnThisMachine: "Hiring on this machine...",
  hireOnThisMachine: "Hire on this machine",
  openTeam: "Open team",
  backToResume: "Back to resume",
  keepBrowsing: "Keep browsing",
  hireConfirmation: "Hire Confirmation",
  reviewTitle: "Review capabilities before hiring {employeeName}",
  reviewBody:
    "This employee can join your durable local roster after you choose a package and authorize the declared capabilities. When the local CrewClaw API is available the site can write that roster on this machine; otherwise the CLI handoff performs the same validation. No real payment is processed in this prototype.",
  websiteStoresTitle: "What the website stores",
  websiteStoresSelection:
    "Only this hiring selection is stored in the browser. It is not an employee record and does not grant runtime access.",
  websiteStoresCli:
    "The CLI revalidates every capability before it atomically updates your local team file.",
  handoffTitle: "Hiring handoff",
  handoffBody:
    "The marketplace carries the first task, budget label, runtime, and requested access into this review. These values are context, not runtime authorization.",
  intendedTask: "Intended task",
  budgetRuntime: "Budget / runtime",
  requestedAccess: "Requested access",
  noMarketplaceAccess:
    "No marketplace access hint; required capabilities below remain authoritative.",
  choosePackage: "Choose a package",
  choosePackageBody:
    "Pricing is part of the hiring preview. This checkout is simulated and will not charge a real card.",
  planFreeName: "Free",
  planFreeCadence: "demo onboarding",
  planFreeDescription:
    "Hire this AI employee into your local demo crew with no payment.",
  planFreeBulletNoPayment: "No real payment",
  planFreeBulletLocalRecord: "Local team record",
  planFreeBulletManualReview: "Manual permission review",
  planProName: "Pro",
  planProCadence: "mock monthly seat",
  planProDescription:
    "Preview a paid seat flow before the employee joins your crew.",
  planProBulletMock: "Mock checkout only",
  planProBulletNoCard: "No card is charged",
  planProBulletSameLocal: "Same local onboarding",
  checkoutTitle: "Simulated checkout confirmation",
  mockCheckout: "Mock checkout",
  checkoutBody:
    "Confirming this step only records your selected package in the demo flow. There is no payment processor, no card form, and no real charge.",
  checkoutSimulated: "Checkout simulated",
  confirmCheckout: "Confirm simulated checkout",
  checkoutConfirmedTitle: "Simulated checkout confirmed.",
  checkoutConfirmedBody:
    "Continue reviewing permissions before preparing the local CLI handoff.",
  wantsAccess: "It wants to access",
  canDo: "It can do",
  mainRisk: "Main risk",
  toolCapabilitiesTitle: "Tool capabilities",
  toolCapabilitiesBody:
    "Required capabilities are locked on. Conditional capabilities are enabled for relevant tasks and can be turned off. Optional capabilities require an explicit opt-in; policy-disabled ones stay unavailable.",
  requiredOptionalAccessTitle: "Required and optional access",
  requiredOptionalAccessBody:
    "CrewClaw separates required permissions from optional access across tools, files, browser, network, budget, and human approval.",
  legacyContextTitle: "Declared legacy context",
  legacyContextBody:
    "These hire.yaml declarations are read-only context, not runtime authorization. Only the capability selections above create formal capability tokens for this employee.",
  riskBoundaries: "Risk boundaries",
  activateLocalHire: "Activate local hire",
  passDoctorFirst: "Pass Doctor and accept trial first",
  cliCopied: "Copied",
  cliCopy: "Copy",
  packageMetadataUnavailable: "Package metadata unavailable",
  cliLocalHandoff: "Local handoff",
  cliFinishTitle: "Finish hiring on your machine",
  cliNotHiredYet: "Not hired yet",
  cliBody:
    "Use these CLI paths when hiring on another machine, offline, or from a verified package tarball. On this machine, the hire page can also write .crewclaw/team.json through the local API (same trust boundary as fire).",
  cliRequiredContractOnly: "Required capability contract only",
  cliOptionRegistry: "Option A / trusted registry",
  cliOptionPackage: "Option B / verified package",
  cliDownloadPackage: "Download package",
  cliFile: "FILE",
  cliSha256: "SHA-256",
  cliLoadingMetadata: "Loading signed package metadata...",
} as const;

export type HireMessageKey = keyof typeof hireEn;
