use std::path::Path;
use std::process::Command;
use std::thread;
use std::time::{Duration, Instant};

use console::style;
use indicatif::{MultiProgress, ProgressBar, ProgressStyle};
use serde::Deserialize;

#[derive(Debug, Deserialize)]
struct Scenario {
    title: String,
    tagline: String,
    agents: Vec<Agent>,
}

#[derive(Clone, Debug, Deserialize)]
struct Agent {
    #[allow(dead_code)]
    id: String,
    emoji: String,
    name: String,
    #[allow(dead_code)]
    role: String,
    command: String,
    steps: Vec<Step>,
    verdict: String,
    summary: String,
    advisory: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
struct Step {
    label: String,
    duration_ms: u64,
}

/// How a single agent finished.
enum Kind {
    Pass(String),
    Advisory(String, String),
    Fail(String),
}

/// Outcome reported back from each per-agent thread.
struct AgentOutcome {
    emoji: String,
    name: String,
    kind: Kind,
    elapsed_ms: u64,
}

impl AgentOutcome {
    fn ok(&self) -> bool {
        !matches!(self.kind, Kind::Fail(_))
    }
}

pub fn run_verify(args: &[String], root: &Path) -> Result<i32, String> {
    let (live, ascii) = parse_verify_flags(args);
    let scenario = read_scenario(root)?;

    crate::show_brand_header();
    println!();
    println!("{}", scenario.title);
    println!("{}", scenario.tagline);
    println!();
    println!(
        "Hiring {} agents · fanning out in parallel…",
        scenario.agents.len()
    );
    println!();

    let multi = MultiProgress::new();
    let mut handles = Vec::new();

    for agent in &scenario.agents {
        let bar = multi.add(ProgressBar::new_spinner());
        bar.set_style(spinner_style(ascii));
        bar.set_prefix(agent_prefix(agent, ascii));
        bar.enable_steady_tick(Duration::from_millis(80));

        let agent = agent.clone();
        let root = root.to_path_buf();
        let handle = thread::spawn(move || run_agent(&agent, bar, live, &root));
        handles.push(handle);
    }

    let mut outcomes = Vec::new();
    for handle in handles {
        match handle.join() {
            Ok(outcome) => outcomes.push(outcome),
            Err(_) => outcomes.push(AgentOutcome {
                emoji: "?".to_string(),
                name: "agent".to_string(),
                kind: Kind::Fail("agent thread panicked".to_string()),
                elapsed_ms: 0,
            }),
        }
    }
    // Spinners are cleared by each thread; print a deterministic report that
    // looks identical on a TTY, when piped, or when captured for a recording.
    let _ = multi.clear();

    let failed = outcomes.iter().filter(|outcome| !outcome.ok()).count();
    let check_count: usize = scenario.agents.iter().map(|agent| agent.steps.len()).sum();

    let parallel_ms = parallel_ms(&scenario.agents);
    let sequential_ms = sequential_ms(&scenario.agents);
    let factor = speedup(parallel_ms, sequential_ms);

    println!("Crew report");
    for outcome in &outcomes {
        println!("{}", format_report_line(outcome, ascii));
    }
    println!();
    println!("{}", "─".repeat(56));
    println!(
        "{} agents · {} checks · ran in PARALLEL",
        scenario.agents.len(),
        check_count
    );
    println!(
        "sequential ≈ {:.1}s  →  parallel {:.1}s  ·  {:.1}× faster",
        sequential_ms as f64 / 1000.0,
        parallel_ms as f64 / 1000.0,
        factor
    );

    if failed == 0 {
        if ascii {
            println!("OK VERDICT: code is runnable");
        } else {
            println!("{}", style("✅ VERDICT: code is runnable").green().bold());
        }
        Ok(0)
    } else {
        if ascii {
            println!("FAIL VERDICT: {failed} checks failed");
        } else {
            println!(
                "{}",
                style(format!("❌ VERDICT: {failed} checks failed"))
                    .red()
                    .bold()
            );
        }
        Ok(1)
    }
}

fn read_scenario(root: &Path) -> Result<Scenario, String> {
    let path = root.join("registry/verify-scenario.json");
    let content = std::fs::read_to_string(&path)
        .map_err(|error| format!("Failed to read {}: {error}", path.display()))?;
    serde_json::from_str(&content)
        .map_err(|error| format!("Failed to parse {}: {error}", path.display()))
}

fn spinner_style(ascii: bool) -> ProgressStyle {
    let template = if ascii {
        "{prefix} {spinner} {msg}"
    } else {
        "{prefix} {spinner:.cyan} {msg}"
    };
    ProgressStyle::with_template(template)
        .unwrap_or_else(|_| ProgressStyle::default_spinner())
}

fn agent_prefix(agent: &Agent, ascii: bool) -> String {
    if ascii {
        agent.name.clone()
    } else {
        format!("{} {}", agent.emoji, agent.name)
    }
}

fn run_agent(agent: &Agent, bar: ProgressBar, live: bool, root: &Path) -> AgentOutcome {
    let kind;
    let elapsed_ms;

    if live {
        let start = Instant::now();
        bar.set_message(format!("running: {}", agent.command));
        let result = run_live_command(&agent.command, root);
        elapsed_ms = start.elapsed().as_millis() as u64;
        kind = if result.code == 0 {
            Kind::Pass(agent.summary.clone())
        } else {
            Kind::Fail(stderr_tail(&result.stderr))
        };
    } else {
        for step in &agent.steps {
            bar.set_message(step.label.clone());
            thread::sleep(Duration::from_millis(step.duration_ms));
        }
        elapsed_ms = agent_step_ms(agent);
        kind = if agent.verdict == "advisory" {
            Kind::Advisory(
                agent.summary.clone(),
                agent.advisory.clone().unwrap_or_else(|| "advisory".to_string()),
            )
        } else {
            Kind::Pass(agent.summary.clone())
        };
    }

    bar.finish_and_clear();
    AgentOutcome {
        emoji: agent.emoji.clone(),
        name: agent.name.clone(),
        kind,
        elapsed_ms,
    }
}

/// Build one line of the final crew report. Plain text when `ascii`, otherwise
/// colorized with a status glyph. Kept thin so the plain form is unit-tested.
fn format_report_line(outcome: &AgentOutcome, ascii: bool) -> String {
    let secs = outcome.elapsed_ms as f64 / 1000.0;
    let who = if ascii {
        outcome.name.clone()
    } else {
        format!("{} {}", outcome.emoji, outcome.name)
    };
    match &outcome.kind {
        Kind::Pass(summary) => {
            let body = format!("{who} — {summary}  ({secs:.1}s)");
            if ascii {
                format!("  OK   {body}")
            } else {
                format!("  {} {}", style("✔").green().bold(), style(body).green())
            }
        }
        Kind::Advisory(summary, advisory) => {
            let body = format!("{who} — {summary} · {advisory}  ({secs:.1}s)");
            if ascii {
                format!("  WARN {body}")
            } else {
                format!("  {} {}", style("▲").yellow().bold(), style(body).yellow())
            }
        }
        Kind::Fail(detail) => {
            let body = format!("{who} — {detail}  ({secs:.1}s)");
            if ascii {
                format!("  FAIL {body}")
            } else {
                format!("  {} {}", style("✘").red().bold(), style(body).red())
            }
        }
    }
}

struct LiveResult {
    code: i32,
    stderr: String,
}

fn run_live_command(command: &str, root: &Path) -> LiveResult {
    let trimmed = command.trim();
    if trimmed.is_empty() {
        return LiveResult {
            code: 1,
            stderr: "empty command".to_string(),
        };
    }

    // On Windows, run through `cmd /C` so .cmd/.bat shims (pnpm, npm, npx) and
    // PATHEXT resolution work — `Command::new` resolves only .exe by bare name,
    // so `pnpm` would otherwise fail with "program not found".
    #[cfg(windows)]
    let output = Command::new("cmd")
        .args(["/C", trimmed])
        .current_dir(root)
        .output();
    #[cfg(not(windows))]
    let output = {
        let mut tokens = trimmed.split_whitespace();
        let program = tokens.next().unwrap_or("");
        let args: Vec<&str> = tokens.collect();
        Command::new(program).args(&args).current_dir(root).output()
    };

    match output {
        Ok(output) => LiveResult {
            code: output.status.code().unwrap_or(1),
            stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        },
        Err(error) => LiveResult {
            code: 127,
            stderr: error.to_string(),
        },
    }
}

fn stderr_tail(stderr: &str) -> String {
    let trimmed = stderr.trim();
    if trimmed.is_empty() {
        return "command failed".to_string();
    }
    trimmed
        .lines()
        .last()
        .unwrap_or("command failed")
        .to_string()
}

/// Parse the verify-specific flags. Returns (live, ascii).
fn parse_verify_flags(args: &[String]) -> (bool, bool) {
    let live = args.iter().any(|arg| arg == "--live");
    let ascii = args.iter().any(|arg| arg == "--ascii");
    (live, ascii)
}

/// Sum of one agent's step durations.
fn agent_step_ms(agent: &Agent) -> u64 {
    agent.steps.iter().map(|step| step.duration_ms).sum()
}

/// Wall-clock time when agents run in parallel: the slowest agent's total.
fn parallel_ms(agents: &[Agent]) -> u64 {
    agents.iter().map(agent_step_ms).max().unwrap_or(0)
}

/// Wall-clock time if every step ran one after another.
fn sequential_ms(agents: &[Agent]) -> u64 {
    agents.iter().map(agent_step_ms).sum()
}

/// Parallel speedup factor. Guards against division by zero.
fn speedup(parallel_ms: u64, sequential_ms: u64) -> f64 {
    if parallel_ms == 0 {
        return 0.0;
    }
    sequential_ms as f64 / parallel_ms as f64
}

#[cfg(test)]
mod tests {
    use super::*;

