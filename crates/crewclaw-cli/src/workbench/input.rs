use std::{io, path::PathBuf};

use serde::{Deserialize, Serialize};
use unicode_width::{UnicodeWidthChar, UnicodeWidthStr};

const HISTORY_LIMIT: usize = 50;

/// v0.8 M6：大段粘贴折叠的阈值——达到任一即折叠为占位块。
const PASTE_FOLD_MIN_LINES: usize = 3;
const PASTE_FOLD_MIN_CHARS: usize = 150;

/// v0.8 M6：占位块类型。PastedText 提交时展开回 text（协议不动）；FilePart 走 parts 通道，
/// 占位符保留在 text（降级可读），同时产出一个 file part 交给引擎读取。
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum SpanKind {
    PastedText,
    FilePart,
}

/// v0.8 M6：输入框里的原子占位块（opencode extmark 等价物）。`range` 是占位符在 `text` 中的
/// byte range；`original` 是折叠前的完整文本，提交时按 range 倒序展开回去。
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct InputSpan {
    start: usize,
    end: usize,
    kind: SpanKind,
    original: String,
}

#[derive(Default)]
pub(crate) struct InputBuffer {
    text: String,
    cursor: usize,
    /// 按 start 升序、互不重叠。所有变更操作后维持该不变式。
    spans: Vec<InputSpan>,
    history: Vec<String>,
    history_cursor: Option<usize>,
    history_draft: Option<String>,
    history_path: Option<PathBuf>,
}

#[derive(Deserialize, Serialize)]
struct HistoryRecord {
    text: String,
    #[serde(default)]
    parts: Vec<serde_json::Value>,
}

impl InputBuffer {
    pub(crate) fn with_history_path(path: PathBuf) -> Self {
        let mut input = Self {
            history_path: Some(path),
            ..Self::default()
        };
        let _ = input.load_history();
        input
    }

    pub(crate) fn as_str(&self) -> &str {
        &self.text
    }

    pub(crate) fn cursor(&self) -> usize {
        self.cursor
    }

    /// v0.8 M6：占位块的 byte 区间（升序），供渲染层给占位符上色。
    pub(crate) fn span_ranges(&self) -> Vec<(usize, usize)> {
        self.spans.iter().map(|s| (s.start, s.end)).collect()
    }

    /// v0.8 M6：是否含占位块（渲染层决定是否走分段上色路径；目前测试断言用）。
    #[allow(dead_code)]
    pub(crate) fn has_spans(&self) -> bool {
        !self.spans.is_empty()
    }

    pub(crate) fn clear(&mut self) {
        self.text.clear();
        self.cursor = 0;
        self.spans.clear();
        self.clear_history_navigation();
    }

    pub(crate) fn is_empty(&self) -> bool {
        self.text.is_empty()
    }

    /// v0.8 M6：唯一的文本变更原语。删除 byte 范围 `[a,b)` 并在 `a` 处插入 `s`，同时维护占位块：
    /// - 编辑范围与某占位块 byte 区间**真重叠**（`a < end && b > start`）→ 整块原子吞掉（连同 payload）；
    /// - 纯边界插入（`a==b` 落在块 start/end）不触发吞除；
    /// - 编辑点之后的块按 delta 平移。
    ///
    /// 返回吞除扩张后的实际左边界，供调用方定位光标。
    fn edit(&mut self, mut a: usize, mut b: usize, s: &str) -> usize {
        self.clear_history_navigation();
        // 反复扩张 [a,b) 直到不再有块与之真重叠（处理连续块的级联吞除）。
        loop {
            let mut grew = false;
            let mut i = 0;
            while i < self.spans.len() {
                let span = &self.spans[i];
                let overlaps = a < span.end && b > span.start;
                if overlaps {
                    a = a.min(span.start);
                    b = b.max(span.end);
                    self.spans.remove(i);
                    grew = true;
                } else {
                    i += 1;
                }
            }
            if !grew {
                break;
            }
        }
        self.text.replace_range(a..b, s);
        let removed = b - a;
        let delta = s.len() as isize - removed as isize;
        if delta != 0 {
            for span in &mut self.spans {
                // 编辑点在块之前（块 start >= 被删范围右端）→ 整块平移。
                if span.start >= b {
                    span.start = (span.start as isize + delta) as usize;
                    span.end = (span.end as isize + delta) as usize;
                }
            }
        }
        a
    }

