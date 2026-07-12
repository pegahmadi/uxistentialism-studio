/*
 * Zero-dependency test helpers (WS-2). Pattern follows tools/tests/*.test.mjs:
 * plain scripts, check(), non-zero exit on failure.
 *
 * Tests NEVER touch the real vault, the real inbox, or the network — synthetic
 * temp fixtures and a local mock HTTP server (node:http) only.
 */

import http from "node:http";
import { mkdtemp, mkdir, writeFile, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

let pass = 0;
let fail = 0;

export function check(name, cond, detail) {
  if (cond) {
    pass += 1;
    console.log(`  ✓ ${name}`);
  } else {
    fail += 1;
    console.log(`  ✗ ${name}${detail !== undefined ? ` -> ${JSON.stringify(detail)}` : ""}`);
  }
}

export function summary(suite) {
  console.log(`\n${fail === 0 ? "✓ ALL PASS" : "✗ FAILURES"} [${suite}] — ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Capturing logger sink. */
export function captureLogger(createLogger, redactions = []) {
  const lines = [];
  const logger = createLogger({ redactions, sink: (line) => lines.push(line) });
  return { logger, lines };
}

/**
 * Local mock ingestion server. `handler(record, n)` returns
 * { status, body } or the string "destroy" to sever the socket (network error).
 */
export async function startMockServer(handler) {
  const requests = [];
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      let body = null;
      try {
        body = JSON.parse(raw);
      } catch {
        /* keep null */
      }
      const record = { method: req.method, url: req.url, headers: req.headers, body };
      requests.push(record);
      const reply = handler(record, requests.length);
      if (reply === "destroy") {
        req.socket.destroy();
        return;
      }
      res.writeHead(reply.status, { "content-type": "application/json" });
      res.end(JSON.stringify(reply.body ?? {}));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}`,
    port,
    requests,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

/**
 * Synthetic temp vault + allowlist (pattern: tools/tests/projector.test.mjs).
 * NEVER the real vault.
 */
export async function makeSyntheticVault() {
  const root = await mkdtemp(path.join(tmpdir(), "ws2-synth-vault-"));
  const at = async (rel, content, mtimeSec) => {
    const p = path.join(root, rel);
    await mkdir(path.dirname(p), { recursive: true });
    await writeFile(p, content);
    await utimes(p, mtimeSec, mtimeSec);
  };
  await at("alpha.md", "# Alpha\nLinks to [[beta]].", 1_000_000);
  await at("beta.md", "# Beta\nSee [[alpha]].", 2_000_000);

  const allowlistPath = path.join(root, "..", `ws2-synth-allow-${path.basename(root)}.json`);
  await writeFile(
    allowlistPath,
    JSON.stringify({
      concepts: [
        { vaultKey: "alpha", id: "alpha", title: "Alpha", kind: "core", category: "test", summary: "Alpha concept.", presentIn: ["today"] },
        { vaultKey: "beta", id: "beta", title: "Beta", kind: "concept", category: "test", summary: "Beta concept.", presentIn: ["field"] },
      ],
      emerging: ["gamma missing"],
    }),
  );
  return { root, allowlistPath };
}

/** A valid §2b editorial-board data object (deep-copied on each call). */
export function validBoardData() {
  return structuredClone({
    manuscript: { id: "ms-01", title: "Interfaces as Thrownness", reviewRound: 2, status: "awaiting ruling" },
    reviewedAt: "2026-07-12T18:04:07.123Z",
    reviewers: [
      { role: "Methodologist", diagnosis: "Sound method.", recommendation: "Tighten claims.", confidence: "high" },
    ],
    unresolvedQuestions: ["Does the framing hold for non-digital artifacts?"],
    rulings: [],
    nextDecision: "Human ruling on scope.",
    sourceLabel: "Claude Editorial Board · automated",
    updatedAt: "2026-07-12T18:04:07.123Z",
    updatedBy: "claude",
  });
}

/** A valid §2b inbox artifact. */
export function validArtifact() {
  return { sourceUpdatedAt: "2026-07-12T18:04:07.123Z", data: validBoardData() };
}

export function artifactName(iso, suffix) {
  return `editorial-board-${iso.replace(/[:.]/g, "-")}-${suffix}.json`;
}
