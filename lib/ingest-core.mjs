// Ingestion pipeline core — INGESTION_CONTRACT.md v1.1.1 (§1–§6, §9).
//
// Plain ESM on purpose: the two route handlers (app/api/ingest/*) wrap this,
// and the zero-dependency node tests in tests/ws1/ exercise it directly with a
// fake Redis. All schema knowledge lives here; the shared primitives
// (substantive hash §1b, public-safety scan §5) are IMPORTED from tools/ —
// never re-implemented.
//
// Pipeline order (fixed): 405 method → 415 content-type → 413 declared length
// → auth (500 if secret unset; length-safe timingSafeEqual; identical 401s) →
// bounded actual-byte read (413 over 512KB) → envelope validation → data
// schema (§2a/§2b strict) → public-safety scan → hash recompute → atomic EVAL
// → §9 responses.
//
// Every error message is redacted: it names fields and categories, never the
// offending content, paths, or secrets.

import { timingSafeEqual } from "node:crypto";
import { Buffer } from "node:buffer";
import { substantiveHash } from "../tools/canonical-hash.mjs";
import { scanPublicSafety } from "../tools/public-safety.mjs";

export const MAX_BODY_BYTES = 512 * 1024;

/** Exact Date.toISOString() format (§1). Any other ISO 8601 variant is rejected. */
export const ISO_EXACT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const HASH_RE = /^sha256-[0-9a-f]{64}$/;
const ENVELOPE_KEYS = ["schemaVersion", "source", "sourceUpdatedAt", "projectedAt", "revision", "payloadHash", "data"];
const ALLOWED_SOURCES = ["companion", "editorial-board-inbox", "studio-ui"];
const CONFIDENCE_VALUES = ["high", "medium", "low"];
const MANUSCRIPT_STATUSES = ["in review", "awaiting ruling", "complete"];

/** Redis base key per endpoint kind (contract §7). */
export const KEY_BY_KIND = {
  obsidian: "obsidian-projection",
  "editorial-board": "editorial-board",
};

/**
 * Endpoint → envelope source binding (v1.1.2). Each ingestion endpoint accepts
 * exactly one source; "studio-ui" stays reserved for WS-4 and is bound to no
 * ingestion endpoint here.
 */
export const SOURCE_BY_KIND = {
  obsidian: "companion",
  "editorial-board": "editorial-board-inbox",
};

/** Exact automated board provenance label (v1.1.2 §2b binding). */
export const BOARD_SOURCE_LABEL = "Claude Editorial Board · automated";

// ---------------------------------------------------------------- responses

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

/** §9 error response. Messages are static/derived labels — never payload content. */
function errorResponse(status, error, message, extra = {}) {
  return json(status, { ok: false, error, message, ...extra });
}

/** Shared 405 handler for non-POST methods on ingestion endpoints. */
export async function rejectMethod() {
  return errorResponse(405, "wrong_method", "Only POST is accepted at this endpoint.");
}

// ------------------------------------------------------------- small checks

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * Exact ISO timestamp (§1, v1.1.2): format regex, a real epoch value, AND a
 * round-trip check — new Date(Date.parse(t)).toISOString() must equal t.
 * The round trip is load-bearing: Date.parse rolls impossible calendar dates
 * over (e.g. 2026-02-31 parses as March 3), so regex + parse alone would
 * accept them.
 */
function parseExactIso(v) {
  if (typeof v !== "string" || !ISO_EXACT_RE.test(v)) return null;
  const ms = Date.parse(v);
  if (Number.isNaN(ms)) return null;
  if (new Date(ms).toISOString() !== v) return null;
  return ms;
}

function isFiniteNumber(v) {
  return typeof v === "number" && Number.isFinite(v);
}

/**
 * Strict object shape: every required key present, no unknown keys.
 * Returns a redacted problem description or null when the shape is exact.
 */
function exactKeys(obj, required, trail) {
  for (const k of required) {
    if (!(k in obj)) return `missing required field ${trail}.${k}`;
  }
  for (const k of Object.keys(obj)) {
    if (!required.includes(k)) return `unknown field ${trail}.${k}`;
  }
  return null;
}

// ------------------------------------------------------- envelope validation

/**
 * Validate the transport envelope (§1). Returns
 * `{ ok: true, envelope: { ..., sourceUpdatedAtMs, projectedAtMs } }` or
 * `{ ok: false, message }` with a redacted message.
 */
