// Shared helpers for the WS-1 test suite. Zero external dependencies: node:test,
// node:assert, the real pipeline (lib/ingest-core.mjs), the real evalIngest +
// INGEST_LUA (lib/redis.ts via node type stripping), and the real shared
// hashing primitive (tools/canonical-hash.mjs).

import { handleIngest } from "../../lib/ingest-core.mjs";
import { INGEST_LUA, evalIngest } from "../../lib/redis.ts";
import { substantiveHash } from "../../tools/canonical-hash.mjs";

export const SECRET = "test-secret-0123456789abcdef";

/**
 * In-memory fake Redis. `eval` is a JS twin of INGEST_LUA — synchronous inside
 * (atomic, like Lua) and behaviorally identical to the state machine locked by
 * tools/tests/contract-freshness.test.mjs:
 *   hash match → idempotent (heartbeat refresh ONLY)
 *   projectedAt < stored → stale_payload (no mutation)
 *   revision ≤ stored AND projectedAt ≠ stored → duplicate (no mutation)
 *   otherwise → accepted (backup prev + write data and meta together)
 */
export class FakeRedis {
  constructor() {
    this.store = new Map();
    /** meta.projectedAtMs observed after every eval — for monotonicity checks */
    this.projectedAtTrace = [];
  }

  async get(key) {
    return this.store.has(key) ? this.store.get(key) : null;
  }

  async set(key, value) {
    this.store.set(key, String(value));
    return "OK";
  }

  async eval(script, keys, args) {
    if (script !== INGEST_LUA) throw new Error("fake redis received an unexpected script");
    const [dataKey, metaKey, prevKey] = keys;
    const [dataJson, metaJson, hash, revisionStr, projectedAtMsStr, nowIso] = args;

    let result;
    const rawMeta = this.store.get(metaKey);
    let handled = false;
    if (rawMeta !== undefined) {
      const m = JSON.parse(rawMeta);
      if (hash === m.payloadHash) {
        m.lastSuccessfulSync = nowIso; // idempotent: heartbeat refresh ONLY
        this.store.set(metaKey, JSON.stringify(m));
        result = { status: "idempotent", storedRevision: m.revision, storedProjectedAt: m.projectedAt };
        handled = true;
      } else {
        const incomingMs = Number(projectedAtMsStr);
        const incomingRev = Number(revisionStr);
        if (incomingMs < Number(m.projectedAtMs)) {
          result = { status: "stale_payload", storedRevision: m.revision, storedProjectedAt: m.projectedAt };
          handled = true;
        } else if (incomingRev <= Number(m.revision) && incomingMs !== Number(m.projectedAtMs)) {
          result = { status: "duplicate", storedRevision: m.revision, storedProjectedAt: m.projectedAt };
          handled = true;
        }
      }
    }
    if (!handled) {
      const current = this.store.get(dataKey);
      if (current !== undefined) this.store.set(prevKey, current);
      this.store.set(dataKey, dataJson);
      this.store.set(metaKey, metaJson);
      result = { status: "accepted" };
    }

    const metaNow = this.store.get(metaKey);
    if (metaNow !== undefined) this.projectedAtTrace.push(JSON.parse(metaNow).projectedAtMs);
    return JSON.stringify(result);
  }

  meta(baseKey) {
    const raw = this.store.get(`${baseKey}-meta`);
    return raw === undefined ? null : JSON.parse(raw);
  }

  data(baseKey) {
    const raw = this.store.get(baseKey);
    return raw === undefined ? null : JSON.parse(raw);
  }

  prev(baseKey) {
    const raw = this.store.get(`${baseKey}-prev`);
    return raw === undefined ? null : JSON.parse(raw);
  }
}

/**
 * Minimal request double exposing exactly the surface handleIngest uses
 * (method, headers.get, body stream) — full control over lying headers.
 */
