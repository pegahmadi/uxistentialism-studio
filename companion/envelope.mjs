/*
 * Transport envelope construction (WS-2 owns the FULL envelope, §1).
 *
 * - payloadHash via the shared substantiveHash (tools/canonical-hash.mjs):
 *   top-level data.generatedAt is excluded, so a generatedAt-only change
 *   produces an identical hash (idempotent reconciliation, §1b).
 * - substantiveHash's canonicalization THROWS on any non-JSON value
 *   (undefined, NaN, ±Infinity, BigInt, functions, circular refs) — this is
 *   the §1b JSON-safety guard, applied BEFORE anything is serialized or sent.
 * - Timestamps are exact Date.toISOString() format (§1).
 */

import { substantiveHash } from "../tools/canonical-hash.mjs";
import { ISO_EXACT } from "./validator.mjs";

export const SCHEMA_VERSION = 1;
export const SOURCES = Object.freeze(["companion", "editorial-board-inbox"]);

/**
 * @param {object} opts
 * @param {"companion"|"editorial-board-inbox"} opts.source
 * @param {string} opts.sourceUpdatedAt   exact toISOString (verbatim from projector / artifact)
 * @param {object} opts.data
 * @param {number} opts.revision          integer >= 1, from the endpoint's persisted sequence
 * @param {number} [opts.now]             epoch ms for projectedAt (default Date.now())
 */
export function buildEnvelope({ source, sourceUpdatedAt, data, revision, now = Date.now() }) {
  if (!SOURCES.includes(source)) {
    throw new Error(`invalid envelope source "${source}"`);
  }
  if (typeof sourceUpdatedAt !== "string" || !ISO_EXACT.test(sourceUpdatedAt)) {
    throw new Error("sourceUpdatedAt must be exact Date.toISOString() format (§1)");
  }
  if (!Number.isInteger(revision) || revision < 1) {
    throw new Error("revision must be an integer >= 1 (§1)");
  }
  // §1b JSON-safety guard + hash in one step: throws on non-JSON values.
  const payloadHash = substantiveHash(data);

  return {
    schemaVersion: SCHEMA_VERSION,
    source,
    sourceUpdatedAt,
    projectedAt: new Date(now).toISOString(),
    revision,
    payloadHash,
    data,
  };
}
