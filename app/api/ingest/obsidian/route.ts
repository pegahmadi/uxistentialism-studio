// POST /api/ingest/obsidian — Obsidian projection ingestion (contract §2a).
// Thin wrapper: the full pipeline lives in lib/ingest-core.mjs; the atomic
// compare-and-set lives in lib/redis.ts (single Lua EVAL, §6).

import { handleIngest, rejectMethod, KEY_BY_KIND } from "@/lib/ingest-core.mjs";
import { evalIngest, getRedis, type IngestEvalParams } from "@/lib/redis";

export const dynamic = "force-dynamic";

async function runIngest(params: IngestEvalParams) {
  const redis = getRedis();
  if (!redis) throw new Error("storage unavailable"); // → 500 server_error, no detail leaks
  return evalIngest(redis, KEY_BY_KIND.obsidian, params);
}

export async function POST(request: Request): Promise<Response> {
  return handleIngest(request, "obsidian", {
    secret: process.env.STUDIO_SYNC_SECRET,
    runIngest,
  });
}

// Only POST is accepted (§4); every other method returns the §9 wrong_method shape.
export {
  rejectMethod as GET,
  rejectMethod as PUT,
  rejectMethod as PATCH,
  rejectMethod as DELETE,
  rejectMethod as OPTIONS,
};
