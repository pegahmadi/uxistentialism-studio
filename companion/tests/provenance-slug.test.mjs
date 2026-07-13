#!/usr/bin/env node
/* WS-2 follow-up tests:
 *   - Local v1.1.2 Editorial Board provenance parity (updatedBy pinned to
 *     "claude"; sourceLabel pinned to the exact automated label, U+00B7
 *     middle dot included).
 *   - Strict §2a slug parity for concept ids (non-empty, no whitespace, no
 *     "/" or "\", no ".md" fragment).
 * Every rejection case proves ZERO HTTP requests via the mock-server request
 * counter — validation happens strictly BEFORE any submission. Uses a
 * synthetic temp vault only — NEVER the real vault. */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createLogger } from "../logger.mjs";
import { createStatusStore } from "../status.mjs";
import { createIngestor } from "../ingestor.mjs";
import { createSyncPipeline } from "../sync-pipeline.mjs";
import { validateEditorialBoardData, validateObsidianDataStrict } from "../validator.mjs";
import { project } from "../../integrations/obsidian/project.mjs";
import {
  check,
  summary,
  startMockServer,
  makeSyntheticVault,
  validBoardData,
  validArtifact,
} from "./_helpers.mjs";

const { root: vaultPath, allowlistPath } = await makeSyntheticVault();
const stateDir = await mkdtemp(path.join(tmpdir(), "ws2-provenance-"));
// One shared mock server; every case asserts on request-count DELTAS.
const server = await startMockServer(() => ({ status: 200, body: { ok: true, status: "accepted" } }));

let stacks = 0;
async function makeStack(projectFn) {
  stacks += 1;
  const lines = [];
  const logger = createLogger({ redactions: [[vaultPath, "[vault]"]], sink: (l) => lines.push(l) });
  const status = await createStatusStore({
    statusPath: path.join(stateDir, `status-${stacks}.json`),
    logger,
  });
  const ingestor = createIngestor({ studioUrl: server.url, syncSecret: "sk-test", logger, sleep: async () => {} });
  const config = { vaultPath, studioUrl: server.url, allowlistPath };
  const pipeline = createSyncPipeline({ config, status, ingestor, logger, projectFn });
  return { pipeline, lines };
}

const NEAR_MISS_LABELS = [
  ['normal hyphen "-" instead of the U+00B7 middle dot', "Claude Editorial Board - automated"],
  ["trailing space", "Claude Editorial Board · automated "],
  ['"curated" suffix', "Claude Editorial Board · automated · curated"],
];

console.log("v1.1.2 provenance parity — unit (validateEditorialBoardData):");
{
  const provFor = (mutate) => {
    const d = validBoardData();
    mutate(d);
    return validateEditorialBoardData(d);
  };
  check(
    "the exact automated provenance passes validation",
    validateEditorialBoardData(validBoardData()).length === 0,
    validateEditorialBoardData(validBoardData()),
  );
  check(
    'updatedBy "human" rejected with the provenance rule',
    provFor((d) => (d.updatedBy = "human")).some((m) => m.includes("updatedBy") && m.includes("provenance")),
  );
  for (const [name, label] of NEAR_MISS_LABELS) {
    check(
      `near-miss sourceLabel rejected: ${name}`,
      provFor((d) => (d.sourceLabel = label)).some((m) => m.includes("sourceLabel") && m.includes("provenance")),
    );
  }
}

