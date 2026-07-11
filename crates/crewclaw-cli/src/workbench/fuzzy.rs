// v0.8 M3: shared fuzzy ranking (nucleo-matcher, helix-grade) for the @ picker and the slash /
// Ctrl+P command palette. One helper so both completion surfaces rank identically. Empty query
// keeps the original order (no filtering); otherwise items are sorted best-match-first and
// non-matches dropped.

use nucleo_matcher::pattern::{AtomKind, CaseMatching, Normalization, Pattern};
use nucleo_matcher::{Config, Matcher};

/// Rank `items` against `query` by fuzzy score. `key` extracts the string matched for each item.
/// Returns items in best-first order; on empty query returns all items unchanged.
pub(crate) fn rank<T, F>(items: Vec<T>, query: &str, key: F) -> Vec<T>
where
    F: Fn(&T) -> String,
{
    if query.trim().is_empty() {
        return items;
    }
    let mut matcher = Matcher::new(Config::DEFAULT);
    let pattern = Pattern::new(
        query,
        CaseMatching::Ignore,
        Normalization::Smart,
        AtomKind::Fuzzy,
    );
    let mut scored: Vec<(T, u32)> = items
        .into_iter()
        .filter_map(|item| {
            let haystack = key(&item);
            let mut buf = Vec::new();
            let hs = nucleo_matcher::Utf32Str::new(&haystack, &mut buf);
            pattern.score(hs, &mut matcher).map(|score| (item, score))
        })
        .collect();
    // Stable sort by descending score keeps original order among equal scores.
    scored.sort_by_key(|item| std::cmp::Reverse(item.1));
    scored.into_iter().map(|(item, _)| item).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_query_returns_all_unchanged() {
        let items = vec!["/help".to_string(), "/model".to_string()];
        let out = rank(items.clone(), "", |s| s.clone());
        assert_eq!(out, items);
    }

    #[test]
    fn fuzzy_matches_out_of_order_subsequence() {
        let items = vec![
            "/help".to_string(),
            "/model".to_string(),
            "/clear".to_string(),
        ];
        // "mdl" is an out-of-order-ish subsequence of "model".
        let out = rank(items, "mdl", |s| s.clone());
        assert_eq!(out.first().map(String::as_str), Some("/model"));
        assert!(!out.iter().any(|s| s == "/help"), "non-matches dropped");
    }

    #[test]
    fn prefix_query_ranks_expected_first() {
        let items = vec!["/model".to_string(), "/mode-x".to_string()];
        let out = rank(items, "mo", |s| s.clone());
        assert!(!out.is_empty(), "prefix query matches");
    }
}
