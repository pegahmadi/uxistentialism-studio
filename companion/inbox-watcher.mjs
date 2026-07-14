/*
 * Editorial Board inbox watcher (WS-2).
 *
 * Watches {inboxPath}/*.json for data-only board artifacts (§2b wire format)
 * and submits them through the pipeline, which owns the full envelope.
 *
 * Behavior (contract §2b, PLAN.md rules 4–5):
 *   - STARTUP DRAIN: existing files processed oldest-first, serialized.
 *     Ordering: parsed `editorial-board-<ts>-<suffix>.json` timestamp prefix
 *     ascending, suffix as deterministic tie-break; file mtime is the fallback
 *     key for legacy/nonconforming names.
 *   - Size-stability wait before reading a file (partial writes).
 *   - Invalid artifacts move to rejected/ (one bad file never blocks later
 *     valid ones). Missing/malformed sourceUpdatedAt → rejected/ — mtime is
 *     NEVER substituted.
 *   - Server 4xx contract drift → rejected/ (preserved + surfaced, never
 *     silently resubmitted forever).
 *   - Network failure / 5xx exhaustion → the file STAYS in the inbox and the
 *     drain pauses (later files wait too, preserving submission order); the
 *     next drain retries.
 *   - 409 conflict → the pipeline recovers the revision sequence; the file
 *     stays in place and ONE follow-up drain pass resubmits it with the
 *     recovered revision (storedRevision + 1) and a fresh envelope.
 *   - Inbox and rejected/ are created/verified mode 700.
 *   - There is NO direct-POST fallback: offline artifacts simply wait.
 *   - PRIVACY (FIX 12): raw inbox filenames are NEVER logged — legacy drops
 *     can carry sensitive names. Log lines identify an artifact by an opaque
 *     label, `artifact#<8-hex>` (first 8 hex chars of the SHA-256 of the
 *     filename). Operators map a label back to a file with:
 *       for f in ~/.studio-inbox/*.json; do
 *         printf '%s  %s\n' "$(basename "$f" | tr -d '\n' | shasum -a 256 | cut -c1-8)" "$f"
 *       done
 *     Filesystem errors log err.code only, never raw messages.
 */

import { readdir, readFile, rename, unlink, stat, mkdir, chmod } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import chokidar from "chokidar";
import { createDebouncedSingleFlight } from "./vault-watcher.mjs";

/** FIX 12 — opaque log identifier for an inbox filename (never the name itself). */
export function artifactLabel(name) {
  return `artifact#${createHash("sha256").update(name).digest("hex").slice(0, 8)}`;
}

