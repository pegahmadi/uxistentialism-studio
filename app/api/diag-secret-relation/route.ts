// TEMPORARY — REMOVE AFTER GATE-5 SECRET DIAGNOSIS (revert this commit).
//
// POST-only, relation-only secret diagnostic (Codex-specified):
//   - reads STUDIO_SYNC_SECRET exactly as production auth does
//   - candidate arrives via Authorization: Bearer over HTTPS (its already-
//     authorized transmission path); NO request body is accepted
//   - comparisons run through the production length-safe constant-time
//     primitive; the response is ONE static category string
//   - anything that is not a matching relation → generic empty 404 (conceals
//     the endpoint from arbitrary requests; means "different values" to the
//     supervised caller during the confirmed diagnostic window)
//   - server secret absent → the same static server-misconfiguration body
//     production uses
//   - never logs the header, secret, comparison inputs, or outcomes

import { relationOf } from "../../../lib/diag-secret-relation.mjs";

export const dynamic = "force-dynamic";

const HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store" } as const;
const generic404 = () => new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request): Promise<Response> {
  // Accept no request body: reject the ACTUAL body stream (a request may
  // carry a body without any Content-Length), keeping the declared-length
  // check as defense in depth.
  const declared = request.headers.get("content-length");
  if (declared && declared !== "0") return generic404();
  if (request.body !== null) return generic404();

  const relation = relationOf(request.headers.get("authorization"), process.env.STUDIO_SYNC_SECRET);

  if (relation === "unconfigured") {
    // Same static shape production auth uses for a missing server secret.
    return new Response(
      JSON.stringify({ ok: false, error: "server_error", message: "Server configuration error." }),
      { status: 500, headers: HEADERS },
    );
  }
  if (relation === "none") return generic404();
  return new Response(JSON.stringify({ relation }), { status: 200, headers: HEADERS });
}

// Every non-POST method answers the identical generic empty 404, so no
// framework-generated 405/Allow response can reveal that the route exists.
const conceal = async (): Promise<Response> => generic404();
export const GET = conceal;
export const HEAD = conceal;
export const PUT = conceal;
export const PATCH = conceal;
export const DELETE = conceal;
export const OPTIONS = conceal;
