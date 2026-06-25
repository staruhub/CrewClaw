// Local file / attachment ingestion: normalize → detect → extract → pack.
//
// Two problems this solves (both hit live): (1) cross-platform PATHS — a pasted
// Windows "C:\Users\…" must be read by Node fs natively, and a Git-Bash/WSL
// mount like "/c/Users/…" must convert back to a native path; (2) Office/PDF
// files are binary (zip+XML / PDF) and need real extraction, not `cat`.
//
// Extractors are mature pure-JS libs, lazy-imported so startup stays fast.
import { readFile } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { resolve, extname, basename, isAbsolute } from "node:path";

const MAX_CHARS = 200 * 1024;

const TEXT_EXT = new Set([
  ".txt", ".md", ".markdown", ".csv", ".tsv", ".json", ".yaml", ".yml", ".xml",
  ".html", ".htm", ".log", ".js", ".ts", ".jsx", ".tsx", ".mjs", ".cjs", ".py",
  ".rs", ".go", ".java", ".c", ".cc", ".cpp", ".h", ".hpp", ".sh", ".bash",
  ".rb", ".php", ".sql", ".toml", ".ini", ".env", ".conf", ".gradle", ".kt",
  ".swift", ".lua", ".r", ".dart", ".vue", ".svelte", ".css", ".scss",
]);
const IMG_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg", ".tiff"]);

// Strip surrounding quotes a paste adds.
function unquote(p) {
  let s = String(p ?? "").trim();
  if (s.length >= 2 && ((s[0] === '"' && s.endsWith('"')) || (s[0] === "'" && s.endsWith("'")))) {
    s = s.slice(1, -1);
  }
  return s;
}

