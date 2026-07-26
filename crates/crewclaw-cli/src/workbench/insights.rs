//! Safe projection of persisted evaluation, KPI, TaskRun dream, and memory state for EVAL/DREAM.

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::Value;

use super::state::{
    DreamSnapshot, EvalReport, ExamEntry, KpiCumulative, MonthlyMetric, PersistedInsights,
    PersistedMemory, ReputationEntry,
};

const MAX_RUN_FILES: usize = 64;
const MAX_INSIGHT_FILE_BYTES: u64 = 1024 * 1024;
const MAX_INSIGHT_TOTAL_BYTES: u64 = 16 * 1024 * 1024;
const MAX_VISIBLE_ITEMS: usize = 50;
const MEMORY_CATEGORIES: [&str; 6] = [
    "user_prefs",
    "project_facts",
    "successful_toolchains",
    "failure_paths",
    "reliable_sources",
    "verified_sops",
];

pub(crate) fn load(root: &Path, employee_id: &str) -> PersistedInsights {
    let mut insights = PersistedInsights {
        refreshed_at: now_millis(),
        ..PersistedInsights::default()
    };
    if !safe_employee_id(employee_id) {
        insights
            .errors
            .push("employee id is unsafe for persisted state lookup".to_string());
        return insights;
    }
    let mut budget = ReadBudget::default();

    match read_json(
        root,
        PathBuf::from("eval").join(format!("{employee_id}.json")),
        &mut budget,
    ) {
        Ok(Some(value)) => match parse_eval(&value, employee_id) {
            Ok(report) => insights.eval = Some(report),
            Err(error) => insights.errors.push(format!("eval: {error}")),
        },
        Ok(None) => {}
        Err(error) => insights.errors.push(format!("eval: {error}")),
    }

    match read_json(
        root,
        PathBuf::from("kpi").join(format!("{employee_id}.json")),
        &mut budget,
    ) {
        Ok(Some(value)) => match parse_kpi(&value) {
            Ok(kpi) => insights.kpi = kpi,
            Err(error) => insights.errors.push(format!("kpi: {error}")),
        },
        Ok(None) => {}
        Err(error) => insights.errors.push(format!("kpi: {error}")),
    }

    match read_json(
        root,
        PathBuf::from("memory").join(format!("{employee_id}.json")),
        &mut budget,
    ) {
        Ok(Some(value)) => match parse_memory(&value) {
            Ok(memories) => insights.dream.memories = memories,
            Err(error) => insights.errors.push(format!("memory: {error}")),
        },
        Ok(None) => {}
        Err(error) => insights.errors.push(format!("memory: {error}")),
    }

    load_runs(root, employee_id, &mut budget, &mut insights);
    derive_memory_views(&mut insights.dream);
    insights
}

fn safe_employee_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
}

#[derive(Debug, Default)]
struct ReadBudget {
    used: u64,
}

impl ReadBudget {
    fn remaining(&self) -> u64 {
        MAX_INSIGHT_TOTAL_BYTES.saturating_sub(self.used)
    }

    fn can_fit(&self, bytes: u64) -> bool {
        bytes <= self.remaining()
    }

    fn charge(&mut self, bytes: u64) -> Result<(), String> {
        if !self.can_fit(bytes) {
            return Err(format!(
                "aggregate read budget exceeds {MAX_INSIGHT_TOTAL_BYTES} bytes"
            ));
        }
        self.used += bytes;
        Ok(())
    }
}

fn read_json(
    root: &Path,
    relative: PathBuf,
    budget: &mut ReadBudget,
) -> Result<Option<Value>, String> {
    let limit = MAX_INSIGHT_FILE_BYTES.min(budget.remaining());
    if limit == 0 {
        return Err(format!(
            "aggregate read budget exceeds {MAX_INSIGHT_TOTAL_BYTES} bytes"
        ));
    }
    let Some(contents) = crate::state_store::read_with_limit(root, &relative, limit)
        .map_err(|error| format!("safe read failed: {error}"))?
    else {
        return Ok(None);
    };
    budget.charge(contents.len() as u64)?;
    serde_json::from_slice(&contents)
        .map(Some)
        .map_err(|error| format!("invalid JSON: {error}"))
}