    fn insert_span_sorted(&mut self, span: InputSpan) {
        let pos = self
            .spans
            .iter()
            .position(|existing| existing.start > span.start)
            .unwrap_or(self.spans.len());
        self.spans.insert(pos, span);
    }

    /// 严格落在某占位块内部（`start < pos < end`）的块——光标不允许停在此处。
    fn strict_span_at(&self, pos: usize) -> Option<&InputSpan> {
        self.spans
            .iter()
            .find(|span| span.start < pos && pos < span.end)
    }

    pub(crate) fn insert_char(&mut self, ch: char) {
        let mut buf = [0u8; 4];
        let encoded = ch.encode_utf8(&mut buf);
        let left = self.edit(self.cursor, self.cursor, encoded);
        self.cursor = left + ch.len_utf8();
    }

    pub(crate) fn insert_str(&mut self, text: &str) {
        let left = self.edit(self.cursor, self.cursor, text);
        self.cursor = left + text.len();
    }

    /// v0.8 M6：粘贴入口。CRLF/CR → LF 归一化；≥3 行或 >150 字符折叠为原子占位块（AC-PST-001/004），
    /// 否则原样插入。折叠块的原文留在 span.original，提交时展开。
    pub(crate) fn insert_paste(&mut self, raw: &str) {
        let normalized = raw.replace("\r\n", "\n").replace('\r', "\n");
        if normalized.is_empty() {
            return;
        }
        // v0.8 M6：单一存在的文件路径 → FilePart 附件占位（读取留给引擎）。
        if let Some(path) = single_existing_file_path(&normalized) {
            let name = std::path::Path::new(&path)
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_else(|| path.clone());
            let placeholder = format!("[File: {name}]");
            let start = self.edit(self.cursor, self.cursor, &placeholder);
            let end = start + placeholder.len();
            self.insert_span_sorted(InputSpan {
                start,
                end,
                kind: SpanKind::FilePart,
                original: path,
            });
            self.cursor = end;
            return;
        }
        let line_count = normalized.split('\n').count();
        let char_count = normalized.chars().count();
        let should_fold = line_count >= PASTE_FOLD_MIN_LINES || char_count >= PASTE_FOLD_MIN_CHARS;
        if !should_fold {
            self.insert_str(&normalized);
            return;
        }
        let placeholder = if line_count >= PASTE_FOLD_MIN_LINES {
            format!("[Pasted ~{line_count} lines]")
        } else {
            format!("[Pasted ~{char_count} chars]")
        };
        let start = self.edit(self.cursor, self.cursor, &placeholder);
        let end = start + placeholder.len();
        self.insert_span_sorted(InputSpan {
            start,
            end,
            kind: SpanKind::PastedText,
            original: normalized,
        });
        self.cursor = end;
    }

    pub(crate) fn active_reference_query(&self) -> Option<String> {
        let prefix = &self.text[..self.cursor];
        let at = prefix.rfind('@')?;
        let query = &prefix[at + 1..];
        if query
            .chars()
            .any(|ch| ch.is_whitespace() || matches!(ch, ',' | ';' | ')' | '('))
        {
            return None;
        }
        Some(query.to_string())
    }

    pub(crate) fn replace_active_reference(&mut self, token: &str) -> bool {
        let prefix = &self.text[..self.cursor];
        let Some(at) = prefix.rfind('@') else {
            return false;
        };
        let query = &prefix[at + 1..];
        if query
            .chars()
            .any(|ch| ch.is_whitespace() || matches!(ch, ',' | ';' | ')' | '('))
        {
            return false;
        }
        let left = self.edit(at, self.cursor, token);
        self.cursor = left + token.len();
        true
    }

    /// v0.8 M3：把行首正在输入的 `/部分命令名` 补全为 `<命令> `（尾随空格便于接参数），光标置于
    /// 空格之后。`name` 是完整命令（含前导 `/`，如 `/model`）。仅当缓冲区以 `/` 开头时替换。
    pub(crate) fn replace_slash_command(&mut self, name: &str) -> bool {
        if !self.text.starts_with('/') {
            return false;
        }
        let rest = &self.text[1..];
        // 命令名段 = `/` 之后到首个空白之前；连同前导 `/` 一起被完整命令替换。
        let name_len = rest.find(char::is_whitespace).unwrap_or(rest.len());
        let end = 1 + name_len;
        let replacement = format!("{name} ");
        let left = self.edit(0, end, &replacement);
        self.cursor = left + replacement.len();
        true
    }