// Convert a POSIX / Git-Bash / WSL mount path to a native Windows path so Node
// fs can stat it. Pure-POSIX systems just keep the path.
//   /mnt/c/Users/x -> C:\Users\x   (WSL)
//   /c/Users/x     -> C:\Users\x   (Git Bash / MSYS)
//   C:/Users/x     -> C:\Users\x   (forward-slash Windows)
export function toNativePath(p) {
  const s = String(p);
  const wsl = s.match(/^\/mnt\/([a-zA-Z])\/(.*)$/);
  if (wsl) return wsl[1].toUpperCase() + ":\\" + wsl[2].replace(/\//g, "\\");
  const git = s.match(/^\/([a-zA-Z])\/(.*)$/);
  if (git) return git[1].toUpperCase() + ":\\" + git[2].replace(/\//g, "\\");
  if (/^[a-zA-Z]:[\\/]/.test(s)) return s.replace(/\//g, "\\");
  return s;
}

// The inverse — native Windows path to a Git-Bash path, for when we shell out.
export function toPosixPath(p) {
  return String(p)
    .replace(/^([a-zA-Z]):[\\/]/, (_, d) => `/${d.toLowerCase()}/`)
    .replace(/\\/g, "/");
}

// Resolve a user/agent-supplied path to an EXISTING absolute path, trying quote
// cleanup, ~ expansion, drag-escape de-escaping, and POSIX↔Windows conversion.
// Mirrors Open Interpreter's find_image_path heuristics (existence-validate,
// prefer the longest match) but for one explicit path.
export function resolveLocalPath(raw, { root = process.cwd() } = {}) {
  let s = unquote(raw);
  if (!s) return { ok: false, error: "empty path" };
  if (s === "~" || s.startsWith("~/") || s.startsWith("~\\")) s = homedir() + s.slice(1);

  const variants = new Set();
  const add = (v) => v && variants.add(v);
  add(toNativePath(s));
  if (s.includes("\\ ")) add(toNativePath(s.replace(/\\ /g, " "))); // dragged "My\ File"
  add(s);
  const nat = toNativePath(s);
  if (!isAbsolute(nat)) add(resolve(root, nat));

  const existing = [...variants].filter((v) => {
    try { return existsSync(v); } catch { return false; }
  });
  if (existing.length) {
    existing.sort((a, b) => b.length - a.length); // longest match wins
    return { ok: true, path: existing[0] };
  }
  return { ok: false, error: `file not found: ${raw}`, tried: [...variants] };
}

function cap(s) {
  const t = String(s ?? "").trim();
  return t.length > MAX_CHARS ? t.slice(0, MAX_CHARS) + `\n\n…（已截断，原文共 ${t.length} 字）` : t;
}

async function decodeText(buf) {
  const utf8 = buf.toString("utf8");
  if (!utf8.includes("�")) return utf8; // clean UTF-8
  try {
    const jschardet = (await import("jschardet")).default;
    const iconv = (await import("iconv-lite")).default;
    const enc = jschardet.detect(buf)?.encoding;
    if (enc && iconv.encodingExists(enc)) return iconv.decode(buf, enc);
  } catch {
    /* fall through to utf8 */
  }
  return utf8;
}

function xlsxToMarkdown(wb) {
  const out = [];
  wb.eachSheet((ws) => {
    const rows = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      const cells = [];
      row.eachCell({ includeEmpty: true }, (cell) => {
        let v = cell.value;
        if (v && typeof v === "object") v = v.text ?? v.result ?? v.hyperlink ?? JSON.stringify(v);
        cells.push(String(v ?? "").replace(/\r?\n/g, " ").trim());
      });
      rows.push(cells);
    });
    if (!rows.length) return;
    out.push(`### ${ws.name}`);
    const width = Math.max(...rows.map((r) => r.length));
    const pad = (r) => { while (r.length < width) r.push(""); return r; };
    out.push("| " + pad(rows[0]).join(" | ") + " |");
    out.push("| " + Array(width).fill("---").join(" | ") + " |");
    for (const r of rows.slice(1, 300)) out.push("| " + pad(r).join(" | ") + " |");
    out.push("");
  });
  return out.join("\n");
}

// Extract readable text from one file (already resolved). Routes by extension.
export async function extractDocText(absPath) {
  const ext = extname(absPath).toLowerCase();
  let buf;
  try {
    buf = await readFile(absPath);
  } catch (e) {
    return { ok: false, error: e.message, kind: "?" };
  }
  try {
    if (ext === ".pdf") {
      const { extractText } = await import("unpdf");
      const r = await extractText(new Uint8Array(buf), { mergePages: true });
      const text = Array.isArray(r.text) ? r.text.join("\n") : r.text;
      return { ok: true, kind: "pdf", text: cap(text), meta: { pages: r.totalPages } };
    }
    if (ext === ".docx") {
      const mammoth = (await import("mammoth")).default;
      const r = await mammoth.extractRawText({ buffer: buf });
      return { ok: true, kind: "docx", text: cap(r.value) };
    }
    if (ext === ".pptx") {
      const op = await import("officeparser");
      const parseOffice = op.parseOffice || op.default?.parseOffice;
      const ast = await parseOffice(buf, { fileType: "pptx" }); // v7: returns an AST
      const md = await ast.to("md"); // -> { value, messages }
      return { ok: true, kind: "pptx", text: cap(md?.value ?? md) };
    }
    if (ext === ".xlsx" || ext === ".xlsm") {
      const ExcelJS = (await import("exceljs")).default;
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buf);
      return { ok: true, kind: "xlsx", text: cap(xlsxToMarkdown(wb)) };
    }
    if (IMG_EXT.has(ext)) {
      return {
        ok: true,
        kind: "image",
        text: `（这是图片文件：${basename(absPath)}。图片要作为视觉附件发送——直接在聊天里粘贴它的路径，我就能看到并描述图像内容；read_file 本身只返回文本、看不到图像。）`,
        meta: { image: true },
      };
    }
    if (TEXT_EXT.has(ext) || ext === "") {
      return { ok: true, kind: "text", text: cap(await decodeText(buf)) };
    }
    // unknown binary: try text decode, but warn
    const text = await decodeText(buf);
    if (text.includes("�")) {
      return { ok: false, error: `不支持的二进制文件类型 ${ext || "(无扩展名)"}`, kind: ext };
    }
    return { ok: true, kind: "text", text: cap(text) };
  } catch (e) {
    return { ok: false, error: `提取 ${ext} 失败：${e.message}`, kind: ext };
  }
}