const NAME_RE = /^editorial-board-(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z-(.+)\.json$/;

/** Parse the §2b filename convention. Returns null for nonconforming names. */
export function parseArtifactName(name) {
  const m = NAME_RE.exec(name);
  if (!m) return null;
  const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}.${m[7]}Z`;
  const timestampMs = Date.parse(iso);
  if (Number.isNaN(timestampMs)) return null;
  return { timestampMs, suffix: m[8] };
}

/**
 * Deterministic §2b processing order.
 * @param {Array<{ name: string, mtimeMs: number }>} entries
 */
export function orderInboxFiles(entries) {
  return [...entries].sort((a, b) => {
    const pa = parseArtifactName(a.name);
    const pb = parseArtifactName(b.name);
    const ka = pa ? pa.timestampMs : a.mtimeMs; // filename timestamp primary, mtime fallback
    const kb = pb ? pb.timestampMs : b.mtimeMs;
    if (ka !== kb) return ka - kb;
    if (pa && pb && pa.suffix !== pb.suffix) return pa.suffix < pb.suffix ? -1 : 1; // suffix tie-break
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  });
}

/**
 * Pure event filter: does an absolute fs path represent a live inbox artifact?
 *
 * LOW-2 (UXI-8): the watcher watches the inbox DIRECTORY, not a
 * `{inboxPath}/*.json` glob — an inbox path containing glob metacharacters
 * (e.g. ".../My Inbox (backup)") would otherwise be parsed as extglob and
 * silently match nothing, dropping every live `add` event. This filter accepts
 * ONLY a direct-child `*.json` file, so events for the `rejected/` quarantine
 * subtree and non-JSON files are ignored — matching what the readdir-based
 * drain already processes. Exported so the semantics are testable without
 * chokidar.
 */
export function createInboxEventFilter(inboxPath) {
  return (absPath) => {
    if (typeof absPath !== "string" || absPath.length === 0) return false;
    const rel = path.relative(inboxPath, absPath);
    if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return false; // outside the inbox
    if (rel.split(path.sep).length !== 1) return false; // direct child only (excludes rejected/*)
    return rel.endsWith(".json");
  };
}

/** Create/verify inbox + rejected/ with mode 700 (repairing looser modes). */
export async function ensureInboxDirs(inboxPath, logger) {
  for (const dir of [inboxPath, path.join(inboxPath, "rejected")]) {
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const st = await stat(dir);
    if ((st.mode & 0o077) !== 0) {
      await chmod(dir, 0o700);
      logger?.warn("tightened inbox directory permissions to 700");
    }
  }
}

/** Wait until a file's size is stable (guards against partial writes). */
export async function waitForStableSize(
  filePath,
  { intervalMs = 250, stableChecks = 2, maxWaitMs = 10000, sleep } = {},
) {
  const wait = sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const deadline = Date.now() + maxWaitMs;
  let lastSize = -1;
  let stable = 0;
  while (Date.now() <= deadline) {
    let size;
    try {
      size = (await stat(filePath)).size;
    } catch {
      return false; // vanished mid-wait
    }
    if (size === lastSize && size > 0) {
      stable += 1;
      if (stable >= stableChecks) return true;
    } else {
      stable = 0;
      lastSize = size;
    }
    await wait(intervalMs);
  }
  return true; // proceed after max wait; JSON validation catches partials
}

export function createInboxWatcher({ inboxPath, submit, logger, stability = {}, debounceMs = 250 }) {
  const rejectedDir = path.join(inboxPath, "rejected");

  async function moveToRejected(name, reason) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    try {
      await rename(path.join(inboxPath, name), path.join(rejectedDir, `${stamp}-${name}`));
      logger.warn(`inbox ${artifactLabel(name)} moved to rejected/ — ${reason}`);
    } catch (e) {
      logger.error(`could not move inbox ${artifactLabel(name)} to rejected/: ${e?.code ?? "error"}`);
    }
  }

  /**
   * @returns {"success"|"rejected"|"conflict"|"unavailable"|"gone"}
   */
  async function processFile(name) {
    const filePath = path.join(inboxPath, name);

    const present = await waitForStableSize(filePath, stability);
    if (!present) return "gone";

    let raw;
    try {
      raw = await readFile(filePath, "utf8");
    } catch {
      return "gone";
    }

    let artifact;
    try {
      artifact = JSON.parse(raw);
    } catch {
      // Generic on purpose: parse error text can quote file content.
      await moveToRejected(name, "not valid JSON");
      return "rejected";
    }

    const result = await submit(artifact);
    switch (result.outcome) {
      case "success":
        try {
          await unlink(filePath);
        } catch (e) {
          logger.error(`submitted inbox ${artifactLabel(name)} but could not remove it: ${e?.code ?? "error"}`);
        }
        logger.info(`inbox ${artifactLabel(name)} submitted (${result.status}) and removed`);
        return "success";
      case "validation-error":
        await moveToRejected(name, "failed §2b validation (see log lines above)");
        return "rejected";
      case "contract-drift":
        await moveToRejected(name, `server rejected it (HTTP ${result.httpStatus}) — contract drift; preserved in rejected/`);
        return "rejected";
      case "conflict":
        logger.warn(`inbox ${artifactLabel(name)} hit a revision conflict — will resubmit with the recovered revision`);
        return "conflict";
      default:
        return "unavailable";
    }
  }

  /**
   * One serialized drain pass, oldest-first.
   * @returns {Promise<{ paused: boolean, conflict?: boolean }>}
   */
  async function drainPass() {
    let names;
    try {
      names = await readdir(inboxPath, { withFileTypes: true });
    } catch (e) {
      logger.error(`could not read inbox directory: ${e?.code ?? "error"}`);
      return { paused: true };
    }

    const entries = [];
    for (const d of names) {
      if (!d.isFile() || !d.name.endsWith(".json")) continue;
      try {
        entries.push({ name: d.name, mtimeMs: (await stat(path.join(inboxPath, d.name))).mtimeMs });
      } catch {
        /* vanished between readdir and stat */
      }
    }

    for (const entry of orderInboxFiles(entries)) {
      const outcome = await processFile(entry.name);
      if (outcome === "unavailable") {
        logger.warn("inbox drain paused: endpoint unavailable — remaining artifacts stay in the inbox for the next drain");
        return { paused: true };
      }
      if (outcome === "conflict") {
        return { paused: true, conflict: true };
      }
    }
    return { paused: false };
  }

  /** Drain with a single bounded follow-up pass after a conflict recovery. */
  async function drain() {
    const first = await drainPass();
    if (first.conflict) {
      const second = await drainPass(); // recovered revision → accepted/idempotent
      if (second.conflict) {
        logger.warn("inbox drain still conflicting after recovery — waiting for the next trigger");
      }
    }
  }

  const runner = createDebouncedSingleFlight({ debounceMs, run: drain, logger });
  let watcher = null;

  return {
    /** Ensure dirs, run the startup drain, then watch live. */
    async start() {
      await ensureInboxDirs(inboxPath, logger);
      await runner.runNow(); // startup drain (serialized with any live trigger)
      // Watch the inbox DIRECTORY itself — no glob in the watch path (LOW-2):
      // an inbox path with glob metacharacters would break a `*.json` watch.
      // depth 0 keeps traversal at the top level; `ignored` prunes the
      // rejected/ quarantine dir; `relevant` filters surviving events to
      // direct-child *.json files. followSymlinks: false for consistency with
      // the vault watcher (an inbox symlink must not pull in outside paths).
      const relevant = createInboxEventFilter(inboxPath);
      watcher = chokidar.watch(inboxPath, {
        persistent: true,
        ignoreInitial: true,
        depth: 0,
        followSymlinks: false,
        // LOW-2 core: treat the watch path LITERALLY. chokidar v3 otherwise
        // parses glob metacharacters in the path string itself, so an inbox at
        // e.g. ".../My Inbox (backup)" would match nothing and never fire.
        disableGlobbing: true,
        ignored: (watchedPath) => {
          const rel = path.relative(inboxPath, watchedPath);
          if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return false;
          return rel.split(path.sep)[0] === "rejected"; // never watch the quarantine subtree
        },
      });
      watcher.on("add", (p) => {
        if (relevant(p)) runner.trigger();
      });
      // err.code only — watcher error messages can embed filenames (FIX 12).
      watcher.on("error", (e) => logger.error(`inbox watcher error: ${e?.code ?? "unknown"}`));
      logger.info("inbox watcher ready");
    },
    drainNow: () => runner.runNow(),
    async close() {
      runner.close();
      if (watcher) await watcher.close();
    },
    // exposed for tests
    _drainPass: drainPass,
    _processFile: processFile,
  };
}
