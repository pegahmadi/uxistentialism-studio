// Lazy, guarded, server-only Upstash Redis accessor + the atomic ingestion
// compare-and-set script (INGESTION_CONTRACT.md §6, §8).
//
// Missing or malformed Redis configuration is an explicit fallback condition —
// never a crashed import. With no UPSTASH_* env vars every page renders from
// committed fixtures (DataResult source: "fallback").
//
// Only the ingestion endpoints write to Redis, and only through INGEST_LUA in a
// single atomic EVAL. lib/* readers only GET.

import { Redis } from "@upstash/redis";

let client: Redis | null | undefined; // undefined = not yet constructed

/** Lazy singleton. Returns null (fallback condition) when config is absent or malformed. */
export function getRedis(): Redis | null {
  if (client !== undefined) return client;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    client = null;
    return client;
  }
  try {
    new URL(url); // malformed URL → fallback, not a crash
    // Raw string values in/out: the Lua script reads and writes plain JSON
    // strings, so readers parse explicitly and the fake test client stays honest.
    client = new Redis({ url, token, automaticDeserialization: false });
  } catch {
    client = null;
  }
  return client;
}

/** Test-only escape hatch: reset the memoized client (never used by app code). */
export function _resetRedisForTests(): void {
  client = undefined;
}

/**
 * Atomic ingestion compare-and-set (contract §6) over {key}, {key}-meta,
 * {key}-prev. One EVAL — no read-then-write in application code.
 *
 * KEYS[1] = data key, KEYS[2] = meta key, KEYS[3] = prev key
 * ARGV[1] = new data JSON string (verbatim received `data`)
 * ARGV[2] = new meta JSON string (server-built: recomputed hash, revision,
 *           projectedAt/-Ms, sourceUpdatedAt, source, lastSuccessfulSync=now)
 * ARGV[3] = server-recomputed substantive hash (§1b) — never the client's
 * ARGV[4] = incoming revision (decimal string)
 * ARGV[5] = incoming projectedAt epoch ms (decimal string)
 * ARGV[6] = server now, ISO 8601 (heartbeat value)
 *
 * State machine (contract v1.1.2 — the shared contract-freshness test is
 * updated to this same rule at merge time):
 *   1. hash match            → idempotent: refresh ONLY lastSuccessfulSync
 *   2. projectedAt < stored  → stale_payload: no mutation
 *   3. revision ≤ stored     → duplicate: no mutation (NO projectedAt
 *      inequality qualifier — a changed payload re-using a consumed revision
 *      is duplicate even when its projectedAt equals the stored one)
 *   4. otherwise             → accepted: backup prev + write data & meta together
 */
export const INGEST_LUA = `
local rawMeta = redis.call('GET', KEYS[2])
if rawMeta then
  local m = cjson.decode(rawMeta)
  if ARGV[3] == m.payloadHash then
    m.lastSuccessfulSync = ARGV[6]
    redis.call('SET', KEYS[2], cjson.encode(m))
    return cjson.encode({ status = 'idempotent', storedRevision = m.revision, storedProjectedAt = m.projectedAt })
  end
  local incomingMs = tonumber(ARGV[5])
  local incomingRev = tonumber(ARGV[4])
  if incomingMs < tonumber(m.projectedAtMs) then
    return cjson.encode({ status = 'stale_payload', storedRevision = m.revision, storedProjectedAt = m.projectedAt })
  end
  if incomingRev <= tonumber(m.revision) then
    return cjson.encode({ status = 'duplicate', storedRevision = m.revision, storedProjectedAt = m.projectedAt })
  end
end
local current = redis.call('GET', KEYS[1])
if current then
  redis.call('SET', KEYS[3], current)
end
redis.call('SET', KEYS[1], ARGV[1])
redis.call('SET', KEYS[2], ARGV[2])
return cjson.encode({ status = 'accepted' })
`;

export interface IngestEvalParams {
  dataJson: string;
  metaJson: string;
  hash: string;
  revision: number;
  projectedAtMs: number;
  nowIso: string;
}

export interface IngestEvalResult {
  status: "accepted" | "idempotent" | "stale_payload" | "duplicate";
  storedRevision?: number;
  storedProjectedAt?: string;
}

/** Minimal client surface evalIngest needs (real Redis or the test fake). */
export interface EvalCapable {
  eval(script: string, keys: string[], args: string[]): Promise<unknown>;
}

/** Run the atomic CAS for one base key. Throws on transport failure (→ 500). */
export async function evalIngest(
  redis: EvalCapable,
  baseKey: string,
  p: IngestEvalParams,
): Promise<IngestEvalResult> {
  const raw = await redis.eval(
    INGEST_LUA,
    [baseKey, `${baseKey}-meta`, `${baseKey}-prev`],
    [p.dataJson, p.metaJson, p.hash, String(p.revision), String(p.projectedAtMs), p.nowIso],
  );
  const parsed: unknown = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (!parsed || typeof parsed !== "object") throw new Error("unexpected eval result shape");
  return parsed as IngestEvalResult;
}

/** Minimal client surface readSnapshot needs (real Redis or a test fake). */
export interface MgetCapable {
  mget(...keys: string[]): Promise<unknown[]>;
}

/**
 * Single-snapshot read (v1.1.2 §8): fetch `{key}` and `{key}-meta` in ONE
 * atomic MGET so an ingestion landing mid-read can never produce a mixed
 * data/meta pair. lib readers must use this — never two independent GETs.
 * Throws on transport failure (callers map that to their fallback path).
 */
export async function readSnapshot(
  redis: MgetCapable,
  baseKey: string,
): Promise<{ rawData: unknown; rawMeta: unknown }> {
  const row = await redis.mget(baseKey, `${baseKey}-meta`);
  if (!Array.isArray(row) || row.length !== 2) throw new Error("unexpected mget result shape");
  return { rawData: row[0], rawMeta: row[1] };
}

/**
 * Server-built meta record stored at `{key}-meta` and read by /api/sync-status
 * and the lib readers. lastAttempt is intentionally absent — v1 records only
 * successful verifications (§2e: lastAttempt is always null, never fabricated).
 */
export interface StoredMeta {
  revision: number;
  projectedAt: string;
  projectedAtMs: number;
  sourceUpdatedAt: string;
  payloadHash: string;
  source: string;
  lastSuccessfulSync: string;
}
