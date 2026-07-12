// DataResult<T> — the live-versus-fallback read contract (INGESTION_CONTRACT.md §8).
//
// Every lib data reader returns one of these per request. The UI must reflect
// `source` and `lastSuccessfulSync` visibly; silent degradation is not permitted.
//
//   "live"     — data came from Upstash Redis successfully
//   "fallback" — Redis failed/empty/unconfigured; data from committed fixture in data/
//   "default"  — neither Redis nor fixture available; curated defaults (lib/content.ts)

export type DataSource = "live" | "fallback" | "default";

export interface DataResult<T> {
  data: T;
  source: DataSource;
  /** ISO 8601 from `{key}-meta`, or null when unknown / not a synced source. */
  lastSuccessfulSync: string | null;
  /** true if lastSuccessfulSync is more than 24h ago or missing (§8). */
  stale: boolean;
  /** Short internal error category if Redis failed; never a secret or a path. */
  error: string | null;
}

export const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000;

/** §8: stale = lastSuccessfulSync missing, unparsable, or older than 24h. */
export function isStale(lastSuccessfulSync: string | null, nowMs: number = Date.now()): boolean {
  if (!lastSuccessfulSync) return true;
  const t = Date.parse(lastSuccessfulSync);
  if (Number.isNaN(t)) return true;
  return nowMs - t > STALE_THRESHOLD_MS;
}
