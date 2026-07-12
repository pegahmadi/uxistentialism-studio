/*
 * Canonical serialization + substantive payload hash — REFERENCE IMPLEMENTATION.
 *
 * This is the single source of truth for INGESTION_CONTRACT.md §1b. The
 * companion (WS-2) and the ingestion endpoints (WS-1) must use this module —
 * or match it exactly — so client and server hashing cannot drift. Behavior is
 * locked by tools/tests/canonical-hash.test.mjs.
 *
 * Rules (§1b):
 *   - objects: keys sorted lexicographically, recursively
 *   - arrays: order retained (semantically meaningful)
 *   - no insignificant whitespace; JSON.stringify semantics for scalars
 *   - non-JSON values (undefined, NaN, ±Infinity, functions, BigInt, circular
 *     references) throw — callers reject the payload as invalid_schema
 *   - substantive hash: the TOP-LEVEL data.generatedAt field is excluded from
 *     the hash input (temporal metadata of a run, not intellectual-state
 *     identity); nested fields of the same name are hashed normally
 *
 * Coordinator-owned shared infrastructure. Implementation workstreams import
 * it; they never modify it.
 */

import { createHash } from "node:crypto";

/** Canonical serialization of a pure-JSON value. Throws TypeError on non-JSON values. */
export function canonicalize(value, seen = new WeakSet()) {
  if (value === null) return "null";
  const t = typeof value;
  if (t === "string" || t === "boolean") return JSON.stringify(value);
  if (t === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Non-finite number has no JSON representation");
    return JSON.stringify(value);
  }
  if (t === "object") {
    if (seen.has(value)) throw new TypeError("Circular reference has no JSON representation");
    seen.add(value);
    let out;
    if (Array.isArray(value)) {
      out = "[" + value.map((v) => canonicalize(v, seen)).join(",") + "]";
    } else {
      const keys = Object.keys(value).sort();
      out =
        "{" +
        keys.map((k) => `${JSON.stringify(k)}:${canonicalize(value[k], seen)}`).join(",") +
        "}";
    }
    seen.delete(value);
    return out;
  }
  // undefined, function, bigint, symbol
  throw new TypeError(`Value of type ${t} has no JSON representation`);
}

/**
 * Substantive payload hash per §1b: canonical serialization of `data` with the
 * TOP-LEVEL `generatedAt` key excluded, SHA-256, "sha256-" + hex.
 */
export function substantiveHash(data) {
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw new TypeError("substantiveHash expects a plain data object");
  }
  const rest = { ...data };
  delete rest.generatedAt; // top-level only; nested generatedAt fields are hashed
  const canonical = canonicalize(rest);
  return "sha256-" + createHash("sha256").update(canonical, "utf8").digest("hex");
}
