pub(crate) fn compact_markdown_summary(text: &str, max_chars: usize) -> String {
    let plain = text
        .chars()
        .map(|ch| match ch {
            '#' | '*' | '`' | '|' | '>' => ' ',
            _ => ch,
        })
        .collect::<String>();
    let normalized = plain.split_whitespace().collect::<Vec<_>>().join(" ");
    let mut summary: String = normalized.chars().take(max_chars).collect();
    if normalized.chars().count() > max_chars {
        summary.push_str("...");
    }
    summary
}
