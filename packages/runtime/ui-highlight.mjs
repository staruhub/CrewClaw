const ANSI = {
  reset: "\x1b[0m",
  comment: "\x1b[2m",
  string: "\x1b[32m",
  keyword: "\x1b[35m",
  number: "\x1b[36m",
  literal: "\x1b[33m",
};

const IDENT_RE = /^[A-Za-z_$][\w$-]*/;
const NUMBER_RE =
  /^(?:0[xX][0-9a-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d[\d_]*)?)/;

const COMMON_LITERALS = new Set([
  "true",
  "false",
  "null",
  "undefined",
  "None",
  "nil",
  "NULL",
  "TRUE",
  "FALSE",
]);

const SPECS = {
  javascript: {
    line: ["//"],
    block: [["/*", "*/"]],
    strings: ["'", '"', "`"],
    keywords: [
      "as",
      "async",
      "await",
      "break",
      "case",
      "catch",
      "class",
      "const",
      "continue",
      "debugger",
      "default",
      "delete",
      "do",
      "else",
      "export",
      "extends",
      "finally",
      "for",
      "from",
      "function",
      "get",
      "if",
      "import",
      "in",
      "instanceof",
      "let",
      "new",
      "of",
      "return",
      "set",
      "static",
      "super",
      "switch",
      "this",
      "throw",
      "try",
      "typeof",
      "var",
      "void",
      "while",
      "with",
      "yield",
    ],
  },
  json: {
    line: [],
    block: [],
    strings: ['"'],
    keywords: [],
    literals: ["true", "false", "null"],
  },
  bash: {
    line: ["#"],
    block: [],
    strings: ["'", '"', "`"],
    keywords: [
      "alias",
      "bg",
      "break",
      "case",
      "cd",
      "command",
      "continue",
      "do",
      "done",
      "elif",
      "else",
      "esac",
      "eval",
      "exec",
      "exit",
      "export",
      "fg",
      "fi",
      "for",
      "function",
      "if",
      "in",
      "local",
      "printf",
      "read",
      "return",
      "select",
      "set",
      "shift",
      "source",
      "then",
      "time",
      "trap",
      "until",
      "while",
    ],
  },
  rust: {
    line: ["//"],
    block: [["/*", "*/"]],
    strings: ["'", '"'],
    keywords: [
      "as",
      "async",
      "await",
      "break",
      "const",
      "continue",
      "crate",
      "dyn",
      "else",
      "enum",
      "extern",
      "fn",
      "for",
      "if",
      "impl",
      "in",
      "let",
      "loop",
      "match",
      "mod",
      "move",
      "mut",
      "pub",
      "ref",
      "return",
      "self",
      "Self",
      "static",
      "struct",
      "super",
      "trait",
      "type",
      "unsafe",
      "use",
      "where",
      "while",
    ],
    literals: ["true", "false", "None", "Some", "Ok", "Err"],
  },
  python: {
    line: ["#"],
    block: [],
    strings: ["'", '"'],
    tripleStrings: ["'''", '"""'],
    keywords: [
      "and",
      "as",
      "assert",
      "async",
      "await",
      "break",
      "class",
      "continue",
      "def",
      "del",
      "elif",
      "else",
      "except",
      "finally",
      "for",
      "from",
      "global",
      "if",
      "import",
      "in",
      "is",
      "lambda",
      "nonlocal",
      "not",
      "or",
      "pass",
      "raise",
      "return",
      "try",
      "while",
      "with",
      "yield",
    ],
    literals: ["True", "False", "None"],
  },
  go: {
    line: ["//"],
    block: [["/*", "*/"]],
    strings: ["'", '"', "`"],
    keywords: [
      "break",
      "case",
      "chan",
      "const",
      "continue",
      "default",
      "defer",
      "else",
      "fallthrough",
      "for",
      "func",
      "go",
      "goto",
      "if",
      "import",
      "interface",
      "map",
      "package",
      "range",
      "return",
      "select",
      "struct",
      "switch",
      "type",
      "var",
    ],
    literals: ["true", "false", "nil", "iota"],
  },
  yaml: {
    line: ["#"],
    block: [],
    strings: ["'", '"'],
    keywords: [],
    literals: ["true", "false", "null", "yes", "no", "on", "off"],
  },
  html: {
    line: [],
    block: [["<!--", "-->"]],
    strings: ["'", '"'],
    keywords: [
      "a",
      "article",
      "body",
      "button",
      "div",
      "em",
      "footer",
      "form",
      "h1",
      "h2",
      "h3",
      "head",
      "header",
      "html",
      "img",
      "input",
      "label",
      "li",
      "link",
      "main",
      "meta",
      "nav",
      "ol",
      "option",
      "p",
      "script",
      "section",
      "select",
      "span",
      "strong",
      "style",
      "table",
      "tbody",
      "td",
      "textarea",
      "th",
      "thead",
      "title",
      "tr",
      "ul",
      "xml",
    ],
  },
  css: {
    line: [],
    block: [["/*", "*/"]],
    strings: ["'", '"'],
    keywords: [
      "align-items",
      "animation",
      "background",
      "border",
      "color",
      "display",
      "flex",
      "font",
      "gap",
      "grid",
      "height",
      "margin",
      "none",
      "padding",
      "position",
      "relative",
      "absolute",
      "static",
      "sticky",
      "width",
    ],
  },
  sql: {
    line: ["--"],
    block: [["/*", "*/"]],
    strings: ["'", '"'],
    keywords: [
      "ALTER",
      "AND",
      "AS",
      "ASC",
      "BY",
      "CREATE",
      "DELETE",
      "DESC",
      "DISTINCT",
      "DROP",
      "FROM",
      "GROUP",
      "HAVING",
      "IN",
      "INSERT",
      "INTO",
      "IS",
      "JOIN",
      "LEFT",
      "LIKE",
      "LIMIT",
      "NOT",
      "NULL",
      "ON",
      "OR",
      "ORDER",
      "RIGHT",
      "SELECT",
      "SET",
      "TABLE",
      "UPDATE",
      "VALUES",
      "WHERE",
    ],
    literals: ["TRUE", "FALSE", "NULL"],
    caseInsensitive: true,
  },
  generic: {
    line: ["//", "#"],
    block: [["/*", "*/"]],
    strings: ["'", '"', "`"],
    keywords: [],
  },
};