fn parse_eval(value: &Value, employee_id: &str) -> Result<EvalReport, String> {
    let object = value
        .as_object()
        .ok_or_else(|| "result is not an object".to_string())?;
    if required_string(value, "agent_id")? != employee_id {
        return Err("agent_id does not match the active employee".to_string());
    }
    let score = bounded_score(value, "score")?;
    let verdict = required_string(value, "verdict")?.to_uppercase();
    if !matches!(verdict.as_str(), "PASS" | "FAIL") {
        return Err("verdict must be PASS or FAIL".to_string());
    }
    let model = required_string(value, "model")?;
    let mock = object
        .get("mock")
        .and_then(Value::as_bool)
        .ok_or_else(|| "mock provenance must be explicit".to_string())?;
    let evaluated_at = object
        .get("evaluated_at")
        .and_then(Value::as_u64)
        .filter(|timestamp| *timestamp > 0)
        .ok_or_else(|| "evaluated_at is missing or invalid".to_string())?;
    let threshold = object
        .get("pass_threshold")
        .and_then(Value::as_f64)
        .filter(|threshold| threshold.is_finite() && (0.0..=1.0).contains(threshold))
        .ok_or_else(|| "pass_threshold is missing or invalid".to_string())?;
    let per_test = object
        .get("per_test")
        .and_then(Value::as_array)
        .filter(|tests| !tests.is_empty())
        .ok_or_else(|| "per_test evidence is missing".to_string())?;
    let mut exams = Vec::with_capacity(per_test.len());
    for test in per_test {
        exams.push(ExamEntry {
            id: required_string(test, "id")?.to_string(),
            score: bounded_score(test, "score")?,
            passed: test
                .get("passed")
                .and_then(Value::as_bool)
                .ok_or_else(|| "per_test passed must be boolean".to_string())?,
        });
    }
    let expected_score = (exams.iter().map(|exam| exam.score as u64).sum::<u64>() as f64
        / exams.len() as f64)
        .round() as u32;
    if score != expected_score {
        return Err("score does not match per_test evidence".to_string());
    }
    let expected_verdict =
        if exams.iter().all(|exam| exam.passed) && score as f64 >= threshold * 100.0 {
            "PASS"
        } else {
            "FAIL"
        };
    if verdict != expected_verdict {
        return Err("verdict does not match per_test evidence".to_string());
    }
    let graded_by = required_string(value, "graded_by")?;
    if mock {
        if graded_by != "mechanical" {
            return Err("mock result must be mechanically graded".to_string());
        }
    } else {
        if graded_by != "model" {
            return Err("non-mock stored result must be model graded".to_string());
        }
        required_string(value, "worker_model")?;
        required_string(value, "judge_model")?;
        for field in ["spec_hash", "subject_hash", "execution_context_hash"] {
            let hash = required_string(value, field)?;
            if hash.len() != 64 || !hash.bytes().all(|byte| byte.is_ascii_hexdigit()) {
                return Err(format!("{field} is not a sha256 digest"));
            }
        }
    }
    Ok(EvalReport {
        score,
        verdict,
        model: model.to_string(),
        mock,
        // A disk record has not been rebound to the current subject contract in Rust. Even a
        // structurally plausible mock:false record is only displayable as pending verification.
        certified: false,
        evaluated_at,
        exams,
    })
}

