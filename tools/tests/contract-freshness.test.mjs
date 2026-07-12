#!/usr/bin/env node
/*
 * Contract-semantics test: §6 atomic write policy + §8 freshness rule.
 *
 * Implements the ingestion state machine EXACTLY as INGESTION_CONTRACT.md v1.1.0
 * specifies it (a pure-JS model of the Lua script) and proves the required
 * property: unchanged data reconciled every 6 hours NEVER becomes operationally
 * stale, because a valid idempotent submission refreshes the server-owned
 * lastSuccessfulSync heartbeat. WS-1's Redis implementation must satisfy this
 * same state machine.
 *
 * Portable: no Redis, no vault, no config. Usage:
 *   node tools/tests/contract-freshness.test.mjs
 */

const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

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
 * §6 state machine — the atomic script, modeled purely.
 * state = { data, meta: { revision, projectedAtMs, payloadHash, lastSuccessfulSyncMs }, prev } | empty meta
 * incoming = { data, revision, projectedAtMs, recomputedHash }
 * Returns { status, state' }. Mutation rules per the v1.1.0 table.
 */
function applyIngest(state, incoming, serverNowMs) {
  const meta = state.meta;
  if (meta) {
    if (incoming.recomputedHash === meta.payloadHash) {
      // Idempotent: heartbeat refresh ONLY — data, hash, projectedAt, revision, prev unchanged.
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
        payloadHash: incoming.recomputedHash,
        lastSuccessfulSyncMs: serverNowMs,
      },
    },
  };
}

// ---------- The required property: 6-hourly idempotent reconciliation of an
// ---------- unchanged vault never becomes operationally stale.

console.log("Freshness under unchanged-vault reconciliation (48h simulation):");
const T0 = Date.parse("2026-07-12T00:00:00.000Z");
let state = { data: null, meta: null, prev: null };

// Initial accept at T0.
let r = applyIngest(state, { data: "D1", revision: 1, projectedAtMs: T0, recomputedHash: "sha256-aaa" }, T0);
state = r.state;
check("initial submission accepted", r.status === "accepted");

// Every 6h for 48h the companion re-projects the UNCHANGED vault. Same hash;
// projectedAt advances (fresh run) but data is identical.
let everStale = false;
let wrongMutation = false;
for (let h = 6; h <= 48; h += 6) {
  const now = T0 + h * HOUR;
  // staleness is evaluated just BEFORE the reconciliation lands
  if (isStale(state.meta.lastSuccessfulSyncMs, now)) everStale = true;
  r = applyIngest(state, { data: "D1", revision: 1 + h / 6, projectedAtMs: now, recomputedHash: "sha256-aaa" }, now);
  if (r.status !== "idempotent") wrongMutation = true;
  const m = r.state.meta;
  if (m.revision !== 1 || m.projectedAtMs !== T0 || m.payloadHash !== "sha256-aaa" || r.state.prev !== null || r.state.data !== "D1") {
    wrongMutation = true; // idempotent must change ONLY the heartbeat
  }
  state = r.state;
}
check("never operationally stale across 48h of unchanged data", !everStale);
check("all reconciliations idempotent; only heartbeat mutated", !wrongMutation);
check("heartbeat is current after last reconciliation", state.meta.lastSuccessfulSyncMs === T0 + 48 * HOUR);

// Contrast (sanity): WITHOUT the heartbeat rule, the same sequence would be
// falsely stale by hour 30.
let lastSyncNoHeartbeat = T0;
check("without heartbeat rule the same data would be falsely stale (contrast)",
  isStale(lastSyncNoHeartbeat, T0 + 30 * HOUR));

// ---------- Ordering + conflict semantics stay intact ----------

console.log("Conflict semantics:");
r = applyIngest(state, { data: "OLD", revision: 99, projectedAtMs: T0 - HOUR, recomputedHash: "sha256-old" }, T0 + 49 * HOUR);
check("older projectedAt rejected as stale_payload, no mutation", r.status === "stale_payload" && r.state === state);

r = applyIngest(state, { data: "D2", revision: 1, projectedAtMs: T0 + 49 * HOUR, recomputedHash: "sha256-bbb" }, T0 + 49 * HOUR);
check("re-used revision rejected as duplicate, no mutation", r.status === "duplicate" && r.state === state);

r = applyIngest(state, { data: "D2", revision: 2, projectedAtMs: T0 + 49 * HOUR, recomputedHash: "sha256-bbb" }, T0 + 49 * HOUR);
check("genuine new payload accepted; prev backed up", r.status === "accepted" && r.state.prev === "D1" && r.state.data === "D2");
check("accepted write updates revision/hash/heartbeat together",
  r.state.meta.revision === 2 && r.state.meta.payloadHash === "sha256-bbb" && r.state.meta.lastSuccessfulSyncMs === T0 + 49 * HOUR);

console.log(`\n${fail === 0 ? "✓ ALL PASS" : "✗ FAILURES"} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
