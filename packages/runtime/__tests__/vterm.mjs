import { visibleLen } from "../ui.mjs";

const CSI_RE = /^\x1b\[([0-?]*)([ -/]*)([@-~])/;

export class VTerm {
  constructor({ rows = 30, cols = 80 } = {}) {
    this.rows = rows;
    this.cols = cols;
    this.row = 0;
    this.col = 0;
    this.grid = Array.from({ length: rows }, () => this.#blankRow());
    this.history = [];
    this.writeCount = 0;
  }

  #blankRow() {
    return Array.from({ length: this.cols }, () => ({ ch: " ", cont: false }));
  }

  #scrollIfNeeded() {
    while (this.row >= this.rows) {
      this.grid.shift();
      this.grid.push(this.#blankRow());
      this.row--;
    }
  }

  #lineFeed() {
    this.row++;
    this.col = 0;
    this.#scrollIfNeeded();
  }

  #eraseToEol() {
    for (let c = this.col; c < this.cols; c++) this.grid[this.row][c] = { ch: " ", cont: false };
  }

  #eraseWholeRow() {
    this.grid[this.row] = this.#blankRow();
  }

  #putChar(ch) {
    const w = Math.max(0, visibleLen(ch));
    if (w === 0) return;
    if (w > this.cols) return;
    if (this.col + w > this.cols) this.#lineFeed();
    this.grid[this.row][this.col] = { ch, cont: false };
    for (let i = 1; i < w && this.col + i < this.cols; i++) {
      this.grid[this.row][this.col + i] = { ch: "", cont: true };
    }
    this.col += w;
    if (this.col >= this.cols) this.#lineFeed();
  }

  #handleCsi(params, final) {
    if (final === "m") return;
    if (final !== "K") return;
    const mode = params === "" ? "0" : params;
    if (mode === "2") this.#eraseWholeRow();
    else this.#eraseToEol();
  }

  write(s, meta = {}) {
    const input = String(s);
    for (let i = 0; i < input.length;) {
      const rest = input.slice(i);
      const csi = rest.match(CSI_RE);
      if (csi) {
        this.#handleCsi(csi[1], csi[3]);
        i += csi[0].length;
        continue;
      }

      const ch = input[i];
      if (ch === "\x1b") {
        i++;
        continue;
      }
      if (ch === "\r") {
        this.col = 0;
        i++;
        continue;
      }
      if (ch === "\n") {
        this.#lineFeed();
        i++;
        continue;
      }

      const cp = input.codePointAt(i);
      const text = String.fromCodePoint(cp);
      this.#putChar(text);
      i += text.length;
    }

    const entry = {
      index: this.writeCount++,
      write: input,
      cursor: { row: this.row, col: this.col },
      deltaIndex: meta.deltaIndex,
      delta: meta.delta,
      snapshot: this.snapshot(),
    };
    this.history.push(entry);
    return true;
  }

  snapshot() {
    return this.grid.map((row) => row.map((cell) => cell.cont ? "" : cell.ch).join("").trimEnd());
  }
}