    pub(crate) fn backspace(&mut self) {
        if self.cursor == 0 {
            return;
        }
        // 若光标正好贴在某占位块右边界 → 删整块（edit 的重叠判定会吞除）。
        let previous = self.previous_boundary();
        self.cursor = self.edit(previous, self.cursor, "");
    }

    pub(crate) fn delete(&mut self) {
        if self.cursor >= self.text.len() {
            return;
        }
        let next = self.next_boundary();
        self.cursor = self.edit(self.cursor, next, "");
    }

    pub(crate) fn move_left(&mut self) {
        let target = self.previous_boundary();
        // 落进占位块内部则跳到块左边界（光标不停在块内）。
        self.cursor = match self.strict_span_at(target) {
            Some(span) => span.start,
            None => target,
        };
    }

    pub(crate) fn move_right(&mut self) {
        let target = self.next_boundary();
        self.cursor = match self.strict_span_at(target) {
            Some(span) => span.end,
            None => target,
        };
    }

    pub(crate) fn move_home(&mut self) {
        self.cursor = 0;
    }

    pub(crate) fn move_end(&mut self) {
        self.cursor = self.text.len();
    }

    pub(crate) fn move_line_start(&mut self) {
        self.cursor = self.line_start();
    }

    pub(crate) fn move_line_end(&mut self) {
        self.cursor = self.line_end();
    }

    pub(crate) fn move_word_left(&mut self) {
        self.cursor = self.previous_word_start();
    }

    pub(crate) fn move_word_right(&mut self) {
        self.cursor = self.next_word_end();
    }

    pub(crate) fn move_line_up(&mut self) -> bool {
        let (line_start, _) = self.line_bounds();
        if line_start == 0 {
            return false;
        }
        let target_col = self.current_display_column();
        let previous_end = line_start - 1;
        let previous_start = self.text[..previous_end]
            .rfind('\n')
            .map(|index| index + 1)
            .unwrap_or(0);
        self.cursor =
            byte_index_for_display_column(&self.text, previous_start, previous_end, target_col);
        true
    }

    pub(crate) fn move_line_down(&mut self) -> bool {
        let (_, line_end) = self.line_bounds();
        if line_end >= self.text.len() {
            return false;
        }
        let target_col = self.current_display_column();
        let next_start = line_end + 1;
        let next_end = self.text[next_start..]
            .find('\n')
            .map(|index| next_start + index)
            .unwrap_or(self.text.len());
        self.cursor = byte_index_for_display_column(&self.text, next_start, next_end, target_col);
        true
    }

    pub(crate) fn cursor_at_first_line_start(&self) -> bool {
        self.cursor == 0
    }

    pub(crate) fn cursor_at_end(&self) -> bool {
        self.cursor == self.text.len()
    }

    pub(crate) fn delete_to_line_start(&mut self) {
        let start = self.line_start();
        if start == self.cursor {
            return;
        }
        self.cursor = self.edit(start, self.cursor, "");
    }

    pub(crate) fn delete_to_line_end(&mut self) {
        let end = self.line_end();
        if end == self.cursor {
            return;
        }
        self.edit(self.cursor, end, "");
    }

    pub(crate) fn delete_word_before(&mut self) {
        let start = self.previous_word_start();
        if start == self.cursor {
            return;
        }
        self.cursor = self.edit(start, self.cursor, "");
    }

    /// v0.8 M6：占位块展开后的完整提交文本。按 range 倒序把 **PastedText** 占位符替换回 original，
    /// 使引擎收到的是原始多行内容（AC-PST-001）。FilePart 保留占位符（`[File: name]`）作为降级可读文本，
    /// 其内容通过 parts 通道让引擎读取。
    fn expanded_text(&self) -> String {
        let mut out = self.text.clone();
        let mut spans: Vec<&InputSpan> = self.spans.iter().collect();
        spans.sort_by_key(|span| std::cmp::Reverse(span.start));
        for span in spans {
            if span.kind == SpanKind::PastedText && span.end <= out.len() {
                out.replace_range(span.start..span.end, &span.original);
            }
        }
        out
    }

