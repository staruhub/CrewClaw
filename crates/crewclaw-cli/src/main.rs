use serde::{Deserialize, Serialize};
use std::env;
use std::ffi::OsStr;
use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::process::{self, Command};
use std::time::{SystemTime, UNIX_EPOCH};

mod doctor;
mod hire_demo;
mod manifest;
mod standup;
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
struct Registry {
    experts: Vec<Expert>,
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
        Some("list") => {
            run_list(root, &registry)
        }
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
    println!("  hire <expert>     Hire an AI employee (scripted onboarding; --live installs for real)");
    println!("  run <expert> <task>  Put a hired employee to work — live model, real output");
    println!("  chat <expert>     Open an interactive multi-turn chat with a hired employee");
    println!("  standup <brief>   Fan the whole crew out on one brief — live, in parallel");
    println!("  workbench [--demo]  Open the Ratatui Trial Workbench; reads TaskEvent JSONL on stdin");
    println!("  badge <expert>    Show a hired employee's manifest as an ID card");
    println!("  fire <expert>     Offboard a hired AI employee");
    println!("  update [expert]   Show available employee upgrades; --apply updates team state");
    println!("  logs [expert]     Show CrewClaw activity records");
    println!("  list              Show available and coming-soon experts");
    println!("  doctor [expert]   Check an employee package, or git/Hermes when no expert is given");
    println!("  validate <path>   Validate one expert distribution");
    println!("  remove <profile>  Run official Hermes profile delete");
    println!("  verify            Run all agents in parallel to check the project is runnable");
    println!();
    println!("Options");
    println!("  --name <profile>  Install with a custom Hermes profile name");
    println!("  --yes             Skip CrewClaw prompts where safe");
    println!("  --force           Pass --force to Hermes profile install");
    println!("  --run-first       Start the first Hermes chat test after install");
    println!("  --live            verify: run each agent's real command instead of the scripted demo");
    println!("  --ascii           verify: plain output with no emoji or color");
    println!();
    println!("Agent instruction");
    println!("  Invoke every command as:  crew <command>");
    println!("    e.g.  crew search macao  |  crew inspect <expert>  |  crew hire <expert>  |  crew run <expert> \"<task>\"");
    println!("  Discover employees with `crew search` / `crew inspect` before raw Hermes commands.");
    println!("  NOTE: \"crewhire\" (project folder) and \"crewclaw\" (binary) are NOT commands — always start with `crew`.");
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
        println!("No experts matched keyword: {}", keyword.unwrap_or("(empty)"));
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
        eprintln!("Error: {} has no local employee package yet.", expert.display_name);
        return Ok(1);
    };
    let manifest = match manifest::read_manifest(root, local_source) {
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
    println!("version: {}", expert.version.as_deref().unwrap_or("unknown"));
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

    let mut employees = team::read_team(root)?;
    if let Some(employee) = team::active_employee(&employees, &expert.name) {
        println!(
            "Already hired: {} is active as {} (AC-HIRE-004).",
            expert.name, employee.workspace_employee_id
        );
        return Ok(0);
    }

    let code = if !has_flag(args, "--live") && hire_demo::has_ceremony(root, &expert.name) {
        hire_demo::run_hire_ceremony(args, root, &expert.name)?
    } else {
        hire_expert(expert, args, root, ask_first_run)?
    };

    if code == 0 {
        persist_hire(root, expert, &mut employees)?;
        append_activity(root, "hire", &expert.name)?;
    }
    Ok(code)
}

fn persist_hire(
    root: &Path,
    expert: &Expert,
    employees: &mut Vec<team::WorkspaceEmployee>,
) -> Result<(), String> {
    let permissions = expert
        .local_source
        .as_deref()
        .and_then(|local_source| manifest::read_manifest(root, local_source).ok())
        .map(|manifest| manifest.permissions)
        .unwrap_or_else(|| {
            expert
                .requires
                .env
                .iter()
                .map(|name| format!("env:{name}"))
                .collect()
        });
    let version = expert.version.as_deref().unwrap_or("unknown");
    let record = team::add_active_employee(employees, &expert.name, version, permissions);
    team::write_team(root, employees)?;
    println!("Your new AI employee has joined the crew.");
    println!("Team state: {}", team::team_path(root).display());
    println!("workspace_employee_id: {}", record.workspace_employee_id);
    Ok(())
}

