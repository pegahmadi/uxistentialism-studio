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
 *
 * The sink is injectable so tests can capture output and assert
 * secret-absence across all flows.
 */

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
    write(redact(line));
  };

  return {
    info: (...parts) => emit("INFO ", parts),
    warn: (...parts) => emit("WARN ", parts),
    error: (...parts) => emit("ERROR", parts),
    redact,
  };
}
