#![cfg_attr(test, allow(clippy::field_reassign_with_default))]

use crossterm::tty::IsTty;
use serde::{Deserialize, Serialize};
use std::env;
use std::ffi::{OsStr, OsString};
use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::process::{self, Command, Stdio};
use std::time::{SystemTime, UNIX_EPOCH};

mod doctor;
mod hire_demo;
mod manifest;
mod permissions;
mod standup;
mod state_store;
mod team;
mod verify;
mod workbench;

pub(crate) const CREWCLAW_ASCII: &[&str] = &[
    "   _____                         _____ _                 ",
    "  / ____|                       / ____| |                ",
    " | |     _ __ _____      __    | |    | | __ ___      __",
    " | |    | '__/ _ \\ \\ /\\ / /    | |    | |/ _` \\ \\ /\\ / /",
    " | |____| | |  __/\\ V  V /     | |____| | (_| |\\ V  V / ",
    "  \\_____|_|  \\___| \\_/\\_/       \\_____|_|\\__,_| \\_/\\_/  ",
];

#[derive(Debug, Deserialize)]
pub(crate) struct Registry {
    pub(crate) experts: Vec<Expert>,
}

#[derive(Clone, Debug, Deserialize)]
pub(crate) struct Expert {
    pub(crate) name: String,
    pub(crate) display_name: String,
    pub(crate) status: String,
    pub(crate) certification: String,
    #[serde(default)]
    pub(crate) category: String,
    pub(crate) description: String,
    pub(crate) local_source: Option<String>,
    pub(crate) version: Option<String>,
    #[serde(default)]
    pub(crate) tags: Vec<String>,
    pub(crate) requires: Requirements,
    pub(crate) first_task: String,
}

#[derive(Clone, Debug, Deserialize)]
pub(crate) struct Requirements {
    pub(crate) hermes: String,
    pub(crate) env: Vec<String>,
}

