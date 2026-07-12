/*
 * Public-safety content scan — REFERENCE IMPLEMENTATION (contract §5).
 *
 * One reusable primitive shared by the ingestion endpoints (WS-1), the
 * companion's local validation (WS-2), and the fixture validator
 * (tools/validate-projection.mjs), so the layers cannot drift.
 *
 * Rejects, in any string value at any depth:
 *   - absolute POSIX paths (any multi-segment absolute path token — /Users/,
 *     /home/, /var/, /tmp/, ...)
 *   - Windows drive paths (C:\...) and UNC paths (\\server\...)
 *   - file:// URIs
 *   - .md filename/path fragments
 * and, as keys at any depth, the vault-internal fields that must never leave
 * the local machine.
 *
 * Deliberately NOT flagged: http(s) URLs, times ("10:30"), ISO timestamps,
 * word/word tokens without a leading slash ("read/write"), a bare "/".
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

/** Does this string leak a filesystem path, note filename, or file URI? */
export function leaksPath(str, extraNeedles = []) {
  if (typeof str !== "string") return false;
  if (/file:\/\//i.test(str)) return true; // file URIs
  if (/[A-Za-z]:\\/.test(str)) return true; // windows drive path
  if (/\\\\[^\s\\]/.test(str)) return true; // UNC path
  if (/\.md\b/i.test(str)) return true; // note filename fragment
  // absolute POSIX path: any whitespace-delimited token that starts with "/"
  // and contains at least two path segments (so a bare "/" or "either/or"
  // never false-positives)
  for (const tok of str.split(/\s+/)) {
    if (/^\/[^/\s]+\/\S*/.test(tok)) return true;
  }
  for (const needle of extraNeedles) {
    if (needle && str.includes(needle)) return true;
  }
  return false;
}

/**
 * Walk every key and string value; collect violations with their JSON trail.
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
      violations.push(`path-like string leaked at ${trail}: ${JSON.stringify(value.slice(0, 80))}`);
    }
  };
  visit(node, "$");
  return violations;
}
