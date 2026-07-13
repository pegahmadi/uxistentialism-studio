/*
 * Authenticated HTTP submission to the Studio ingestion endpoints (WS-2).
 *
 * Response classification (contract §6, PLAN.md rule 3):
 *   200 accepted / 200 idempotent  → { outcome: "success", status }
 *   409 stale_payload / duplicate  → { outcome: "conflict", storedRevision, ... }
 *                                    NON-retryable; caller recovers the sequence.
 *   other 4xx                      → { outcome: "contract-drift" } — no retry,
 *                                    surfaced as an error (never silent).
 *   5xx / network error / timeout  → up to 3 retries with 5s backoff, then
 *                                    { outcome: "unavailable" } until next trigger.
 *
 * Every attempt is bounded by an AbortController timeout (FIX 10,
 * requestTimeoutMs, default 30000 ms) covering both the request and the
 * response-body read, so a server that accepts the connection but never
 * responds cannot hang a sync forever. A timeout classifies as a retryable
 * network failure (same 3-retry/backoff/stop policy).
 *
 * The secret travels ONLY in the one Authorization header. It is never logged
 * (the logger additionally redacts it defense-in-depth). Server response
 * `message` bodies are never logged — only the short error category.
 */

export const DEFAULT_REQUEST_TIMEOUT_MS = 30000;

export function createIngestor({
  studioUrl,
  syncSecret,
  logger,
  fetchImpl = fetch,
  maxRetries = 3,
  retryDelayMs = 5000,
  requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  sleep,
}) {
  const wait = sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const base = studioUrl.replace(/\/+$/, "");

  async function attemptOnce(url, body) {
    // FIX 10 — per-attempt timeout; the timer spans the fetch AND the body read.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
    try {
      const res = await fetchImpl(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${syncSecret}`,
        },
        body,
        signal: controller.signal,
      });
      const text = await res.text();
      let parsed = null;
      try {
        parsed = JSON.parse(text);
      } catch {
        /* non-JSON body — classified by HTTP status alone */
      }
      return { status: res.status, body: parsed };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * @param {string} endpointPath e.g. "/api/ingest/obsidian"
   * @param {object} envelope     full §1 envelope
   */
  async function submit(endpointPath, envelope) {
    const url = base + endpointPath;
    const body = JSON.stringify(envelope);

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (attempt > 0) {
        await wait(retryDelayMs);
        logger.info(`retrying ${endpointPath} (retry ${attempt} of ${maxRetries})`);
      }

      let res;
      try {
        res = await attemptOnce(url, body);
      } catch (e) {
        // Timeout aborts surface as AbortError/TimeoutError — retryable, like
        // any network failure. Codes/categories only, never raw messages.
        const category =
          e?.name === "AbortError" || e?.name === "TimeoutError"
            ? `timeout after ${requestTimeoutMs}ms`
            : (e?.cause?.code ?? e?.code ?? e?.name ?? "unknown");
        logger.warn(`network error posting to ${endpointPath}: ${category}`);
        continue; // network → retry
      }

      if (res.status === 200) {
        const status = res.body?.status === "idempotent" ? "idempotent" : "accepted";
        return { outcome: "success", status };
      }

      if (res.status === 409) {
        const error = res.body?.error ?? "conflict";
        logger.warn(
          `${endpointPath}: 409 ${error} (storedRevision ${res.body?.storedRevision ?? "unknown"}) — non-retryable`,
        );
        return {
          outcome: "conflict",
          error,
          storedRevision: res.body?.storedRevision,
          storedProjectedAt: res.body?.storedProjectedAt,
        };
      }

      if (res.status >= 400 && res.status < 500) {
        const error = res.body?.error ?? null;
        if (error === "auth_failed") {
          logger.error(`${endpointPath}: authentication failed (401) — check the sync secret in the local config. Not retrying.`);
        } else {
          logger.error(`${endpointPath}: HTTP ${res.status} ${error ?? ""} — contract drift; payload passed local validation but was rejected by the server. Not retrying.`);
        }
        return { outcome: "contract-drift", httpStatus: res.status, error };
      }

      // 5xx → retry
      logger.warn(`${endpointPath}: server error HTTP ${res.status}`);
    }

    logger.error(`${endpointPath}: unavailable after ${maxRetries} retries — stopping until the next trigger`);
    return { outcome: "unavailable" };
  }

  return { submit };
}