fn parse_kpi(value: &Value) -> Result<KpiCumulative, String> {
    let object = value
        .as_object()
        .ok_or_else(|| "document is not an object".to_string())?;
    let tasks = object.get("tasks").and_then(Value::as_u64).unwrap_or(0);
    let accepted = object.get("accepted").and_then(Value::as_u64).unwrap_or(0);
    let auto_accepted = object
        .get("auto_accepted")
        .and_then(Value::as_u64)
        .unwrap_or(0);
    if accepted.saturating_add(auto_accepted) > tasks {
        return Err("accepted counts exceed task count".to_string());
    }
    let total_cost = object
        .get("total_cost")
        .and_then(Value::as_f64)
        .unwrap_or(0.0);
    if !total_cost.is_finite() || total_cost < 0.0 {
        return Err("total_cost is invalid".to_string());
    }
    Ok(KpiCumulative {
        tasks,
        accepted,
        auto_accepted,
        total_cost,
        first_hired_ts: object.get("first_hired_ts").and_then(Value::as_u64),
    })
}

fn parse_memory(value: &Value) -> Result<Vec<PersistedMemory>, String> {
    let items = value
        .as_array()
        .ok_or_else(|| "memory document is not an array".to_string())?;
    let mut memories = Vec::new();
    for item in items {
        if item.get("sensitive").and_then(Value::as_bool) == Some(true) {
            continue;
        }
        let Some(category) = item.get("category").and_then(Value::as_str) else {
            continue;
        };
        if !MEMORY_CATEGORIES.contains(&category) {
            continue;
        }
        let Some(text) = item
            .get("text")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|text| !text.is_empty())
        else {
            continue;
        };
        let confidence = item
            .get("confidence")
            .and_then(Value::as_str)
            .unwrap_or("unknown");
        if confidence == "low" {
            continue;
        }
        memories.push(PersistedMemory {
            kind: memory_kind(category).to_string(),
            category: category.to_string(),
            text: text.to_string(),
            confidence: confidence.to_string(),
            saved_at: item
                .get("savedAt")
                .and_then(Value::as_str)
                .map(ToString::to_string),
            source_task_ids: item
                .get("source_task_ids")
                .and_then(Value::as_array)
                .map(|values| {
                    values
                        .iter()
                        .filter_map(Value::as_str)
                        .map(str::trim)
                        .filter(|value| !value.is_empty())
                        .take(8)
                        .map(ToString::to_string)
                        .collect()
                })
                .unwrap_or_default(),
            dream_run_id: item
                .get("dream_run_id")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToString::to_string),
        });
    }
    memories.sort_by(|left, right| right.saved_at.cmp(&left.saved_at));
    memories.truncate(MAX_VISIBLE_ITEMS);
    Ok(memories)
}