export function validateEnvelope(body) {
  if (!isPlainObject(body)) return { ok: false, message: "payload must be a JSON object" };
  const shape = exactKeys(body, ENVELOPE_KEYS, "$");
  if (shape) return { ok: false, message: shape };

  // §12: accept exactly schemaVersion 1 — every other value is rejected.
  if (body.schemaVersion !== 1) return { ok: false, message: "unsupported schemaVersion (server accepts exactly 1)" };
  if (typeof body.source !== "string" || !ALLOWED_SOURCES.includes(body.source)) {
    return { ok: false, message: "invalid field $.source" };
  }
  const sourceUpdatedAtMs = parseExactIso(body.sourceUpdatedAt);
  if (sourceUpdatedAtMs === null) return { ok: false, message: "invalid field $.sourceUpdatedAt (exact Date.toISOString() format required)" };
  const projectedAtMs = parseExactIso(body.projectedAt);
  if (projectedAtMs === null) return { ok: false, message: "invalid field $.projectedAt (exact Date.toISOString() format required)" };
  if (typeof body.revision !== "number" || !Number.isInteger(body.revision) || body.revision < 1) {
    return { ok: false, message: "invalid field $.revision (integer >= 1 required)" };
  }
  if (typeof body.payloadHash !== "string" || !HASH_RE.test(body.payloadHash)) {
    return { ok: false, message: "invalid field $.payloadHash (sha256-<64 hex> required)" };
  }
  if (!isPlainObject(body.data)) return { ok: false, message: "invalid field $.data (object required)" };

  return { ok: true, envelope: { ...body, sourceUpdatedAtMs, projectedAtMs } };
}

// ------------------------------------------------- data validation — §2a

function checkString(v, trail, maxLen = Infinity) {
  if (typeof v !== "string") return `invalid field ${trail} (string required)`;
  if (v.length > maxLen) return `invalid field ${trail} (exceeds ${maxLen} characters)`;
  return null;
}

/** Validate an Obsidian projection `data` object (§2a, strict). */
export function validateObsidianData(data) {
  const shape = exactKeys(data, ["generatedAt", "concepts", "connections", "emerging"], "$.data");
  if (shape) return { ok: false, message: shape };
  if (parseExactIso(data.generatedAt) === null) {
    return { ok: false, message: "invalid field $.data.generatedAt (exact Date.toISOString() format required)" };
  }

  if (!Array.isArray(data.concepts) || data.concepts.length === 0) {
    return { ok: false, message: "invalid field $.data.concepts (non-empty array required)" };
  }
  for (let i = 0; i < data.concepts.length; i++) {
    const c = data.concepts[i];
    const trail = `$.data.concepts[${i}]`;
    if (!isPlainObject(c)) return { ok: false, message: `invalid entry at ${trail}` };
    const cShape = exactKeys(c, ["id", "title", "kind", "category", "summary", "presentIn", "backlinks"], trail);
    if (cShape) return { ok: false, message: cShape };
    // slug-style id: no spaces, no path separators, no .md (§2a)
    if (typeof c.id !== "string" || c.id.length === 0 || /\s/.test(c.id) || /[\\/]/.test(c.id) || /\.md/i.test(c.id)) {
      return { ok: false, message: `invalid field ${trail}.id (slug-style string required)` };
    }
    const problem =
      checkString(c.title, `${trail}.title`) ??
      checkString(c.kind, `${trail}.kind`) ??
      checkString(c.category, `${trail}.category`) ??
      checkString(c.summary, `${trail}.summary`, 500);
    if (problem) return { ok: false, message: problem };
    if (!Array.isArray(c.presentIn) || c.presentIn.some((s) => typeof s !== "string")) {
      return { ok: false, message: `invalid field ${trail}.presentIn (array of strings required)` };
    }
    if (!isFiniteNumber(c.backlinks)) return { ok: false, message: `invalid field ${trail}.backlinks (number required)` };
  }

  if (!Array.isArray(data.connections)) return { ok: false, message: "invalid field $.data.connections (array required)" };
  for (let i = 0; i < data.connections.length; i++) {
    const e = data.connections[i];
    const trail = `$.data.connections[${i}]`;
    if (!isPlainObject(e)) return { ok: false, message: `invalid entry at ${trail}` };
    const eShape = exactKeys(e, ["from", "to"], trail);
    if (eShape) return { ok: false, message: eShape };
    const problem = checkString(e.from, `${trail}.from`) ?? checkString(e.to, `${trail}.to`);
    if (problem) return { ok: false, message: problem };
  }

  if (!Array.isArray(data.emerging)) return { ok: false, message: "invalid field $.data.emerging (array required)" };
  for (let i = 0; i < data.emerging.length; i++) {
    const e = data.emerging[i];
    const trail = `$.data.emerging[${i}]`;
    if (!isPlainObject(e)) return { ok: false, message: `invalid entry at ${trail}` };
    const eShape = exactKeys(e, ["term", "references"], trail);
    if (eShape) return { ok: false, message: eShape };
    const problem = checkString(e.term, `${trail}.term`);
    if (problem) return { ok: false, message: problem };
    if (!isFiniteNumber(e.references)) return { ok: false, message: `invalid field ${trail}.references (number required)` };
  }

  return { ok: true };
}

