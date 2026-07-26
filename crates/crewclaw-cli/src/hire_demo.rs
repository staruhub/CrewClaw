//! Scripted onboarding ceremony for the ClawCon / FORCE stage demo.
//!
//! `crew hire <agent> --demo` plays a deterministic, animated "AI employee onboarding"
//! built from a per-agent card in `registry/hire-scenario.json`. The four spinner
//! steps are generated from the card (download → install skills → verify → sign),
//! so adding a new hireable employee is just one card entry — every available
//! agent gets a ceremony, not only one. Scripted-for-stability: no network, no
//! real install, identical every run. Normal `crew hire` uses the real Hermes
//! path in `main.rs`; demo mode is never selected implicitly.

use std::path::Path;
use std::thread;
use std::time::Duration;

use console::style;
use indicatif::{ProgressBar, ProgressStyle};
use serde::Deserialize;

#[derive(Debug, Deserialize)]
struct ScenarioFile {
    agents: Vec<AgentCard>,
}

#[derive(Clone, Debug, Deserialize)]
struct AgentCard {
    id: String,
    name: String,
    emoji: String,
    title: String,
    version: String,
    source: String,
    manifest_path: String,
    sla: String,
    #[serde(default)]
    certification: String,
    #[serde(default)]
    skills: Vec<String>,
    #[serde(default)]
    permissions: Vec<String>,
}

#[derive(Clone, Debug)]
struct Step {
    label: String,
    done: String,
    detail: String,
    duration_ms: u64,
}

/// The four onboarding steps, generated from the agent card so any agent works.
fn steps_for(card: &AgentCard) -> Vec<Step> {
    let skills_detail = if card.skills.is_empty() {
        "C1 package-validated skills".to_string()
    } else {
        format!("{} skills · {}", card.skills.len(), card.skills.join(", "))
    };
    vec![
        Step {
            label: format!("Resolving {} from {}…", card.id, card.source),
            done: "Employee Package downloaded".to_string(),
            detail: format!("{}@{}", card.id, card.version),
            duration_ms: 700,
        },
        Step {
            label: "Installing skills from ClawHub…".to_string(),
            done: "Skills installed".to_string(),
            detail: skills_detail,
            duration_ms: 900,
        },
        Step {
            label: "Verifying employee manifest…".to_string(),
            done: "Manifest verified".to_string(),
            detail: "identity · permissions · SLA · signature OK".to_string(),
            duration_ms: 650,
        },
        Step {
            label: "Signing employment contract…".to_string(),
            done: format!("{} hired", card.name),
            detail: card.emoji.clone(),
            duration_ms: 550,
        },
    ]
}

/// True when a scripted onboarding card exists for `target`. Lets `main.rs` route
/// any known agent into the demo while unknown agents fall through to the real
/// Hermes hire path.
pub fn has_ceremony(root: &Path, target: &str) -> bool {
    find_card(root, target).is_ok()
}

/// Play the onboarding ceremony for `target`. `--ascii` drops emoji/color.
pub fn run_hire_ceremony(args: &[String], root: &Path, target: &str) -> Result<i32, String> {
    let ascii = args.iter().any(|arg| arg == "--ascii");
    let card = find_card(root, target)?;

    crate::show_brand_header();
    println!();
    println!("CrewClaw · Hiring");
    println!(
        "Onboarding a C1 package-validated AI employee from {}",
        card.source
    );
    println!();

    for step in &steps_for(&card) {
        play_step(step, ascii);
    }

    println!();
    let who = if ascii {
        card.name.clone()
    } else {
        format!("{} {}", card.emoji, card.name)
    };
    let welcome = format!("Welcome aboard, {who}.");
    if ascii {
        println!("{welcome}");
    } else {
        println!("{}", style(welcome).green().bold());
    }
    println!("  Title : {}", card.title);
    println!("  SLA   : {}", card.sla);
    println!(
        "  Next  : cat {}    (read the job description)",
        card.manifest_path
    );
    println!(
        "          crew chat {}        (talk to it — interactive)",
        card.id
    );

    Ok(0)
}

/// Animate one onboarding step: a spinner on `label` for its duration, then a
/// persisted checkmark line `✓ done   detail`.
fn play_step(step: &Step, ascii: bool) {
    let bar = ProgressBar::new_spinner();
    bar.set_style(spinner_style(ascii));
    bar.set_message(step.label.clone());
    bar.enable_steady_tick(Duration::from_millis(80));
    thread::sleep(Duration::from_millis(step.duration_ms));
    bar.finish_and_clear();
    println!("{}", check_line(step, ascii));
}

fn spinner_style(ascii: bool) -> ProgressStyle {
    let template = if ascii {
        "  {spinner} {msg}"
    } else {
        "  {spinner:.cyan} {msg}"
    };
    ProgressStyle::with_template(template).unwrap_or_else(|_| ProgressStyle::default_spinner())
}

/// One resolved onboarding line. Plain when `ascii`, otherwise a green glyph
/// with a dimmed detail. Kept thin so the plain form is unit-tested.
fn check_line(step: &Step, ascii: bool) -> String {
    if ascii {
        format!("  OK  {:<32} {}", step.done, step.detail)
    } else {
        format!(
            "  {} {:<32} {}",
            style("✓").green().bold(),
            style(&step.done).green(),
            style(&step.detail).dim()
        )
    }
}