// Resolve + extract + pack with a header. The single entry point for read_file.
export async function readAnyFile(rawPath, { root } = {}) {
  const r = resolveLocalPath(rawPath, { root });
  if (!r.ok) return { ok: false, error: r.error };
  try {
    if (statSync(r.path).isDirectory()) return { ok: false, error: `是一个目录：${r.path}` };
  } catch {
    /* statSync errors fall through to extract */
  }
  const ex = await extractDocText(r.path);
  if (!ex.ok) return { ok: false, error: ex.error, path: r.path };
  if (ex.kind === "text") return { ok: true, path: r.path, kind: ex.kind, text: ex.text };
  const meta = ex.meta?.pages ? `, ${ex.meta.pages} 页` : "";
  const header = `# ${basename(r.path)} · ${ex.kind}${meta}\n\n`;
  return { ok: true, path: r.path, kind: ex.kind, text: header + ex.text };
}

// Extensions we auto-detect when a user pastes/mentions a path in free text.
const DETECT_EXT =
  "pptx|docx|xlsx|xlsm|pdf|txt|md|markdown|csv|tsv|json|ya?ml|html?|log|js|ts|jsx|tsx|mjs|cjs|py|rs|go|java|cc|cpp|hpp|sh|bash|rb|php|sql|toml|ini|conf|png|jpe?g|gif|webp|bmp|svg|tiff";
// Match an absolute Windows ("C:\..." / "C:/...") or POSIX/Git-Bash ("/c/..." ,
// "/mnt/c/..." , "/usr/...") path ending in a known extension. The body excludes
// ':' (so it stops at the drive colon) but ALLOWS spaces + CJK in the filename;
// the extension anchor lets it skip dotted names like "6.16 ADG…PPT.pptx".
const PATH_RE = new RegExp(
  '(?:[A-Za-z]:[\\\\/][^\\n:*?"<>|]*?\\.(?:' + DETECT_EXT + "))" +
    '|(?:/[^\\n:*?"<>|]*?\\.(?:' + DETECT_EXT + "))",
  "gi",
);

// Scan free text for local file paths that actually EXIST (OI find_image_path,
// generalized to all readable types). Returns existing absolute paths, deduped,
// longest first. Existence-validation keeps URLs / prose out.
export function detectFilePaths(text, { root } = {}) {
  const found = [];
  const seen = new Set();
  for (const m of String(text ?? "").matchAll(PATH_RE)) {
    const r = resolveLocalPath(m[0], { root });
    if (r.ok && !seen.has(r.path)) {
      seen.add(r.path);
      found.push(r.path);
    }
  }
  found.sort((a, b) => b.length - a.length);
  return found;
}

const IMG_MIME = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".tiff": "image/tiff",
};
const MAX_IMG_BYTES = 4.5 * 1024 * 1024; // headroom under the ~5MB vision limit

export function isImagePath(p) {
  return IMG_EXT.has(extname(String(p ?? "")).toLowerCase());
}

// Read an image into a base64 data URL for multimodal (vision) messages.
export async function readImageDataUrl(absPath) {
  const ext = extname(absPath).toLowerCase();
  const mime = IMG_MIME[ext];
  if (!mime) return { ok: false, error: `不支持作为视觉输入的图片类型 ${ext}` };
  try {
    const buf = await readFile(absPath);
    if (buf.length > MAX_IMG_BYTES) {
      return { ok: false, error: `图片过大(${(buf.length / 1024 / 1024).toFixed(1)}MB > 4.5MB),请压缩后再发` };
    }
    return { ok: true, dataUrl: `data:${mime};base64,${buf.toString("base64")}`, bytes: buf.length };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
