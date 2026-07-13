/*
 * Sync pipeline (WS-2): project → validate → envelope → ingest → status.
 *
 * Two flows share the envelope/submit/status tail:
 *   syncObsidian()            — vault projection → /api/ingest/obsidian
 *   submitEditorialBoard()    — inbox artifact  → /api/ingest/editorial-board
 *
 * Status bookkeeping follows contract §6 client semantics:
 *   success   → recordSuccess(revision sent, payloadHash)
 *   conflict  → recordConflict(storedRevision): NO lastSuccess, sequence
 *               recovered so the next submission uses storedRevision + 1
 *   drift/4xx → recordError, no retry (surfaced, never silent)
 *   unavailable → recordError; the next trigger resubmits
 *
 * Nothing here ever writes the vault or data/projections/*.json.
 */

import { VaultError } from "../tools/vault-audit/_shared.mjs";
import { runProjection } from "./projector.mjs";
import { validateObsidianData, validateInboxArtifact } from "./validator.mjs";
import { buildEnvelope } from "./envelope.mjs";

export function createSyncPipeline({ config, status, ingestor, logger, projectFn = runProjection }) {
  async function submitWithStatus(endpointKey, endpointPath, { source, sourceUpdatedAt, data }) {
    const revision = status.nextRevision(endpointKey);

    let envelope;
    try {
      envelope = buildEnvelope({ source, sourceUpdatedAt, data, revision });
    } catch (e) {
      await status.recordError(endpointKey, `envelope construction failed: ${e.message}`);
      logger.error(`envelope construction failed for ${endpointPath}: ${e.message}`);
      return { outcome: "validation-error" };
    }

    const result = await ingestor.submit(endpointPath, envelope);

    if (result.outcome === "success") {
      await status.recordSuccess(endpointKey, { revision, payloadHash: envelope.payloadHash });
      logger.info(`${endpointPath}: ${result.status} (revision ${revision})`);
    } else if (result.outcome === "conflict") {
      await status.recordConflict(endpointKey, {
        storedRevision: result.storedRevision,
        error: result.error,
      });
      logger.warn(
        `${endpointPath}: conflict (${result.error}) — revision sequence recovered; next submission uses ${
          Number.isInteger(result.storedRevision) ? result.storedRevision + 1 : "a recovered revision"
        }`,
      );
    } else if (result.outcome === "contract-drift") {
      await status.recordError(
        endpointKey,
        `contract drift: HTTP ${result.httpStatus}${result.error ? ` ${result.error}` : ""}`,
      );
    } else {
      await status.recordError(endpointKey, "endpoint unavailable after retries");
    }

    return result;
  }

  /** Full vault sync. Returns the submission result (or an error outcome). */
  async function syncObsidian() {
    await status.recordAttempt("obsidianProjection");

    let projection;
    try {
      projection = await projectFn({ vaultPath: config.vaultPath });
    } catch (e) {
      // Code/category only (FIX 12): non-VaultError messages (fs errors) can
      // embed note filenames or paths.
      const msg = `projection failed (${e instanceof VaultError ? e.code : (e?.code ?? e?.name ?? "unknown error")})`;
      await status.recordError("obsidianProjection", msg);
      logger.error(msg);
      return { outcome: "projection-error" };
    }

    const { ok, violations } = await validateObsidianData({
      data: projection.data,
      vaultPath: config.vaultPath,
      ...(config.allowlistPath ? { allowlistPath: config.allowlistPath } : {}),
    });
    if (!ok) {
      await status.recordError(
        "obsidianProjection",
        `local validation failed (${violations.length} violation${violations.length === 1 ? "" : "s"}) — not submitted`,
      );
      for (const v of violations) logger.error(`projection validation: ${v}`);
      return { outcome: "validation-error", violations };
    }

    if (projection.missing.length > 0) {
      // Allowlist entries are public (committed allowlist.json), so ids are safe to log.
      logger.warn(`allowlisted concepts not found in vault: ${projection.missing.length}`);
    }

    return submitWithStatus("obsidianProjection", "/api/ingest/obsidian", {
      source: "companion",
      sourceUpdatedAt: projection.sourceUpdatedAt,
      data: projection.data,
    });
  }

  /**
   * Validate and submit one inbox artifact ({ sourceUpdatedAt, data }).
   * The companion owns the entire envelope (§1 envelope ownership).
   */
  async function submitEditorialBoard(artifact) {
    await status.recordAttempt("editorialBoard");

    const violations = validateInboxArtifact(artifact);
    if (violations.length > 0) {
      await status.recordError(
        "editorialBoard",
        `artifact validation failed (${violations.length} violation${violations.length === 1 ? "" : "s"}) — not submitted`,
      );
      for (const v of violations) logger.error(`inbox validation: ${v}`);
      return { outcome: "validation-error", violations };
    }

    return submitWithStatus("editorialBoard", "/api/ingest/editorial-board", {
      source: "editorial-board-inbox",
      sourceUpdatedAt: artifact.sourceUpdatedAt,
      data: artifact.data,
    });
  }

  return { syncObsidian, submitEditorialBoard };
}