#[derive(Debug)]
struct CommandResult {
    code: i32,
    stdout: String,
    stderr: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct UpdateCandidate {
    employee_id: String,
    current_version: String,
    registry_version: String,
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
struct HirePermissionPlan {
    granted: Vec<String>,
    pending: Vec<String>,
    disabled: Vec<String>,
    source_warning: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct ActivityEntry {
    ts: String,
    action: String,
    employee: String,
}

fn main() {
    install_cancel_handler();
    let args = env::args().skip(1).collect::<Vec<_>>();
    let root = repo_root();
    let code = match run_cli(&args, &root) {
        Ok(code) => code,
        Err(message) => {
            eprintln!("Error: {message}");
            1
        }
    };
    process::exit(code);
}

fn install_cancel_handler() {
    let _ = ctrlc::set_handler(|| {
        eprintln!("Cancelled.");
        process::exit(130);
    });
}

fn repo_root() -> PathBuf {
    if let Ok(root) = env::var("CREWCLAW_ROOT") {
        return PathBuf::from(root);
    }
    env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
}

fn run_cli(args: &[String], root: &Path) -> Result<i32, String> {
    if args
        .iter()
        .any(|arg| matches!(arg.as_str(), "help" | "--help" | "-h"))
    {
        show_help(root);
        return Ok(0);
    }

    let positionals = positionals(args);
    let command = positionals.first().map(String::as_str);
    let target = positionals.get(1).map(String::as_str);

    if matches!(command, Some("verify") | Some("check") | Some("校验")) {
        return verify::run_verify(args, root);
    }

    // `crew run <agent> "<task>"` — the REAL runtime. Loads the hired profile
    // (SOUL.md + skills) and streams a live model answer through the Node
    // runtime. This is the "employee actually does the job" half of the demo.
    if matches!(command, Some("run") | Some("chat")) {
        return run_agent_live(args, root);
    }

    if matches!(command, Some("deploy")) {
        return run_deploy(args, root);
    }

    // `crew standup "<brief>"` — the live parallel crew (real models, real cost).
    if matches!(command, Some("standup")) {
        return standup::run_standup(args, root);
    }

    // `crew workbench --demo` — Ratatui Trial Workbench. In normal mode it
    // consumes TaskEvent JSONL on stdin, so the Node runtime can pipe events in.
    if matches!(command, Some("workbench")) {
        workbench::run_workbench(has_flag(args, "--demo"))?;
        return Ok(0);
    }

    // `crew badge <agent>` — render the hired employee's manifest as an ID card.
    if matches!(command, Some("badge")) {
        return hire_demo::run_badge(args, root, target.unwrap_or(""));
    }

    let registry = read_registry(root)?;

    match command {
        None => run_interactive_hire(args, root, &registry),
        Some("search") => run_search(&registry, target),
        Some("inspect") => {
            let Some(target) = target else {
                eprintln!("Error: Missing expert name.");
                return Ok(1);
            };
            run_inspect(root, &registry, target)
        }
        Some("list") => run_list(root, &registry),
        Some("hire" | "install") => {
            let Some(target) = target else {
                return run_interactive_hire(args, root, &registry);
            };
            let Some(expert) = find_expert(&registry, target) else {
                eprintln!("Error: Unknown expert: {target}");
                return Ok(1);
            };
            run_hire(expert, args, root, false)
        }
        Some("doctor") => {
            if let Some(target) = target {
                let code = run_employee_doctor(root, &registry, target)?;
                if code == 0 {
                    append_activity(root, "doctor", target)?;
                }
                Ok(code)
            } else {
                run_environment_doctor()
            }
        }
        Some("fire") => {
            let Some(target) = target else {
                eprintln!("Error: Missing expert name.");
                return Ok(1);
            };
            run_fire(root, &registry, target, args)
        }
        Some("validate") => {
            let Some(target) = target else {
                eprintln!("Error: Missing expert path.");
                return Ok(1);
            };
            run_validate(root, target)
        }
        Some("update") => run_update(root, &registry, target, args),
        Some("logs") => run_logs(root, target),
        Some("remove") => run_hermes_passthrough("delete", target, args),
        Some(other) => {
            eprintln!("Error: Unknown command: {other}");
            show_help(root);
            Ok(1)
        }
    }
}

pub(crate) fn show_brand_header() {
    for line in CREWCLAW_ASCII {
        println!("{line}");
    }
    println!();
    println!("ChaoGeek AI Agent Hiring Platform");
    println!("Hire certified Hermes experts as command-line employees.");
}

fn show_help(root: &Path) {
    let local_command = local_command(root);
    show_brand_header();
    println!();
    println!("Usage");
    println!("  crew <command> [args]                  bundled launcher — run from any directory");
    println!("  crew hire <expert> [--yes]             e.g. crew hire ai-adoption-whale");
    println!("  crew run <expert> \"<task>\"             one-shot: put an employee to work (live)");
    println!("  crew chat <expert>                     interactive multi-turn chat session");
    println!("  (dev alternative) {local_command} <command>");
    println!();
    println!("Commands");
    println!("  search [keyword]  Search the employee registry");
    println!("  inspect <expert>  Show an AI employee resume from registry + hire.yaml");
    println!(
        "  hire <expert>     Hire an AI employee (scripted onboarding; --live installs for real)"
    );
    println!("  run <expert> <task>  Put a hired employee to work — live model, real output");
    println!("  chat <expert>     Open an interactive multi-turn chat with a hired employee");
    println!(
        "  deploy <agent> [--target openwork]  Generate an OpenWork deployment package + show compatibility level"
    );
    println!("  standup <brief>   Fan the whole crew out on one brief — live, in parallel");
    println!(
        "  workbench [--demo]  Open the Ratatui Trial Workbench; reads TaskEvent JSONL on stdin"
    );
    println!("  badge <expert>    Show a hired employee's manifest as an ID card");
    println!("  fire <expert>     Offboard a hired AI employee");
    println!("  update [expert]   Show available employee upgrades; --apply updates team state");
    println!("  logs [expert]     Show CrewClaw activity records");
    println!("  list              Show available and coming-soon experts");
    println!(
        "  doctor [expert]   Check an employee package, or git/Hermes when no expert is given"
    );
    println!("  validate <path>   Validate one expert distribution");
    println!("  remove <profile>  Run official Hermes profile delete");
    println!("  verify            Run all agents in parallel to check the project is runnable");
    println!();
    println!("Options");
    println!("  --name <profile>  Install with a custom Hermes profile name");
    println!(
        "  --grant-capability <id>  Explicitly enable one declared conditional or non_default capability (repeatable)"
    );
    println!(
        "  --skip-capability <id>   Explicitly disable one declared conditional capability (repeatable)"
    );
    println!("  --yes             Skip CrewClaw prompts where safe");
    println!("  --force           Pass --force to Hermes profile install");
    println!("  --run-first       Start the first Hermes chat test after install");
    println!(
        "  --live            verify: run each agent's real command instead of the scripted demo"
    );
    println!("  --ascii           verify: plain output with no emoji or color");
    println!("  --plain           chat/run --task: use legacy plain output instead of Workbench");
    println!(
        "  --tui/--ratatui   chat: request Ratatui Workbench explicitly (chat defaults on TTY)"
    );
    println!();
    println!("Agent instruction");
    println!("  Invoke every command as:  crew <command>");
    println!(
        "    e.g.  crew search macao  |  crew inspect <expert>  |  crew hire <expert>  |  crew run <expert> \"<task>\""
    );
    println!(
        "  Discover employees with `crew search` / `crew inspect` before raw Hermes commands."
    );
    println!(
        "  NOTE: \"crewhire\" (project folder) and \"crewclaw\" (binary) are NOT commands — always start with `crew`."
    );
}

fn run_search(registry: &Registry, keyword: Option<&str>) -> Result<i32, String> {
    let query = keyword.unwrap_or("").trim().to_ascii_lowercase();
    let matches = registry
        .experts
        .iter()
        .filter(|expert| {
            query.is_empty()
                || expert.name.to_ascii_lowercase().contains(&query)
                || expert.display_name.to_ascii_lowercase().contains(&query)
                || expert.description.to_ascii_lowercase().contains(&query)
                || expert.category.to_ascii_lowercase().contains(&query)
                || expert
                    .tags
                    .iter()
                    .any(|tag| tag.to_ascii_lowercase().contains(&query))
        })
        .collect::<Vec<_>>();

    if matches.is_empty() {
        println!(
            "No experts matched keyword: {}",
            keyword.unwrap_or("(empty)")
        );
        return Ok(0);
    }

    println!("Search results");
    for expert in matches {
        println!(
            "{}  {}  {}  {}",
            expert.name, expert.display_name, expert.status, expert.description
        );
    }
    Ok(0)
}

fn run_inspect(root: &Path, registry: &Registry, target: &str) -> Result<i32, String> {
    let Some(expert) = find_expert(registry, target) else {
        eprintln!("Error: Unknown expert: {target}");
        return Ok(1);
    };
    let Some(local_source) = expert.local_source.as_deref() else {
        eprintln!(
            "Error: {} has no local employee package yet.",
            expert.display_name
        );
        return Ok(1);
    };
    let manifest = match manifest::read_manifest(root, &expert.name, local_source) {
        Ok(manifest) => manifest,
        Err(error) => {
            eprintln!("Error: {error}");
            return Ok(1);
        }
    };

    println!("Employee resume");
    println!("name: {}", expert.name);
    println!("display_name: {}", expert.display_name);
    println!("status: {}", expert.status);
    println!(
        "version: {}",
        expert.version.as_deref().unwrap_or("unknown")
    );
    println!("certification: {}", expert.certification);
    println!();
    println!("identity:");
    println!("  title: {}", manifest.identity.title);
    println!("  description: {}", manifest.identity.description);
    print_list("skills", &manifest.skills);
    print_list("tools", &manifest.tools);
    print_list("permissions", &manifest.permissions);
    println!("requires:");
    println!("  hermes: {}", blank(&manifest.requires.hermes));
    println!("  runtime: {}", blank(&manifest.requires.runtime));
    print_list("  env", &manifest.requires.env);
    println!("examples:");
    print_list("  inputs", &manifest.examples.inputs);
    print_list("  outputs", &manifest.examples.outputs);
    print_list("limitations", &manifest.limitations);
    println!("lifecycle:");
    for (key, value) in &manifest.lifecycle {
        println!("  {key}: {value}");
    }
    Ok(0)
}

fn run_list(root: &Path, registry: &Registry) -> Result<i32, String> {
    println!("Expert registry");
    for expert in &registry.experts {
        println!(
            "{}  {}  {}  {}",
            expert.name, expert.status, expert.certification, expert.description
        );
    }

    println!();
    println!("Team roster");
    let employees = team::read_team(root)?;
    if employees.is_empty() {
        println!("(no hired employees)");
    } else {
        for employee in employees {
            println!(
                "{}  {}  {}",
                employee.employee_id,
                employee.status.as_str(),
                employee.version
            );
        }
    }
    Ok(0)
}

fn run_hire(
    expert: &Expert,
    args: &[String],
    root: &Path,
    ask_first_run: bool,
) -> Result<i32, String> {
    if let Some(code) = reject_unhireable(expert, root) {
        return Ok(code);
    }

    let employees = team::read_team(root)?;
    if let Some(employee) = team::active_employee(&employees, &expert.name) {
        ensure_active_rehire_version(root, expert, employee)?;
        // An active employee's capability selection is frozen. Re-hire starts from that
        // selection and changes it only through an explicit --grant/--skip option.
        let permission_plan =
            rehire_permission_plan(root, expert, args, &employee.permissions_granted)?;
        let workspace_employee_id = employee.workspace_employee_id.clone();
        // Re-hire is also a security reconciliation point: old team.json files may contain
        // disabled or confirmation-gated manifest entries as if they were grants.
        persist_hire(root, expert, &permission_plan)?;
        println!(
            "Already hired: {} is active as {} (AC-HIRE-004).",
            expert.name, workspace_employee_id
        );
        return Ok(0);
    }

    // Freeze and validate the complete legacy-scope + canonical-capability plan before Hermes,
    // ceremony, or team state can change. An invalid grant must have zero installation effects.
    let permission_plan = hire_permission_plan(root, expert, args)?;

    let code = if !has_flag(args, "--live") && hire_demo::has_ceremony(root, &expert.name) {
        hire_demo::run_hire_ceremony(args, root, &expert.name)?
    } else {
        hire_expert(expert, args, root, ask_first_run)?
    };

    if code == 0 {
        persist_hire(root, expert, &permission_plan)?;
        append_activity(root, "hire", &expert.name)?;
    }
    Ok(code)
}

fn ensure_active_rehire_version(
    root: &Path,
    expert: &Expert,
    employee: &team::WorkspaceEmployee,
) -> Result<(), String> {
    let local_source = expert
        .local_source
        .as_deref()
        .ok_or_else(|| "employee has no local manifest source".to_string())?;
    let manifest = manifest::read_manifest(root, &expert.name, local_source)?;
    let registry_version = expert.version.as_deref().unwrap_or("unknown");
    let spec_version = manifest.metadata.version.trim();
    if employee.version == registry_version
        && !spec_version.is_empty()
        && employee.version == spec_version
    {
        return Ok(());
    }

    Err(format!(
        "Cannot re-hire {} while its active record is version {} but registry/spec policy is {}/{}. Run `crew update {} --apply` before hiring again.",
        expert.name,
        employee.version,
        registry_version,
        if spec_version.is_empty() {
            "missing"
        } else {
            spec_version
        },
        expert.name
    ))
}

fn persist_hire(root: &Path, expert: &Expert, plan: &HirePermissionPlan) -> Result<(), String> {
    let permissions = plan.granted.clone();
    let version = expert.version.as_deref().unwrap_or("unknown");
    let (record, created) = team::mutate_team(root, |employees| {
        if let Some(existing) = team::active_employee_mut(employees, &expert.name) {
            // Exact replacement makes re-hire idempotent and revokes grants that are no longer
            // safe-by-default. Never union with the legacy list: that would preserve escalation.
            existing.permissions_granted = permissions.clone();
            return Ok((existing.clone(), false));
        }
        Ok((
            team::add_active_employee(employees, &expert.name, version, permissions),
            true,
        ))
    })?;
    if created {
        println!("Your new AI employee has joined the crew.");
    } else {
        println!("Existing employee permissions reconciled (fail-closed).");
    }
    println!("Team state: {}", team::team_path(root).display());
    println!("workspace_employee_id: {}", record.workspace_employee_id);
    println!(
        "Permissions granted by default: {}",
        display_permission_list(&plan.granted)
    );
    if !plan.pending.is_empty() {
        println!(
            "Permissions pending review (not granted): {}",
            plan.pending.join(", ")
        );
    }
    if !plan.disabled.is_empty() {
        println!(
            "Permissions disabled by policy (not granted): {}",
            plan.disabled.join(", ")
        );
    }
    if let Some(warning) = plan.source_warning.as_ref() {
        println!("Permission manifest warning: {warning}; granted none by default.");
    }
    Ok(())
}

fn hire_permission_plan(
    root: &Path,
    expert: &Expert,
    args: &[String],
) -> Result<HirePermissionPlan, String> {
    hire_permission_plan_from_selection(root, expert, args, None)
}

fn rehire_permission_plan(
    root: &Path,
    expert: &Expert,
    args: &[String],
    existing_permissions: &[String],
) -> Result<HirePermissionPlan, String> {
    hire_permission_plan_from_selection(root, expert, args, Some(existing_permissions))
}

fn hire_permission_plan_from_selection(
    root: &Path,
    expert: &Expert,
    args: &[String],
    existing_permissions: Option<&[String]>,
) -> Result<HirePermissionPlan, String> {
    let local_source = expert
        .local_source
        .as_deref()
        .ok_or_else(|| "employee has no local manifest source".to_string())?;
    let legacy = manifest::read_manifest(root, &expert.name, local_source)?;
    let tool_needs = manifest::read_employee_tool_needs(root, &expert.name, local_source)?;
    let requested = option_values(args, "--grant-capability")?;
    let requested = requested
        .into_iter()
        .collect::<std::collections::BTreeSet<_>>();
    let skipped = option_values(args, "--skip-capability")?;
    let skipped = skipped
        .into_iter()
        .collect::<std::collections::BTreeSet<_>>();
    let existing = existing_permissions.map(|permissions| {
        permissions
            .iter()
            .collect::<std::collections::BTreeSet<_>>()
    });

    if let Some(capability) = requested.intersection(&skipped).next() {
        return Err(format!(
            "Cannot both grant and skip capability {capability} in one hire request"
        ));
    }

    for capability in &requested {
        let Some(need) = tool_needs.get(capability) else {
            return Err(format!(
                "Cannot grant unknown capability {capability}; it is not declared by {}",
                expert.name
            ));
        };
        match need.necessity {
            manifest::EmployeeToolNecessity::Conditional => {}
            manifest::EmployeeToolNecessity::NonDefault
                if need.permission == manifest::EmployeeToolPermission::RequiresAuthorization => {}
            manifest::EmployeeToolNecessity::NonDefault => {
                return Err(format!(
                    "Cannot grant capability {capability}: a non_default capability must remain per-call authorized"
                ));
            }
            manifest::EmployeeToolNecessity::Required
            | manifest::EmployeeToolNecessity::Disabled => {
                return Err(format!(
                    "Cannot grant capability {capability}: only declared conditional or non_default capabilities may be explicitly selected"
                ));
            }
        }
    }

    for capability in &skipped {
        let Some(need) = tool_needs.get(capability) else {
            return Err(format!(
                "Cannot skip unknown capability {capability}; it is not declared by {}",
                expert.name
            ));
        };
        if need.necessity != manifest::EmployeeToolNecessity::Conditional {
            return Err(format!(
                "Cannot skip capability {capability}: only declared conditional capabilities may be skipped"
            ));
        }
    }

    let mut plan = permission_plan(legacy.permissions);
    for (capability, need) in tool_needs {
        let token = format!("capability:{capability}");
        match need.necessity {
            manifest::EmployeeToolNecessity::Required => plan.granted.push(token),
            manifest::EmployeeToolNecessity::Conditional if skipped.contains(&capability) => {
                plan.pending.push(token)
            }
            manifest::EmployeeToolNecessity::Conditional
                if requested.contains(&capability)
                    || existing.is_none()
                    || existing
                        .as_ref()
                        .is_some_and(|permissions| permissions.contains(&token)) =>
            {
                plan.granted.push(token)
            }
            manifest::EmployeeToolNecessity::Conditional => plan.pending.push(token),
            manifest::EmployeeToolNecessity::NonDefault
                if need.permission == manifest::EmployeeToolPermission::RequiresAuthorization
                    && (requested.contains(&capability)
                        || existing
                            .as_ref()
                            .is_some_and(|permissions| permissions.contains(&token))) =>
            {
                plan.granted.push(token)
            }
            manifest::EmployeeToolNecessity::NonDefault => plan.pending.push(token),
            manifest::EmployeeToolNecessity::Disabled => plan.disabled.push(token),
        }
    }
    for permissions in [&mut plan.granted, &mut plan.pending, &mut plan.disabled] {
        permissions.sort();
        permissions.dedup();
    }
    Ok(plan)
}

fn permission_plan(permissions: Vec<String>) -> HirePermissionPlan {
    use permissions::DefaultPermissionClass;

    let mut plan = HirePermissionPlan::default();
    for permission in permissions {
        let permission = permission.trim().to_string();
        if permission.is_empty() {
            continue;
        }
        match permissions::classify_default_permission(&permission) {
            DefaultPermissionClass::Granted => plan.granted.push(permission),
            DefaultPermissionClass::Disabled => plan.disabled.push(permission),
            DefaultPermissionClass::Pending => {
                // Includes disabled_by_default, human_confirmation_required, with_consent,
                // writes, sends/deploys, and unknown capabilities. They remain visible but
                // are never auto-granted.
                plan.pending.push(permission);
            }
        }
    }
    for permissions in [&mut plan.granted, &mut plan.pending, &mut plan.disabled] {
        permissions.sort();
        permissions.dedup();
    }
    plan
}

fn display_permission_list(permissions: &[String]) -> String {
    if permissions.is_empty() {
        "none".to_string()
    } else {
        permissions.join(", ")
    }
}

fn run_fire(
    root: &Path,
    registry: &Registry,
    target: &str,
    args: &[String],
) -> Result<i32, String> {
    let Some(expert) = find_expert(registry, target) else {
        eprintln!("Error: Unknown expert: {target}");
        return Ok(1);
    };
    let employees = team::read_team(root)?;
    if team::active_employee(&employees, &expert.name).is_none() {
        eprintln!("Error: {} is not active in this crew.", expert.name);
        return Ok(1);
    }

    println!(
        "Impact: {} will be marked fired; history remains in .crewclaw/team.json.",
        expert.name
    );
    let fired = team::mutate_team(root, |employees| {
        let Some(employee) = team::active_employee_mut(employees, &expert.name) else {
            return Ok(false);
        };
        employee.status = team::WorkspaceEmployeeStatus::Fired;
        employee.fired_at = Some(team::now_iso8601());
        Ok(true)
    })?;
    if !fired {
        eprintln!("Error: {} is no longer active in this crew.", expert.name);
        return Ok(1);
    }
    append_activity(root, "fire", &expert.name)?;

    if hire_demo::has_ceremony(root, &expert.name) {
        let code = hire_demo::run_fire_ceremony(args, root, &expert.name)?;
        return Ok(code);
    }
    println!(
        "Fired {}. New tasks are disabled for this employee.",
        expert.name
    );
    Ok(0)
}

fn run_employee_doctor(root: &Path, registry: &Registry, target: &str) -> Result<i32, String> {
    let Some(expert) = find_expert(registry, target) else {
        eprintln!("Error: Unknown expert: {target}");
        return Ok(1);
    };
    let manifest = expert
        .local_source
        .as_deref()
        .ok_or_else(|| format!("{} has no local employee package yet.", expert.display_name))
        .and_then(|local_source| manifest::read_manifest(root, &expert.name, local_source));
    let employees = team::read_team(root)?;
    let report = doctor::build_report(expert, manifest, &employees);
    doctor::print_report(expert, &report);
    let runtime_tools_healthy = match run_runtime_tool_doctor(root, target) {
        Ok(healthy) => healthy,
        Err(error) => {
            eprintln!("Runtime tool snapshot failed: {error}");
            false
        }
    };
    Ok(
        if report.health_status == doctor::HealthStatus::Healthy && runtime_tools_healthy {
            0
        } else {
            1
        },
    )
}

fn run_runtime_tool_doctor(root: &Path, employee: &str) -> Result<bool, String> {
    let script = root.join("packages/runtime/tool-doctor-cli.mjs");
    let output = Command::new(resolve_command_path("node"))
        .arg(&script)
        .arg(employee)
        .arg(root)
        .current_dir(root)
        .env("CREWCLAW_ROOT", root)
        .stdin(Stdio::null())
        .output()
        .map_err(|error| format!("failed to launch Node tool doctor: {error}"))?;
    if !output.status.success() {
        return Err(non_empty(
            &String::from_utf8_lossy(&output.stderr),
            &String::from_utf8_lossy(&output.stdout),
            "Node tool doctor failed",
        ));
    }
    let snapshot: serde_json::Value = serde_json::from_slice(&output.stdout)
        .map_err(|error| format!("invalid Node tool doctor JSON: {error}"))?;
    println!();
    println!("Runtime capability snapshot (canonical ToolCatalog)");
    println!(
        "  grant source: {}",
        snapshot["grant_source"].as_str().unwrap_or("none")
    );
    if let Some(grants) = snapshot["grants"].as_array() {
        let grants = grants
            .iter()
            .filter_map(serde_json::Value::as_str)
            .collect::<Vec<_>>();
        println!(
            "  capability grants: {}",
            if grants.is_empty() {
                "none".to_string()
            } else {
                grants.join(", ")
            }
        );
    }
    for surface in ["chat", "task"] {
        let state = &snapshot["surfaces"][surface];
        let status = state["status"].as_str().unwrap_or("unknown");
        println!("  {surface}: {status}");
        for kind in ["blocking", "degraded"] {
            if let Some(items) = state[kind].as_array() {
                for item in items {
                    println!(
                        "    {kind}: {} — {}",
                        item["capability"].as_str().unwrap_or("unknown"),
                        item["reason"].as_str().unwrap_or("no reason")
                    );
                }
            }
        }
        if let Some(items) = state["resolution"].as_array() {
            let not_applicable = items
                .iter()
                .filter(|item| item["availability"] == "not_applicable")
                .filter_map(|item| item["capability"].as_str())
                .collect::<Vec<_>>();
            if !not_applicable.is_empty() {
                println!(
                    "    not_applicable on {surface}: {}",
                    not_applicable.join(", ")
                );
            }
        }
    }
    Ok(snapshot["surfaces"]["task"]["status"] == "ready")
}

fn reject_unhireable(expert: &Expert, root: &Path) -> Option<i32> {
    let Some(local_source) = expert.local_source.as_ref() else {
        eprintln!(
            "Error: {} is Coming Soon and cannot be installed yet.",
            expert.display_name
        );
        return Some(1);
    };
    if expert.status != "available" {
        eprintln!(
            "Error: {} is Coming Soon and cannot be installed yet.",
            expert.display_name
        );
        return Some(1);
    }
    if let Err(error) = manifest::resolve_local_source(root, &expert.name, local_source) {
        eprintln!("Error: {error}");
        return Some(1);
    }
    None
}

fn run_interactive_hire(args: &[String], root: &Path, registry: &Registry) -> Result<i32, String> {
    show_brand_header();
    println!();
    println!("Choose a ChaoGeek-certified Hermes expert:");
    println!();
    for (index, expert) in registry.experts.iter().enumerate() {
        println!(
            "  {}. {:<25} {:<12} {}",
            index + 1,
            expert.display_name,
            expert.status,
            expert.description
        );
    }
    println!();
    let Some(answer) = ask("Choose an expert number or slug: ")? else {
        return Ok(130);
    };
    let selection = answer.trim();
    let expert = selection
        .parse::<usize>()
        .ok()
        .and_then(|number| registry.experts.get(number.saturating_sub(1)))
        .or_else(|| find_expert(registry, selection));

    let Some(expert) = expert else {
        eprintln!(
            "Error: Unknown expert selection: {}",
            if selection.is_empty() {
                "(empty)"
            } else {
                selection
            }
        );
        return Ok(1);
    };
    run_hire(expert, args, root, true)
}

fn hire_expert(
    expert: &Expert,
    args: &[String],
    root: &Path,
    ask_first_run: bool,
) -> Result<i32, String> {
    let Some(local_source) = expert.local_source.as_ref() else {
        eprintln!(
            "Error: {} is Coming Soon and cannot be installed yet.",
            expert.display_name
        );
        return Ok(1);
    };
    if expert.status != "available" {
        eprintln!(
            "Error: {} is Coming Soon and cannot be installed yet.",
            expert.display_name
        );
        return Ok(1);
    }

    let source = match manifest::resolve_local_source(root, &expert.name, local_source) {
        Ok(source) => source,
        Err(error) => {
            eprintln!("Error: {error}");
            return Ok(1);
        }
    };

    println!("Hiring {}", expert.display_name);
    println!("Requires Hermes {}", expert.requires.hermes);
    println!(
        "Permissions: {}",
        if expert.requires.env.is_empty() {
            "no required env vars".to_string()
        } else {
            expert.requires.env.join(", ")
        }
    );

    let profile_name = option_value(args, "--name").unwrap_or_else(|| expert.name.clone());
    let mut install_args = vec![
        "profile".to_string(),
        "install".to_string(),
        source.to_string_lossy().to_string(),
        "--name".to_string(),
        profile_name.clone(),
        "--alias".to_string(),
        "--yes".to_string(),
    ];
    if has_flag(args, "--force") {
        install_args.push("--force".to_string());
    }

    let result = run_command("hermes", &install_args, root);
    if result.code != 0 {
        let combined = format!("{}{}", result.stderr, result.stdout);
        if combined.contains("invalid choice: 'install'") {
            return import_fallback(expert, &source, &profile_name, args, ask_first_run, root);
        }
        eprintln!(
            "Error: Hermes install failed: {}",
            non_empty(&result.stderr, &result.stdout, "unknown error")
        );
        return Ok(result.code);
    }

    log_command_output("Hermes", &result.stdout);
    finish_hire(expert, &profile_name, args, ask_first_run, root)
}

fn import_fallback(
    expert: &Expert,
    source: &Path,
    profile_name: &str,
    args: &[String],
    ask_first_run: bool,
    root: &Path,
) -> Result<i32, String> {
    let archive_path = make_archive(source, &expert.name, root)?;
    let import_args = vec![
        "profile".to_string(),
        "import".to_string(),
        archive_path.to_string_lossy().to_string(),
        "--name".to_string(),
        profile_name.to_string(),
    ];
    let result = run_command("hermes", &import_args, root);
    let _ = fs::remove_file(&archive_path);
    if let Some(parent) = archive_path.parent() {
        let _ = fs::remove_dir(parent);
    }

    if result.code != 0 {
        eprintln!(
            "Error: Hermes import fallback failed: {}",
            non_empty(&result.stderr, &result.stdout, "unknown error")
        );
        return Ok(result.code);
    }

    println!("Imported via Hermes profile import fallback.");
    log_command_output("Hermes", &result.stdout);
    finish_hire(expert, profile_name, args, ask_first_run, root)
}

fn finish_hire(
    expert: &Expert,
    profile_name: &str,
    args: &[String],
    ask_first_run: bool,
    root: &Path,
) -> Result<i32, String> {
    if has_any_flag(args, &["--run-first", "--first-run"]) {
        return run_first_task(profile_name, &expert.first_task, root);
    }

    if ask_first_run && !has_any_flag(args, &["--yes", "-y"]) {
        let Some(answer) = ask("Run the first Hermes test now? [y/N] ")? else {
            return Ok(130);
        };
        if is_yes(&answer) {
            return run_first_task(profile_name, &expert.first_task, root);
        }
    }

    show_first_run_guide(profile_name, &expert.first_task);
    Ok(0)
}

fn show_first_run_guide(profile_name: &str, task: &str) {
    println!("Profile installed.");
    println!("Run this first Hermes test when you are ready:");
    println!("  {}", first_run_command(profile_name, task));
}

fn run_first_task(profile_name: &str, task: &str, root: &Path) -> Result<i32, String> {
    println!("Starting first Hermes run for {profile_name}");
    println!("First task: {task}");
    let args = vec![
        "-p".to_string(),
        profile_name.to_string(),
        "chat".to_string(),
        "-q".to_string(),
        task.to_string(),
    ];
    let result = run_command("hermes", &args, root);
    if result.code != 0 {
        eprintln!(
            "Error: First Hermes run failed: {}",
            non_empty(&result.stderr, &result.stdout, "unknown error")
        );
        show_first_run_guide(profile_name, task);
        return Ok(result.code);
    }
    log_command_output("First run", &non_empty(&result.stdout, &result.stderr, ""));
    Ok(0)
}

/// Forward `run`/`chat` to the Node runtime, inheriting stdio so the model's
/// answer streams live to the terminal. Everything after the verb (the agent id
/// and the task) is passed straight through.
fn run_agent_live(args: &[String], root: &Path) -> Result<i32, String> {
    let forward = node_runtime_forward_args(args);
    if chat_requires_tty(args, io::stdout().is_tty()) {
        eprintln!(
            "Error: crew chat requires an interactive terminal. Use `crew run <expert> \"<task>\"` for non-interactive runs."
        );
        return Ok(2);
    }
    if should_use_ratatui_workbench(args, io::stdout().is_tty()) {
        let Some(agent) = forward.first() else {
            eprintln!("Error: Missing agent name.");
            return Ok(1);
        };
        let code = workbench::run_workbench_live(&forward, root)?;
        if code == 0 {
            append_activity(root, "run", agent)?;
        }
        return Ok(code);
    }

    let script = root.join("packages/runtime/run.mjs");
    let mut node_args = vec![script.to_string_lossy().to_string()];
    let run_employee = forward.first().cloned();
    node_args.extend(forward);

    let code = run_node_live(&node_args, root);
    if code == 0
        && let Some(employee) = run_employee.as_deref()
    {
        append_activity(root, "run", employee)?;
    }
    Ok(code)
}

fn chat_requires_tty(args: &[String], stdout_is_tty: bool) -> bool {
    if stdout_is_tty {
        return false;
    }
    matches!(positionals(args).first().map(String::as_str), Some("chat"))
        && !has_flag(args, "--input")
}

fn should_use_ratatui_workbench(args: &[String], stdout_is_tty: bool) -> bool {
    if !stdout_is_tty || has_flag(args, "--plain") {
        return false;
    }
    let positionals = positionals(args);
    match positionals.first().map(String::as_str) {
        Some("chat") => true,
        Some("run") => has_flag(args, "--task"),
        _ => false,
    }
}

fn node_runtime_forward_args(args: &[String]) -> Vec<String> {
    let mut forward = Vec::new();
    let mut consumed_verb = false;
    for arg in args {
        if !consumed_verb && matches!(arg.as_str(), "run" | "chat") {
            consumed_verb = true;
            continue;
        }
        if matches!(arg.as_str(), "--plain" | "--tui" | "--ratatui") {
            continue;
        }
        forward.push(arg.clone());
    }
    forward
}

fn run_deploy(args: &[String], root: &Path) -> Result<i32, String> {
    let (agent, target) = deploy_args(args);
    let Some(agent) = agent else {
        eprintln!("Usage: crewclaw deploy <agent> [--target openwork]");
        return Ok(1);
    };
    let node_args = deploy_node_args(root, &agent, target.as_deref());
    Ok(run_node_live(&node_args, root))
}

fn deploy_args(args: &[String]) -> (Option<String>, Option<String>) {
    let mut agent = None;
    let mut target = None;
    let mut consumed_verb = false;
    let mut index = 0;
    while index < args.len() {
        let arg = &args[index];
        if !consumed_verb && arg == "deploy" {
            consumed_verb = true;
            index += 1;
            continue;
        }
        if arg == "--target" {
            if let Some(value) = args.get(index + 1) {
                target = Some(value.clone());
                index += 2;
            } else {
                index += 1;
            }
            continue;
        }
        if !arg.starts_with('-') && agent.is_none() {
            agent = Some(arg.clone());
        }
        index += 1;
    }
    (agent, target)
}

fn deploy_node_args(root: &Path, agent: &str, target: Option<&str>) -> Vec<String> {
    let mut node_args = vec![
        root.join("packages/runtime/deploy.mjs")
            .to_string_lossy()
            .to_string(),
        agent.to_string(),
    ];
    if let Some(target) = target {
        node_args.push("--target".to_string());
        node_args.push(target.to_string());
    }
    node_args
}

fn run_node_live(node_args: &[String], root: &Path) -> i32 {
    match Command::new("node")
        .args(node_args)
        .current_dir(root)
        .env("CREWCLAW_ROOT", root)
        .stdin(Stdio::inherit())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .status()
    {
        Ok(status) => status.code().unwrap_or(1),
        Err(error) => {
            eprintln!("Error: failed to launch the Node runtime (is node on PATH?): {error}");
            127
        }
    }
}

fn run_update(
    root: &Path,
    registry: &Registry,
    target: Option<&str>,
    args: &[String],
) -> Result<i32, String> {
    if let Some(target) = target
        && find_expert(registry, target).is_none()
    {
        eprintln!("Error: Unknown expert: {target}");
        return Ok(1);
    }

    let employees = team::read_team(root)?;
    let updates = available_updates(registry, &employees, target);
    if updates.is_empty() {
        if let Some(target) = target {
            println!("{target} is up to date.");
        } else {
            println!("All hired employees are up to date.");
        }
        return Ok(0);
    }

    println!("Available updates");
    for update in &updates {
        println!(
            "{}  {} -> {}",
            update.employee_id, update.current_version, update.registry_version
        );
    }

    if has_flag(args, "--apply") {
        let changed = team::mutate_team(root, |employees| {
            let current_updates = available_updates(registry, employees, target);
            apply_updates(root, registry, employees, &current_updates)
        })?;
        println!("Updated {changed} employee record(s) in .crewclaw/team.json.");
    } else {
        println!("Run crew update --apply to update .crewclaw/team.json after reviewing changes.");
    }
    Ok(0)
}

fn available_updates(
    registry: &Registry,
    employees: &[team::WorkspaceEmployee],
    target: Option<&str>,
) -> Vec<UpdateCandidate> {
    employees
        .iter()
        .filter(|employee| employee.status == team::WorkspaceEmployeeStatus::Active)
        .filter(|employee| target.is_none_or(|target| employee.employee_id == target))
        .filter_map(|employee| {
            let expert = find_expert(registry, &employee.employee_id)?;
            let registry_version = expert.version.as_deref().unwrap_or("unknown");
            if employee.version == registry_version {
                return None;
            }
            Some(UpdateCandidate {
                employee_id: employee.employee_id.clone(),
                current_version: employee.version.clone(),
                registry_version: registry_version.to_string(),
            })
        })
        .collect()
}

fn reconcile_update_permissions(
    existing: &[String],
    tool_needs: &std::collections::BTreeMap<String, manifest::EmployeeToolNeed>,
) -> Vec<String> {
    let existing = existing.iter().collect::<std::collections::BTreeSet<_>>();
    let mut retained = existing
        .iter()
        .filter(|permission| permissions::is_safe_default_permission(permission))
        .map(|permission| (*permission).clone())
        .collect::<Vec<_>>();

    for (capability, need) in tool_needs {
        let token = format!("capability:{capability}");
        match need.necessity {
            // Required is selected by the manifest itself, including migration from
            // pre-capability team records.
            manifest::EmployeeToolNecessity::Required => retained.push(token),
            // Conditional selection is frozen at hire time. A missing token is an
            // explicit Web/CLI opt-out, never a reason for update to re-enable it.
            manifest::EmployeeToolNecessity::Conditional if existing.contains(&&token) => {
                retained.push(token)
            }
            // An explicit optional grant survives only when the updated manifest
            // still declares the same guarded capability. Unknown, disabled, and
            // policy-weakened old tokens never carry forward.
            manifest::EmployeeToolNecessity::NonDefault
                if need.permission == manifest::EmployeeToolPermission::RequiresAuthorization
                    && existing.contains(&&token) =>
            {
                retained.push(token)
            }
            manifest::EmployeeToolNecessity::Conditional
            | manifest::EmployeeToolNecessity::NonDefault
            | manifest::EmployeeToolNecessity::Disabled => {}
        }
    }
    retained.sort();
    retained.dedup();
    retained
}

fn apply_updates(
    root: &Path,
    registry: &Registry,
    employees: &mut [team::WorkspaceEmployee],
    updates: &[UpdateCandidate],
) -> Result<usize, String> {
    let mut changed = 0;
    for update in updates {
        if let Some(employee) = employees.iter_mut().find(|employee| {
            employee.employee_id == update.employee_id
                && employee.status == team::WorkspaceEmployeeStatus::Active
        }) {
            let expert = find_expert(registry, &employee.employee_id).ok_or_else(|| {
                format!(
                    "Updated employee {} is missing from registry",
                    employee.employee_id
                )
            })?;
            let local_source = expert.local_source.as_deref().ok_or_else(|| {
                format!(
                    "Updated employee {} has no local manifest source",
                    employee.employee_id
                )
            })?;
            let tool_needs =
                manifest::read_employee_tool_needs(root, &employee.employee_id, local_source)?;
            employee.version = update.registry_version.clone();
            employee.permissions_granted =
                reconcile_update_permissions(&employee.permissions_granted, &tool_needs);
            changed += 1;
        }
    }
    Ok(changed)
}

fn run_logs(root: &Path, target: Option<&str>) -> Result<i32, String> {
    let entries = read_activity(root, target)?;
    if entries.is_empty() {
        println!("No CrewClaw activity records found.");
        return Ok(0);
    }

    println!("CrewClaw activity");
    for entry in entries {
        println!("{}  {}  {}", entry.ts, entry.action, entry.employee);
    }
    Ok(0)
}

fn append_activity(root: &Path, action: &str, employee: &str) -> Result<(), String> {
    let path = activity_path(root);
    let _lock = state_store::acquire_owner_lock(root, "activity.json")
        .map_err(|error| format!("Failed to lock {}: {error}", path.display()))?;
    let mut entries = read_activity(root, None)?;
    entries.push(ActivityEntry {
        ts: team::now_iso8601(),
        action: action.to_string(),
        employee: employee.to_string(),
    });
    write_activity(root, &entries)
}

fn read_activity(root: &Path, target: Option<&str>) -> Result<Vec<ActivityEntry>, String> {
    let path = activity_path(root);
    let content = state_store::read_string(root, "activity.json")
        .map_err(|error| format!("Failed to read {}: {error}", path.display()))?;
    let Some(content) = content else {
        return Ok(Vec::new());
    };
    let entries = serde_json::from_str::<Vec<ActivityEntry>>(&content)
        .map_err(|error| format!("Failed to parse {}: {error}", path.display()))?;
    Ok(entries
        .into_iter()
        .filter(|entry| target.is_none_or(|target| entry.employee == target))
        .collect())
}

fn write_activity(root: &Path, entries: &[ActivityEntry]) -> Result<(), String> {
    let path = activity_path(root);
    let content = serde_json::to_string_pretty(entries)
        .map_err(|error| format!("Failed to serialize activity: {error}"))?;
    state_store::write_atomic(root, "activity.json", format!("{content}\n").as_bytes())
        .map_err(|error| format!("Failed to write {}: {error}", path.display()))
}

fn activity_path(root: &Path) -> PathBuf {
    root.join(".crewclaw/activity.json")
}

fn run_environment_doctor() -> Result<i32, String> {
    let root = repo_root();
    let git = run_command("git", &["--version".to_string()], &root);
    let hermes = run_command("hermes", &["--version".to_string()], &root);
    let profiles = run_command(
        "hermes",
        &["profile".to_string(), "list".to_string()],
        &root,
    );
    let install_help = run_command(
        "hermes",
        &[
            "profile".to_string(),
            "install".to_string(),
            "--help".to_string(),
        ],
        &root,
    );

    if git.code == 0 {
        println!("git: ok");
    } else {
        eprintln!(
            "Error: git check failed: {}",
            non_empty(&git.stderr, &git.stdout, "unknown error")
        );
    }
    if hermes.code == 0 {
        println!(
            "hermes: {}",
            non_empty(&hermes.stdout, &hermes.stderr, "ok").trim()
        );
    } else {
        eprintln!(
            "Error: Hermes check failed: {}",
            non_empty(&hermes.stderr, &hermes.stdout, "unknown error")
        );
    }
    if profiles.code == 0 {
        println!("hermes profiles: ok");
    } else {
        eprintln!(
            "Error: Hermes profile list failed: {}",
            non_empty(&profiles.stderr, &profiles.stdout, "unknown error")
        );
    }
    if install_help.code == 0 {
        println!("hermes profile install: ok");
    } else {
        eprintln!(
            "Error: Hermes profile install is unavailable. CrewClaw hire can still try the local import fallback."
        );
    }

    Ok(
        if git.code == 0 && hermes.code == 0 && profiles.code == 0 && install_help.code == 0 {
            0
        } else {
            1
        },
    )
}

fn run_validate(root: &Path, target: &str) -> Result<i32, String> {
    let result = run_command(
        "node",
        &[
            "--import".to_string(),
            "tsx".to_string(),
            root.join("packages/validator/src/bin.ts")
                .to_string_lossy()
                .to_string(),
            target.to_string(),
        ],
        root,
    );
    if !result.stdout.is_empty() {
        print!("{}", result.stdout);
    }
    if !result.stderr.is_empty() {
        eprint!("{}", result.stderr);
    }
    Ok(result.code)
}

fn run_hermes_passthrough(
    action: &str,
    target: Option<&str>,
    args: &[String],
) -> Result<i32, String> {
    let Some(target) = target else {
        eprintln!("Error: Missing expert name.");
        return Ok(1);
    };
    let root = repo_root();
    let mut hermes_args = vec![
        "profile".to_string(),
        action.to_string(),
        target.to_string(),
    ];
    if has_flag(args, "--yes") {
        hermes_args.push("--yes".to_string());
    }
    let result = run_command("hermes", &hermes_args, &root);
    if result.code != 0 {
        eprintln!(
            "Error: {}",
            non_empty(&result.stderr, &result.stdout, "unknown error")
        );
    } else {
        log_command_output("Hermes", &result.stdout);
    }
    Ok(result.code)
}

pub(crate) fn read_registry(root: &Path) -> Result<Registry, String> {
    let path = root.join("registry/experts.json");
    let content = fs::read_to_string(&path)
        .map_err(|error| format!("Failed to read {}: {error}", path.display()))?;
    let registry: Registry = serde_json::from_str(&content)
        .map_err(|error| format!("Failed to parse {}: {error}", path.display()))?;
    validate_registry(&registry)?;
    Ok(registry)
}

fn validate_registry(registry: &Registry) -> Result<(), String> {
    for expert in &registry.experts {
        manifest::validate_registry_local_source(
            &expert.name,
            &expert.status,
            expert.local_source.as_deref(),
        )?;
    }
    Ok(())
}

fn find_expert<'a>(registry: &'a Registry, value: &str) -> Option<&'a Expert> {
    registry
        .experts
        .iter()
        .find(|expert| expert.name == value || expert.display_name.eq_ignore_ascii_case(value))
}

fn ask(question: &str) -> Result<Option<String>, String> {
    print!("{question}");
    io::stdout().flush().map_err(|error| error.to_string())?;
    let mut answer = String::new();
    let bytes = io::stdin()
        .read_line(&mut answer)
        .map_err(|error| error.to_string())?;
    if bytes == 0 {
        eprintln!("Cancelled.");
        return Ok(None);
    }
    Ok(Some(answer))
}

fn make_archive(source: &Path, archive_name: &str, root: &Path) -> Result<PathBuf, String> {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_millis();
    let temp_root = env::temp_dir().join(format!(
        "crewclaw-profile-{}-{}-{millis}",
        archive_name,
        process::id()
    ));
    fs::create_dir_all(&temp_root)
        .map_err(|error| format!("Failed to create {}: {error}", temp_root.display()))?;
    let archive_path = temp_root.join(format!("{archive_name}.tar.gz"));
    let parent = source
        .parent()
        .ok_or_else(|| format!("Expert source has no parent: {}", source.display()))?;
    let basename = source
        .file_name()
        .and_then(OsStr::to_str)
        .ok_or_else(|| format!("Expert source has invalid name: {}", source.display()))?;
    let args = vec![
        "-czf".to_string(),
        archive_path.to_string_lossy().to_string(),
        "-C".to_string(),
        parent.to_string_lossy().to_string(),
        basename.to_string(),
    ];
    let result = run_command("tar", &args, root);
    if result.code != 0 {
        return Err(format!(
            "Failed to create profile archive: {}",
            non_empty(&result.stderr, &result.stdout, "unknown error")
        ));
    }
    Ok(archive_path)
}

fn run_command(command: &str, args: &[String], root: &Path) -> CommandResult {
    match Command::new(resolve_command_path(command))
        .args(args)
        .current_dir(root)
        .output()
    {
        Ok(output) => CommandResult {
            code: output.status.code().unwrap_or(1),
            stdout: String::from_utf8_lossy(&output.stdout).to_string(),
            stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        },
        Err(error) => CommandResult {
            code: 127,
            stdout: String::new(),
            stderr: error.to_string(),
        },
    }
}

/// Resolve npm-style `.cmd` shims as well as native executables on Windows. `Command::new`
/// only appends `.exe` there; without this lookup a normal npm-installed `hermes.cmd` is reported
/// as missing even though an interactive shell can run it.
fn resolve_command_path(command: &str) -> OsString {
    #[cfg(windows)]
    {
        // Prefer the OS-shipped bsdtar: an MSYS/Git-Bash GNU tar earlier on PATH parses the `:` in
        // `C:\...` (and canonicalized `\\?\C:\...`) as a remote host and fails on native Windows
        // paths. bsdtar (Windows 10+, System32) handles both forms natively.
        if command == "tar"
            && let Some(system_root) = env::var_os("SystemRoot")
        {
            let bsdtar = Path::new(&system_root).join("System32").join("tar.exe");
            if bsdtar.is_file() {
                return bsdtar.into_os_string();
            }
        }
        let command_path = Path::new(command);
        if command_path.extension().is_none() {
            let path = env::var_os("PATH").unwrap_or_default();
            let extensions =
                env::var_os("PATHEXT").unwrap_or_else(|| OsString::from(".COM;.EXE;.BAT;.CMD"));
            for directory in env::split_paths(&path) {
                for extension in extensions.to_string_lossy().split(';') {
                    let extension = extension.trim();
                    if extension.is_empty() {
                        continue;
                    }
                    let candidate = directory.join(format!("{command}{extension}"));
                    if candidate.is_file() {
                        return candidate.into_os_string();
                    }
                }
            }
        }
    }
    OsString::from(command)
}

fn positionals(args: &[String]) -> Vec<String> {
    let mut values = Vec::new();
    let mut index = 0;
    while index < args.len() {
        let value = &args[index];
        if value.starts_with('-') {
            if matches!(
                value.as_str(),
                "--name" | "--grant-capability" | "--skip-capability"
            ) {
                index += 2;
            } else {
                index += 1;
            }
            continue;
        }
        values.push(value.clone());
        index += 1;
    }
    values
}

fn option_value(args: &[String], option: &str) -> Option<String> {
    args.iter()
        .position(|arg| arg == option)
        .and_then(|index| args.get(index + 1))
        .cloned()
}

fn option_values(args: &[String], option: &str) -> Result<Vec<String>, String> {
    let mut values = Vec::new();
    let mut index = 0usize;
    while index < args.len() {
        if args[index] != option {
            index += 1;
            continue;
        }
        let Some(value) = args.get(index + 1) else {
            return Err(format!("Missing value after {option}"));
        };
        if value.starts_with('-') || value.trim().is_empty() {
            return Err(format!("Invalid value after {option}"));
        }
        values.push(value.trim().to_string());
        index += 2;
    }
    Ok(values)
}

fn has_flag(args: &[String], flag: &str) -> bool {
    args.iter().any(|arg| arg == flag)
}

fn has_any_flag(args: &[String], flags: &[&str]) -> bool {
    flags.iter().any(|flag| has_flag(args, flag))
}

fn is_yes(answer: &str) -> bool {
    matches!(answer.trim().to_ascii_lowercase().as_str(), "y" | "yes")
}

fn print_list(label: &str, values: &[String]) {
    println!("{label}:");
    if values.is_empty() {
        println!("  - none");
    } else {
        for value in values {
            println!("  - {value}");
        }
    }
}

fn blank(value: &str) -> &str {
    if value.is_empty() { "(missing)" } else { value }
}

fn quote_shell(value: &str) -> String {
    let escaped = value
        .replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('$', "\\$")
        .replace('`', "\\`");
    format!("\"{escaped}\"")
}

fn first_run_command(profile_name: &str, task: &str) -> String {
    format!("hermes -p {profile_name} chat -q {}", quote_shell(task))
}

#[cfg(windows)]
fn quote_command_argument(value: &str) -> String {
    format!("\"{}\"", value.replace('"', "\"\""))
}

#[cfg(not(windows))]
fn quote_command_argument(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\"'\"'"))
}

