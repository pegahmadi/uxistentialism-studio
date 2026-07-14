// Env-pair resolution for getRedis() (contract §8, v1.1.3).
//
// Two accepted name pairs, precedence-ordered and PAIR-ATOMIC:
//   1. UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN            (canonical)
//   2. UPSTASH_REDIS_REST_KV_REST_API_URL + ..._KV_REST_API_TOKEN  (deployed
//      Marketplace binding)
// A partial pair is skipped without cross-scheme mixing; TCP/read-only names
// are never consumed. No secret VALUES appear in this file — only env names
// and synthetic localhost fixtures.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { getRedis, resolveRedisConfig, _resetRedisForTests } from "../../lib/redis.ts";

const NAMES = [
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
  "UPSTASH_REDIS_REST_KV_REST_API_URL",
  "UPSTASH_REDIS_REST_KV_REST_API_TOKEN",
  "UPSTASH_REDIS_REST_KV_REST_API_READ_ONLY_TOKEN",
  "UPSTASH_REDIS_REST_REDIS_URL",
  "UPSTASH_REDIS_REST_KV_URL",
];

const CANON_URL = "https://canonical.localhost.test";
const DEPLOYED_URL = "https://deployed.localhost.test";
const FAKE_TOKEN_A = "synthetic-test-token-a"; // synthetic fixture, not a secret
const FAKE_TOKEN_B = "synthetic-test-token-b";

function clearEnv() {
  for (const n of NAMES) delete process.env[n];
}

beforeEach(() => {
  clearEnv();
  _resetRedisForTests();
});

test("canonical pair has precedence when both pairs are complete", () => {
  process.env.UPSTASH_REDIS_REST_URL = CANON_URL;
  process.env.UPSTASH_REDIS_REST_TOKEN = FAKE_TOKEN_A;
  process.env.UPSTASH_REDIS_REST_KV_REST_API_URL = DEPLOYED_URL;
  process.env.UPSTASH_REDIS_REST_KV_REST_API_TOKEN = FAKE_TOKEN_B;
  const config = resolveRedisConfig();
  assert.equal(config?.url, CANON_URL, "canonical URL must win");
  assert.equal(config?.token, FAKE_TOKEN_A, "token must come from the SAME (canonical) scheme");
  assert.ok(getRedis(), "and the client constructs from it");
});

test("deployed Marketplace pair alone yields a client", () => {
  process.env.UPSTASH_REDIS_REST_KV_REST_API_URL = DEPLOYED_URL;
  process.env.UPSTASH_REDIS_REST_KV_REST_API_TOKEN = FAKE_TOKEN_B;
  assert.ok(getRedis(), "deployed pair must be usable");
});

test("partial canonical pair is skipped; complete deployed pair is used", () => {
  process.env.UPSTASH_REDIS_REST_URL = CANON_URL; // token missing → partial
  process.env.UPSTASH_REDIS_REST_KV_REST_API_URL = DEPLOYED_URL;
  process.env.UPSTASH_REDIS_REST_KV_REST_API_TOKEN = FAKE_TOKEN_B;
  assert.ok(getRedis(), "partial higher-precedence pair must not block a complete lower one");
});

test("no cross-scheme mixing: canonical URL + deployed token only → null", () => {
  process.env.UPSTASH_REDIS_REST_URL = CANON_URL;
  process.env.UPSTASH_REDIS_REST_KV_REST_API_TOKEN = FAKE_TOKEN_B;
  assert.equal(getRedis(), null, "URL and token must come from the SAME scheme");
});

test("no cross-scheme mixing: deployed URL + canonical token only → null", () => {
  process.env.UPSTASH_REDIS_REST_KV_REST_API_URL = DEPLOYED_URL;
  process.env.UPSTASH_REDIS_REST_TOKEN = FAKE_TOKEN_A;
  assert.equal(getRedis(), null);
});

test("both pairs partial → null (fallback condition)", () => {
  process.env.UPSTASH_REDIS_REST_URL = CANON_URL;
  process.env.UPSTASH_REDIS_REST_KV_REST_API_URL = DEPLOYED_URL;
  assert.equal(getRedis(), null);
});

test("full absence → null (fallback condition)", () => {
  assert.equal(getRedis(), null);
});

test("empty-string names count as absent (pair-atomicity respects non-empty)", () => {
  process.env.UPSTASH_REDIS_REST_URL = "";
  process.env.UPSTASH_REDIS_REST_TOKEN = FAKE_TOKEN_A;
  process.env.UPSTASH_REDIS_REST_KV_REST_API_URL = DEPLOYED_URL;
  process.env.UPSTASH_REDIS_REST_KV_REST_API_TOKEN = "";
  assert.equal(getRedis(), null);
});

test("TCP and read-only variables are never consumed", () => {
  process.env.UPSTASH_REDIS_REST_REDIS_URL = "rediss://ignored.localhost.test";
  process.env.UPSTASH_REDIS_REST_KV_URL = "rediss://ignored.localhost.test";
  process.env.UPSTASH_REDIS_REST_KV_REST_API_READ_ONLY_TOKEN = FAKE_TOKEN_B;
  assert.equal(getRedis(), null, "TCP/read-only names must not construct a client");
});

test("malformed URL in the winning pair → null, never a crash", () => {
  process.env.UPSTASH_REDIS_REST_URL = "not a url";
  process.env.UPSTASH_REDIS_REST_TOKEN = FAKE_TOKEN_A;
  assert.equal(getRedis(), null);
});
