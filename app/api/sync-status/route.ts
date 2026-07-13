// GET /api/sync-status — public sync provenance (contract §2e).
//
// GET-only, force-dynamic, Cache-Control: no-store, no authentication, no
// secrets. Redis unreachable → 200 with degraded: true and null values (never
// a 5xx, never internal detail). Never-synced (Redis reachable, key absent) is
// degraded: false with null values for that key.
//
// lastAttempt is ALWAYS null in v1: the server records only successful
// verifications (§6 forbids mutation on conflicts), and fabricating it from
// lastSuccessfulSync would falsely imply the most recent attempt succeeded.

import { getRedis } from "@/lib/redis";

export const dynamic = "force-dynamic";

const TRACKED_KEYS = [
  "obsidian-projection",
  "editorial-board",
  "workspace-inferred", // WS-4 — reported as never-synced until that workstream ships
  "workspace-override", // WS-4
] as const;

interface KeyStatus {
  lastSuccessfulSync: string | null;
  lastAttempt: null; // always null in v1 (§2e)
  revision: number | null;
  payloadHash: string | null;
  error: string | null;
}

const nullStatus = (error: string | null = null): KeyStatus => ({
  lastSuccessfulSync: null,
  lastAttempt: null,
  revision: null,
  payloadHash: null,
  error,
});

function respond(degraded: boolean, keys: Record<string, KeyStatus>): Response {
  return new Response(JSON.stringify({ degraded, keys }), {
    status: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function parseMeta(raw: unknown): KeyStatus {
  if (typeof raw !== "string" || raw.length === 0) return nullStatus();
  try {
    const m: unknown = JSON.parse(raw);
    if (!m || typeof m !== "object") return nullStatus("malformed_meta");
    const o = m as Record<string, unknown>;
    return {
      lastSuccessfulSync: typeof o.lastSuccessfulSync === "string" ? o.lastSuccessfulSync : null,
      lastAttempt: null,
      revision: typeof o.revision === "number" && Number.isFinite(o.revision) ? o.revision : null,
      payloadHash: typeof o.payloadHash === "string" ? o.payloadHash : null,
      error: null,
    };
  } catch {
    return nullStatus("malformed_meta");
  }
}

export async function GET(): Promise<Response> {
  const degradedKeys = Object.fromEntries(
    TRACKED_KEYS.map((k) => [k, nullStatus("unavailable")]),
  ) as Record<string, KeyStatus>;

  const redis = getRedis();
  if (!redis) return respond(true, degradedKeys);

  try {
    const metas = await Promise.all(TRACKED_KEYS.map((k) => redis.get(`${k}-meta`)));
    const keys = Object.fromEntries(TRACKED_KEYS.map((k, i) => [k, parseMeta(metas[i])])) as Record<
      string,
      KeyStatus
    >;
    return respond(false, keys);
  } catch {
    // Redis itself could not be reached — degraded, never a 5xx, no detail.
    return respond(true, degradedKeys);
  }
}

// §2e: GET only. Every other method returns the §9 wrong_method shape.
async function wrongMethod(): Promise<Response> {
  return new Response(
    JSON.stringify({ ok: false, error: "wrong_method", message: "Only GET is accepted at this endpoint." }),
    { status: 405, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } },
  );
}

export {
  wrongMethod as POST,
  wrongMethod as PUT,
  wrongMethod as PATCH,
  wrongMethod as DELETE,
  wrongMethod as OPTIONS,
};