    /// v0.8 M6：FilePart 占位块对应的文件路径（original 存的是绝对路径），供构造 parts。
    pub(crate) fn file_parts(&self) -> Vec<String> {
        self.spans
            .iter()
            .filter(|s| s.kind == SpanKind::FilePart)
            .map(|s| s.original.clone())
            .collect()
    }

    pub(crate) fn take(&mut self) -> String {
        let submitted = self.expanded_text();
        self.text.clear();
        self.spans.clear();
        self.cursor = 0;
        self.clear_history_navigation();
        submitted
    }

    pub(crate) fn submit(&mut self) -> String {
        let submitted = self.take();
        if !submitted.trim().is_empty()
            && self.history.last().map(String::as_str) != Some(submitted.as_str())
        {
            self.history.push(submitted.clone());
            trim_history(&mut self.history);
            if let Ok(history) = self.save_history_submission(&submitted) {
                self.history = history;
            }
        }
        submitted
    }

    pub(crate) fn history_previous(&mut self) -> bool {
        if self.history.is_empty() {
            return false;
        }
        let next_index = match self.history_cursor {
            Some(0) => 0,
            Some(index) => index.saturating_sub(1),
            None => {
                self.history_draft = Some(self.text.clone());
                self.history.len() - 1
            }
        };
        self.set_from_history(next_index);
        true
    }

    pub(crate) fn history_next(&mut self) -> bool {
        let Some(index) = self.history_cursor else {
            return false;
        };
        if index + 1 < self.history.len() {
            self.set_from_history(index + 1);
        } else {
            let draft = self.history_draft.take().unwrap_or_default();
            self.set_text(draft);
            self.history_cursor = None;
        }
        true
    }

    fn set_from_history(&mut self, index: usize) {
        self.set_text(self.history[index].clone());
        self.history_cursor = Some(index);
    }

    fn set_text(&mut self, text: String) {
        // 历史回放是纯文本，清掉当前占位块避免陈旧 range 悬挂。
        self.spans.clear();
        self.cursor = text.len();
        self.text = text;
    }

    fn clear_history_navigation(&mut self) {
        self.history_cursor = None;
        self.history_draft = None;
    }

    fn previous_boundary(&self) -> usize {
        self.text[..self.cursor]
            .char_indices()
            .last()
            .map(|(index, _)| index)
            .unwrap_or(0)
    }

    fn next_boundary(&self) -> usize {
        self.text[self.cursor..]
            .char_indices()
            .nth(1)
            .map(|(index, _)| self.cursor + index)
            .unwrap_or(self.text.len())
    }

    fn line_start(&self) -> usize {
        self.text[..self.cursor]
            .rfind('\n')
            .map(|index| index + 1)
            .unwrap_or(0)
    }

    fn line_end(&self) -> usize {
        self.text[self.cursor..]
            .find('\n')
            .map(|index| self.cursor + index)
            .unwrap_or(self.text.len())
    }

    fn line_bounds(&self) -> (usize, usize) {
        (self.line_start(), self.line_end())
    }

    fn current_display_column(&self) -> usize {
        UnicodeWidthStr::width(&self.text[self.line_start()..self.cursor])
    }

    fn previous_word_start(&self) -> usize {
        let mut index = self.cursor;
        while index > 0 {
            let previous = previous_char_boundary(&self.text, index);
            let ch = self.text[previous..index]
                .chars()
                .next()
                .unwrap_or_default();
            if !ch.is_whitespace() {
                break;
            }
            index = previous;
        }
        while index > 0 {
            let previous = previous_char_boundary(&self.text, index);
            let ch = self.text[previous..index]
                .chars()
                .next()
                .unwrap_or_default();
            if ch.is_whitespace() {
                break;
            }
            index = previous;
        }
        index
    }

    fn next_word_end(&self) -> usize {
        let mut index = self.cursor;
        while index < self.text.len() {
            let next = next_char_boundary(&self.text, index);
            let ch = self.text[index..next].chars().next().unwrap_or_default();
            if !ch.is_whitespace() {
                break;
            }
            index = next;
        }
        while index < self.text.len() {
            let next = next_char_boundary(&self.text, index);
            let ch = self.text[index..next].chars().next().unwrap_or_default();
            if ch.is_whitespace() {
                break;
            }
            index = next;
        }
        index
    }