fn load_runs(
    root: &Path,
    employee_id: &str,
    budget: &mut ReadBudget,
    insights: &mut PersistedInsights,
) {
    let entries = match crate::state_store::list_regular_file_entries(root, "runs") {
        Ok(entries) => entries,
        Err(error) => {
            insights
                .errors
                .push(format!("runs: safe listing failed: {error}"));
            return;
        }
    };
    let mut candidates: Vec<_> = entries
        .into_iter()
        .filter_map(|entry| task_run_stem(&entry.relative).map(|stem| (entry, stem)))
        .collect();
    // Select recent runs by advisory mtime before opening any file. Ties use the path so refreshes
    // are deterministic; every selected file is still reopened through the guarded state reader.
    candidates.sort_by(|(left, _), (right, _)| {
        right
            .modified
            .cmp(&left.modified)
            .then_with(|| right.relative.cmp(&left.relative))
    });
    if candidates.len() > MAX_RUN_FILES {
        insights.errors.push(format!(
            "runs: {} TaskRun files exceed the read limit of {MAX_RUN_FILES}",
            candidates.len()
        ));
    }
    let mut relevant: Vec<(String, Value)> = Vec::new();
    for (entry, stem) in candidates.into_iter().take(MAX_RUN_FILES) {
        if entry.len > MAX_INSIGHT_FILE_BYTES {
            insights.errors.push(format!(
                "runs: {stem}: file size {} exceeds the per-file budget of {MAX_INSIGHT_FILE_BYTES} bytes",
                entry.len
            ));
            continue;
        }
        if !budget.can_fit(entry.len) {
            insights.errors.push(format!(
                "runs: aggregate read budget exceeds {MAX_INSIGHT_TOTAL_BYTES} bytes"
            ));
            return;
        }
        match read_json(root, entry.relative, budget) {
            Ok(Some(value)) => {
                if value.get("employee_id").and_then(Value::as_str) != Some(employee_id) {
                    continue;
                }
                if value.get("id").and_then(Value::as_str) != Some(stem.as_str()) {
                    insights
                        .errors
                        .push(format!("runs: {stem} has a mismatched id"));
                    continue;
                }
                relevant.push((stem, value));
            }
            Ok(None) => {}
            Err(error) => insights.errors.push(format!("runs: {stem}: {error}")),
        }
    }
    relevant.sort_by(|left, right| run_updated_at(&right.1).cmp(&run_updated_at(&left.1)));

    let mut months: BTreeMap<String, (u64, u64)> = BTreeMap::new();
    let mut worked = Vec::new();
    let mut failed = Vec::new();
    let mut playbook_add = Vec::new();
    let mut playbook_remove = Vec::new();
    let mut knowledge = Vec::new();
    for (_, run) in &relevant {
        let status = run
            .get("status")
            .and_then(Value::as_str)
            .unwrap_or("unknown");
        let goal = run
            .get("user_goal")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|goal| !goal.is_empty())
            .unwrap_or("未命名任务");
        insights.dream.run_count += 1;
        let reputation_status = match status {
            "accepted" => {
                insights.reputation.accepted += 1;
                Some("accepted")
            }
            "rejected" => {
                insights.reputation.rejected += 1;
                Some("rejected")
            }
            "revision_needed" => {
                insights.reputation.revision_needed += 1;
                Some("revision_needed")
            }
            _ => None,
        };
        if let Some(reputation_status) = reputation_status {
            insights.reputation.verified_tasks += 1;
            if insights.reputation.history.len() < 8 {
                insights.reputation.history.push(ReputationEntry {
                    task_id: run
                        .get("id")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_string(),
                    status: reputation_status.to_string(),
                    goal: goal.to_string(),
                    updated_at: run_updated_at(run).and_then(rfc3339_millis).unwrap_or(0),
                });
            }
        }
        match status {
            "accepted" => {
                insights.dream.accepted_count += 1;
                push_unique(&mut worked, format!("{goal}（已验收）"));
            }
            "failed" | "rejected" => {
                insights.dream.failed_count += 1;
                push_unique(&mut failed, format!("{goal}（{status}）"));
            }
            "revision_needed" => {
                insights.dream.revision_count += 1;
                push_unique(&mut failed, format!("{goal}（需修订）"));
            }
            _ => {}
        }
        if let Some(updated) = run_updated_at(run) {
            if insights.dream.last_updated.is_none() {
                insights.dream.last_updated = Some(updated.to_string());
            }
            if let Some(month) = month_key(updated) {
                let counts = months.entry(month.to_string()).or_default();
                counts.0 += 1;
                if status == "accepted" {
                    counts.1 += 1;
                }
            }
        }
        if let Some(dream) = run.get("dream") {
            insights.dream.dream_candidates +=
                dream.get("candidates").and_then(Value::as_u64).unwrap_or(0);
            if insights.dream.confidence.is_none() {
                insights.dream.confidence = dream
                    .get("confidence")
                    .and_then(Value::as_str)
                    .map(ToString::to_string);
            }
        }
        if run
            .get("memory_commit")
            .and_then(|commit| commit.get("committed"))
            .and_then(Value::as_bool)
            == Some(true)
            && let Some(candidates) = run
                .get("memory_commit")
                .and_then(|commit| commit.get("candidates"))
                .and_then(Value::as_array)
        {
            for candidate in candidates {
                let Some(category) = candidate.get("category").and_then(Value::as_str) else {
                    continue;
                };
                let Some(text) = candidate
                    .get("text")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|text| !text.is_empty())
                else {
                    continue;
                };
                match category {
                    "verified_sops" | "successful_toolchains" => {
                        push_unique(&mut playbook_add, format!("+ {text}"));
                    }
                    "failure_paths" => push_unique(&mut knowledge, text.to_string()),
                    _ => {}
                }
            }
        }
        if let Some(removals) = run.get("playbook_remove").and_then(Value::as_array) {
            for removal in removals.iter().filter_map(Value::as_str) {
                push_unique(&mut playbook_remove, format!("- {}", removal.trim()));
            }
        }
    }
    worked.truncate(5);
    failed.truncate(5);
    knowledge.truncate(8);
    playbook_add.truncate(8);
    playbook_remove.truncate(8);
    insights.dream.worked = worked;
    insights.dream.failed = failed;
    insights.dream.knowledge = knowledge;
    insights.dream.playbook_add = playbook_add;
    insights.dream.playbook_remove = playbook_remove;
    let mut monthly: Vec<_> = months
        .into_iter()
        .map(|(month, (tasks, accepted))| MonthlyMetric {
            month,
            tasks,
            accepted,
        })
        .collect();
    if monthly.len() > 6 {
        monthly.drain(0..monthly.len() - 6);
    }
    insights.monthly = monthly;
    insights.reputation.acceptance_rate_bps = insights
        .reputation
        .accepted
        .saturating_mul(10_000)
        .checked_div(insights.reputation.verified_tasks)
        .unwrap_or(0);
}

