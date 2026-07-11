//! `crew standup "<brief>"` — the live, REAL parallel crew.
//!
//! Fans the hired AI employees out across one brief at the same time. Each lane is
//! a real `node run.mjs <agent> ... --json` call to the model; Rust animates the
//! lanes (reusing the verify aesthetic) and, once they converge, prints each
//! employee's contribution plus REAL stats: measured parallel speedup and the
//! real dollar cost computed from the models' token usage.
//!
//! This is the one moment only CrewClaw can show: not "an AI writes text", but a
//! parallel AI workforce doing one job, live.

use std::path::Path;
use std::process::Command;
use std::thread;
use std::time::{Duration, Instant};

use console::style;
use indicatif::{MultiProgress, ProgressBar, ProgressStyle};
use serde::Deserialize;

// ZenMux published price for the demo model (anthropic/claude-opus-4.8), USD per
// million tokens. Used to turn real token usage into a real dollar figure.
const USD_PER_M_INPUT: f64 = 5.0;
const USD_PER_M_OUTPUT: f64 = 25.0;

#[derive(Debug, Deserialize)]
struct StandupScenario {
    title: String,
    tagline: String,
    crew: Vec<CrewMember>,
}

#[derive(Clone, Debug, Deserialize)]
struct CrewMember {
    id: String,
    emoji: String,
    label: String,
    role: String,
    prompt_prefix: String,
}

/// One line of the Node runtime's `--json` output.
#[derive(Debug, Deserialize)]
struct RunResult {
    content: Option<String>,
    usage: Option<Usage>,
    error: Option<String>,
}

#[derive(Debug, Deserialize)]
struct Usage {
    #[serde(default)]
    prompt_tokens: u64,
    #[serde(default)]
    completion_tokens: u64,
}

struct Outcome {
    emoji: String,
    label: String,
    role: String,
    body: Result<String, String>,
    elapsed_ms: u64,
    prompt_tokens: u64,
    completion_tokens: u64,
}

pub fn run_standup(args: &[String], root: &Path) -> Result<i32, String> {
    let ascii = args.iter().any(|arg| arg == "--ascii");
    let brief = standup_brief(args);
    if brief.is_empty() {
        eprintln!("Usage: crew standup \"<brief>\"");
        return Ok(2);
    }

    let scenario = read_scenario(root)?;

    crate::show_brand_header();
    println!();
    println!("{}", scenario.title);
    println!("{}", scenario.tagline);
    println!();
    println!(
        "{} AI employees · one brief · working in parallel…",
        scenario.crew.len()
    );
    println!();

    let multi = MultiProgress::new();
    let mut handles = Vec::new();

    for member in &scenario.crew {
        let bar = multi.add(ProgressBar::new_spinner());
        bar.set_style(spinner_style(ascii));
        bar.set_prefix(member_prefix(member, ascii));
        bar.set_message("thinking…");
        bar.enable_steady_tick(Duration::from_millis(90));

        let member = member.clone();
        let brief = brief.clone();
        let root = root.to_path_buf();
        handles.push(thread::spawn(move || {
            run_member(&member, &brief, bar, &root)
        }));
    }

    let mut outcomes = Vec::new();
    for handle in handles {
        if let Ok(outcome) = handle.join() {
            outcomes.push(outcome)
        }
    }
    let _ = multi.clear();

    let parallel_ms = outcomes.iter().map(|o| o.elapsed_ms).max().unwrap_or(0);
    let serial_ms: u64 = outcomes.iter().map(|o| o.elapsed_ms).sum();
    let speedup = if parallel_ms == 0 {
        0.0
    } else {
        serial_ms as f64 / parallel_ms as f64
    };
    let prompt_tokens: u64 = outcomes.iter().map(|o| o.prompt_tokens).sum();
    let completion_tokens: u64 = outcomes.iter().map(|o| o.completion_tokens).sum();
    let cost = prompt_tokens as f64 / 1_000_000.0 * USD_PER_M_INPUT
        + completion_tokens as f64 / 1_000_000.0 * USD_PER_M_OUTPUT;

    println!("Crew report");
    println!();
    let failed = outcomes.iter().filter(|o| o.body.is_err()).count();
    for outcome in &outcomes {
        print_outcome(outcome, ascii);
        println!();
    }

    println!("{}", "─".repeat(60));
    println!(
        "{} employees · ran in PARALLEL · {} tokens",
        outcomes.len(),
        prompt_tokens + completion_tokens
    );
    println!(
        "serial ≈ {:.1}s  →  parallel {:.1}s  ·  {:.1}× faster  ·  ${:.3}",
        serial_ms as f64 / 1000.0,
        parallel_ms as f64 / 1000.0,
        speedup,
        cost
    );
    if failed == 0 {
        if ascii {
            println!("OK  the crew shipped.");
        } else {
            println!("{}", style("✅ the crew shipped.").green().bold());
        }
        Ok(0)
    } else {
        if ascii {
            println!("WARN  {failed} employee(s) did not report.");
        } else {
            println!(
                "{}",
                style(format!("▲ {failed} employee(s) did not report.")).yellow()
            );
        }
        Ok(1)
    }
}