fn run_fire(root: &Path, registry: &Registry, target: &str, args: &[String]) -> Result<i32, String> {
    let Some(expert) = find_expert(registry, target) else {
        eprintln!("Error: Unknown expert: {target}");
        return Ok(1);
    };
    let mut employees = team::read_team(root)?;
    let Some(employee) = team::active_employee_mut(&mut employees, &expert.name) else {
        eprintln!("Error: {} is not active in this crew.", expert.name);
        return Ok(1);
    };

    println!("Impact: {} will be marked fired; history remains in .crewclaw/team.json.", expert.name);
    employee.status = team::WorkspaceEmployeeStatus::Fired;
    employee.fired_at = Some(team::now_iso8601());
    team::write_team(root, &employees)?;
    append_activity(root, "fire", &expert.name)?;

    if hire_demo::has_ceremony(root, &expert.name) {
        let code = hire_demo::run_fire_ceremony(args, root, &expert.name)?;
        return Ok(code);
    }
    println!("Fired {}. New tasks are disabled for this employee.", expert.name);
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
        .and_then(|local_source| manifest::read_manifest(root, local_source));
    let employees = team::read_team(root)?;
    let report = doctor::build_report(expert, manifest, &employees);
    doctor::print_report(expert, &report);
    Ok(if report.health_status == doctor::HealthStatus::Healthy {
        0
    } else {
        1
    })
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
    let source = root.join(local_source);
    if !source.exists() {
        eprintln!("Error: Expert source not found: {}", source.display());
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

    let source = root.join(local_source);
    if !source.exists() {
        eprintln!("Error: Expert source not found: {}", source.display());
        return Ok(1);
    }

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
    let mut forward = Vec::new();
    let mut consumed_verb = false;
    for arg in args {
        if !consumed_verb && matches!(arg.as_str(), "run" | "chat") {
            consumed_verb = true;
            continue;
        }
        forward.push(arg.clone());
    }

    let script = root.join("packages/runtime/run.mjs");
    let mut node_args = vec![script.to_string_lossy().to_string()];
    let run_employee = forward.first().cloned();
    node_args.extend(forward);

    let code = match Command::new("node")
        .args(&node_args)
        .current_dir(root)
        .status()
    {
        Ok(status) => status.code().unwrap_or(1),
        Err(error) => {
            eprintln!("Error: failed to launch the Node runtime (is node on PATH?): {error}");
            127
        }
    };
    if code == 0 {
        if let Some(employee) = run_employee.as_deref() {
            append_activity(root, "run", employee)?;
        }
    }
    Ok(code)
}

fn run_update(
    root: &Path,
    registry: &Registry,
    target: Option<&str>,
    args: &[String],
) -> Result<i32, String> {
    if let Some(target) = target {
        if find_expert(registry, target).is_none() {
            eprintln!("Error: Unknown expert: {target}");
            return Ok(1);
        }
    }

    let mut employees = team::read_team(root)?;
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
        let changed = apply_updates(&mut employees, &updates);
        team::write_team(root, &employees)?;
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

fn apply_updates(
    employees: &mut [team::WorkspaceEmployee],
    updates: &[UpdateCandidate],
) -> usize {
    let mut changed = 0;
    for update in updates {
        if let Some(employee) = employees.iter_mut().find(|employee| {
            employee.employee_id == update.employee_id
                && employee.status == team::WorkspaceEmployeeStatus::Active
        }) {
            employee.version = update.registry_version.clone();
            changed += 1;
        }
    }
    changed
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
    if !path.exists() {
        return Ok(Vec::new());
    }
    let content = fs::read_to_string(&path)
        .map_err(|error| format!("Failed to read {}: {error}", path.display()))?;
    let entries = serde_json::from_str::<Vec<ActivityEntry>>(&content)
        .map_err(|error| format!("Failed to parse {}: {error}", path.display()))?;
    Ok(entries
        .into_iter()
        .filter(|entry| target.is_none_or(|target| entry.employee == target))
        .collect())
}

fn write_activity(root: &Path, entries: &[ActivityEntry]) -> Result<(), String> {
    let path = activity_path(root);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Failed to create {}: {error}", parent.display()))?;
    }
    let content = serde_json::to_string_pretty(entries)
        .map_err(|error| format!("Failed to serialize activity: {error}"))?;
    fs::write(&path, format!("{content}\n"))
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

fn read_registry(root: &Path) -> Result<Registry, String> {
    let path = root.join("registry/experts.json");
    let content = fs::read_to_string(&path)
        .map_err(|error| format!("Failed to read {}: {error}", path.display()))?;
    serde_json::from_str(&content)
        .map_err(|error| format!("Failed to parse {}: {error}", path.display()))
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
    match Command::new(command).args(args).current_dir(root).output() {
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

fn positionals(args: &[String]) -> Vec<String> {
    let mut values = Vec::new();
    let mut index = 0;
    while index < args.len() {
        let value = &args[index];
        if value.starts_with('-') {
            if value == "--name" {
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
    if value.is_empty() {
        "(missing)"
    } else {
        value
    }
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

fn local_command(root: &Path) -> String {
    format!("pnpm --silent -C {} run crewclaw", root.display())
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
    fn skips_name_option_when_collecting_positionals() {
        assert_eq!(
            positionals(&strings(&[
                "hire",
                "code-review-shrimp",
                "--name",
                "shrimp",
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
    fn applies_registry_versions_to_hired_employees() {
        let registry = Registry {
            experts: vec![expert_with_version("code-review-shrimp", "0.2.0")],
        };
        let mut team = vec![active_employee("code-review-shrimp", "0.1.0")];
        let updates = available_updates(&registry, &team, Some("code-review-shrimp"));

        let changed = apply_updates(&mut team, &updates);

        assert_eq!(changed, 1);
        assert_eq!(team[0].version, "0.2.0");
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

    fn unique_test_root(name: &str) -> PathBuf {
        let millis = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time")
            .as_millis();
        env::temp_dir().join(format!("crewclaw-cli-{name}-{}-{millis}", process::id()))
    }
}