fn derive_memory_views(dream: &mut DreamSnapshot) {
    let mut seen: BTreeSet<String> = dream.knowledge.iter().cloned().collect();
    for memory in &dream.memories {
        if memory.kind == "P" {
            let addition = format!("+ {}", memory.text);
            if !dream.playbook_add.contains(&addition) {
                dream.playbook_add.push(addition);
            }
        } else if seen.insert(memory.text.clone()) {
            dream.knowledge.push(memory.text.clone());
        }
    }
    dream.knowledge.truncate(8);
    dream.playbook_add.truncate(8);
}

fn task_run_stem(relative: &Path) -> Option<String> {
    let name = relative.file_name()?.to_str()?;
    let stem = name.strip_suffix(".json")?;
    (stem.starts_with("task_")
        && stem
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-')))
    .then(|| stem.to_string())
}

fn run_updated_at(run: &Value) -> Option<&str> {
    run.get("updated_at").and_then(Value::as_str)
}

fn rfc3339_millis(value: &str) -> Option<u64> {
    let millis = chrono::DateTime::parse_from_rfc3339(value)
        .ok()?
        .timestamp_millis();
    u64::try_from(millis).ok()
}

fn month_key(timestamp: &str) -> Option<&str> {
    let month = timestamp.get(..7)?;
    (month.len() == 7
        && month.as_bytes()[4] == b'-'
        && month[..4].bytes().all(|byte| byte.is_ascii_digit())
        && month[5..].bytes().all(|byte| byte.is_ascii_digit()))
    .then_some(month)
}

fn memory_kind(category: &str) -> &'static str {
    match category {
        "verified_sops" | "successful_toolchains" => "P",
        "reliable_sources" => "E",
        _ => "K",
    }
}

fn required_string<'a>(value: &'a Value, field: &str) -> Result<&'a str, String> {
    value
        .get(field)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .ok_or_else(|| format!("{field} is missing or invalid"))
}

fn bounded_score(value: &Value, field: &str) -> Result<u32, String> {
    value
        .get(field)
        .and_then(Value::as_u64)
        .filter(|score| *score <= 100)
        .map(|score| score as u32)
        .ok_or_else(|| format!("{field} is missing or outside 0..=100"))
}

