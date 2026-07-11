use std::fs;

const TRUNCATED_ARTIFACT_PREVIEW: &str = "… (truncated, open the file to read all)";

/// 测试专用辅助函数（仅 `mod tests` 调用，不进 release 二进制——避免 `cargo build` 误报死代码）。
#[cfg(test)]
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

pub(crate) fn read_artifact_preview(
    path: &str,
    max_lines: usize,
    max_chars: usize,
) -> Result<String, String> {
    let content = fs::read_to_string(path).map_err(|err| err.to_string())?;
    let mut out = String::new();
    let mut chars = 0usize;
    let mut truncated = false;

    for (index, line) in content.lines().enumerate() {
        if index >= max_lines {
            truncated = true;
            break;
        }
        if index > 0 {
            out.push('\n');
            chars += 1;
        }
        for ch in line.chars() {
            if chars >= max_chars {
                truncated = true;
                break;
            }
            out.push(ch);
            chars += 1;
        }
        if truncated {
            break;
        }
    }

    if !truncated
        && content.ends_with('\n')
        && chars < max_chars
        && content.lines().count() < max_lines
    {
        out.push('\n');
    }

    if truncated {
        if !out.is_empty() {
            out.push('\n');
        }
        out.push_str(TRUNCATED_ARTIFACT_PREVIEW);
    }

    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compact_markdown_summary_removes_common_markup() {
        assert_eq!(
            compact_markdown_summary("# **ROI** `draft`", 20),
            "ROI draft"
        );
    }

    #[test]
    fn read_artifact_preview_caps_file_contents() {
        let path = std::env::temp_dir().join(format!(
            "crewclaw-preview-helper-{}-caps.md",
            std::process::id()
        ));
        std::fs::write(&path, "first\nsecond\nthird").expect("write temp artifact");

        let preview =
            read_artifact_preview(&path.to_string_lossy(), 2, 100).expect("read artifact preview");

        assert_eq!(
            preview,
            "first\nsecond\n… (truncated, open the file to read all)"
        );

        let _ = std::fs::remove_file(path);
    }
}