fn run_member(member: &CrewMember, brief: &str, bar: ProgressBar, root: &Path) -> Outcome {
    let script = root.join("packages/runtime/run.mjs");
    let task = format!("{}{}", member.prompt_prefix, brief);
    let start = Instant::now();

    let output = Command::new("node")
        .arg(&script)
        .arg(&member.id)
        .arg(&task)
        .arg("--json")
        .current_dir(root)
        .output();
    let elapsed_ms = start.elapsed().as_millis() as u64;
    bar.finish_and_clear();

    let (body, prompt_tokens, completion_tokens) = match output {
        Ok(out) => {
            let stdout = String::from_utf8_lossy(&out.stdout);
            match parse_last_json(&stdout) {
                Some(result) => match result.content {
                    Some(content) if !content.trim().is_empty() => {
                        let usage = result.usage.unwrap_or(Usage {
                            prompt_tokens: 0,
                            completion_tokens: 0,
                        });
                        (Ok(content), usage.prompt_tokens, usage.completion_tokens)
                    }
                    _ => (
                        Err(result.error.unwrap_or_else(|| "no content".to_string())),
                        0,
                        0,
                    ),
                },
                None => {
                    let stderr = String::from_utf8_lossy(&out.stderr);
                    (Err(last_line(&stderr, "runtime returned no JSON")), 0, 0)
                }
            }
        }
        Err(error) => (Err(format!("failed to launch node: {error}")), 0, 0),
    };

    Outcome {
        emoji: member.emoji.clone(),
        label: member.label.clone(),
        role: member.role.clone(),
        body,
        elapsed_ms,
        prompt_tokens,
        completion_tokens,
    }
}

fn print_outcome(outcome: &Outcome, ascii: bool) {
    let secs = outcome.elapsed_ms as f64 / 1000.0;
    let who = if ascii {
        format!("{} ({})", outcome.label, outcome.role)
    } else {
        format!("{} {} ({})", outcome.emoji, outcome.label, outcome.role)
    };
    match &outcome.body {
        Ok(content) => {
            let head = format!("{who} — done ({secs:.1}s)");
            if ascii {
                println!("  OK  {head}");
            } else {
                println!(
                    "  {} {}",
                    style("✔").green().bold(),
                    style(head).green().bold()
                );
            }
            for line in content.trim().lines() {
                println!("       {}", line.trim_end());
            }
        }
        Err(detail) => {
            let head = format!("{who} — {detail} ({secs:.1}s)");
            if ascii {
                println!("  FAIL {head}");
            } else {
                println!("  {} {}", style("✘").red().bold(), style(head).red());
            }
        }
    }
}

/// The runtime prints one JSON object; tolerate stray lines by scanning upward
/// for the last line that parses.
fn parse_last_json(stdout: &str) -> Option<RunResult> {
    for line in stdout.lines().rev() {
        let trimmed = line.trim();
        if trimmed.starts_with('{')
            && let Ok(result) = serde_json::from_str::<RunResult>(trimmed)
        {
            return Some(result);
        }
    }
    None
}

fn last_line(text: &str, fallback: &str) -> String {
    text.trim()
        .lines()
        .last()
        .map(|line| line.trim().to_string())
        .filter(|line| !line.is_empty())
        .unwrap_or_else(|| fallback.to_string())
}

fn standup_brief(args: &[String]) -> String {
    let mut parts = Vec::new();
    let mut consumed_verb = false;
    for arg in args {
        if arg == "--ascii" {
            continue;
        }
        if !consumed_verb && arg == "standup" {
            consumed_verb = true;
            continue;
        }
        parts.push(arg.clone());
    }
    parts.join(" ").trim().to_string()
}

fn read_scenario(root: &Path) -> Result<StandupScenario, String> {
    let path = root.join("registry/standup-scenario.json");
    let content = std::fs::read_to_string(&path)
        .map_err(|error| format!("Failed to read {}: {error}", path.display()))?;
    serde_json::from_str(&content)
        .map_err(|error| format!("Failed to parse {}: {error}", path.display()))
}

fn spinner_style(ascii: bool) -> ProgressStyle {
    let template = if ascii {
        "  {prefix} {spinner} {msg}"
    } else {
        "  {prefix} {spinner:.cyan} {msg}"
    };
    ProgressStyle::with_template(template).unwrap_or_else(|_| ProgressStyle::default_spinner())
}

fn member_prefix(member: &CrewMember, ascii: bool) -> String {
    if ascii {
        format!("{} ({})", member.label, member.role)
    } else {
        format!("{} {} ({})", member.emoji, member.label, member.role)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_runtime_json_line() {
        let line = r#"{"agent":"x","content":"hello","usage":{"prompt_tokens":10,"completion_tokens":5},"elapsed_ms":1200}"#;
        let result = parse_last_json(line).expect("parse");
        assert_eq!(result.content.as_deref(), Some("hello"));
        assert_eq!(result.usage.unwrap().completion_tokens, 5);
    }

    #[test]
    fn parses_error_json_line() {
        let line = r#"prelude noise
{"agent":"x","error":"timed out","elapsed_ms":45000}"#;
        let result = parse_last_json(line).expect("parse");
        assert!(result.content.is_none());
        assert_eq!(result.error.as_deref(), Some("timed out"));
    }

    #[test]
    fn brief_strips_verb_and_flags() {
        let args = vec![
            "standup".to_string(),
            "--ascii".to_string(),
            "ship".to_string(),
            "it".to_string(),
        ];
        assert_eq!(standup_brief(&args), "ship it");
    }
}
