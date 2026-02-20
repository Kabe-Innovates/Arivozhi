/**
 * Arivozhi — Symbol Extractor (MAIN world)
 *
 * Extracts user-defined identifiers from an Ace Editor session by
 * walking Ace's *own* tokenizer output — the same data Ace already
 * computes for syntax highlighting.
 *
 * Phase 5: Language-aware extraction with heuristics for Python, C/C++,
 * and Java.  Uses look-ahead patterns to detect function definitions in
 * C mode (where Ace rarely emits entity.name.function) and extracts
 * function signatures for snippet completions.
 *
 * Usage:
 *   const symbols = Arivozhi.extractor.extract(editor);
 */

window.Arivozhi = window.Arivozhi || {};

window.Arivozhi.extractor = (() => {
  "use strict";

  /* ═══════════ Per-language built-in names ═══════════ */

  const BUILTINS = {
    python: new Set([
      "print", "input", "len", "range", "int", "float", "str", "list",
      "dict", "set", "tuple", "bool", "type", "super", "self", "cls",
      "None", "True", "False", "and", "or", "not", "is", "in",
      "if", "else", "elif", "for", "while", "def", "class", "return",
      "import", "from", "as", "try", "except", "finally", "raise",
      "with", "yield", "lambda", "pass", "break", "continue", "del",
      "global", "nonlocal", "assert", "open", "map", "filter", "zip",
      "enumerate", "sorted", "reversed", "abs", "max", "min", "sum",
      "any", "all", "hasattr", "getattr", "setattr", "isinstance",
      "issubclass", "id", "hex", "oct", "bin", "ord", "chr", "repr",
      "format", "hash", "iter", "next", "object", "property",
    ]),

    c_cpp: new Set([
      "printf", "scanf", "fprintf", "fscanf", "sprintf", "sscanf",
      "malloc", "calloc", "realloc", "free",
      "strlen", "strcpy", "strncpy", "strcat", "strcmp", "strncmp",
      "memset", "memcpy", "memmove", "memcmp",
      "fopen", "fclose", "fread", "fwrite", "fgets", "fputs",
      "getchar", "putchar", "gets", "puts",
      "atoi", "atof", "atol", "strtol", "strtod",
      "abs", "labs", "rand", "srand", "exit", "system",
      "sizeof", "typedef", "NULL",
      "void", "null",
      "public", "private", "protected", "static", "final",
      "new", "delete", "goto",
      "include", "define", "ifdef", "endif", "pragma",
      "namespace", "using", "template", "typename",
      "cout", "cin", "endl", "std",
    ]),

    java: new Set([
      "System", "println", "print", "printf",
      "String", "Integer", "Double", "Float", "Boolean", "Character",
      "Long", "Short", "Byte", "Object",
      "ArrayList", "HashMap", "HashSet", "LinkedList", "TreeMap",
      "Iterator", "Collections", "Arrays",
      "Math", "Scanner", "Random",
      "Exception", "RuntimeException", "NullPointerException",
      "IOException", "FileNotFoundException",
      "Override", "Deprecated", "SuppressWarnings",
      "void", "null", "this", "super",
      "public", "private", "protected", "static", "final",
      "abstract", "synchronized", "volatile", "transient",
      "new", "instanceof", "goto",
      "true", "false",
    ]),
  };

  /** Fallback builtins for unknown language modes. */
  const BUILTINS_COMMON = new Set([
    "var", "let", "const", "function", "return", "if", "else",
    "for", "while", "do", "switch", "case", "default", "break",
    "continue", "true", "false", "null", "void", "this", "self",
    "print", "input", "printf", "scanf", "main",
  ]);

  /* ═══════════ Token classification ═══════════ */

  const DEFINITION_PATTERNS = [
    "entity.name.function",
    "entity.name.class",
  ];

  const IDENTIFIER_PATTERNS = ["identifier"];

  const SKIP_PATTERNS = [
    "keyword",
    "storage",
    "constant",
    "comment",
    "string",
    "support",
    "punctuation",
    "paren",
    "operator",
    "text",
    "meta",
    "variable.language",  // self, this, super, cls
  ];

  const MIN_NAME_LENGTH = 2;

  /* ═══════════ Language detection ═══════════ */

  /**
   * @param  {AceEditor} editor
   * @return {string} "python" | "c_cpp" | "java" | "unknown"
   */
  function detectLanguage(editor) {
    const modeId = editor.session.$modeId || "";
    if (modeId.includes("python")) return "python";
    if (modeId.includes("c_cpp") || modeId.endsWith("/c")) return "c_cpp";
    if (modeId.includes("java") && !modeId.includes("javascript")) return "java";
    return "unknown";
  }

  /* ═══════════ Core extraction ═══════════ */

  /**
   * Walk the Ace session's token stream and collect user-defined symbols.
   *
   * @param  {AceEditor} editor
   * @return {Array<{name: string, type: string, signature?: string}>}
   */
  function extract(editor) {
    const session = editor.getSession();
    const totalRows = session.getLength();
    const lang = detectLanguage(editor);
    const builtins = BUILTINS[lang] || BUILTINS_COMMON;
    const seen = new Map(); // name → { type, signature? }

    for (let row = 0; row < totalRows; row++) {
      const tokens = session.getTokens(row);
      if (!tokens || !tokens.length) continue;

      for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        const ttype = token.type || "";
        const value = (token.value || "").trim();

        if (!value || value.length < MIN_NAME_LENGTH) continue;
        if (builtins.has(value)) continue;
        // Reject values that aren't valid identifiers (e.g. partial
        // string content like area" from inside "calculate area").
        if (!/^[a-zA-Z_]\w*$/.test(value)) continue;

        // ── 1. Explicit definition tokens (reliable in some Ace versions) ──
        if (isDefinition(ttype)) {
          const kind = ttype.includes("function") ? "function" : "class";
          if (!seen.has(value)) {
            const sig = kind === "function"
              ? extractSignature(tokens, i, lang)
              : null;
            seen.set(value, { type: kind, signature: sig });
          }
          continue;
        }

        // Skip non-identifiers and noise tokens from here on
        if (!isIdent(ttype) || isSkipped(ttype)) continue;

        // ── 2. Look-back: preceded by a definition keyword ──
        // Catches `def foo`, `class Bar`, `struct Node`, `interface Runnable`
        // even when Ace emits plain `identifier` instead of entity.name.*
        const prev = getPrevNonWS(tokens, i);
        if (prev && (prev.type || "").includes("keyword")) {
          const kw = (prev.value || "").trim();
          if (kw === "def" || kw === "function") {
            if (!seen.has(value)) {
              const sig = extractSignature(tokens, i, lang);
              seen.set(value, { type: "function", signature: sig });
            }
            continue;
          }
          if (["class", "struct", "enum", "union", "interface"].includes(kw)) {
            if (!seen.has(value)) {
              seen.set(value, { type: "class", signature: null });
            }
            continue;
          }
        }

        // ── 3. Look-ahead: identifier followed by '(' → function ──
        // Works for all languages — catches function definitions AND calls
        if (isFollowedByParen(tokens, i)) {
          if (!seen.has(value)) {
            const sig = extractSignature(tokens, i, lang);
            seen.set(value, { type: "function", signature: sig });
          }
          continue;
        }

        // ── 4. Fallback → variable ──
        if (!seen.has(value)) {
          seen.set(value, { type: "variable", signature: null });
        }
      }
    }

    const symbols = [];
    for (const [name, info] of seen) {
      const entry = { name, type: info.type };
      if (info.signature) entry.signature = info.signature;
      symbols.push(entry);
    }
    return symbols;
  }

  /* ═══════════ Signature extraction ═══════════ */

  /**
   * Starting from a function name token, walk forward to capture params.
   * Returns a comma-separated list of parameter names, or null.
   */
  function extractSignature(tokens, nameIdx, lang) {
    let parenStart = -1;
    for (let j = nameIdx + 1; j < tokens.length; j++) {
      const v = (tokens[j].value || "").trim();
      if (!v) continue;
      if (v === "(") { parenStart = j; break; }
      break;
    }
    if (parenStart === -1) return null;

    let depth = 1;
    const parts = [];
    for (let j = parenStart + 1; j < tokens.length && depth > 0; j++) {
      const v = tokens[j].value || "";
      for (const ch of v) {
        if (ch === "(") depth++;
        else if (ch === ")") depth--;
        if (depth === 0) break;
      }
      if (depth > 0) parts.push(v);
    }

    const raw = parts.join("").trim();
    if (!raw) return null;

    const params = parseParamNames(raw, lang);
    return params.length ? params.join(", ") : null;
  }

  /**
   * Parse param names from a raw param string.
   *   Python: "a, b, c=10"      → ["a", "b", "c"]
   *   C/Java: "int a, float b"  → ["a", "b"]
   */
  function parseParamNames(raw, lang) {
    const params = raw.split(",").map((p) => p.trim()).filter(Boolean);
    const names = [];

    for (const param of params) {
      if (lang === "python") {
        const match = param.match(/^(\w+)/);
        if (match && match[1] !== "self" && match[1] !== "cls") {
          names.push(match[1]);
        }
      } else {
        // C/Java: last word is the name (after type keywords)
        const words = param.replace(/[*&\[\]]/g, " ").trim().split(/\s+/);
        if (words.length >= 2) {
          names.push(words[words.length - 1]);
        } else if (words.length === 1 && /^[a-zA-Z_]\w*$/.test(words[0])) {
          names.push(words[0]);
        }
      }
    }
    return names;
  }

  /* ═══════════ Token helpers ═══════════ */

  function isDefinition(ttype) {
    return DEFINITION_PATTERNS.some((p) => ttype.includes(p));
  }
  function isIdent(ttype) {
    return IDENTIFIER_PATTERNS.some((p) => ttype.includes(p));
  }
  function isSkipped(ttype) {
    return SKIP_PATTERNS.some((p) => ttype.includes(p));
  }
  function isFollowedByParen(tokens, idx) {
    for (let j = idx + 1; j < tokens.length; j++) {
      const v = (tokens[j].value || "").trim();
      if (!v) continue;
      return v.startsWith("(");
    }
    return false;
  }
  function getPrevNonWS(tokens, idx) {
    for (let j = idx - 1; j >= 0; j--) {
      const v = (tokens[j].value || "").trim();
      if (v) return tokens[j];
    }
    return null;
  }

  return { extract, detectLanguage };
})();