    fn load_history(&mut self) -> io::Result<()> {
        let Some(path) = &self.history_path else {
            return Ok(());
        };
        let root = history_root(path)?;
        let contents = match crate::state_store::read_string(root, "prompt-history.jsonl")? {
            Some(contents) => contents,
            None => return Ok(()),
        };
        self.history = parse_history(&contents);
        trim_history(&mut self.history);
        Ok(())
    }

    fn save_history_submission(&self, submitted: &str) -> io::Result<Vec<String>> {
        let Some(path) = &self.history_path else {
            return Ok(self.history.clone());
        };
        let root = history_root(path)?;
        let _lock = crate::state_store::acquire_owner_lock(root, "prompt-history.jsonl")?;
        let mut history = crate::state_store::read_string(root, "prompt-history.jsonl")?
            .map(|contents| parse_history(&contents))
            .unwrap_or_default();
        if history.last().map(String::as_str) != Some(submitted) {
            history.push(submitted.to_string());
        }
        trim_history(&mut history);
        let mut output = String::new();
        for text in &history {
            let record = HistoryRecord {
                text: text.clone(),
                parts: Vec::new(),
            };
            output.push_str(&serde_json::to_string(&record)?);
            output.push('\n');
        }
        crate::state_store::write_atomic(root, "prompt-history.jsonl", output.as_bytes())?;
        Ok(history)
    }
}

fn history_root(path: &std::path::Path) -> io::Result<&std::path::Path> {
    if path.file_name() != Some(std::ffi::OsStr::new("prompt-history.jsonl")) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "prompt history must use the canonical state filename",
        ));
    }
    let state_dir = path.parent().ok_or_else(|| {
        io::Error::new(io::ErrorKind::InvalidInput, "prompt history has no parent")
    })?;
    if state_dir.file_name() != Some(std::ffi::OsStr::new(".crewclaw")) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "prompt history must be stored below .crewclaw",
        ));
    }
    state_dir.parent().ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::InvalidInput,
            "prompt history has no workspace root",
        )
    })
}

fn parse_history(contents: &str) -> Vec<String> {
    contents
        .lines()
        .filter_map(|line| serde_json::from_str::<HistoryRecord>(line).ok())
        .map(|record| record.text)
        .filter(|text| !text.trim().is_empty())
        .collect()
}

fn trim_history(history: &mut Vec<String>) {
    if history.len() > HISTORY_LIMIT {
        history.drain(0..history.len() - HISTORY_LIMIT);
    }
}

fn byte_index_for_display_column(text: &str, start: usize, end: usize, target_col: usize) -> usize {
    let mut width = 0usize;
    for (offset, ch) in text[start..end].char_indices() {
        let ch_width = ch.width().unwrap_or(0);
        if width + ch_width > target_col {
            return start + offset;
        }
        width += ch_width;
    }
    end
}

/// v0.8 M6：粘贴文本若是单一存在的文件路径（strip 首尾引号、单行、fs 实测存在且非目录）→ 返回绝对
/// 路径字符串，否则 None。读取解码留给引擎（避免 Rust 再实现一遍图片/PDF 解析）。
fn single_existing_file_path(text: &str) -> Option<String> {
    let trimmed = text.trim();
    // 去掉成对引号。
    let unquoted = trimmed
        .strip_prefix('"')
        .and_then(|s| s.strip_suffix('"'))
        .or_else(|| {
            trimmed
                .strip_prefix('\'')
                .and_then(|s| s.strip_suffix('\''))
        })
        .unwrap_or(trimmed);
    if unquoted.is_empty() || unquoted.contains('\n') {
        return None;
    }
    match std::fs::metadata(unquoted) {
        Ok(meta) if meta.is_file() => Some(unquoted.to_string()),
        _ => None,
    }
}

fn previous_char_boundary(text: &str, index: usize) -> usize {
    text[..index]
        .char_indices()
        .last()
        .map(|(index, _)| index)
        .unwrap_or(0)
}