// ------------------------------------------------- data validation — §2b

/** Validate an Editorial Board `data` object (§2b, strict, v1 authority rules). */
export function validateBoardData(data) {
  const shape = exactKeys(
    data,
    ["manuscript", "reviewedAt", "reviewers", "unresolvedQuestions", "rulings", "nextDecision", "sourceLabel", "updatedAt", "updatedBy"],
    "$.data",
  );
  if (shape) return { ok: false, message: shape };

  const m = data.manuscript;
  if (!isPlainObject(m)) return { ok: false, message: "invalid field $.data.manuscript (object required)" };
  const mShape = exactKeys(m, ["id", "title", "reviewRound", "status"], "$.data.manuscript");
  if (mShape) return { ok: false, message: mShape };
  const mProblem = checkString(m.id, "$.data.manuscript.id") ?? checkString(m.title, "$.data.manuscript.title");
  if (mProblem) return { ok: false, message: mProblem };
  if (!isFiniteNumber(m.reviewRound)) return { ok: false, message: "invalid field $.data.manuscript.reviewRound (number required)" };
  if (typeof m.status !== "string" || !MANUSCRIPT_STATUSES.includes(m.status)) {
    return { ok: false, message: "invalid field $.data.manuscript.status" };
  }
  // Status rule (v1): completion is human-attested state. Every live submission
  // claiming "complete" is rejected regardless of updatedBy.
  if (m.status === "complete") {
    return { ok: false, message: 'live submissions must not claim manuscript.status "complete" (human-attested state; v1 authority rule)' };
  }

  if (parseExactIso(data.reviewedAt) === null) {
    return { ok: false, message: "invalid field $.data.reviewedAt (exact Date.toISOString() format required)" };
  }

  if (!Array.isArray(data.reviewers) || data.reviewers.length === 0) {
    return { ok: false, message: "invalid field $.data.reviewers (non-empty array required)" };
  }
  for (let i = 0; i < data.reviewers.length; i++) {
    const r = data.reviewers[i];
    const trail = `$.data.reviewers[${i}]`;
    if (!isPlainObject(r)) return { ok: false, message: `invalid entry at ${trail}` };
    const rShape = exactKeys(r, ["role", "diagnosis", "recommendation", "confidence"], trail);
    if (rShape) return { ok: false, message: rShape };
    const problem =
      checkString(r.role, `${trail}.role`) ??
      checkString(r.diagnosis, `${trail}.diagnosis`, 500) ??
      checkString(r.recommendation, `${trail}.recommendation`, 500);
    if (problem) return { ok: false, message: problem };
    if (typeof r.confidence !== "string" || !CONFIDENCE_VALUES.includes(r.confidence)) {
      return { ok: false, message: `invalid field ${trail}.confidence` };
    }
  }

  if (!Array.isArray(data.unresolvedQuestions)) {
    return { ok: false, message: "invalid field $.data.unresolvedQuestions (array required)" };
  }
  for (let i = 0; i < data.unresolvedQuestions.length; i++) {
    const problem = checkString(data.unresolvedQuestions[i], `$.data.unresolvedQuestions[${i}]`, 300);
    if (problem) return { ok: false, message: problem };
  }

  // Rulings rule (v1 authority boundary): the endpoint rejects EVERY non-empty
  // rulings array regardless of updatedBy — updatedBy is provenance, never
  // authorization. Automated board output always carries rulings: [].
  if (!Array.isArray(data.rulings)) return { ok: false, message: "invalid field $.data.rulings (array required)" };
  if (data.rulings.length > 0) {
    return { ok: false, message: "live submissions must carry an empty rulings array (human authorship is established by the write path, not payload content; v1 authority rule)" };
  }

  const tail = checkString(data.nextDecision, "$.data.nextDecision", 300);
  if (tail) return { ok: false, message: tail };
  // Provenance binding (v1.1.2): the automated path carries exactly the
  // automated label — anything else is a forged provenance claim.
  if (data.sourceLabel !== BOARD_SOURCE_LABEL) {
    return { ok: false, message: `invalid field $.data.sourceLabel (this endpoint requires exactly "${BOARD_SOURCE_LABEL}")` };
  }
  if (parseExactIso(data.updatedAt) === null) {
    return { ok: false, message: "invalid field $.data.updatedAt (exact Date.toISOString() format required)" };
  }
  // Provenance binding (v1.1.2): asserted human provenance through the
  // automated path is forbidden — this endpoint only ever carries "claude".
  if (data.updatedBy !== "claude") {
    return { ok: false, message: 'invalid field $.data.updatedBy (automated ingestion carries exactly "claude"; human provenance cannot be asserted through this path)' };
  }

  return { ok: true };
}

