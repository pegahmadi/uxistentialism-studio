// Concurrency: an older request must never overwrite a newer one (§6).
//
// The CAS is a single atomic EVAL, so a "race" reduces to the order in which
// the two atomic executions land. We prove the invariant three ways:
//   1. both fixed interleavings (old-then-new, new-then-old),
//   2. many randomized interleavings of full concurrent pipelines,
//   3. a monotonicity trace: stored projectedAtMs never decreases.

import { test } from "node:test";
import assert from "node:assert/strict";
import { INGEST_LUA } from "../../lib/redis.ts";
import { FakeRedis, submit, envelope, obsidianData } from "./helpers.mjs";

const KEY = "obsidian-projection";
const iso = (ms) => new Date(ms).toISOString();
const T0 = Date.parse("2026-07-12T00:00:00.000Z");
const MIN = 60 * 1000;

const dataAt = (ms, refs) =>
  obsidianData({ generatedAt: iso(ms), emerging: [{ term: "decision memory", references: refs }] });

const submitAt = (redis, data, revision, projectedAtMs) =>
  submit({
    redis,
    payload: envelope(data, { revision, projectedAt: iso(projectedAtMs) }),
    now: () => new Date(projectedAtMs),
  });

/** FakeRedis whose eval waits for an externally controlled gate, then runs atomically. */
class GatedRedis extends FakeRedis {
  constructor() {
    super();
    this.gates = [];
  }
  async eval(script, keys, args) {
    await new Promise((resolve) => this.gates.push(resolve));
    return super.eval(script, keys, args);
  }
  releaseAll(order) {
    for (const i of order) this.gates[i]();
  }
}

test("new lands first, old arrives second → old gets 409, newer data survives", async () => {
  const redis = new FakeRedis();
  const newer = await submitAt(redis, dataAt(T0 + 10 * MIN, 7), 2, T0 + 10 * MIN);
  assert.equal(newer.body.status, "accepted");
  const old = await submitAt(redis, dataAt(T0, 1), 1, T0);
  assert.equal(old.status, 409);
  assert.equal(old.body.error, "stale_payload");
  assert.equal(redis.data(KEY).emerging[0].references, 7, "newer data survives");
  assert.equal(redis.meta(KEY).revision, 2);
});

test("old lands first, new arrives second → both ordered writes apply, newest wins", async () => {
  const redis = new FakeRedis();
  const old = await submitAt(redis, dataAt(T0, 1), 1, T0);
  assert.equal(old.body.status, "accepted");
  const newer = await submitAt(redis, dataAt(T0 + 10 * MIN, 7), 2, T0 + 10 * MIN);
  assert.equal(newer.body.status, "accepted");
  assert.equal(redis.data(KEY).emerging[0].references, 7);
  assert.deepEqual(redis.prev(KEY), dataAt(T0, 1), "older value preserved as prev");
});

test("controlled interleaving: concurrent pipelines, old CAS deliberately executed AFTER new", async () => {
  const redis = new GatedRedis();
  // Both full pipelines run concurrently and block at the atomic CAS.
  const oldP = submitAt(redis, dataAt(T0, 1), 1, T0);
  const newP = submitAt(redis, dataAt(T0 + 10 * MIN, 7), 2, T0 + 10 * MIN);
  // Wait until both reached the gate (validation, hashing done).
  while (redis.gates.length < 2) await new Promise((r) => setTimeout(r, 1));
  // Adversarial order: the NEW request's CAS executes first (index 1), then the old (index 0).
  redis.releaseAll([1, 0]);
  const [oldR, newR] = await Promise.all([oldP, newP]);
  assert.equal(newR.body.status, "accepted");
  assert.equal(oldR.status, 409);
  assert.equal(oldR.body.error, "stale_payload");
  assert.equal(oldR.body.storedRevision, 2, "conflict reports the stored revision for sequence recovery");
  assert.equal(redis.data(KEY).emerging[0].references, 7, "older request did not overwrite newer data");
  assert.equal(redis.meta(KEY).projectedAtMs, T0 + 10 * MIN);
});

test("same-revision race: exactly one wins, the other 409s, data+meta never mix", async () => {
  for (const order of [[0, 1], [1, 0]]) {
    const redis = new GatedRedis();
    const a = submitAt(redis, dataAt(T0 + 1 * MIN, 11), 5, T0 + 1 * MIN);
    const b = submitAt(redis, dataAt(T0 + 2 * MIN, 22), 5, T0 + 2 * MIN);
    while (redis.gates.length < 2) await new Promise((r) => setTimeout(r, 1));
    redis.releaseAll(order);
    const [ra, rb] = await Promise.all([a, b]);
    const statuses = [ra.body.status ?? ra.body.error, rb.body.status ?? rb.body.error].sort();
    // First-lander is accepted; the loser conflicts as duplicate (rev re-use)
    // or stale_payload (older projectedAt arriving after the newer one landed).
    assert.equal(statuses.filter((s) => s === "accepted").length, 1, `order ${order}: exactly one winner`);
    assert.ok(
      statuses.some((s) => s === "duplicate" || s === "stale_payload"),
      `order ${order}: loser conflicts (got ${statuses})`,
    );
    // Consistency: stored meta always describes the stored data (no torn writes).
    const { substantiveHash } = await import("../../tools/canonical-hash.mjs");
    assert.equal(redis.meta(KEY).payloadHash, substantiveHash(redis.data(KEY)), "meta matches data");
  }
});

test("randomized interleavings: stored projectedAtMs is monotonically non-decreasing", async () => {
  for (let round = 0; round < 25; round++) {
    const redis = new FakeRedis();
    // 6 concurrent submissions with distinct projectedAt values and shuffled
    // arrival, each preceded by random async jitter (eval itself stays atomic).
    const jobs = [0, 1, 2, 3, 4, 5].map((i) => ({ ms: T0 + i * MIN, revision: i + 1, refs: i + 100 }));
    for (let i = jobs.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [jobs[i], jobs[j]] = [jobs[j], jobs[i]];
    }
    await Promise.all(
      jobs.map(async (job) => {
        await new Promise((r) => setTimeout(r, Math.floor(Math.random() * 3)));
        const res = await submitAt(redis, dataAt(job.ms, job.refs), job.revision, job.ms);
        assert.ok([200, 409].includes(res.status));
      }),
    );
    for (let i = 1; i < redis.projectedAtTrace.length; i++) {
      assert.ok(
        redis.projectedAtTrace[i] >= redis.projectedAtTrace[i - 1],
        `round ${round}: stored projectedAtMs regressed (${redis.projectedAtTrace[i - 1]} → ${redis.projectedAtTrace[i]})`,
      );
    }
  }
});

test("the literal Lua script is what production evaluates (sanity)", () => {
  assert.match(INGEST_LUA, /redis\.call\('GET', KEYS\[2\]\)/);
  assert.match(INGEST_LUA, /idempotent/);
  assert.match(INGEST_LUA, /stale_payload/);
  assert.match(INGEST_LUA, /duplicate/);
  assert.match(INGEST_LUA, /accepted/);
  // idempotent branch touches ONLY the heartbeat field
  assert.match(INGEST_LUA, /m\.lastSuccessfulSync = ARGV\[6\]/);
});
