// §6 atomic write policy + §8 freshness rule, exercised through the FULL
// pipeline (handleIngest → evalIngest → fake-Redis JS twin of INGEST_LUA).
// Must match the state machine locked by tools/tests/contract-freshness.test.mjs.

import { test } from "node:test";
import assert from "node:assert/strict";
import { isStale } from "../../lib/data-result.ts";
import { substantiveHash } from "../../tools/canonical-hash.mjs";
import { FakeRedis, submit, envelope } from "./helpers.mjs";

const KEY = "obsidian-projection";
const iso = (ms) => new Date(ms).toISOString();
const HOUR = 60 * 60 * 1000;
const T0 = Date.parse("2026-07-12T00:00:00.000Z");

// A reprojection of an UNCHANGED vault: same substance, fresh generatedAt.
const substance = {
  concepts: [{ id: "alpha", title: "Alpha", kind: "core", category: "t", summary: "A.", presentIn: ["today"], backlinks: 2 }],
  connections: [],
  emerging: [{ term: "gamma missing", references: 1 }],
};
const projectUnchanged = (nowMs) => ({ generatedAt: iso(nowMs), ...substance });

const at = (ms) => () => new Date(ms);

function submitAt(redis, data, revision, projectedAtMs, serverNowMs = projectedAtMs) {
  return submit({
    redis,
    payload: envelope(data, { revision, projectedAt: iso(projectedAtMs), sourceUpdatedAt: iso(T0 - HOUR) }),
    now: at(serverNowMs),
  });
}

test("initial submission → accepted; data+meta written together, no prev", async () => {
  const redis = new FakeRedis();
  const r = await submitAt(redis, projectUnchanged(T0), 1, T0);
  assert.equal(r.body.status, "accepted");
  const meta = redis.meta(KEY);
  assert.equal(meta.revision, 1);
  assert.equal(meta.projectedAtMs, T0);
  assert.equal(meta.payloadHash, substantiveHash(projectUnchanged(T0)));
  assert.equal(meta.lastSuccessfulSync, iso(T0));
  assert.equal(meta.source, "companion");
  assert.deepEqual(redis.data(KEY), projectUnchanged(T0));
  assert.equal(redis.prev(KEY), null);
});

test("idempotent = heartbeat-only: everything except lastSuccessfulSync unchanged", async () => {
  const redis = new FakeRedis();
  await submitAt(redis, projectUnchanged(T0), 1, T0);
  const before = redis.meta(KEY);

  const T6 = T0 + 6 * HOUR;
  const r = await submitAt(redis, projectUnchanged(T6), 2, T6); // fresh generatedAt, same substance
  assert.equal(r.status, 200);
  assert.equal(r.body.status, "idempotent");

  const after = redis.meta(KEY);
  assert.equal(after.lastSuccessfulSync, iso(T6), "heartbeat refreshed");
  assert.equal(after.revision, before.revision, "revision unchanged");
  assert.equal(after.projectedAt, before.projectedAt, "projectedAt unchanged");
  assert.equal(after.projectedAtMs, before.projectedAtMs);
  assert.equal(after.payloadHash, before.payloadHash, "hash unchanged");
  assert.equal(after.sourceUpdatedAt, before.sourceUpdatedAt, "sourceUpdatedAt unchanged");
  assert.equal(redis.data(KEY).generatedAt, iso(T0), "stored data keeps its ORIGINAL generatedAt");
  assert.equal(redis.prev(KEY), null, "prev untouched on idempotent");
});

test("older projectedAt → 409 stale_payload, no mutation, stored* fields present", async () => {
  const redis = new FakeRedis();
  await submitAt(redis, projectUnchanged(T0), 1, T0);
  const snapshot = new Map(redis.store);

  const changed = { generatedAt: iso(T0 - HOUR), ...substance, emerging: [{ term: "gamma missing", references: 9 }] };
  const r = await submitAt(redis, changed, 2, T0 - HOUR, T0 + HOUR);
  assert.equal(r.status, 409);
  assert.equal(r.body.error, "stale_payload");
  assert.equal(r.body.storedRevision, 1);
  assert.equal(r.body.storedProjectedAt, iso(T0));
  assert.deepEqual(new Map(redis.store), snapshot, "conflicts must not mutate anything");
});

test("re-used revision with different projectedAt and changed substance → 409 duplicate, no mutation", async () => {
  const redis = new FakeRedis();
  await submitAt(redis, projectUnchanged(T0), 1, T0);
  const snapshot = new Map(redis.store);

  const changed = { generatedAt: iso(T0 + HOUR), ...substance, emerging: [{ term: "gamma missing", references: 9 }] };
  const r = await submitAt(redis, changed, 1, T0 + HOUR);
  assert.equal(r.status, 409);
  assert.equal(r.body.error, "duplicate");
  assert.equal(r.body.storedRevision, 1);
  assert.equal(r.body.storedProjectedAt, iso(T0));
  assert.deepEqual(new Map(redis.store), snapshot);
});

test("changed substance with next revision → accepted; prev backed up; meta updated together", async () => {
  const redis = new FakeRedis();
  await submitAt(redis, projectUnchanged(T0), 1, T0);

  const T2 = T0 + 2 * HOUR;
  const changed = { generatedAt: iso(T2), ...substance, emerging: [{ term: "gamma missing", references: 2 }] };
  const r = await submitAt(redis, changed, 2, T2);
  assert.equal(r.body.status, "accepted");
  assert.deepEqual(redis.prev(KEY), projectUnchanged(T0), "previous value backed up");
  assert.deepEqual(redis.data(KEY), changed);
  const meta = redis.meta(KEY);
  assert.equal(meta.revision, 2);
  assert.equal(meta.projectedAtMs, T2);
  assert.equal(meta.payloadHash, substantiveHash(changed));
  assert.equal(meta.lastSuccessfulSync, iso(T2));
});

test("48h of 6-hourly unchanged reconciliation: always idempotent, never stale (§8)", async () => {
  const redis = new FakeRedis();
  await submitAt(redis, projectUnchanged(T0), 1, T0);

  for (let h = 6; h <= 48; h += 6) {
    const now = T0 + h * HOUR;
    assert.equal(isStale(redis.meta(KEY).lastSuccessfulSync, now), false, `not stale at +${h}h before sync`);
    const r = await submitAt(redis, projectUnchanged(now), 1 + h / 6, now);
    assert.equal(r.body.status, "idempotent", `+${h}h reprojection is idempotent`);
  }

  const meta = redis.meta(KEY);
  assert.equal(meta.revision, 1, "revision never advanced by idempotent submissions");
  assert.equal(redis.data(KEY).generatedAt, iso(T0), "original generatedAt retained across 48h");
  assert.equal(meta.lastSuccessfulSync, iso(T0 + 48 * HOUR), "heartbeat current");
  // Contrast: without the heartbeat rule the same data would read stale by +30h.
  assert.equal(isStale(iso(T0), T0 + 30 * HOUR), true);
});

test("missing metadata never appears fresh (isStale on null/garbage)", () => {
  assert.equal(isStale(null), true);
  assert.equal(isStale("not a timestamp"), true);
  assert.equal(isStale(iso(Date.now())), false);
});