const LANG_ALIASES = new Map([
  ["", "generic"],
  ["cjs", "javascript"],
  ["js", "javascript"],
  ["jsx", "javascript"],
  ["mjs", "javascript"],
  ["node", "javascript"],
  ["javascript", "javascript"],
  ["ts", "javascript"],
  ["tsx", "javascript"],
  ["typescript", "javascript"],
  ["json", "json"],
  ["jsonc", "javascript"],
  ["bash", "bash"],
  ["shell", "bash"],
  ["sh", "bash"],
  ["zsh", "bash"],
  ["rs", "rust"],
  ["rust", "rust"],
  ["py", "python"],
  ["python", "python"],
  ["go", "go"],
  ["golang", "go"],
  ["yaml", "yaml"],
  ["yml", "yaml"],
  ["html", "html"],
  ["htm", "html"],
  ["xml", "html"],
  ["css", "css"],
  ["sql", "sql"],
]);

function normalizeLang(lang) {
  const key = String(lang || "")
    .trim()
    .toLowerCase();
  return LANG_ALIASES.get(key) || key || "generic";
}

function paint(type, text) {
  const code = ANSI[type];
  return code ? `${code}${text}${ANSI.reset}` : text;
}

function specFor(lang) {
  const normalized = normalizeLang(lang);
  const spec = SPECS[normalized] || SPECS.generic;
  return {
    ...spec,
    keywordSet: new Set(
      (spec.keywords || []).map(w =>
        spec.caseInsensitive ? w.toLowerCase() : w
      )
    ),
    literalSet: new Set(
      [...(spec.literals || []), ...COMMON_LITERALS].map(w =>
        spec.caseInsensitive ? w.toLowerCase() : w
      )
    ),
  };
}

function startsWithAny(input, index, values) {
  for (const value of values || []) {
    if (value && input.startsWith(value, index)) return value;
  }
  return "";
}

function readLineComment(input, index) {
  const end = input.indexOf("\n", index);
  return end === -1 ? input.length : end;
}

function readBlock(input, index, open, close) {
  const end = input.indexOf(close, index + open.length);
  return end === -1 ? input.length : end + close.length;
}

function readString(input, index, quote) {
  let i = index + quote.length;
  while (i < input.length) {
    if (input[i] === "\\") {
      i += 2;
      continue;
    }
    if (input.startsWith(quote, i)) return i + quote.length;
    i++;
  }
  return input.length;
}

function readNumber(input, index) {
  const match = input.slice(index).match(NUMBER_RE);
  return match ? index + match[0].length : index;
}

function readIdentifier(input, index) {
  const match = input.slice(index).match(IDENT_RE);
  return match ? match[0] : "";
}

function tokenTypeForWord(word, spec) {
  const key = spec.caseInsensitive ? word.toLowerCase() : word;
  if (spec.literalSet.has(key)) return "literal";
  if (spec.keywordSet.has(key)) return "keyword";
  return "plain";
}

function tokenize(code, spec) {
  const tokens = [];
  let i = 0;

  while (i < code.length) {
    const block = (spec.block || []).find(([open]) => code.startsWith(open, i));
    if (block) {
      const end = readBlock(code, i, block[0], block[1]);
      tokens.push(["comment", code.slice(i, end)]);
      i = end;
      continue;
    }

    const line = startsWithAny(code, i, spec.line);
    if (line && (line !== "#" || i === 0 || code[i - 1] !== "$")) {
      const end = readLineComment(code, i);
      tokens.push(["comment", code.slice(i, end)]);
      i = end;
      continue;
    }

    const triple = startsWithAny(code, i, spec.tripleStrings);
    if (triple) {
      const end = readString(code, i, triple);
      tokens.push(["string", code.slice(i, end)]);
      i = end;
      continue;
    }

    const quote = startsWithAny(code, i, spec.strings);
    if (quote) {
      const end = readString(code, i, quote);
      tokens.push(["string", code.slice(i, end)]);
      i = end;
      continue;
    }

    if (/\d/.test(code[i])) {
      const end = readNumber(code, i);
      if (end > i) {
        tokens.push(["number", code.slice(i, end)]);
        i = end;
        continue;
      }
    }

    const word = readIdentifier(code, i);
    if (word) {
      tokens.push([tokenTypeForWord(word, spec), word]);
      i += word.length;
      continue;
    }

    tokens.push(["plain", code[i]]);
    i++;
  }

  return tokens;
}

export function highlightCode(code, lang, { color = true } = {}) {
  const text = String(code ?? "");
  if (!color) return text;
  return tokenize(text, specFor(lang))
    .map(([type, value]) => paint(type, value))
    .join("");
}
