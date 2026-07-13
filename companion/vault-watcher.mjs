/*
 * Vault watcher (WS-2): chokidar + debounce + single-flight queue.
 *
 * - Watches the vault ROOT (read-only, { persistent, ignoreInitial }) and
 *   filters events against the vault-relative watchGlob (default "**\/*.md")
 *   plus the projector's skip set (VAULT_SKIP_FOLDERS + dot-dirs), so the
 *   watcher and the projector agree about which notes exist.
 * - add/change/unlink events reset a debounce timer; when it fires, one sync
 *   runs. Deletions matter: an unlinked allowlisted note must leave the
 *   projection, so unlink triggers the pipeline too (FIX 5).
 * - SINGLE-FLIGHT: while a sync is running, at most ONE follow-up is queued;
 *   intermediate events collapse into it (only the latest vault state matters).
 * - runNow() bypasses the debounce (SIGUSR1 / reconciliation / startup).
 * - Event file paths are NEVER logged — note filenames are private. Watcher
 *   errors log err.code only, never err.message (which can embed paths).
 *
 * The debounce/single-flight core is exported separately so tests exercise it
 * without chokidar or a real filesystem.
 */

import path from "node:path";
import picomatch from "picomatch";
import chokidar from "chokidar";

/**
 * Mirrors the projector's DEFAULT_SKIP (tools/vault-audit/_shared.mjs). The
 * projector additionally skips every dot-directory; the filter below applies
 * the same rule via the segment dot-check.
 */
export const VAULT_SKIP_FOLDERS = Object.freeze([
  ".obsidian",
  ".trash",
  ".git",
  ".stversions",
  "node_modules",
  "Templates",
]);

const hasSkippedSegment = (segments) =>
  segments.some((s) => s.startsWith(".") || VAULT_SKIP_FOLDERS.includes(s));

/**
 * Pure event filter: does an absolute fs path represent a watched note?
 * Exported so the glob/skip semantics are testable without chokidar.
 */
export function createVaultEventFilter({ vaultPath, watchGlob }) {
  // Parens/pipes are LITERAL: real vault directories are named like
  // "02 Concepts (Ontology)", and treating them as extglob metacharacters
  // would silently match nothing. *, ?, [], {} keep their glob meaning.
  const literalized = watchGlob.replace(/[()|]/g, "\\$&");
  const match = picomatch(literalized, { dot: false });
  return (absPath) => {
    if (typeof absPath !== "string" || absPath.length === 0) return false;
    const rel = path.relative(vaultPath, absPath);
    if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return false; // outside the vault
    const segments = rel.split(path.sep);
    if (hasSkippedSegment(segments)) return false;
    return match(segments.join("/"));
  };
}

export function createDebouncedSingleFlight({ debounceMs, run, logger }) {
  let timer = null;
  let running = false;
  let pending = false;
  let closed = false;

  async function execute() {
    if (closed) return;
    if (running) {
      pending = true; // collapse all triggers-during-run into one follow-up
      return;
    }
    running = true;
    try {
      await run();
    } catch (e) {
      // Code/category only: raw messages from fs/watcher errors can embed
      // note filenames (FIX 12).
      logger?.error(`sync failed: ${e?.code ?? e?.name ?? "unknown error"}`);
    } finally {
      running = false;
      if (pending && !closed) {
        pending = false;
        void execute();
      }
    }
  }

  return {
    /** Debounced trigger: restarts the timer on every call. */
    trigger() {
      if (closed) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        void execute();
      }, debounceMs);
    },
    /** Immediate run, bypassing the debounce (still single-flight). */
    runNow() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      return execute();
    },
    close() {
      closed = true;
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}

export function createVaultWatcher({ vaultPath, watchGlob, debounceMs, onSync, logger }) {
  const runner = createDebouncedSingleFlight({ debounceMs, run: onSync, logger });
  const relevant = createVaultEventFilter({ vaultPath, watchGlob });

  // Watch the vault root itself (no glob in the watch path: vault directory
  // names like "02 Concepts (Ontology)" contain glob metacharacters). The
  // `ignored` callback prunes skip folders from traversal; `relevant` filters
  // the surviving events against watchGlob.
  const watcher = chokidar.watch(vaultPath, {
    persistent: true,
    ignoreInitial: true,
    ignored: (watchedPath) => {
      const rel = path.relative(vaultPath, watchedPath);
      if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return false;
      return hasSkippedSegment(rel.split(path.sep));
    },
  });

  // Never log event paths: vault note filenames are private.
  const onEvent = (p) => {
    if (relevant(p)) runner.trigger();
  };
  watcher.on("add", onEvent);
  watcher.on("change", onEvent);
  watcher.on("unlink", onEvent); // deleted allowlisted notes must sync out (FIX 5)
  // err.code only — watcher error messages can embed note paths (FIX 12).
  watcher.on("error", (e) => logger.error(`vault watcher error: ${e?.code ?? "unknown"}`));
  watcher.on("ready", () => logger.info("vault watcher ready"));

  return {
    runner,
    async close() {
      runner.close();
      await watcher.close();
    },
  };
}