const VALIDATE_BY_KIND = {
  obsidian: validateObsidianData,
  "editorial-board": validateBoardData,
};

// ---------------------------------------------------------------- transport

/** Content-Type must be application/json (parameters like charset tolerated). */
function contentTypeOk(request) {
  const raw = request.headers.get("content-type");
  if (!raw) return false;
  return raw.split(";")[0].trim().toLowerCase() === "application/json";
}

/**
 * Declared length (§4): present, well-formed, non-negative, ≤ 512KB — checked
 * BEFORE reading the body. Anything else → 413.
 */
function declaredLengthOk(request) {
  const raw = request.headers.get("content-length");
  if (raw === null || !/^\d+$/.test(raw.trim())) return false;
  return Number(raw.trim()) <= MAX_BODY_BYTES;
}

/**
 * Length-safe constant-time auth (§3). Returns "ok" | "unauthorized" |
 * "unconfigured". Every credential failure is indistinguishable to the caller.
 */
export function checkAuth(authorizationHeader, secret) {
  if (typeof secret !== "string" || secret.length === 0) return "unconfigured";
  const secretBuf = Buffer.from(secret, "utf8");
  const match = typeof authorizationHeader === "string" ? /^Bearer (.+)$/.exec(authorizationHeader) : null;
  // Malformed/missing header: burn an equal-cost comparison, then refuse.
  const tokenBuf = match ? Buffer.from(match[1], "utf8") : Buffer.alloc(secretBuf.length);
  if (tokenBuf.length !== secretBuf.length) {
    timingSafeEqual(secretBuf, secretBuf); // unequal lengths never reach timingSafeEqual with mixed inputs
    return "unauthorized";
  }
  if (!timingSafeEqual(tokenBuf, secretBuf)) return "unauthorized";
  return match ? "ok" : "unauthorized";
}

/**
 * Bounded actual-byte body read (§4): streams and counts received bytes,
 * aborting past 512KB regardless of the declared Content-Length. Never calls
 * request.json() on an unbounded body.
 */
export async function readBoundedBody(request, maxBytes = MAX_BODY_BYTES) {
  const body = request.body;
  if (!body) return { ok: true, text: "" };
  const reader = body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      return { ok: false };
    }
    chunks.push(value);
  }
  return { ok: true, text: Buffer.concat(chunks).toString("utf8") };
}

// ------------------------------------------------------------- the pipeline

/**
 * Full ingestion pipeline for one endpoint kind.
 *
 * @param {Request} request
 * @param {"obsidian" | "editorial-board"} kind
 * @param {{
 *   secret: string | undefined,
 *   runIngest: (params: {
 *     dataJson: string, metaJson: string, hash: string,
 *     revision: number, projectedAtMs: number, nowIso: string,
 *   }) => Promise<{ status: string, storedRevision?: number, storedProjectedAt?: string }>,
 *   now?: () => Date,
 * }} deps  runIngest binds the atomic EVAL (lib/redis.ts) to the endpoint's key.
 * @returns {Promise<Response>}
 */