fn local_command(root: &Path) -> String {
    format!(
        "pnpm --silent -C {} run crewclaw",
        quote_command_argument(&root.to_string_lossy())
    )
}

fn log_command_output(label: &str, output: &str) {
    let text = output.trim();
    if text.is_empty() {
        return;
    }
    for line in text.lines() {
        println!("{label}: {line}");
    }
}

fn non_empty<'a>(primary: &'a str, secondary: &'a str, fallback: &'a str) -> String {
    let primary = primary.trim();
    if !primary.is_empty() {
        return primary.to_string();
    }
    let secondary = secondary.trim();
    if !secondary.is_empty() {
        return secondary.to_string();
    }
    fallback.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn strings(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| value.to_string()).collect()
    }

    #[test]
    fn skips_value_options_when_collecting_positionals() {
        assert_eq!(
            positionals(&strings(&[
                "hire",
                "code-review-shrimp",
                "--name",
                "shrimp",
                "--grant-capability",
                "contacts.read",
                "--skip-capability",
                "web.search",
                "--yes"
            ])),
            vec!["hire".to_string(), "code-review-shrimp".to_string()]
        );
    }

    #[test]
    fn renders_first_run_command_with_shell_quoting() {
        let command = first_run_command("shrimp", "say \"hi\" and $HOME");
        assert_eq!(
            command,
            "hermes -p shrimp chat -q \"say \\\"hi\\\" and \\$HOME\""
        );
    }

    #[test]
    fn quotes_local_command_root_with_spaces() {
        let command = local_command(Path::new("workspace with spaces"));
        #[cfg(windows)]
        assert_eq!(
            command,
            "pnpm --silent -C \"workspace with spaces\" run crewclaw"
        );
        #[cfg(not(windows))]
        assert_eq!(
            command,
            "pnpm --silent -C 'workspace with spaces' run crewclaw"
        );
    }

    #[test]
    fn builds_deploy_node_args_without_target() {
        let root = Path::new("repo");
        let script = root
            .join("packages/runtime/deploy.mjs")
            .to_string_lossy()
            .to_string();

        assert_eq!(
            deploy_node_args(root, "code-review-shrimp", None),
            vec![script, "code-review-shrimp".to_string()]
        );
    }

    #[test]
    fn builds_deploy_node_args_with_custom_target() {
        let root = Path::new("repo");
        let script = root
            .join("packages/runtime/deploy.mjs")
            .to_string_lossy()
            .to_string();

        assert_eq!(
            deploy_node_args(root, "code-review-shrimp", Some("custom")),
            vec![
                script,
                "code-review-shrimp".to_string(),
                "--target".to_string(),
                "custom".to_string()
            ]
        );
    }

    #[test]
    fn chat_defaults_to_ratatui_on_tty_unless_plain_is_requested() {
        assert!(should_use_ratatui_workbench(
            &strings(&["chat", "ai-adoption-whale"]),
            true
        ));
        assert!(should_use_ratatui_workbench(
            &strings(&["chat", "ai-adoption-whale", "--tui"]),
            true
        ));
        assert!(should_use_ratatui_workbench(
            &strings(&["chat", "ai-adoption-whale", "--ratatui"]),
            true
        ));
        assert!(!should_use_ratatui_workbench(
            &strings(&["chat", "ai-adoption-whale", "--plain"]),
            true
        ));
        assert!(!should_use_ratatui_workbench(
            &strings(&["chat", "ai-adoption-whale"]),
            false
        ));
        assert!(chat_requires_tty(
            &strings(&["chat", "ai-adoption-whale"]),
            false
        ));
        assert!(!chat_requires_tty(
            &strings(&["chat", "ai-adoption-whale"]),
            true
        ));
    }

    #[test]
    fn run_task_defaults_to_ratatui_on_tty_unless_plain_is_requested() {
        assert!(should_use_ratatui_workbench(
            &strings(&["run", "ai-adoption-whale", "--task", "roi-demo"]),
            true
        ));
        assert!(!should_use_ratatui_workbench(
            &strings(&["run", "ai-adoption-whale", "write a report"]),
            true
        ));
        assert!(!should_use_ratatui_workbench(
            &strings(&["run", "ai-adoption-whale", "--task", "roi-demo", "--plain"]),
            true
        ));
        assert!(!should_use_ratatui_workbench(
            &strings(&["run", "ai-adoption-whale", "--task", "roi-demo"]),
            false
        ));
    }

    #[test]
    fn node_runtime_args_strip_rust_tui_control_flags() {
        assert_eq!(
            node_runtime_forward_args(&strings(&[
                "chat",
                "ai-adoption-whale",
                "--plain",
                "--tui",
                "--ratatui",
                "--resume"
            ])),
            vec!["ai-adoption-whale".to_string(), "--resume".to_string()]
        );
    }

    fn expert_with_version(name: &str, version: &str) -> Expert {
        Expert {
            name: name.to_string(),
            display_name: name.to_string(),
            status: "available".to_string(),
            certification: "C2".to_string(),
            category: "engineering".to_string(),
            description: "Test expert".to_string(),
            local_source: Some(format!("experts/{name}")),
            version: Some(version.to_string()),
            tags: Vec::new(),
            requires: Requirements {
                hermes: ">=0.12.0".to_string(),
                env: Vec::new(),
            },
            first_task: "Review this".to_string(),
        }
    }

    #[test]
    fn validates_registry_local_source_before_consumers_use_it() {
        let valid = Registry {
            experts: vec![expert_with_version("code-review-shrimp", "0.1.0")],
        };
        assert!(validate_registry(&valid).is_ok());

        for local_source in [
            "../../outside",
            "/tmp/outside",
            r"C:\outside",
            "experts/product-prd-crab",
        ] {
            let mut expert = expert_with_version("code-review-shrimp", "0.1.0");
            expert.local_source = Some(local_source.to_string());
            assert!(
                validate_registry(&Registry {
                    experts: vec![expert]
                })
                .is_err(),
                "accepted unsafe local_source: {local_source}"
            );
        }

        let mut coming_soon = expert_with_version("docs-octopus", "0.1.0");
        coming_soon.status = "coming-soon".to_string();
        coming_soon.local_source = Some("experts/docs-octopus".to_string());
        assert!(
            validate_registry(&Registry {
                experts: vec![coming_soon]
            })
            .is_err()
        );
    }

    fn active_employee(name: &str, version: &str) -> team::WorkspaceEmployee {
        team::WorkspaceEmployee {
            workspace_employee_id: format!("{name}-1"),
            employee_id: name.to_string(),
            version: version.to_string(),
            status: team::WorkspaceEmployeeStatus::Active,
            hired_at: "2026-06-22T00:00:00Z".to_string(),
            fired_at: None,
            permissions_granted: Vec::new(),
        }
    }

    #[test]
    fn finds_outdated_hired_employees() {
        let registry = Registry {
            experts: vec![
                expert_with_version("code-review-shrimp", "0.2.0"),
                expert_with_version("product-prd-crab", "0.1.0"),
            ],
        };
        let team = vec![
            active_employee("code-review-shrimp", "0.1.0"),
            active_employee("product-prd-crab", "0.1.0"),
        ];

        let updates = available_updates(&registry, &team, None);

        assert_eq!(updates.len(), 1);
        assert_eq!(updates[0].employee_id, "code-review-shrimp");
        assert_eq!(updates[0].current_version, "0.1.0");
        assert_eq!(updates[0].registry_version, "0.2.0");
    }

    #[test]
    fn update_permission_reconciliation_freezes_conditional_selection() {
        let tool_need = |necessity, permission| manifest::EmployeeToolNeed {
            necessity,
            permission,
            description: "test tool".to_string(),
            scopes: Vec::new(),
            approval: None,
            purpose: None,
            limits: None,
            on_unavailable: None,
        };
        let tool_needs = std::collections::BTreeMap::from([
            (
                "files.read".to_string(),
                tool_need(
                    manifest::EmployeeToolNecessity::Required,
                    manifest::EmployeeToolPermission::Readonly,
                ),
            ),
            (
                "web.search".to_string(),
                tool_need(
                    manifest::EmployeeToolNecessity::Conditional,
                    manifest::EmployeeToolPermission::Readonly,
                ),
            ),
            (
                "contacts.read".to_string(),
                tool_need(
                    manifest::EmployeeToolNecessity::NonDefault,
                    manifest::EmployeeToolPermission::RequiresAuthorization,
                ),
            ),
            (
                "files.write".to_string(),
                tool_need(
                    manifest::EmployeeToolNecessity::Disabled,
                    manifest::EmployeeToolPermission::Disabled,
                ),
            ),
        ]);
        let retained = reconcile_update_permissions(
            &strings(&[
                "repo_files:read",
                "secrets:read",
                "code:write:disabled",
                "merge_and_deploy:human_confirmation_required",
                "capability:contacts.read",
                "capability:web.search",
                "capability:unknown.tool",
                "capability:files.write",
            ]),
            &tool_needs,
        );
        assert_eq!(
            retained,
            strings(&[
                "capability:contacts.read",
                "capability:files.read",
                "capability:web.search",
                "repo_files:read",
            ]),
            "update retains a frozen conditional selection, preserves still-declared explicit grants, and drops stale escalation"
        );

        let opted_out = reconcile_update_permissions(
            &strings(&[
                "repo_files:read",
                "capability:contacts.read",
                "capability:unknown.tool",
            ]),
            &tool_needs,
        );
        assert_eq!(
            opted_out,
            strings(&[
                "capability:contacts.read",
                "capability:files.read",
                "repo_files:read",
            ]),
            "a missing conditional token is a frozen opt-out and update must not re-enable it"
        );
    }

    #[test]
    fn hire_permission_plan_is_fail_closed_and_explainable() {
        let plan = permission_plan(strings(&[
            "public_web:read",
            "repo_files:read",
            "prd_docs:read",
            "repo_files:read",
            "secrets:read",
            "contacts:read",
            "internal_docs:read:with_consent",
            "contacts:read:disabled_by_default",
            "production:deploy:human_confirmation_required",
            "code:write:disabled",
            "unknown",
            "*:read",
            "repo files:read",
            ".hidden:read",
        ]));
        assert_eq!(
            plan.granted,
            vec![
                "prd_docs:read".to_string(),
                "public_web:read".to_string(),
                "repo_files:read".to_string()
            ]
        );
        assert!(plan.disabled.contains(&"code:write:disabled".to_string()));
        for permission in [
            "internal_docs:read:with_consent",
            "contacts:read:disabled_by_default",
            "production:deploy:human_confirmation_required",
            "unknown",
            "secrets:read",
            "contacts:read",
            "*:read",
            "repo files:read",
            ".hidden:read",
        ] {
            assert!(
                plan.pending.contains(&permission.to_string()),
                "{permission}"
            );
        }
    }

    #[test]
    fn active_rehire_freezes_capability_selection_and_rejects_version_drift() {
        let root = unique_test_root("safe-hire-permissions");
        let expert = expert_with_version("security-test", "1.0.0");
        let source = root.join("experts/security-test");
        fs::create_dir_all(&source).expect("expert source");
        fs::create_dir_all(root.join("contracts")).expect("catalog directory");
        fs::write(
            root.join("contracts/tool-catalog.json"),
            r#"{"capabilities":[{"id":"files.read"},{"id":"contacts.read"},{"id":"draft.write"},{"id":"files.write"}]}"#,
        )
        .expect("canonical tool catalog");
        fs::write(
            source.join("hire.yaml"),
            "apiVersion: crewclaw/v1\nkind: Employee\nmetadata:\n  id: security-test\n  name: Security Test\n  version: 1.0.0\npermissions:\n  - repo_files:read\n  - code:write:disabled\n  - contacts:read:disabled_by_default\n  - deploy:human_confirmation_required\n",
        )
        .expect("manifest");
        fs::write(
            source.join("crewclaw.employee.yaml"),
            "tool_needs:\n  files.read:\n    necessity: required\n    permission: readonly\n    description: read\n  contacts.read:\n    necessity: non_default\n    permission: requires_authorization\n    description: contacts\n  draft.write:\n    necessity: conditional\n    permission: write\n    description: draft\n  files.write:\n    necessity: disabled\n    permission: disabled\n    description: no writes\n",
        )
        .expect("employee spec");

        let default_plan = hire_permission_plan(&root, &expert, &[]).expect("default hire plan");
        assert!(
            default_plan
                .granted
                .contains(&"capability:draft.write".to_string()),
            "conditional capabilities are selected by default at first hire"
        );
        let skipped_plan = hire_permission_plan(
            &root,
            &expert,
            &strings(&["--skip-capability", "draft.write"]),
        )
        .expect("conditional skip plan");
        assert!(
            !skipped_plan
                .granted
                .contains(&"capability:draft.write".to_string())
        );
        assert!(
            skipped_plan
                .pending
                .contains(&"capability:draft.write".to_string())
        );
        let explicitly_enabled_conditional = hire_permission_plan(
            &root,
            &expert,
            &strings(&["--grant-capability", "draft.write"]),
        )
        .expect("explicit conditional grant");
        assert!(
            explicitly_enabled_conditional
                .granted
                .contains(&"capability:draft.write".to_string())
        );
        let conflict = hire_permission_plan(
            &root,
            &expert,
            &strings(&[
                "--grant-capability",
                "draft.write",
                "--skip-capability",
                "draft.write",
            ]),
        )
        .expect_err("a conditional capability cannot be both granted and skipped");
        assert!(
            conflict.contains("Cannot both grant and skip"),
            "{conflict}"
        );
        let skip_required = hire_permission_plan(
            &root,
            &expert,
            &strings(&["--skip-capability", "files.read"]),
        )
        .expect_err("required capability cannot be skipped");
        assert!(
            skip_required.contains("only declared conditional"),
            "{skip_required}"
        );

        let first_plan = hire_permission_plan(
            &root,
            &expert,
            &strings(&["--grant-capability", "contacts.read"]),
        )
        .expect("first hire plan");
        persist_hire(&root, &expert, &first_plan).expect("first hire");
        let first = team::read_team(&root).expect("team after hire");
        assert_eq!(first.len(), 1);
        assert_eq!(
            first[0].permissions_granted,
            strings(&[
                "capability:contacts.read",
                "capability:draft.write",
                "capability:files.read",
                "repo_files:read",
            ]),
            "explicit non_default capability is persisted in its own namespace"
        );
        let workspace_id = first[0].workspace_employee_id.clone();

        for capability in ["unknown.tool", "files.read", "files.write"] {
            let error = hire_permission_plan(
                &root,
                &expert,
                &strings(&["--grant-capability", capability]),
            )
            .expect_err("unsafe or invalid grant must fail closed");
            assert!(error.contains("Cannot grant"), "{error}");
        }

        team::mutate_team(&root, |employees| {
            employees[0].permissions_granted.extend(strings(&[
                "secrets:read",
                "code:write:disabled",
                "deploy:human_confirmation_required",
            ]));
            Ok(())
        })
        .expect("seed legacy unsafe grants");
        let code = run_hire(
            &expert,
            &strings(&["--skip-capability", "draft.write"]),
            &root,
            false,
        )
        .expect("re-hire skip");
        assert_eq!(code, 0);

        let reconciled = team::read_team(&root).expect("team after re-hire");
        assert_eq!(reconciled.len(), 1, "re-hire does not duplicate employee");
        assert_eq!(reconciled[0].workspace_employee_id, workspace_id);
        assert_eq!(
            reconciled[0].permissions_granted,
            strings(&[
                "capability:contacts.read",
                "capability:files.read",
                "repo_files:read",
            ]),
            "skip revokes only that conditional; the frozen non_default selection remains while legacy dangerous grants are removed"
        );

        assert_eq!(run_hire(&expert, &[], &root, false), Ok(0));
        let still_opted_out = team::read_team(&root).expect("team after ordinary re-hire");
        assert_eq!(
            still_opted_out[0].permissions_granted, reconciled[0].permissions_granted,
            "ordinary re-hire must not turn a skipped conditional back on"
        );

        assert_eq!(
            run_hire(
                &expert,
                &strings(&["--grant-capability", "draft.write"]),
                &root,
                false,
            ),
            Ok(0)
        );
        let restored = team::read_team(&root).expect("team after explicit restore");
        assert_eq!(
            restored[0].permissions_granted,
            strings(&[
                "capability:contacts.read",
                "capability:draft.write",
                "capability:files.read",
                "repo_files:read",
            ]),
            "only an explicit grant restores the skipped conditional"
        );

        team::mutate_team(&root, |employees| {
            employees[0].version = "0.9.0".to_string();
            Ok(())
        })
        .expect("seed stale active version");
        let error = run_hire(&expert, &[], &root, false)
            .expect_err("ordinary re-hire must reject registry/spec version drift");
        assert!(
            error.contains("crew update security-test --apply"),
            "{error}"
        );
        let stale = team::read_team(&root).expect("team after rejected stale re-hire");
        assert_eq!(stale[0].version, "0.9.0");
        assert_eq!(
            stale[0].permissions_granted, restored[0].permissions_granted,
            "version rejection must happen before applying the new policy"
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn activity_log_round_trips_and_filters_by_employee() {
        let root = unique_test_root("activity-log");
        append_activity(&root, "hire", "code-review-shrimp").expect("append hire activity");
        append_activity(&root, "doctor", "product-prd-crab").expect("append doctor activity");

        let entries = read_activity(&root, Some("code-review-shrimp")).expect("read activity");

        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].action, "hire");
        assert_eq!(entries[0].employee, "code-review-shrimp");
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn concurrent_activity_appends_do_not_lose_entries() {
        let root = std::sync::Arc::new(unique_test_root("activity-concurrency"));
        let workers = 6;
        let rounds = 10;
        let barrier = std::sync::Arc::new(std::sync::Barrier::new(workers));
        let mut joins = Vec::new();
        for worker in 0..workers {
            let root = std::sync::Arc::clone(&root);
            let barrier = std::sync::Arc::clone(&barrier);
            joins.push(std::thread::spawn(move || {
                barrier.wait();
                for round in 0..rounds {
                    append_activity(&root, "run", &format!("employee-{worker}-{round}"))
                        .expect("serialized activity append");
                }
            }));
        }
        for join in joins {
            join.join().expect("worker");
        }
        let entries = read_activity(&root, None).expect("final activity");
        assert_eq!(entries.len(), workers * rounds);
        let _ = std::fs::remove_dir_all(root.as_ref());
    }

    fn unique_test_root(name: &str) -> PathBuf {
        let millis = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time")
            .as_millis();
        env::temp_dir().join(format!("crewclaw-cli-{name}-{}-{millis}", process::id()))
    }
}
