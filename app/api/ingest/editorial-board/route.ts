// POST /api/ingest/editorial-board — Editorial Board ingestion (contract §2b).
// Thin wrapper over lib/ingest-core.mjs. The v1 authority rules are enforced in
// the shared validator: every non-empty `rulings` array and every
// manuscript.status "complete" is rejected regardless of `updatedBy`.

import { handleIngest, rejectMethod, KEY_BY_KIND } from "@/lib/ingest-core.mjs";
import { evalIngest, getRedis, type IngestEvalParams } from "@/lib/redis";

export const dynamic = "force-dynamic";

async function runIngest(params: IngestEvalParams) {
  const redis = getRedis();
  if (!redis) throw new Error("storage unavailable"); // → 500 server_error, no detail leaks
  return evalIngest(redis, KEY_BY_KIND["editorial-board"], params);
}

export async function POST(request: Request): Promise<Response> {
  return handleIngest(request, "editorial-board", {
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
