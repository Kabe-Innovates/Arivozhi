/**
 * Arivozhi — Symbol Extractor (MAIN world)
 *
 * Extracts user-defined identifiers from an Ace Editor session by
 * walking Ace's *own* tokenizer output — the same data Ace already
 * computes for syntax highlighting.  This is:
 *   • Free (no extra parsing cost)
 *   • Accurate (comments, strings, and keywords are already classified)
 *   • Language-aware (works with any mode Ace supports)
 *
 * Usage:
 *   const symbols = Arivozhi.extractor.extract(editor);
 */

window.Arivozhi = window.Arivozhi || {};

window.Arivozhi.extractor = (() => {
  "use strict";

  /* ─── Token types that represent user-defined names ─── */

  /**
   * Ace token types vary by language mode but follow a dotted hierarchy.
   * We match against substrings so this works across Python, C, Java, etc.
   *
   * Examples of Ace token types we want:
   *   entity.name.function        → function/method definitions
   *   entity.name.class           → class definitions
   *   entity.name.tag             → (HTML, not relevant but harmless)
   *   identifier                  → general identifiers (variables)
   *   variable                    → some modes use this
   *   support.function            → built-in calls (optional — skip to reduce noise)
   */
  const DEFINITION_PATTERNS = [
    "entity.name.function",
    "entity.name.class",
  ];

  const IDENTIFIER_PATTERNS = [
    "identifier",
    "variable",
  ];

  /** Tokens we explicitly skip even if they match an identifier pattern. */
  const SKIP_PATTERNS = [
    "keyword",
    "storage",
    "constant",
    "comment",
    "string",
    "support",        // built-ins (print, len, …) — noisy
    "punctuation",
    "paren",
    "operator",
    "text",           // whitespace
    "meta",           // decorators, pragmas
  ];

  /* ─── Built-in names we should never suggest (language-agnostic) ─── */

  const BUILTIN_NAMES = new Set([
    // Python
    "print", "input", "len", "range", "int", "float", "str", "list",
    "dict", "set", "tuple", "bool", "type", "super", "self", "cls",
    "None", "True", "False", "and", "or", "not", "is", "in",
    "if", "else", "elif", "for", "while", "def", "class", "return",
    "import", "from", "as", "try", "except", "finally", "raise",
    "with", "yield", "lambda", "pass", "break", "continue", "del",
    "global", "nonlocal", "assert",
    // C / Java common
    "main", "printf", "scanf", "void", "null", "this",
    "public", "private", "protected", "static", "final",
    "new", "delete", "sizeof", "typedef", "struct", "enum",
    "switch", "case", "default", "do", "goto",
    "include", "define", "ifdef", "endif",
    // Generic
    "var", "let", "const", "function", "return",
  ]);

  /** Minimum identifier length worth remembering. */
  const MIN_NAME_LENGTH = 2;

  /* ─── Core extraction ─── */

  /**
   * Walk the Ace session's token stream and collect user-defined symbols.
   *
   * @param  {AceEditSession} session  The editor.session object.
   * @return {Array<{name: string, type: string}>}
   *         Deduplicated list of symbols with their kind ("function", "class", "variable").
   */
  function extract(editor) {
    const session = editor.getSession();
    const totalRows = session.getLength();
    const seen = new Map(); // name → type (first-seen wins for type)

    for (let row = 0; row < totalRows; row++) {
      const tokens = session.getTokens(row);

      for (const token of tokens) {
        const ttype = token.type || "";
        const value = token.value.trim();

        if (!value || value.length < MIN_NAME_LENGTH) continue;
        if (BUILTIN_NAMES.has(value)) continue;

        // Check if this is a definition token (function / class name)
        if (isDefinition(ttype)) {
          const kind = ttype.includes("function") ? "function" : "class";
          if (!seen.has(value)) seen.set(value, kind);
          continue;
        }

        // Check if it's a general identifier (variable)
        if (isIdentifier(ttype) && !isSkipped(ttype)) {
          if (!seen.has(value)) seen.set(value, "variable");
        }
      }
    }

    // Convert to array
    const symbols = [];
    for (const [name, type] of seen) {
      symbols.push({ name, type });
    }
    return symbols;
  }

  /* ─── Helpers ─── */

  function isDefinition(ttype) {
    return DEFINITION_PATTERNS.some((p) => ttype.includes(p));
  }

  function isIdentifier(ttype) {
    return IDENTIFIER_PATTERNS.some((p) => ttype.includes(p));
  }

  function isSkipped(ttype) {
    return SKIP_PATTERNS.some((p) => ttype.includes(p));
  }

  return { extract };
})();