export function fakeRequest({ method = "POST", headers = {}, bodyText, bodyChunks }) {
  const map = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v)]));
  let body = null;
  const chunks = bodyChunks ?? (bodyText !== undefined ? [new TextEncoder().encode(bodyText)] : null);
  if (chunks) {
    body = new ReadableStream({
      start(controller) {
        for (const c of chunks) controller.enqueue(c);
        controller.close();
      },
    });
  }
  return {
    method,
    headers: { get: (name) => map.get(name.toLowerCase()) ?? null },
    body,
  };
}

export function obsidianData(overrides = {}) {
  return {
    generatedAt: "2026-07-12T10:30:05.123Z",
    concepts: [
      {
        id: "authority-architecture",
        title: "Authority Architecture",
        kind: "core",
        category: "ontology",
        summary: "Where decisions live and who can see them.",
        presentIn: ["today", "field"],
        backlinks: 3,
      },
    ],
    connections: [{ from: "authority-architecture", to: "decision-memory" }],
    emerging: [{ term: "decision memory", references: 2 }],
    ...overrides,
  };
}

export function boardData(overrides = {}) {
  return {
    manuscript: { id: "authority-architecture", title: "Authority Architecture", reviewRound: 3, status: "awaiting ruling" },
    reviewedAt: "2026-07-12T10:00:00.000Z",
    reviewers: [
      {
        role: "Evidence",
        diagnosis: "This claim needs a documented case to stand on.",
        recommendation: "Ground the mechanism in one real case.",
        confidence: "high",
      },
    ],
    unresolvedQuestions: ["Does the mechanism need a documented case, or observation first?"],
    rulings: [],
    nextDecision: "Rule on the mechanism section.",
    sourceLabel: "Claude Editorial Board · automated",
    updatedAt: "2026-07-12T10:00:00.000Z",
    updatedBy: "claude",
    ...overrides,
  };
}

/** Build a valid envelope; payloadHash is recomputed unless overridden. */
export function envelope(data, overrides = {}) {
  return {
    schemaVersion: 1,
    source: "companion",
    sourceUpdatedAt: "2026-07-12T10:30:00.000Z",
    projectedAt: "2026-07-12T10:30:06.123Z",
    revision: 1,
    payloadHash: substantiveHash(data),
    data,
    ...overrides,
  };
}

const KEY_FOR = { obsidian: "obsidian-projection", "editorial-board": "editorial-board" };

/**
 * Run the full pipeline once. Header semantics:
 *   contentLength / contentType / auth === null  → header omitted
 *   contentLength undefined                      → computed from the body
 */
export async function submit(opts = {}) {
  const {
    kind = "obsidian",
    payload,
    bodyText,
    bodyChunks,
    redis = new FakeRedis(),
    auth = `Bearer ${SECRET}`,
    method = "POST",
    contentType = "application/json",
    contentLength,
    now,
  } = opts;
  // `secret: undefined` must mean "unset on the server", not the default.
  const secret = Object.hasOwn(opts, "secret") ? opts.secret : SECRET;
  const text = bodyText !== undefined ? bodyText : JSON.stringify(payload ?? {});
  const headers = {};
  if (contentType !== null) headers["content-type"] = contentType;
  if (contentLength === undefined) {
    headers["content-length"] = String(
      bodyChunks ? bodyChunks.reduce((n, c) => n + c.byteLength, 0) : new TextEncoder().encode(text).length,
    );
  } else if (contentLength !== null) {
    headers["content-length"] = String(contentLength);
  }
  if (auth !== null) headers["authorization"] = auth;

  const request = fakeRequest({ method, headers, bodyText: bodyChunks ? undefined : text, bodyChunks });
  const response = await handleIngest(request, kind, {
    secret,
    runIngest: (params) => evalIngest(redis, KEY_FOR[kind], params),
    ...(now ? { now } : {}),
  });
  return { status: response.status, body: await response.json(), redis };
}