fn next_char_boundary(text: &str, index: usize) -> usize {
    text[index..]
        .char_indices()
        .nth(1)
        .map(|(offset, _)| index + offset)
        .unwrap_or(text.len())
}

#[cfg(test)]
mod span_tests {
    use super::*;

    /// 折叠所需的多行原文（≥3 行）。
    fn multiline() -> String {
        (1..=20)
            .map(|n| format!("line {n}"))
            .collect::<Vec<_>>()
            .join("\n")
    }

    #[test]
    fn paste_folds_multiline_into_placeholder_and_expands_on_submit() {
        // AC-PST-001：20 行粘贴 → 显示单个占位块；提交展开回 20 行。
        let mut b = InputBuffer::default();
        let src = multiline();
        b.insert_paste(&src);
        assert!(b.has_spans(), "multiline paste must fold");
        assert!(b.as_str().contains("[Pasted ~20 lines]"));
        assert_eq!(
            b.as_str().lines().count(),
            1,
            "display collapses to one line"
        );
        let submitted = b.take();
        assert_eq!(
            submitted, src,
            "submit expands placeholder back to original"
        );
        assert_eq!(submitted.lines().count(), 20);
    }

    #[test]
    fn short_paste_is_not_folded() {
        let mut b = InputBuffer::default();
        b.insert_paste("hi there");
        assert!(!b.has_spans());
        assert_eq!(b.as_str(), "hi there");
    }

    #[test]
    fn long_single_line_paste_folds_by_char_count() {
        let mut b = InputBuffer::default();
        let long = "x".repeat(200);
        b.insert_paste(&long);
        assert!(b.has_spans());
        assert!(b.as_str().contains("[Pasted ~200 chars]"));
        assert_eq!(b.take(), long);
    }

    #[test]
    fn crlf_normalized_on_paste() {
        // AC-PST-004：Windows CRLF 文本提交后无 \r。
        let mut b = InputBuffer::default();
        b.insert_paste("a\r\nb\r\nc\r\nd");
        let submitted = b.take();
        assert!(!submitted.contains('\r'));
        assert_eq!(submitted, "a\nb\nc\nd");
    }

    #[test]
    fn backspace_at_right_edge_removes_whole_span() {
        // AC-PST-002：占位块右边界 Backspace 整块消失，前后文本无损。
        let mut b = InputBuffer::default();
        b.insert_str("before ");
        b.insert_paste(&multiline());
        b.insert_str(" after");
        // 光标现在在 " after" 末尾；移动到占位块右边界。
        // 简化：直接把光标放到 span end。
        let (_, end) = b.span_ranges()[0];
        b.cursor = end;
        b.backspace();
        assert!(!b.has_spans(), "backspace at edge swallows span");
        assert_eq!(b.as_str(), "before  after");
        assert_eq!(b.take(), "before  after");
    }

    #[test]
    fn backspace_inside_span_removes_whole_span() {
        // 占位块内部任意位置 Backspace（通过把光标塞进块内模拟）也整块删。
        let mut b = InputBuffer::default();
        b.insert_str("x");
        b.insert_paste(&multiline());
        let (start, end) = b.span_ranges()[0];
        b.cursor = start + (end - start) / 2; // 块内部
        b.backspace();
        assert!(!b.has_spans());
        assert_eq!(b.as_str(), "x");
    }

    #[test]
    fn insert_before_span_shifts_range_and_expands_correctly() {
        // AC-PST-003：占位块前插入文字后提交，展开位置正确。
        let mut b = InputBuffer::default();
        b.insert_paste(&multiline());
        // 光标在块后；移到块前（位置 0）插入。
        b.cursor = 0;
        b.insert_str("PREFIX ");
        let (start, _) = b.span_ranges()[0];
        assert_eq!(start, "PREFIX ".len(), "span shifted right by prefix len");
        let submitted = b.take();
        assert!(submitted.starts_with("PREFIX line 1"));
        assert!(submitted.ends_with("line 20"));
    }

    #[test]
    fn insert_after_span_keeps_range() {
        let mut b = InputBuffer::default();
        b.insert_paste(&multiline());
        let before = b.span_ranges()[0];
        b.insert_str(" SUFFIX");
        assert_eq!(b.span_ranges()[0], before, "span range unchanged by append");
        let submitted = b.take();
        assert!(submitted.contains("line 20 SUFFIX"));
    }

