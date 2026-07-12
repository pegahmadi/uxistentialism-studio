/*
 * Public-safety content scan — REFERENCE IMPLEMENTATION (contract §5).
 *
 * One reusable primitive shared by the ingestion endpoints (WS-1), the
 * companion's local validation (WS-2), and the fixture validator
 * (tools/validate-projection.mjs), so the layers cannot drift.
 *
 * Rejects, in any string value at any depth:
 *   - absolute POSIX paths (/Users/, /home/, /var/, /tmp/, ... — including
 *     paths wrapped in punctuation, quotes, assignments, or markdown links)
 *   - Windows drive paths (C:\... and C:/...) and UNC paths (\\server\...)
 *   - file:// URIs
 *   - .md filename/path fragments
 * and, as keys at any depth, the vault-internal fields that must never leave
 * the local machine.
 *
 * Deliberately NOT flagged: http(s) URLs, times ("10:30"), ISO timestamps,
 * ratios ("3/4"), word/word tokens without a leading slash ("read/write"),
 * a bare "/".
 *
 * REDACTION: violation messages name only the category and the JSON trail —
 * they NEVER repeat the offending string or path, so error responses and logs
 * cannot re-leak the content they rejected.
 *
 * Coordinator-owned shared infrastructure. Behavior locked by
 * tools/tests/public-safety.test.mjs.
 */

export const FORBIDDEN_KEYS = new Set([
  "body",
  "transcript",
  "vaultKey",
  "path",
  "relPath",
  "folder",
  "fileName",
  "fileBase",
  "mtime",
  "mtimeMs",
  "birthtime",
]);

// Absolute POSIX path: a "/" at the start of the string or preceded by
// whitespace / quoting / punctuation / assignment ( ( [ { = : , < " ' ` ),
// followed by at least two path segments — so "either/or", "3/4", "a / b",
// ISO timestamps, and https:// URLs (whose "//" yields an empty first
// segment) never false-positive, while "(/home/x/y)", "path=/tmp/x/y",
// "\"/var/x/y\"" and "[link](/home/x/y)" are caught.
const POSIX_PATH = /(?:^|[\s"'`(\[{=:,<])\/(?:[^/\s"'`)\]}>,]+\/)+[^/\s"'`)\]}>,]*/;

// Windows drive path with forward slashes: a SINGLE-letter drive (preceded by
// start or a delimiter, so prose like "Substack:/x" never matches) + ":/" not
// followed by a second slash (so "https://" never matches).
const WIN_FORWARD = /(?:^|[\s"'`(\[{=,<])[A-Za-z]:\/(?!\/)\S/;

/** Does this string leak a filesystem path, note filename, or file URI? */
export function leaksPath(str, extraNeedles = []) {
  if (typeof str !== "string") return false;
  if (/file:\/\//i.test(str)) return true; // file URIs
  if (/[A-Za-z]:\\/.test(str)) return true; // windows drive path (backslash)
  if (WIN_FORWARD.test(str)) return true; // windows drive path (forward slash)
  if (/\\\\[^\s\\]/.test(str)) return true; // UNC path
  if (/\.md\b/i.test(str)) return true; // note filename fragment
  if (POSIX_PATH.test(str)) return true; // absolute POSIX path
  for (const needle of extraNeedles) {
    if (needle && str.includes(needle)) return true;
  }
  return false;
}

/**
 * Walk every key and string value; collect REDACTED violations (category +
 * JSON trail only — never the offending value).
 * @param {unknown} node          value to scan
 * @param {object}  [opts]
 * @param {string[]} [opts.extraNeedles]  additional forbidden substrings (e.g. the local vault path)
 * @returns {string[]} violations (empty = safe)
 */
export function scanPublicSafety(node, opts = {}) {
  const violations = [];
  const extraNeedles = opts.extraNeedles ?? [];
  const visit = (value, trail) => {
    if (Array.isArray(value)) {
      value.forEach((v, i) => visit(v, `${trail}[${i}]`));
      return;
    }
    if (value && typeof value === "object") {
      for (const [k, v] of Object.entries(value)) {
        if (FORBIDDEN_KEYS.has(k)) violations.push(`forbidden key "${k}" present at ${trail}`);
        visit(v, `${trail}.${k}`);
      }
      return;
    }
    if (typeof value === "string" && leaksPath(value, extraNeedles)) {
      violations.push(`path-like string detected at ${trail}`);
    }
  };
  visit(node, "$");
  return violations;
}
