/*
 * Persistent companion status store (WS-2).
 *
 * Owns the TWO independent revision sequences required by the contract
 * (§1 envelope ownership): "obsidianProjection" and "editorialBoard".
 *
 * Guarantees (PLAN.md, Coordinator Amendment #2):
 *   - Writes are ATOMIC: serialize to a same-directory temp file (mode 600),
 *     then rename over status.json. A crash between the temp write and the
 *     rename leaves the previous state fully intact.
 *   - Writes are SERIALIZED (FIX 7): the vault and inbox flows can persist
 *     concurrently, and an out-of-order rename could leave disk older than
 *     memory (losing one endpoint's revision on restart). All writes flow
 *     through a promise queue; each write serializes the CURRENT in-memory
 *     state, so disk always converges to the latest state. A failed write
 *     rejects its caller but never poisons the queue.
 *   - Revision state survives restart: sequences are re-read from disk on
 *     construction.
 *   - 409 recovery: recordConflict(storedRevision) resets the sequence so the
 *     next submission uses storedRevision + 1 (contract §6 client semantics).
 *   - Error strings stored here are pre-redacted by callers; this module
 *     never stores secrets, headers, or private paths.
 */

import { readFile, writeFile, rename, unlink, mkdir } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";

export const ENDPOINTS = Object.freeze(["obsidianProjection", "editorialBoard"]);

const emptyEndpoint = () => ({
  lastAttempt: null,
  lastSuccess: null,
  lastRevision: 0, // nextRevision() = lastRevision + 1, so the first submission is revision 1
  lastPayloadHash: null,
  lastError: null,
  lastConflict: null,
});

/**
 * @param {object} opts
 * @param {string} opts.statusPath
 * @param {object} [opts.logger]
 * @param {object} [opts.fsOps]   injectable { writeFile, rename } for crash-safety tests
 */
export async function createStatusStore({ statusPath, logger, fsOps } = {}) {
  if (!statusPath) throw new Error("createStatusStore requires statusPath");
  const ops = { writeFile, rename, ...fsOps };

  const state = { obsidianProjection: emptyEndpoint(), editorialBoard: emptyEndpoint() };
  try {
    const parsed = JSON.parse(await readFile(statusPath, "utf8"));
    for (const ep of ENDPOINTS) {
      if (parsed && typeof parsed[ep] === "object" && parsed[ep] !== null) {
        state[ep] = { ...emptyEndpoint(), ...parsed[ep] };
        if (!Number.isInteger(state[ep].lastRevision) || state[ep].lastRevision < 0) {
          state[ep].lastRevision = 0;
        }
      }
    }
  } catch (e) {
    if (e?.code !== "ENOENT") {
      // Corrupt status file: start fresh. A too-low revision self-heals via
      // the contract's 409 duplicate → storedRevision recovery path (§6).
      logger?.warn("status file unreadable — starting with fresh status (revision recovery via 409 if needed)");
    }
  }

  await mkdir(path.dirname(statusPath), { recursive: true, mode: 0o700 });

  async function persistNow() {
    const tmp = `${statusPath}.tmp-${process.pid}-${randomBytes(4).toString("hex")}`;
    await ops.writeFile(tmp, JSON.stringify(state, null, 2) + "\n", { mode: 0o600 });
    try {
      await ops.rename(tmp, statusPath);
    } catch (e) {
      try {
        await unlink(tmp);
      } catch {
        /* best effort */
      }
      throw e;
    }
  }

  // FIX 7 — promise-queue mutex: writes run strictly one after another, each
  // snapshotting the in-memory state at execution time. The tail swallows
  // rejections so one failed write never poisons subsequent writes.
  let writeQueue = Promise.resolve();
  function persist() {
    const write = writeQueue.then(persistNow);
    writeQueue = write.catch(() => {});
    return write;
  }

  const assertEndpoint = (ep) => {
    if (!ENDPOINTS.includes(ep)) throw new Error(`unknown status endpoint "${ep}"`);
  };

  return {
    statusPath,

    /** Snapshot of one endpoint's status (copy — mutations do not leak). */
    get(endpoint) {
      assertEndpoint(endpoint);
      return structuredClone(state[endpoint]);
    },

    /** Next revision to send: lastRevision + 1. Does not persist by itself. */
    nextRevision(endpoint) {
      assertEndpoint(endpoint);
      return state[endpoint].lastRevision + 1;
    },

    async recordAttempt(endpoint, at = new Date().toISOString()) {
      assertEndpoint(endpoint);
      state[endpoint].lastAttempt = at;
      await persist();
    },

    /** 200 accepted / 200 idempotent — both are success (§6). */
    async recordSuccess(endpoint, { revision, payloadHash, at = new Date().toISOString() }) {
      assertEndpoint(endpoint);
      const s = state[endpoint];
      s.lastSuccess = at;
      s.lastRevision = revision;
      s.lastPayloadHash = payloadHash;
      s.lastError = null;
      s.lastConflict = null;
      await persist();
    },

    /**
     * 409 stale_payload / duplicate — non-retryable. No lastSuccess. Recover
     * the sequence: lastRevision = storedRevision so next = storedRevision + 1.
     */
    async recordConflict(endpoint, { storedRevision, error, at = new Date().toISOString() }) {
      assertEndpoint(endpoint);
      const s = state[endpoint];
      if (Number.isInteger(storedRevision) && storedRevision >= 0) {
        s.lastRevision = storedRevision;
      }
      s.lastConflict = { error: error ?? "conflict", at };
      s.lastError = `conflict: ${error ?? "conflict"}`;
      await persist();
    },

    async recordError(endpoint, message) {
      assertEndpoint(endpoint);
      state[endpoint].lastError = String(message);
      await persist();
    },
  };
}