fn push_unique(items: &mut Vec<String>, value: String) {
    if !value.trim().is_empty() && !items.contains(&value) {
        items.push(value);
    }
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(u128::from(u64::MAX)) as u64)
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn root(name: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "crewclaw-insights-{name}-{}-{}",
            std::process::id(),
            now_millis()
        ));
        fs::create_dir(&root).expect("root");
        root
    }

    fn real_eval(score: u32) -> Value {
        serde_json::json!({
            "agent_id":"whale",
            "score":score,
            "verdict": if score >= 80 { "PASS" } else { "FAIL" },
            "pass_threshold":0.8,
            "model":"judge/model",
            "worker_model":"worker/model",
            "judge_model":"judge/model",
            "graded_by":"model",
            "mock":false,
            "evaluated_at":1_700_000_000_000_u64,
            "spec_hash":"a".repeat(64),
            "subject_hash":"b".repeat(64),
            "execution_context_hash":"c".repeat(64),
            "per_test":[{"id":"smoke-1","score":score,"passed":score >= 80}]
        })
    }

    fn write_json(root: &Path, relative: impl AsRef<Path>, value: &Value) {
        crate::state_store::write_atomic(
            root,
            relative,
            serde_json::to_string(value).expect("json").as_bytes(),
        )
        .expect("state write");
    }

    #[test]
    fn missing_state_is_honest_and_refresh_observes_new_eval() {
        let root = root("refresh");
        let empty = load(&root, "whale");
        assert!(empty.eval.is_none());
        assert!(!empty.dream.has_review_data());

        write_json(&root, "eval/whale.json", &real_eval(80));
        let first = load(&root, "whale");
        assert_eq!(first.eval.as_ref().map(|eval| eval.score), Some(80));
        assert!(!first.eval.as_ref().expect("eval").mock);
        assert!(
            !first.eval.as_ref().expect("eval").certified,
            "a structurally plausible disk record is still awaiting Node contract verification"
        );

        write_json(&root, "eval/whale.json", &real_eval(90));
        let refreshed = load(&root, "whale");
        assert_eq!(refreshed.eval.as_ref().map(|eval| eval.score), Some(90));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn mock_eval_is_loaded_with_non_certification_provenance() {
        let root = root("mock");
        let value = serde_json::json!({
            "agent_id":"whale","score":100,"verdict":"PASS","pass_threshold":0.8,
            "model":"mock","graded_by":"mechanical","mock":true,"evaluated_at":123,
            "per_test":[{"id":"smoke","score":100,"passed":true}]
        });
        write_json(&root, "eval/whale.json", &value);
        let loaded = load(&root, "whale");
        let report = loaded.eval.expect("eval");
        assert!(report.mock);
        assert!(!report.certified);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn task_runs_and_committed_memory_drive_dream_and_monthly_metrics() {
        let root = root("dream");
        write_json(
            &root,
            "runs/task_one.json",
            &serde_json::json!({
                "id":"task_one","employee_id":"whale","user_goal":"调研模型",
                "status":"accepted","updated_at":"2026-07-10T00:00:00Z",
                "dream":{"candidates":2,"confidence":"high"},
                "memory_commit":{"committed":true,"candidates":[
                    {"category":"verified_sops","text":"先核验官方来源"},
                    {"category":"failure_paths","text":"无 key 时先预检"}
                ]}
            }),
        );
        write_json(
            &root,
            "runs/task_two.json",
            &serde_json::json!({
                "id":"task_two","employee_id":"whale","user_goal":"生成报告",
                "status":"revision_needed","updated_at":"2026-07-11T00:00:00Z"
            }),
        );
        write_json(
            &root,
            "memory/whale.json",
            &serde_json::json!([
                {"category":"project_facts","text":"客户要求双格式","confidence":"high","savedAt":"2026-07-10T01:00:00Z"}
            ]),
        );
        let loaded = load(&root, "whale");
        assert_eq!(loaded.dream.run_count, 2);
        assert_eq!(loaded.dream.accepted_count, 1);
        assert_eq!(loaded.dream.revision_count, 1);
        assert_eq!(loaded.dream.dream_candidates, 2);
        assert!(
            loaded
                .dream
                .worked
                .iter()
                .any(|item| item.contains("调研模型"))
        );
        assert!(
            loaded
                .dream
                .failed
                .iter()
                .any(|item| item.contains("生成报告"))
        );
        assert!(
            loaded
                .dream
                .playbook_add
                .iter()
                .any(|item| item.contains("官方来源"))
        );
        assert!(
            loaded
                .dream
                .knowledge
                .iter()
                .any(|item| item.contains("客户要求"))
        );
        assert_eq!(loaded.monthly.len(), 1);
        assert_eq!(loaded.monthly[0].tasks, 2);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn forged_or_hardlinked_eval_never_becomes_a_score() {
        let root = root("unsafe");
        let mut forged = real_eval(90);
        forged["score"] = Value::from(100);
        write_json(&root, "eval/whale.json", &forged);
        let rejected = load(&root, "whale");
        assert!(rejected.eval.is_none());
        assert!(
            rejected
                .errors
                .iter()
                .any(|error| error.starts_with("eval:"))
        );

        let state_file = root.join(".crewclaw/eval/whale.json");
        let alias = root.join(".crewclaw/eval/alias.json");
        fs::hard_link(&state_file, &alias).expect("hardlink");
        let linked = load(&root, "whale");
        assert!(linked.eval.is_none());
        assert!(linked.errors.iter().any(|error| error.starts_with("eval:")));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn oversized_run_is_rejected_by_the_one_mib_file_budget() {
        let root = root("oversized-run");
        let runs = root.join(".crewclaw/runs");
        fs::create_dir_all(&runs).expect("runs");
        fs::write(
            runs.join("task_oversized.json"),
            vec![b'x'; MAX_INSIGHT_FILE_BYTES as usize + 1],
        )
        .expect("oversized run");

        let loaded = load(&root, "whale");
        assert_eq!(loaded.dream.run_count, 0);
        assert!(
            loaded
                .errors
                .iter()
                .any(|error| { error.starts_with("runs:") && error.contains("per-file budget") })
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn aggregate_run_reads_stop_at_the_sixteen_mib_budget() {
        let root = root("aggregate-budget");
        let runs = root.join(".crewclaw/runs");
        fs::create_dir_all(&runs).expect("runs");
        let padding = vec![b'x'; 1_000_000];
        for index in 0..17 {
            let id = format!("task_budget_{index:02}");
            let mut bytes =
                format!(r#"{{"id":"{id}","employee_id":"whale","padding":""#).into_bytes();
            bytes.extend_from_slice(&padding);
            bytes.extend_from_slice(br#""}"#);
            assert!(bytes.len() as u64 <= MAX_INSIGHT_FILE_BYTES);
            fs::write(runs.join(format!("{id}.json")), bytes).expect("budget run");
        }

        let loaded = load(&root, "whale");
        assert_eq!(
            loaded.dream.run_count, 0,
            "partial aggregate data is not published after the budget is exceeded"
        );
        assert!(loaded.errors.iter().any(|error| {
            error.starts_with("runs:") && error.contains("aggregate read budget")
        }));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn run_file_count_is_bounded_to_the_most_recent_sixty_four() {
        let root = root("file-budget");
        let runs = root.join(".crewclaw/runs");
        fs::create_dir_all(&runs).expect("runs");
        for index in 0..=MAX_RUN_FILES {
            let id = format!("task_count_{index:02}");
            fs::write(
                runs.join(format!("{id}.json")),
                format!(r#"{{"id":"{id}","employee_id":"whale"}}"#),
            )
            .expect("counted run");
        }

        let loaded = load(&root, "whale");
        assert!(
            loaded
                .errors
                .iter()
                .any(|error| { error.starts_with("runs:") && error.contains("read limit of 64") })
        );
        assert!(loaded.dream.run_count <= MAX_RUN_FILES as u64);
        let _ = fs::remove_dir_all(root);
    }
}