    #[test]
    fn cursor_cannot_rest_inside_span_moving_left() {
        let mut b = InputBuffer::default();
        b.insert_paste(&multiline());
        let (start, end) = b.span_ranges()[0];
        b.cursor = end;
        b.move_left(); // 从右边界左移，应跳到左边界而非块内。
        assert_eq!(b.cursor, start);
    }

    #[test]
    fn cursor_cannot_rest_inside_span_moving_right() {
        let mut b = InputBuffer::default();
        b.insert_paste(&multiline());
        let (start, end) = b.span_ranges()[0];
        b.cursor = start;
        b.move_right(); // 从左边界右移，应跳到右边界。
        assert_eq!(b.cursor, end);
    }

    #[test]
    fn cjk_prefix_then_paste_expands_without_boundary_panic() {
        // CJK 用例矩阵：中文前缀 + 折叠块 + 中文后缀，展开无 byte-boundary 崩。
        let mut b = InputBuffer::default();
        b.insert_str("看这段代码：");
        b.insert_paste(&multiline());
        b.insert_str("——请优化");
        let submitted = b.take();
        assert!(submitted.starts_with("看这段代码：line 1"));
        assert!(submitted.ends_with("line 20——请优化"));
    }

    #[test]
    fn cjk_backspace_before_span_deletes_one_char_not_span() {
        let mut b = InputBuffer::default();
        b.insert_str("中文");
        b.insert_paste(&multiline());
        // 光标在块后；移动到块前（"中文" 之后 = span start）。
        let (start, _) = b.span_ranges()[0];
        b.cursor = start;
        b.backspace(); // 删掉 "文" 一个字，不碰块。
        assert!(b.has_spans(), "backspace before span must not swallow it");
        assert_eq!(b.as_str().chars().next(), Some('中'));
        let submitted = b.take();
        assert!(submitted.starts_with("中line 1"));
    }

    #[test]
    fn two_spans_independent_expand() {
        let mut b = InputBuffer::default();
        b.insert_paste(&multiline());
        b.insert_str(" MID ");
        b.insert_paste(&"y".repeat(160));
        assert_eq!(b.span_ranges().len(), 2);
        let submitted = b.take();
        assert!(submitted.contains("line 20 MID "));
        assert!(submitted.ends_with(&"y".repeat(160)));
    }

    #[test]
    fn clear_drops_spans() {
        let mut b = InputBuffer::default();
        b.insert_paste(&multiline());
        b.clear();
        assert!(!b.has_spans());
        assert_eq!(b.as_str(), "");
    }

    #[test]
    fn empty_paste_is_noop() {
        let mut b = InputBuffer::default();
        b.insert_paste("");
        b.insert_paste("\r\n"); // normalizes to "\n" — single line, short → inserted literally
        assert!(!b.has_spans());
    }

    #[test]
    fn pasting_existing_file_path_creates_file_part() {
        // AC-IMG-003 (Rust 侧)：粘贴带引号的存在文件路径 → FilePart 占位；file_parts() 返回该路径；
        // 提交文本保留降级可读占位符（引擎通过 parts 读取内容）。
        let dir = std::env::temp_dir().join(format!("crewclaw-paste-file-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("mkdir");
        let file = dir.join("report.md");
        std::fs::write(&file, "# hi").expect("write file");

        let mut b = InputBuffer::default();
        b.insert_str("看这个 ");
        // 带引号粘贴，模拟资源管理器复制路径。
        b.insert_paste(&format!("\"{}\"", file.display()));
        assert!(b.has_spans(), "existing file path folds into a FilePart");
        assert_eq!(b.file_parts(), vec![file.display().to_string()]);
        assert!(b.as_str().contains("[File: report.md]"));
        let submitted = b.take();
        // FilePart 占位符保留在降级文本，不展开成路径。
        assert!(submitted.contains("[File: report.md]"));
        assert!(submitted.starts_with("看这个 "));

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn pasting_nonexistent_path_is_plain_text() {
        let mut b = InputBuffer::default();
        b.insert_paste("C:\\definitely\\not\\here\\nope.md");
        assert!(!b.has_spans(), "nonexistent path is not an attachment");
        assert!(b.file_parts().is_empty());
    }
}
