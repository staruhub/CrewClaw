#[derive(Default)]
pub(crate) struct InputBuffer {
    text: String,
    cursor: usize,
    history: Vec<String>,
    history_cursor: Option<usize>,
    history_draft: Option<String>,
}

impl InputBuffer {
    pub(crate) fn as_str(&self) -> &str {
        &self.text
    }

    pub(crate) fn cursor(&self) -> usize {
        self.cursor
    }

    pub(crate) fn clear(&mut self) {
        self.text.clear();
        self.cursor = 0;
        self.clear_history_navigation();
    }

    pub(crate) fn is_empty(&self) -> bool {
        self.text.is_empty()
    }

    pub(crate) fn insert_char(&mut self, ch: char) {
        self.clear_history_navigation();
        self.text.insert(self.cursor, ch);
        self.cursor += ch.len_utf8();
    }

    pub(crate) fn insert_str(&mut self, text: &str) {
        self.clear_history_navigation();
        self.text.insert_str(self.cursor, text);
        self.cursor += text.len();
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
        self.clear_history_navigation();
        self.text.replace_range(at..self.cursor, token);
        self.cursor = at + token.len();
        true
    }

    pub(crate) fn backspace(&mut self) {
        if self.cursor == 0 {
            return;
        }
        self.clear_history_navigation();
        let previous = self.previous_boundary();
        self.text.replace_range(previous..self.cursor, "");
        self.cursor = previous;
    }

    pub(crate) fn delete(&mut self) {
        if self.cursor >= self.text.len() {
            return;
        }
        self.clear_history_navigation();
        let next = self.next_boundary();
        self.text.replace_range(self.cursor..next, "");
    }

    pub(crate) fn move_left(&mut self) {
        self.cursor = self.previous_boundary();
    }

    pub(crate) fn move_right(&mut self) {
        self.cursor = self.next_boundary();
    }

    pub(crate) fn move_home(&mut self) {
        self.cursor = 0;
    }

    pub(crate) fn move_end(&mut self) {
        self.cursor = self.text.len();
    }

    pub(crate) fn take(&mut self) -> String {
        let submitted = std::mem::take(&mut self.text);
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
}
