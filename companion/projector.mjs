/*
 * Thin adapter over the coordinator-owned pure projector (WS-2).
 *
 * `project()` is read-only, throws VaultError (incl. VAULT_EMPTY) instead of
 * exiting, and writes nothing. The companion NEVER writes
 * data/projections/*.json and never touches the vault.
 */

import { project } from "../integrations/obsidian/project.mjs";

/**
 * @param {object} opts
 * @param {string} opts.vaultPath        realpath-normalized vault root
 * @param {string[]} [opts.skipFolders]  additive — safety defaults preserved
 * @returns {Promise<{ data: object, sourceUpdatedAt: string, missing: string[] }>}
 */
export async function runProjection({ vaultPath, skipFolders }) {
  return project({ vaultPath, ...(skipFolders ? { skipFolders } : {}) });
}
