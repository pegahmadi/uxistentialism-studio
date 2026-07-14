// True single-snapshot reads (contract v1.1.2 §8).
//
// getProjection()/getEditorialBoard() previously issued TWO independent GETs
// (data, then meta) inside Promise.all. An ingestion landing between those two
// commands produced a MIXED pair: old data described by new metadata (or vice
// versa). v1.1.2 requires one atomic MGET fetching {key} and {key}-meta
// together — readSnapshot in lib/redis.ts.
//
// Proof strategy: a fake Redis executes each command atomically and applies an
// injected write at EVERY boundary between two separate commands. The old
// two-GET pattern demonstrably observes a torn pair; readSnapshot cannot.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { readSnapshot } from "../../lib/redis.ts";
import { substantiveHash } from "../../tools/canonical-hash.mjs";

const KEY = "obsidian-projection";

const dataV = (refs) => ({
  generatedAt: "2026-07-12T10:30:05.123Z",
  concepts: [{ id: "alpha", title: "Alpha", kind: "core", category: "t", summary: "A.", presentIn: ["today"], backlinks: 2 }],
  connections: [],
  emerging: [{ term: "gamma", references: refs }],
});
const metaV = (data, revision) => ({
  revision,
  projectedAt: "2026-07-12T10:30:06.123Z",
  projectedAtMs: Date.parse("2026-07-12T10:30:06.123Z"),
  sourceUpdatedAt: "2026-07-12T10:30:00.000Z",
  payloadHash: substantiveHash(data),
  source: "companion",
  lastSuccessfulSync: "2026-07-12T10:30:06.123Z",
});

/** A stored version: data + meta written together (as INGEST_LUA does). */
function version(refs, revision) {
  const data = dataV(refs);
  return { data: JSON.stringify(data), meta: JSON.stringify(metaV(data, revision)) };
}

/**
 * Fake Redis where every command (get / mget) is atomic, and an injected
 * write — an atomic ingestion setting data AND meta together — is applied at
 * each boundary BETWEEN two separate commands. This is exactly the hazard
 * window the old two-GET reader was exposed to.
 */
class InterleavingRedis {
  constructor(v) {
    this.store = new Map([[KEY, v.data], [`${KEY}-meta`, v.meta]]);
    this.pendingWrites = []; // one applied after each completed command
    this.commands = 0;
  }
  injectBetweenCommands(v) {
    this.pendingWrites.push(v);
  }
  _boundary() {
    this.commands++;
    const v = this.pendingWrites.shift();
    if (v) {
      this.store.set(KEY, v.data);
      this.store.set(`${KEY}-meta`, v.meta);
    }
  }
  async get(key) {
    const out = this.store.has(key) ? this.store.get(key) : null;
    this._boundary();
    return out;
  }
  async mget(...keys) {
    const out = keys.map((k) => (this.store.has(k) ? this.store.get(k) : null));
    this._boundary();
    return out;
  }
}

const parsePair = ({ rawData, rawMeta }) => ({ data: JSON.parse(rawData), meta: JSON.parse(rawMeta) });
const consistent = ({ data, meta }) => meta.payloadHash === substantiveHash(data);

test("the OLD two-GET pattern observes a MIXED pair when a write lands between the GETs", async () => {
  const redis = new InterleavingRedis(version(1, 1));
  redis.injectBetweenCommands(version(2, 2)); // ingestion lands between GET #1 and GET #2

  // Verbatim shape of the pre-v1.1.2 reader: two independent GETs.
  const [rawData, rawMeta] = await Promise.all([redis.get(KEY), redis.get(`${KEY}-meta`)]);
  const pair = parsePair({ rawData, rawMeta });

  assert.equal(redis.commands, 2, "two separate commands were issued");
  assert.equal(pair.data.emerging[0].references, 1, "data came from version 1");
  assert.equal(pair.meta.revision, 2, "meta came from version 2");
  assert.equal(consistent(pair), false, "torn read: stored meta does not describe the returned data");
});

test("readSnapshot issues ONE command and can never observe a mixed pair", async () => {
  const redis = new InterleavingRedis(version(1, 1));
  redis.injectBetweenCommands(version(2, 2)); // same adversarial write, same schedule

  const first = parsePair(await readSnapshot(redis, KEY));
  assert.equal(redis.commands, 1, "exactly one command — there is no between-commands window inside the read");
  assert.equal(first.data.emerging[0].references, 1);
  assert.equal(first.meta.revision, 1);
  assert.ok(consistent(first), "snapshot is internally consistent");

  // The injected write applied AFTER the atomic read; the next snapshot sees
  // version 2 as a whole — again consistent.
  const second = parsePair(await readSnapshot(redis, KEY));
  assert.equal(second.data.emerging[0].references, 2);
  assert.equal(second.meta.revision, 2);
  assert.ok(consistent(second), "next snapshot is the new version as a whole");
});

test("a write injected at EVERY command boundary never yields an inconsistent snapshot", async () => {
  const redis = new InterleavingRedis(version(1, 1));
  for (let v = 2; v <= 8; v++) redis.injectBetweenCommands(version(v, v)); // one write per boundary
  for (let read = 0; read < 8; read++) {
    const pair = parsePair(await readSnapshot(redis, KEY));
    assert.ok(consistent(pair), `read ${read}: snapshot consistent under maximal interleaving`);
  }
});

test("readSnapshot rejects a malformed transport result instead of fabricating a pair", async () => {
  await assert.rejects(() => readSnapshot({ mget: async () => "not an array" }, KEY));
  await assert.rejects(() => readSnapshot({ mget: async () => [1, 2, 3] }, KEY));
});

test("source lock: both lib readers go through readSnapshot, never independent GETs", () => {
  for (const file of ["../../lib/projection.ts", "../../lib/editorial-board.ts"]) {
    const src = fs.readFileSync(new URL(file, import.meta.url), "utf8");
    assert.match(src, /readSnapshot\(redis, /, `${file} reads via readSnapshot`);
    assert.doesNotMatch(src, /redis\.get\(/, `${file} issues no independent GET`);
    assert.doesNotMatch(src, /Promise\.all/, `${file} has no multi-command read`);
  }
});
