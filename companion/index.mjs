#!/usr/bin/env node
/*
 * Studio Sync companion daemon (WS-2) — entry point.
 *
 * Startup sequence:
 *   1. Load config (refuses to start unless the file is mode 600).
 *   2. Build the redacting logger (secret, vault path, inbox path, home dir).
 *   3. Ensure inbox + rejected/ exist with mode 700; realpath-normalize.
 *   4. Open the status store (two persisted revision sequences).
 *   5. Startup inbox drain, then live inbox watch.
 *   6. Vault watcher (debounced, single-flight) + initial sync.
 *   7. Reconciliation timer (default 6h) — idempotent reconciliations refresh
 *      the server heartbeat (§6 freshness rule).
 *   8. SIGUSR1 → immediate sync + inbox drain. SIGTERM/SIGINT → clean shutdown.
 *
 * The companion never writes the vault, never writes data/projections/*.json,
 * and has no direct-POST fallback for board sessions.
 */

import os from "node:os";
import { realpath } from "node:fs/promises";
import { loadConfig, DEFAULT_CONFIG_PATH } from "./config.mjs";
import { createLogger } from "./logger.mjs";
import { createStatusStore } from "./status.mjs";
import { createIngestor } from "./ingestor.mjs";
import { createSyncPipeline } from "./sync-pipeline.mjs";
import { createVaultWatcher } from "./vault-watcher.mjs";
import { createInboxWatcher, ensureInboxDirs } from "./inbox-watcher.mjs";

async function main() {
  const configPath = process.env.STUDIO_COMPANION_CONFIG || DEFAULT_CONFIG_PATH;

  // Bootstrap logger for the window before the config (and its redaction
  // values) is available: redact the home directory at minimum.
  const boot = createLogger({ redactions: [[os.homedir(), "~"]] });

  let config;
  try {
    config = await loadConfig({ configPath });
  } catch (e) {
    boot.error(`startup failed: ${e.message}`);
    process.exit(1);
  }

  const logger = createLogger({
    redactions: [
      [config.syncSecret, "[redacted-secret]"],
      [config.vaultPath, "[vault]"],
      [config.inboxPath, "[inbox]"],
      [os.homedir(), "~"],
    ],
  });

  try {
    await ensureInboxDirs(config.inboxPath, logger);
  } catch (e) {
    logger.error(`startup failed: could not prepare the inbox directory: ${e?.code ?? e.message}`);
    process.exit(1);
  }
  const inboxPath = await realpath(config.inboxPath); // normalized after creation

  const status = await createStatusStore({ statusPath: config.statusPath, logger });
  const ingestor = createIngestor({
    studioUrl: config.studioUrl,
    syncSecret: config.syncSecret,
    logger,
  });
  const pipeline = createSyncPipeline({ config, status, ingestor, logger });

  const inbox = createInboxWatcher({ inboxPath, submit: pipeline.submitEditorialBoard, logger });
  await inbox.start(); // startup drain + live watch

  const vault = createVaultWatcher({
    vaultPath: config.vaultPath,
    watchGlob: config.watchGlob,
    debounceMs: config.debounceMs,
    onSync: pipeline.syncObsidian,
    logger,
  });

  const reconcile = setInterval(() => {
    logger.info("reconciliation sync (interval)");
    void vault.runner.runNow();
  }, config.reconcileIntervalMs);

  process.on("SIGUSR1", () => {
    logger.info("SIGUSR1 received — immediate sync");
    void vault.runner.runNow();
    void inbox.drainNow();
  });

  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`${signal} received — shutting down`);
    clearInterval(reconcile);
    try {
      await vault.close();
      await inbox.close();
    } finally {
      process.exit(0);
    }
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  logger.info("studio companion started");
  void vault.runner.runNow(); // initial sync doubles as recovery after downtime
}

main().catch((e) => {
  // Redact the home directory even in last-resort failures.
  const msg = String(e?.message ?? e).split(os.homedir()).join("~");
  process.stderr.write(`studio companion fatal: ${msg}\n`);
  process.exit(1);
});