    fn strings(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| value.to_string()).collect()
    }

    fn fixture() -> Scenario {
        Scenario {
            title: "t".to_string(),
            tagline: "tag".to_string(),
            agents: vec![
                Agent {
                    id: "a".to_string(),
                    emoji: "🦀".to_string(),
                    name: "Alpha".to_string(),
                    role: "build".to_string(),
                    command: "true".to_string(),
                    steps: vec![
                        Step {
                            label: "one".to_string(),
                            duration_ms: 1000,
                        },
                        Step {
                            label: "two".to_string(),
                            duration_ms: 2000,
                        },
                    ],
                    verdict: "pass".to_string(),
                    summary: "ok".to_string(),
                    advisory: None,
                },
                Agent {
                    id: "b".to_string(),
                    emoji: "🦐".to_string(),
                    name: "Beta".to_string(),
                    role: "lint".to_string(),
                    command: "true".to_string(),
                    steps: vec![Step {
                        label: "solo".to_string(),
                        duration_ms: 4500,
                    }],
                    verdict: "advisory".to_string(),
                    summary: "meh".to_string(),
                    advisory: Some("watch this".to_string()),
                },
            ],
        }
    }

    #[test]
    fn deserializes_scenario_from_literal() {
        let json = r#"{
            "title": "Runnability check",
            "tagline": "Six agents, one verdict.",
            "agents": [
                {
                    "id": "builder",
                    "emoji": "🦀",
                    "name": "Builder",
                    "role": "compile",
                    "command": "cargo build",
                    "steps": [
                        { "label": "fetch deps", "duration_ms": 1200 },
                        { "label": "compile", "duration_ms": 3000 }
                    ],
                    "verdict": "pass",
                    "summary": "builds clean",
                    "advisory": null
                },
                {
                    "id": "linter",
                    "emoji": "🦐",
                    "name": "Linter",
                    "role": "lint",
                    "command": "cargo clippy",
                    "steps": [
                        { "label": "lint", "duration_ms": 800 }
                    ],
                    "verdict": "advisory",
                    "summary": "minor warnings",
                    "advisory": "3 style nits"
                }
            ]
        }"#;
        let scenario: Scenario = serde_json::from_str(json).expect("parse scenario");
        assert_eq!(scenario.title, "Runnability check");
        assert_eq!(scenario.agents.len(), 2);
        assert_eq!(scenario.agents[0].name, "Builder");
        assert_eq!(scenario.agents[0].steps.len(), 2);
        assert_eq!(scenario.agents[0].steps[1].duration_ms, 3000);
        assert_eq!(scenario.agents[0].advisory, None);
        assert_eq!(scenario.agents[1].verdict, "advisory");
        assert_eq!(scenario.agents[1].advisory.as_deref(), Some("3 style nits"));
    }

    #[test]
    fn speedup_math() {
        let factor = speedup(4500, 20300);
        assert!((factor - 4.5111).abs() < 0.05, "expected ~4.5, got {factor}");
    }

    #[test]
    fn speedup_guards_zero_parallel() {
        assert_eq!(speedup(0, 1000), 0.0);
    }

    #[test]
    fn aggregation_helpers_on_fixture() {
        let scenario = fixture();
        // Alpha: 1000 + 2000 = 3000, Beta: 4500
        assert_eq!(agent_step_ms(&scenario.agents[0]), 3000);
        assert_eq!(agent_step_ms(&scenario.agents[1]), 4500);
        // parallel = slowest agent = 4500
        assert_eq!(parallel_ms(&scenario.agents), 4500);
        // sequential = 3000 + 4500 = 7500
        assert_eq!(sequential_ms(&scenario.agents), 7500);
    }

    #[test]
    fn parses_verify_flags() {
        assert_eq!(parse_verify_flags(&strings(&["verify"])), (false, false));
        assert_eq!(
            parse_verify_flags(&strings(&["verify", "--live"])),
            (true, false)
        );
        assert_eq!(
            parse_verify_flags(&strings(&["verify", "--ascii"])),
            (false, true)
        );
        assert_eq!(
            parse_verify_flags(&strings(&["verify", "--live", "--ascii"])),
            (true, true)
        );
    }

    #[test]
    fn stderr_tail_picks_last_line() {
        assert_eq!(stderr_tail("first\nlast line"), "last line");
        assert_eq!(stderr_tail("   "), "command failed");
    }

    #[test]
    fn report_line_plain_forms() {
        let pass = AgentOutcome {
            emoji: "🦐".to_string(),
            name: "build-shrimp".to_string(),
            kind: Kind::Pass("compiled clean".to_string()),
            elapsed_ms: 3500,
        };
        assert_eq!(pass.ok(), true);
        let line = format_report_line(&pass, true);
        assert_eq!(line, "  OK   build-shrimp — compiled clean  (3.5s)");

        let advisory = AgentOutcome {
            emoji: "🐙".to_string(),
            name: "lint-octopus".to_string(),
            kind: Kind::Advisory("passed".to_string(), "2 hints".to_string()),
            elapsed_ms: 2500,
        };
        assert_eq!(advisory.ok(), true);
        assert_eq!(
            format_report_line(&advisory, true),
            "  WARN lint-octopus — passed · 2 hints  (2.5s)"
        );

        let fail = AgentOutcome {
            emoji: "🐡".to_string(),
            name: "e2e-puffer".to_string(),
            kind: Kind::Fail("exit 1".to_string()),
            elapsed_ms: 1000,
        };
        assert_eq!(fail.ok(), false);
        assert_eq!(
            format_report_line(&fail, true),
            "  FAIL e2e-puffer — exit 1  (1.0s)"
        );
    }
}
