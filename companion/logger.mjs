/*
 * Redacting logger for the Studio Sync companion (WS-2).
 *
 * Hard rules (CLAUDE.md + contract §3/§5, PLAN.md rule 6):
 *   - The sync secret, config objects, HTTP headers, and private filesystem
 *     paths must NEVER appear in any log line.
 *   - Only scalar values are rendered. Objects (config, headers, envelopes)
 *     are never serialized — they render as an opaque placeholder.
 *   - Errors render their message only (stacks embed absolute file paths).
 *   - Every emitted line passes through the redaction table; longer redaction
 *     values are applied first so a path prefix cannot shadow a longer secret.
 *   - NOTE-PATH SCRUB (FIX 12): after table redaction, any surviving fragment
 *     that ends in ".md" — including fragments with spaces hanging off a
 *     redaction placeholder, e.g. "[vault]/Private Note.md" — is replaced
 *     with "[note]". Note filenames are private; no ".md" name or path
 *     fragment may reach a log line by any route.
 *
 * The sink is injectable so tests can capture output and assert
 * secret-absence across all flows.
 */

/**
 * FIX 12 — final defense-in-depth pass. Matches (a) a redaction placeholder
 * or path fragment (which may contain spaces, as vault note names do)
 * running up to ".md", or (b) a bare whitespace-free token ending in ".md".
 * Deliberately aggressive: over-scrubbing a log line is acceptable; leaking
 * a note filename is not.
 */
const NOTE_PATH_RE = /(?:\[vault\]|\[inbox\]|~)?(?:\/[^\n]*?)?[^\s/]*\.md\b/g;
export const scrubNotePaths = (text) => text.replace(NOTE_PATH_RE, "[note]");

/**
 * @param {object} [opts]
 * @param {Array<[string, string]>} [opts.redactions]  [value, replacement] pairs
 * @param {(line: string) => void} [opts.sink]         defaults to stdout
 * @param {string} [opts.name]
 */
export function createLogger({ redactions = [], sink, name = "companion" } = {}) {
  const write = sink ?? ((line) => process.stdout.write(line + "\n"));
  const table = redactions
    .filter(([value]) => typeof value === "string" && value.length > 0)
    .sort((a, b) => b[0].length - a[0].length);

  const redact = (text) => {
    let out = text;
    for (const [value, replacement] of table) out = out.split(value).join(replacement);
    return out;
  };

  const coerce = (part) => {
    if (typeof part === "string") return part;
    if (typeof part === "number" || typeof part === "boolean") return String(part);
    if (part instanceof Error) return part.message; // message only — never the stack
    if (part === null || part === undefined) return String(part);
    return "[unloggable object]"; // objects are never serialized into logs
  };

  const emit = (level, parts) => {
    const line = `${new Date().toISOString()} [${name}] ${level} ${parts.map(coerce).join(" ")}`;
    write(scrubNotePaths(redact(line)));
  };

  return {
    info: (...parts) => emit("INFO ", parts),
    warn: (...parts) => emit("WARN ", parts),
    error: (...parts) => emit("ERROR", parts),
    redact,
  };
}