console.log("v1.1.2 provenance parity — pipeline (zero HTTP requests on rejection):");
{
  const { pipeline } = await makeStack();

  let before = server.requests.length;
  const human = validArtifact();
  human.data.updatedBy = "human";
  let r = await pipeline.submitEditorialBoard(human);
  check('updatedBy "human" → validation-error', r.outcome === "validation-error", r.outcome);
  check('updatedBy "human" → ZERO HTTP requests', server.requests.length === before, server.requests.length - before);

  for (const [name, label] of NEAR_MISS_LABELS) {
    before = server.requests.length;
    const bad = validArtifact();
    bad.data.sourceLabel = label;
    r = await pipeline.submitEditorialBoard(bad);
    check(`near-miss sourceLabel (${name}) → validation-error`, r.outcome === "validation-error", r.outcome);
    check(`near-miss sourceLabel (${name}) → ZERO HTTP requests`, server.requests.length === before, server.requests.length - before);
  }

  // The exact automated provenance passes AND the counter demonstrably moves —
  // proving the zero-request assertions above measure a live server.
  before = server.requests.length;
  r = await pipeline.submitEditorialBoard(validArtifact());
  check("exact automated provenance submits successfully", r.outcome === "success", r);
  check("exactly ONE request for the valid artifact (counter is live)", server.requests.length === before + 1, server.requests.length - before);
}

console.log("Strict §2a slug parity — unit (validateObsidianDataStrict):");
{
  const goodData = () => ({
    generatedAt: "2026-07-12T10:00:00.000Z",
    concepts: [{ id: "alpha", title: "Alpha", kind: "core", category: "t", summary: "Fine.", presentIn: ["today"], backlinks: 2 }],
    connections: [],
    emerging: [],
  });
  const slugViolations = (id) => {
    const d = goodData();
    d.concepts[0].id = id;
    return validateObsidianDataStrict(d).filter((m) => m.includes("slug"));
  };
  check("empty id rejected", slugViolations("").length === 1);
  check("whitespace id rejected", slugViolations("bad id").length === 1);
  check("slash id rejected", slugViolations("bad/id").length === 1);
  check("backslash id rejected", slugViolations("bad\\id").length === 1);
  check('".md" fragment id rejected', slugViolations("alpha.md").length === 1);
  check('".MD" fragment id rejected (case-insensitive)', slugViolations("alpha.MD").length === 1);
  check("slug-style id passes", slugViolations("alpha-beta_2").length === 0);
  check("baseline data has no strict violations", validateObsidianDataStrict(goodData()).length === 0, validateObsidianDataStrict(goodData()));
  check(
    "slug violation message never repeats the offending value (redaction)",
    validateObsidianDataStrict((() => { const d = goodData(); d.concepts[0].id = "bad id"; return d; })())
      .every((m) => !m.includes("bad id")),
  );
}

console.log("Strict §2a slug parity — pipeline (zero HTTP requests per rejected class):");
{
  const projectWithId = (id) => async ({ vaultPath: vp }) => {
    const projection = await project({ vaultPath: vp, allowlistPath });
    projection.data.concepts[0].id = id; // the ONLY mutation
    return projection;
  };

  const SLUG_CASES = [
    ["empty", ""],
    ["whitespace", "bad id"],
    ["slash", "bad/id"],
    ["backslash", "bad\\id"],
    ['".md" fragment', "alpha.md"],
  ];
  for (const [name, id] of SLUG_CASES) {
    const { pipeline, lines } = await makeStack(projectWithId(id));
    const before = server.requests.length;
    const r = await pipeline.syncObsidian();
    check(`${name} id → validation-error`, r.outcome === "validation-error", r.outcome);
    check(`${name} id → ZERO HTTP requests`, server.requests.length === before, server.requests.length - before);
    check(`${name} id → the strict slug rule fired`, lines.some((l) => l.includes("slug")), lines.filter((l) => l.includes("validation")));
  }

  // Passing slug case: the unmodified synthetic projection (slug ids
  // alpha/beta) passes strict validation and actually reaches the server.
  const { pipeline } = await makeStack(async ({ vaultPath: vp }) => project({ vaultPath: vp, allowlistPath }));
  const before = server.requests.length;
  const r = await pipeline.syncObsidian();
  check("slug-style projection submits successfully", r.outcome === "success", r);
  check("exactly ONE request for the slug-style projection", server.requests.length === before + 1, server.requests.length - before);
}

await server.close();
await rm(vaultPath, { recursive: true, force: true });
await rm(allowlistPath, { force: true });
await rm(stateDir, { recursive: true, force: true });
summary("provenance-slug");