export async function handleIngest(request, kind, deps) {
  if (request.method !== "POST") return rejectMethod();
  if (!contentTypeOk(request)) {
    return errorResponse(415, "wrong_content_type", "Content-Type must be application/json.");
  }
  if (!declaredLengthOk(request)) {
    return errorResponse(413, "oversized", "Content-Length must be present, well-formed, and at most 512KB.");
  }

  // Auth before reading the body. Absent secret is a server error, never a bypass.
  const auth = checkAuth(request.headers.get("authorization"), deps.secret);
  if (auth === "unconfigured") {
    return errorResponse(500, "server_error", "Server is not configured for ingestion.");
  }
  if (auth !== "ok") {
    return errorResponse(401, "auth_failed", "Authentication failed.");
  }

  const body = await readBoundedBody(request);
  if (!body.ok) return errorResponse(413, "oversized", "Request body exceeds 512KB.");

  let parsed;
  try {
    parsed = JSON.parse(body.text);
  } catch {
    return errorResponse(400, "invalid_schema", "Request body is not valid JSON.");
  }

  const env = validateEnvelope(parsed);
  if (!env.ok) return errorResponse(400, "invalid_schema", env.message);
  const envelope = env.envelope;

  // Endpoint source binding (v1.1.2): each endpoint accepts exactly one source.
  if (envelope.source !== SOURCE_BY_KIND[kind]) {
    return errorResponse(400, "invalid_schema", `invalid field $.source (this endpoint accepts exactly "${SOURCE_BY_KIND[kind]}")`);
  }

  const validateData = VALIDATE_BY_KIND[kind];
  const dataCheck = validateData(envelope.data);
  if (!dataCheck.ok) return errorResponse(400, "invalid_schema", dataCheck.message);

  // §5 public-safety scan — violations are already redacted by the primitive.
  const violations = scanPublicSafety(envelope.data);
  if (violations.length > 0) {
    return errorResponse(400, "invalid_schema", `public-safety violation: ${violations.slice(0, 5).join("; ")}`);
  }

  // §1b: the server recomputes the substantive hash and never trusts the
  // client-asserted value for comparison or storage.
  let recomputedHash;
  try {
    recomputedHash = substantiveHash(envelope.data);
  } catch {
    return errorResponse(400, "invalid_schema", "payload data has no canonical JSON representation");
  }
  if (recomputedHash !== envelope.payloadHash) {
    return errorResponse(400, "invalid_schema", "payloadHash does not match the server-recomputed substantive hash");
  }

  const now = (deps.now ?? (() => new Date()))();
  const nowIso = now.toISOString();
  const meta = {
    revision: envelope.revision,
    projectedAt: envelope.projectedAt,
    projectedAtMs: envelope.projectedAtMs,
    sourceUpdatedAt: envelope.sourceUpdatedAt,
    payloadHash: recomputedHash,
    source: envelope.source,
    lastSuccessfulSync: nowIso,
  };

  let result;
  try {
    result = await deps.runIngest({
      dataJson: JSON.stringify(envelope.data),
      metaJson: JSON.stringify(meta),
      hash: recomputedHash,
      revision: envelope.revision,
      projectedAtMs: envelope.projectedAtMs,
      nowIso,
    });
  } catch {
    // Redis missing/unreachable or transport failure — no internal detail leaks.
    return errorResponse(500, "server_error", "Storage is unavailable.");
  }

  switch (result.status) {
    case "accepted":
      return json(200, { ok: true, status: "accepted" });
    case "idempotent":
      return json(200, { ok: true, status: "idempotent" });
    case "stale_payload":
      return errorResponse(409, "stale_payload", "A newer payload is already stored.", {
        storedRevision: result.storedRevision,
        storedProjectedAt: result.storedProjectedAt,
      });
    case "duplicate":
      return errorResponse(409, "duplicate", "This revision was already consumed by a different payload.", {
        storedRevision: result.storedRevision,
        storedProjectedAt: result.storedProjectedAt,
      });
    default:
      return errorResponse(500, "server_error", "Unexpected storage result.");
  }
}
