// Streaming markdown printer — extracted from run.mjs so the caret/line-buffer
// logic is unit-testable (the streaming-disappear bug lived here and couldn't be
// reproduced without a TTY). Line-buffered: completed lines are rendered via the
// injected renderMdLine + emitted; the in-progress (not-yet-newlined) line shows a
// dim ● caret. A line that would wrap past one row is shown TRUNCATED (head + …)
// rather than cleared — so streaming text never vanishes mid-line.
//
// Deps are injected for testing: { out, isTTY, renderMdLine, renderTable,
// isTableRow, visibleLen, GUTTER }. In production run.mjs passes its real ones.
export function createMdPrinter(render, deps = {}) {
  const out = deps.out || process.stdout;
  const isTTY = deps.isTTY ?? !!out.isTTY;
  const renderMdLine = deps.renderMdLine;
  const renderTable = deps.renderTable;
  const isTableRow = deps.isTableRow;
  const visibleLen = deps.visibleLen;
  const GUTTER = deps.GUTTER ?? "   ";
  const cols = () => out.columns || 80;

  let buf = "";
  const state = { inFence: false, fenceLang: "", table: [] };
  const caretOn = render && (isTTY || process.env.CREW_FORCE_CARET === "1");
  let partialShown = false;

  const clearPartial = () => {
    if (partialShown) {
      out.write("\r\x1b[K");
      partialShown = false;
    }
  };
  const flushTable = () => {
    if (state.table.length) {
      out.write(renderTable(state.table, { color: true }) + "\n");
      state.table = [];
    }
  };
  const emit = (line) => {
    // buffer consecutive markdown table rows, then render the whole table aligned
    if (!state.inFence && isTableRow(line)) {
      // A streamed first row can leave a caret on screen: the partial "| a" had a single
      // pipe so it wasn't yet a table row and got a caret. Clear it before holding the row,
      // else flushTable() writes the aligned table INTO that stale caret row (garbled).
      // This clear is the table-build pause — prose still overwrites in place, no flash.
      clearPartial();
      state.table.push(line);
      return;
    }
    flushTable();
    const rows = renderMdLine(line, state);
    if (partialShown) {
      // Overwrite the caret row IN PLACE — no \x1b[K blank flash before the rendered
      // line (that blank was the "streams out → disappears → reappears" flicker). \r
      // returns to col 0, the rendered first row overwrites the raw caret, \x1b[K clears
      // the leftover (the ● / longer raw text), and extra wrapped rows flow below.
      out.write("\r" + rows[0] + "\x1b[K" + (rows.length > 1 ? "\n" + rows.slice(1).join("\n") : "") + "\n");
      partialShown = false;
    } else {
      out.write(rows.join("\n") + "\n");
    }
  };
  // Truncate raw text to a display width (ANSI-free, CJK-aware) for the caret line.
  const truncToWidth = (s, max) => {
    let w = 0, o = "";
    for (const ch of s) {
      const cw = visibleLen(ch);
      if (w + cw > max) break;
      w += cw;
      o += ch;
    }
    return o;
  };
  const showPartial = () => {
    if (!caretOn) return;
    if (!buf.length || state.inFence || isTableRow(buf)) return clearPartial();
    let text = GUTTER + buf;
    // A line that would wrap onto >1 row used to be cleared — it VANISHED mid-stream
    // until the \n arrived. Show a truncated single-row preview (head + …) instead;
    // the full wrapped line is re-emitted on the newline.
    if (visibleLen(text) + 2 > cols()) text = truncToWidth(text, cols() - 4) + "…";
    // \r overwrite (NO leading \x1b[K) so the growing line never blanks frame-to-frame;
    // the trailing \x1b[K clears any leftover. emit() later overwrites this same row.
    out.write("\r" + text + " \x1b[2m●\x1b[0m\x1b[K");
    partialShown = true;
  };

  return {
    push(delta) {
      if (!render) { out.write(delta); return; }
      buf += delta;
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        emit(buf.slice(0, nl)); // emit overwrites the caret row in place (no blank flash)
        buf = buf.slice(nl + 1);
      }
      showPartial();
    },
    end() {
      if (render && buf.length) emit(buf); // overwrites the caret row in place
      else clearPartial();                  // no trailing line → just clear the caret
      flushTable();
      buf = "";
    },
  };
}