/// `crew badge <agent>` — render the hired employee's manifest as a visual ID card.
pub fn run_badge(args: &[String], root: &Path, target: &str) -> Result<i32, String> {
    let ascii = args.iter().any(|arg| arg == "--ascii");
    let a = find_card(root, target)?;

    let (tl, bl, h, v) = if ascii {
        ("+", "+", "-", "|")
    } else {
        ("┌", "└", "─", "│")
    };
    let sep = if ascii { ", " } else { " · " };
    let rule = h.repeat(46);

    let head = if ascii {
        a.name.to_uppercase()
    } else {
        format!("{}  {}", a.emoji, a.name.to_uppercase())
    };
    let cert = if a.certification.is_empty() {
        format!("v{}", a.version)
    } else {
        format!(
            "[DEMO · {} SCENARIO CLAIM] · v{}",
            a.certification, a.version
        )
    };

    println!();
    println!("  {tl}{h} EMPLOYEE BADGE {rule}");
    println!("  {v}");
    println!("  {v}   {head}        {cert}");
    println!("  {v}       {}", a.title);
    println!("  {v}");
    println!("  {v}   SKILLS   {}", a.skills.join(sep));
    println!("  {v}   PERMS    {}", a.permissions.join(sep));
    println!("  {v}   SLA      {}", a.sla);
    println!(
        "  {v}   STATUS   hired{sep}fireable{sep}{}-verified",
        a.source
    );
    println!("  {v}");
    println!("  {bl}{}", rule);
    println!();
    println!("  Manifest: {}   ·   crew chat {}", a.manifest_path, a.id);
    Ok(0)
}

/// Light scripted farewell — `crew fire <agent>` reuses the same card.
pub fn run_fire_ceremony(args: &[String], root: &Path, target: &str) -> Result<i32, String> {
    let ascii = args.iter().any(|arg| arg == "--ascii");
    let card = find_card(root, target)?;

    let who = if ascii {
        card.name.clone()
    } else {
        format!("{} {}", card.emoji, card.name)
    };
    let line = format!("{who} offboarded · access revoked · record retained");
    if ascii {
        println!("  OK  {line}");
        println!("Employment ended. History is retained and the employee can be re-hired.");
    } else {
        println!("  {} {}", style("✓").green().bold(), style(line).green());
        println!(
            "{}",
            style("Record retained · access disabled · ready to re-hire later.").dim()
        );
    }
    Ok(0)
}

fn load_cards(root: &Path) -> Result<Vec<AgentCard>, String> {
    let path = root.join("registry/hire-scenario.json");
    let content = std::fs::read_to_string(&path)
        .map_err(|error| format!("Failed to read {}: {error}", path.display()))?;
    let file: ScenarioFile = serde_json::from_str(&content)
        .map_err(|error| format!("Failed to parse {}: {error}", path.display()))?;
    Ok(file.agents)
}

fn find_card(root: &Path, target: &str) -> Result<AgentCard, String> {
    load_cards(root)?
        .into_iter()
        .find(|card| card.id.eq_ignore_ascii_case(target))
        .ok_or_else(|| format!("no onboarding card for {target}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_card() -> AgentCard {
        AgentCard {
            id: "ai-adoption-whale".to_string(),
            name: "AI 落地鲸".to_string(),
            emoji: "🐳".to_string(),
            title: "企业大模型落地顾问".to_string(),
            version: "0.1.0".to_string(),
            source: "ClawHub".to_string(),
            manifest_path: "experts/ai-adoption-whale/hire.yaml".to_string(),
            sla: "落地方案 24 小时内交付".to_string(),
            certification: "C2".to_string(),
            skills: vec!["model-selector".to_string(), "roi-estimator".to_string()],
            permissions: vec!["public_web:read".to_string()],
        }
    }

    #[test]
    fn check_line_plain_form() {
        let step = &steps_for(&sample_card())[0];
        let line = check_line(step, true);
        assert_eq!(
            line,
            "  OK  Employee Package downloaded      ai-adoption-whale@0.1.0"
        );
    }

    #[test]
    fn generates_four_steps_from_card() {
        let steps = steps_for(&sample_card());
        assert_eq!(steps.len(), 4);
        assert_eq!(steps[1].detail, "2 skills · model-selector, roi-estimator");
        assert_eq!(steps[3].done, "AI 落地鲸 hired");
    }

    #[test]
    fn deserializes_scenario_file() {
        let json = r#"{
            "agents": [
                {
                    "id": "ai-adoption-whale",
                    "name": "AI 落地鲸",
                    "emoji": "🐳",
                    "title": "企业大模型落地顾问",
                    "version": "0.1.0",
                    "source": "ClawHub",
                    "manifest_path": "experts/ai-adoption-whale/hire.yaml",
                    "sla": "落地方案 24 小时内交付"
                }
            ]
        }"#;
        let file: ScenarioFile = serde_json::from_str(json).expect("parse scenario file");
        assert_eq!(file.agents.len(), 1);
        assert_eq!(file.agents[0].id, "ai-adoption-whale");
    }
}
