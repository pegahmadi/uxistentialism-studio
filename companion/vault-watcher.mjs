/*
 * Vault watcher (WS-2): chokidar + debounce + single-flight queue.
 *
 * - Watches {vaultPath}/{watchGlob} read-only ({ persistent, ignoreInitial }).
 * - add/change events reset a debounce timer; when it fires, one sync runs.
 * - SINGLE-FLIGHT: while a sync is running, at most ONE follow-up is queued;
 *   intermediate events collapse into it (only the latest vault state matters).
 * - runNow() bypasses the debounce (SIGUSR1 / reconciliation / startup).
 * - Event file paths are NEVER logged — note filenames are private.
 *
 * The debounce/single-flight core is exported separately so tests exercise it
 * without chokidar or a real filesystem.
 */

import path from "node:path";
import chokidar from "chokidar";

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
      logger?.error(`sync failed: ${e?.message ?? "unknown error"}`);
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

  const watcher = chokidar.watch(path.join(vaultPath, watchGlob), {
    persistent: true,
    ignoreInitial: true,
  });
  // Never log event paths: vault note filenames are private.
  watcher.on("add", () => runner.trigger());
  watcher.on("change", () => runner.trigger());
  watcher.on("error", (e) => logger.error(`vault watcher error: ${e?.message ?? "unknown"}`));
  watcher.on("ready", () => logger.info("vault watcher ready"));

  return {
    runner,
    async close() {
      runner.close();
      await watcher.close();
    },
  };
}
