// TEMPORARY — REMOVE AFTER GATE-5 SECRET DIAGNOSIS (revert this commit).
//
// Relation-only comparison between the server's STUDIO_SYNC_SECRET and a
// candidate presented via Authorization: Bearer (the secret's already-
// authorized transmission path). Reuses the PRODUCTION length-safe
// constant-time primitive (checkAuth) for every comparison. Returns only a
// coarse relation category — never values, substrings, hashes, or lengths.
// Performs no logging.

import { checkAuth } from "./ingest-core.mjs";

/**
 * @param {string|null} authorizationHeader  raw Authorization header
 * @param {string|undefined} serverSecret    process.env.STUDIO_SYNC_SECRET
 * @returns {"unconfigured"|"exact"|"server_trim_matches_local"|"local_trim_matches_server"|"both_trim_match"|"none"}
 */
export function relationOf(authorizationHeader, serverSecret) {
  if (typeof serverSecret !== "string" || serverSecret.length === 0) return "unconfigured";
  const match =
    typeof authorizationHeader === "string" ? /^Bearer (.+)$/.exec(authorizationHeader) : null;
  if (!match) return "none";
  const local = match[1];
  const localTrimHeader = `Bearer ${local.trim()}`;

  if (checkAuth(authorizationHeader, serverSecret) === "ok") return "exact";
  if (checkAuth(authorizationHeader, serverSecret.trim()) === "ok") return "server_trim_matches_local";
  if (checkAuth(localTrimHeader, serverSecret) === "ok") return "local_trim_matches_server";
  if (checkAuth(localTrimHeader, serverSecret.trim()) === "ok") return "both_trim_match";
  return "none";
}
