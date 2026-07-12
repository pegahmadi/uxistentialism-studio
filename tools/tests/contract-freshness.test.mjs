#!/usr/bin/env node
/*
 * Contract-semantics test: §6 atomic write policy + §8 freshness rule, using
 * the REAL §1b hashing rule (tools/canonical-hash.mjs) and projector-shaped
 * payloads.
 *
 * Proves the required property end-to-end: an unchanged vault reprojected every
 * 6 hours produces a fresh generatedAt each run, yet the SUBSTANTIVE hash is
 * unchanged → the server takes the idempotent branch → the heartbeat refreshes
 * → the data never becomes operationally stale. WS-1's Redis implementation
 * must satisfy this same state machine.
 *
 * Portable: no Redis, no vault, no config.
 * Usage: node tools/tests/contract-freshness.test.mjs
 */

import { substantiveHash } from "../canonical-hash.mjs";

const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const iso = (ms) => new Date(ms).toISOString();

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail !== undefined ? ` -> ${JSON.stringify(detail)}` : ""}`); }
}

// §8: stale = lastSuccessfulSync missing or older than 24h.
function isStale(lastSuccessfulSyncMs, nowMs) {
  if (lastSuccessfulSyncMs == null) return true;
  return nowMs - lastSuccessfulSyncMs > STALE_THRESHOLD_MS;
}

/**
 * §6 state machine — the atomic script, modeled purely. The server recomputes
 * the SUBSTANTIVE hash (§1b) from the received data; the client-asserted hash
 * is never used for comparison.
 * state = { data, prev, meta: { revision, projectedAtMs, payloadHash, lastSuccessfulSyncMs } | null }
 */
function applyIngest(state, incoming, serverNowMs) {
  const recomputedHash = substantiveHash(incoming.data); // server-side recompute
  const meta = state.meta;
  if (meta) {
    if (recomputedHash === meta.payloadHash) {
      // Idempotent: heartbeat refresh ONLY — stored data (incl. its original
      // generatedAt), hash, projectedAt, revision, prev all unchanged; the
      // incoming run's fresh generatedAt/projectedAt are discarded.
      return {
        status: "idempotent",
        state: { ...state, meta: { ...meta, lastSuccessfulSyncMs: serverNowMs } },
      };
    }
    if (incoming.projectedAtMs < meta.projectedAtMs) return { status: "stale_payload", state };
    if (incoming.revision <= meta.revision && incoming.projectedAtMs !== meta.projectedAtMs) {
      return { status: "duplicate", state };
    }
  }
  // Accepted: backup + write data and meta together.
  return {
    status: "accepted",
    state: {
      data: incoming.data,
      prev: state.data ?? null,
      meta: {
        revision: incoming.revision,
        projectedAtMs: incoming.projectedAtMs,
        payloadHash: recomputedHash,
        lastSuccessfulSyncMs: serverNowMs,
      },
    },
  };
}

// Projector-shaped payloads: reprojecting an UNCHANGED vault yields the same
// substance with a fresh generatedAt (this is what integrations/obsidian/
// project.mjs actually produces).
const SUBSTANCE_V1 = {
  concepts: [{ id: "alpha", title: "Alpha", kind: "core", category: "t", summary: "A.", presentIn: ["today"], backlinks: 2 }],
  connections: [],
  emerging: [{ term: "gamma missing", references: 1 }],
};
const projectUnchanged = (nowMs) => ({ generatedAt: iso(nowMs), ...SUBSTANCE_V1 });

// ---------- Hashing precondition (the third-review blocker) ----------

console.log("Real hashing rule on real projector shapes:");
check("two runs over an unchanged vault → identical substantive hash",
  substantiveHash(projectUnchanged(0)) === substantiveHash(projectUnchanged(6 * HOUR)));
check("their generatedAt values differ (temporal metadata only)",
  projectUnchanged(0).generatedAt !== projectUnchanged(6 * HOUR).generatedAt);

// ---------- The required property: 6-hourly reconciliation of an unchanged
// ---------- vault stays idempotent and never becomes operationally stale.

console.log("Freshness under unchanged-vault reconciliation (48h simulation):");
const T0 = Date.parse("2026-07-12T00:00:00.000Z");
let state = { data: null, prev: null, meta: null };

let r = applyIngest(state, { data: projectUnchanged(T0), revision: 1, projectedAtMs: T0 }, T0);
state = r.state;
check("initial submission accepted", r.status === "accepted");
const storedGeneratedAt = state.data.generatedAt;

let everStale = false;
let wrongBehavior = false;
for (let h = 6; h <= 48; h += 6) {
  const now = T0 + h * HOUR;
  if (isStale(state.meta.lastSuccessfulSyncMs, now)) everStale = true;
  // Fresh reprojection: NEW generatedAt, same substance, next revision attempt.
  r = applyIngest(state, { data: projectUnchanged(now), revision: 1 + h / 6, projectedAtMs: now }, now);
  if (r.status !== "idempotent") wrongBehavior = true;
  const m = r.state.meta;
  if (m.revision !== 1 || m.projectedAtMs !== T0 || r.state.prev !== null ||
      r.state.data.generatedAt !== storedGeneratedAt) {
    wrongBehavior = true; // idempotent must change ONLY the heartbeat
  }
  state = r.state;
}
check("every unchanged reprojection is idempotent despite fresh generatedAt", !wrongBehavior);
check("never operationally stale across 48h of unchanged data", !everStale);
check("stored data retains its ORIGINAL generatedAt", state.data.generatedAt === storedGeneratedAt);
check("heartbeat is current after last reconciliation", state.meta.lastSuccessfulSyncMs === T0 + 48 * HOUR);

// Contrast (sanity): without the heartbeat rule the same sequence would be
// falsely stale by hour 30.
check("without heartbeat rule the same data would be falsely stale (contrast)",
  isStale(T0, T0 + 30 * HOUR));

// ---------- Substantive change is accepted, not idempotent ----------

console.log("Substantive change and conflict semantics:");
const T49 = T0 + 49 * HOUR;
const SUBSTANCE_V2 = { ...SUBSTANCE_V1, emerging: [{ term: "gamma missing", references: 2 }] };

r = applyIngest(state, { data: { generatedAt: iso(T49), ...SUBSTANCE_V2 }, revision: 1, projectedAtMs: T49 }, T49);
check("changed substance with re-used revision → duplicate, no mutation", r.status === "duplicate" && r.state === state);

r = applyIngest(state, { data: { generatedAt: iso(T0 - HOUR), ...SUBSTANCE_V2 }, revision: 2, projectedAtMs: T0 - HOUR }, T49);
check("older projectedAt → stale_payload, no mutation", r.status === "stale_payload" && r.state === state);

r = applyIngest(state, { data: { generatedAt: iso(T49), ...SUBSTANCE_V2 }, revision: 2, projectedAtMs: T49 }, T49);
check("changed substance with next revision → accepted; prev backed up",
  r.status === "accepted" && r.state.prev?.generatedAt === storedGeneratedAt && r.state.data.emerging[0].references === 2);
check("accepted write updates revision/hash/heartbeat together",
  r.state.meta.revision === 2 && r.state.meta.payloadHash === substantiveHash(r.state.data) && r.state.meta.lastSuccessfulSyncMs === T49);

console.log(`\n${fail === 0 ? "✓ ALL PASS" : "✗ FAILURES"} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
