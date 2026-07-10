#!/usr/bin/env node
/*
 * UXistentialism Studio — Knowledge Governance Pass (M2)
 *
 * North star: increase the CONCEPTUAL COHERENCE of the field, not merely reduce
 * organizational entropy. A tidy vault can still be intellectually fragmented; a
 * coherent vault tells one increasingly unified story.
 *
 * The tool aims to be DIAGNOSTIC (architectural observations), not merely
 * prescriptive (file instructions). It opens with Field Diagnostics — what is
 * happening to the architecture of the field — then offers recommendations on
 * two axes:
 *   - Curation   (increases coherence): elevate, promote, extract, refactor, field-map
 *   - Maintenance (reduces entropy):    connect, update, merge, archive
 * Every recommendation carries confidence (high/medium/low), the evidence that
 * triggered it, and a one-line coherence rationale.
 *
 * The tool PROPOSES. You curate. It is read-only and never edits the vault.
 *
 * Usage: node tools/vault-audit/govern.mjs
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadNotes, computeGraph, OUT_DIR, fail, fmt } from "./_shared.mjs";

const CORE = "01 Core Models";
const CONCEPTS = "02 Concepts (Ontology)";
const ARTICLES = "04 UXistentialism Articles";
const MAP = "00 Map";

const STOP = new Set([
  "the", "a", "an", "of", "and", "to", "in", "for", "on", "as", "is", "are", "be",
  "becoming", "your", "this", "that", "with", "into", "from", "why", "how", "what",
  "model", "models", "concept", "concepts", "system", "systems",
]);

// Refinement: meta / archive notes are not concepts and must not pollute concept
// analysis (families, promote) or act as implicit-link sources.
const isMeta = (n) =>
  n.fileBase.startsWith("_") ||
  /concept audit brief/i.test(n.fileBase) ||
  n.relPath.toLowerCase().includes("_archive");

// Refinement: operational process notes are not intellectual work. Distinguish
// them so they don't masquerade as "connect" candidates or implicit-link sources.
const OPERATIONAL_RE = /^(Council —|Pegah OS|Friday Brief|Weekly Digest|Signal Intelligence Loop|Vault Maintenance Loop|Session Log)/i;
const isOperational = (n) =>
  n.fileBase === "VAULT_PROTOCOL" ||
  (n.folder === "99 Lab" && (OPERATIONAL_RE.test(n.fileBase) || /[—-]\s*SOP$/i.test(n.fileBase) || /session log/i.test(n.fileBase)));

const RATIONALE = {
  elevate: "Gives a concept the field already leans on an explicit home — making implicit structure explicit.",
  promote: "Recognizes a concept that has become foundational by moving it into Core Models.",
  extract: "Lifts a reusable concept out of an article so the whole field can reference it.",
  refactor: "Introduces a higher-order concept to organize an emergent family without flattening its members.",
  fieldmap: "Keeps the Field Map tracking the architecture as it actually evolves.",
  connect: "Links an isolated note into the graph so its ideas join the story.",
  update: "Refreshes stale-but-referenced material the field still depends on.",
  merge: "Collapses duplicate entries so one concept has exactly one home.",
  archive: "Clears a dead end so the field's signal isn't diluted by noise.",
};

const median = (xs) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const rank = { high: 0, medium: 1, low: 2 };

async function main() {
  const { root, notes } = await loadNotes();
  const graph = computeGraph(notes);
  const byKey = graph.keyToNotes;

  const isConceptFolder = (n) => n.folder === CORE || n.folder === CONCEPTS;
  const conceptNotes = notes.filter((n) => isConceptFolder(n) && !isMeta(n));
  const conceptKeys = new Set(conceptNotes.map((n) => n.key));
  const newest = Math.max(...notes.map((n) => n.mtimeMs));
  const STALE_MS = 120 * 24 * 60 * 60 * 1000;

  // Concept-to-concept inbound: how many *concepts* cite this concept.
  const conceptInbound = new Map();
  for (const n of conceptNotes) {
    for (const t of n.outbound) {
      const tk = byKey.has(t) ? t : graph.aliasToKey.get(t) || t;
      if (conceptKeys.has(tk) && tk !== n.key) {
        conceptInbound.set(tk, (conceptInbound.get(tk) || 0) + 1);
      }
    }
  }

  // ---- Implicit links (vault-wide): concept mentions in prose not yet linked.
  // Sources exclude meta and operational notes (they are not intellectual work).
  const vocab = [];
  for (const n of conceptNotes) {
    for (const term of new Set([n.fileBase, ...n.aliases])) {
      const t = String(term).trim();
      const single = !t.includes(" ");
      if ((single && t.length < 6) || STOP.has(t.toLowerCase())) continue;
      vocab.push({ key: n.key, term: t, title: n.title });
    }
  }
  const implicitMap = new Map();
  for (const n of notes) {
    if (isMeta(n) || isOperational(n)) continue;
    const prose = n.body.replace(/\[\[[^\]]+?\]\]/g, " ");
    const already = new Set(n.outbound.map((t) => (byKey.has(t) ? t : graph.aliasToKey.get(t) || t)));
    for (const v of vocab) {
      if (v.key === n.key || already.has(v.key)) continue;
      const m = prose.match(new RegExp(`\\b${esc(v.term)}\\b`, "gi"));
      if (!m) continue;
      const id = `${n.relPath}|${v.key}`;
      const prev = implicitMap.get(id);
      if (!prev || m.length > prev.count) {
        implicitMap.set(id, { from: n.relPath, fromFolder: n.folder, toKey: v.key, toTitle: v.title, term: v.term, count: m.length });
      }
    }
  }
  const implicit = [...implicitMap.values()].sort((a, b) => b.count - a.count);
  const implicitByFrom = new Map();
  for (const l of implicit) {
    if (!implicitByFrom.has(l.from)) implicitByFrom.set(l.from, []);
    implicitByFrom.get(l.from).push(l);
  }
  const implicitConf = (l) => (l.count >= 3 || l.term.includes(" ") ? "medium" : "low");

  const recs = [];
  const add = (axis, move, subject, confidence, evidence) =>
    recs.push({ axis, move, subject, confidence, evidence, rationale: RATIONALE[move] });

  // ---- CURATION ----------------------------------------------------------
  // elevate: referenced-but-missing concepts.
  for (const [target, info] of [...graph.unresolved.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 30)) {
    const c = info.count >= 5 ? "high" : info.count >= 3 ? "medium" : "low";
    add("curation", "elevate", `[[${target}]]`, c, [
      `Referenced ${info.count}× but no note satisfies it`,
      `From: ${[...info.from].slice(0, 4).join(", ")}${info.from.size > 4 ? " …" : ""}`,
    ]);
  }

  // promote: 02 concepts behaving like Core Models.
  const coreInbound = notes.filter((n) => n.folder === CORE && !isMeta(n)).map((n) => n.inboundCount);
  const coreMed = median(coreInbound);
  const coreMax = Math.max(0, ...coreInbound);
  const promoteHits = [];
  for (const n of conceptNotes.filter((n) => n.folder === CONCEPTS)) {
    const ci = conceptInbound.get(n.key) || 0;
    if (n.inboundCount >= coreMed && ci >= 3) {
      const c = n.inboundCount >= coreMax * 0.8 ? "high" : n.inboundCount >= coreMed ? "medium" : "low";
      promoteHits.push(n);
      add("curation", "promote", n.title, c, [
        `${n.inboundCount} backlinks (Core Models median ${coreMed}, max ${coreMax})`,
        `Cited by ${ci} other concepts`,
        `\`${n.relPath}\``,
      ]);
    }
  }

  // extract: articles the graph treats as concepts.
  const extractHits = [];
  for (const art of notes.filter((n) => n.folder === ARTICLES)) {
    const linkFrom = [...(graph.inboundFrom.get(art.key) || new Set())].filter((p) => !p.startsWith(ARTICLES));
    const mentions = implicit.filter((l) => l.toKey === art.key && !l.from.startsWith(ARTICLES)).length;
    const total = linkFrom.length + mentions;
    if (total >= 2) {
      const c = total >= 4 ? "high" : total >= 3 ? "medium" : "low";
      extractHits.push({ art, total });
      add("curation", "extract", art.title, c, [
        `Used from outside Articles ${total}× (${linkFrom.length} links, ${mentions} mentions)`,
        `\`${art.relPath}\``,
      ]);
    }
  }

  // refactor: emergent concept families by shared significant token (deduped by title).
  const tokenMap = new Map();
  for (const n of conceptNotes) {
    for (const tok of new Set(n.title.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !STOP.has(w)))) {
      if (!tokenMap.has(tok)) tokenMap.set(tok, new Map());
      tokenMap.get(tok).set(n.title, n);
    }
  }
  const families = [...tokenMap.entries()]
    .map(([tok, m]) => [tok, [...m.values()]])
    .filter(([, m]) => m.length >= 3)
    .sort((a, b) => b[1].length - a[1].length);
  for (const [tok, members] of families) {
    const c = members.length >= 4 ? "high" : "medium";
    add("curation", "refactor", `The "${tok}" family (${members.length} concepts)`, c, [
      `Members: ${members.map((m) => m.title).join(", ")}`,
      `Consider a higher-order concept organizing the "${tok}" family, keeping each member distinct.`,
    ]);
  }

  // field-map: hubs / emerging concepts missing from 00 Map.
  const mapNotes = notes.filter((n) => n.folder === MAP);
  const mapText = mapNotes.map((n) => n.body.toLowerCase()).join("\n");
  const mapLinks = new Set(mapNotes.flatMap((n) => n.outbound));
  const topHubs = conceptNotes.filter((n) => n.inboundCount >= 10).sort((a, b) => b.inboundCount - a.inboundCount);
  const missingHubs = topHubs.filter((n) => !mapLinks.has(n.key) && !mapText.includes(n.title.toLowerCase()));
  const topEmerging = [...graph.unresolved.entries()].filter(([, i]) => i.count >= 3).map(([t]) => t);
  const missingEmerging = topEmerging.filter((t) => !mapLinks.has(t) && !mapText.includes(t));
  if (missingHubs.length || missingEmerging.length) {
    add("curation", "fieldmap", "Field Map is missing current architecture", "medium", [
      missingHubs.length ? `Hubs absent from 00 Map: ${missingHubs.map((n) => n.title).join(", ")}` : null,
      missingEmerging.length ? `Emerging concepts absent: ${missingEmerging.map((t) => `[[${t}]]`).join(", ")}` : null,
    ].filter(Boolean));
  }

  // ---- MAINTENANCE -------------------------------------------------------
  for (const n of notes) {
    const orphan = n.inboundCount === 0 && n.outboundCount === 0;

    // operational process notes: distinguished from thinking; parked, not connected.
    if (isOperational(n)) {
      add("maintenance", "archive", n.title, "medium", [`Operational process note (not intellectual work) · \`${n.relPath}\``]);
      continue;
    }

    // connect: substantive orphan (prefer specific implicit-link suggestions).
    if (orphan && n.wordCount >= 60 && !isMeta(n)) {
      const sugg = (implicitByFrom.get(n.relPath) || []).slice(0, 4);
      add("maintenance", "connect", n.title, sugg.length ? "high" : "medium", [
        `Orphan, ${n.wordCount} words · \`${n.relPath}\``,
        sugg.length ? `Suggested links: ${sugg.map((s) => `[[${s.toTitle}]]`).join(", ")}` : "No obvious concept mentions — needs manual placement",
      ]);
    }

    // archive: dead-end stubs.
    if (orphan && n.wordCount < 60) {
      add("maintenance", "archive", n.title, n.wordCount === 0 ? "high" : "low", [
        `Orphan, ${n.wordCount} words · \`${n.relPath}\``,
      ]);
    }

    // update: stale-but-referenced, or explicit TODO/WIP.
    if (n.hasTodo) {
      add("maintenance", "update", n.title, "medium", [`Contains TODO/WIP/DRAFT · \`${n.relPath}\``]);
    } else if (n.inboundCount >= 1 && newest - n.mtimeMs > STALE_MS) {
      const days = Math.round((newest - n.mtimeMs) / (24 * 60 * 60 * 1000));
      add("maintenance", "update", n.title, "low", [
        `${n.inboundCount} backlinks but ~${days}d older than newest work · \`${n.relPath}\``,
      ]);
    }
  }

  // merge: duplicate & near-duplicate names.
  for (const [key, arr] of graph.duplicates) {
    add("maintenance", "merge", key, "high", [`Duplicate name across: ${arr.map((n) => `\`${n.relPath}\``).join(", ")}`]);
  }
  const normMap = new Map();
  for (const n of notes) {
    const norm = n.fileBase.toLowerCase().replace(/[^a-z0-9]+/g, "");
    if (!normMap.has(norm)) normMap.set(norm, []);
    normMap.get(norm).push(n);
  }
  for (const [, arr] of normMap) {
    if (arr.length > 1 && new Set(arr.map((n) => n.key)).size > 1) {
      add("maintenance", "merge", arr.map((n) => n.fileBase).join(" / "), "medium", [
        `Near-duplicate names: ${arr.map((n) => `\`${n.relPath}\``).join(", ")}`,
      ]);
    }
  }

  // ---- FIELD DIAGNOSTICS (observations, not instructions) ----------------
  const diagnostics = [];
  const rankedConcepts = [...conceptNotes].sort((a, b) => b.inboundCount - a.inboundCount);
  const topInConcepts = rankedConcepts.slice(0, 6).filter((n) => n.folder === CONCEPTS);
  if (topInConcepts.length >= 4) {
    diagnostics.push(
      `**The center of gravity has shifted.** ${topInConcepts.length} of the 6 most-referenced concepts live in *02 Concepts*, not *01 Core Models* (whose backlink median is just ${coreMed}). Your de-facto core models — ${topInConcepts.slice(0, 4).map((n) => `${n.title} (${n.inboundCount})`).join(", ")} — sit in the Concepts drawer.`,
    );
  }
  if (families.length) {
    diagnostics.push(
      `**Concept families are emerging.** The strongest: ${families.slice(0, 3).map(([t, m]) => `“${t}” (${m.length})`).join(", ")}. Each is cohering into a group that may want a higher-order organizing concept.`,
    );
  }
  const accumulating = [...conceptInbound.entries()]
    .map(([k, v]) => ({ note: conceptNotes.find((n) => n.key === k), ci: v }))
    .filter((x) => x.note && x.ci >= 6)
    .sort((a, b) => b.ci - a.ci);
  if (accumulating.length) {
    diagnostics.push(
      `**Some concepts are accumulating responsibility from many directions.** ${accumulating.slice(0, 3).map((x) => `${x.note.title} (cited by ${x.ci} concepts)`).join(", ")} — each may be absorbing more than one role and could be candidates to split.`,
    );
  }
  if (extractHits.length) {
    diagnostics.push(
      `**Articles are behaving like reusable concepts.** ${extractHits.slice(0, 3).map((x) => `“${x.art.title}” (used ${x.total}×)`).join(", ")} are being referenced from outside the Articles folder — the field is treating them as concepts.`,
    );
  }
  if (graph.duplicates.length) {
    diagnostics.push(
      `**A concept is fragmenting across locations.** ${graph.duplicates.map(([, a]) => `“${a[0].title}” exists in ${a.length} places`).join("; ")} — a single idea splitting into duplicate homes.`,
    );
  }

  // ---- OUTPUT ------------------------------------------------------------
  const sortRecs = (rs) => rs.sort((a, b) => rank[a.confidence] - rank[b.confidence]);
  const curation = ["elevate", "promote", "extract", "refactor", "fieldmap"];
  const maintenance = ["connect", "update", "merge", "archive"];
  const generatedAt = new Date().toISOString();

  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(
    path.join(OUT_DIR, "governance.json"),
    JSON.stringify({ generatedAt, vaultPath: root, diagnostics, recs, implicit }, null, 2),
  );
  await writeFile(
    path.join(OUT_DIR, "governance-worklist.md"),
    render({ generatedAt, root, notes, diagnostics, recs, curation, maintenance, sortRecs, implicit, implicitConf }),
  );

  const count = (axis) => recs.filter((r) => r.axis === axis).length;
  console.log("\n✓ Governance pass complete. The vault was not modified.");
  console.log(`  Field diagnostics:           ${fmt(diagnostics.length)}`);
  console.log(`  Curation recommendations:    ${fmt(count("curation"))}`);
  console.log(`  Maintenance recommendations: ${fmt(count("maintenance"))}`);
  console.log(`  Implicit-link candidates:    ${fmt(implicit.length)} (vault-wide)`);
  console.log(`\n  Output (gitignored): .vault-audit/governance-worklist.md`);
}

const badge = (c) => ({ high: "**HIGH**", medium: "MED", low: "_low_" })[c];

function section(L, title, moves, recs, sortRecs, labels) {
  L.push(`## ${title}`, "");
  for (const move of moves) {
    const rs = sortRecs(recs.filter((r) => r.move === move));
    if (!rs.length) continue;
    L.push(`### ${labels[move]} (${rs.length})`, "", `_${rs[0].rationale}_`, "");
    for (const r of rs) {
      L.push(`- ${badge(r.confidence)} — **${r.subject}**`);
      for (const e of r.evidence) L.push(`  - ${e}`);
    }
    L.push("");
  }
}

function render(d) {
  const L = [];
  L.push(`# Knowledge Governance Worklist`, "");
  L.push(`_Generated ${d.generatedAt} — read-only; the vault was not modified._`, "");
  L.push(`> **North star:** increase the conceptual coherence of the field, not merely reduce organizational entropy. The tool proposes; you curate.`, "");
  L.push(`Vault: \`${d.root}\` · ${fmt(d.notes.length)} notes`, "");

  L.push(`## Field Diagnostics`, "", `_Observations about the architecture of the field — not instructions about files._`, "");
  if (d.diagnostics.length) for (const obs of d.diagnostics) L.push(`- ${obs}`);
  else L.push(`_No structural observations this pass._`);
  L.push("");

  section(L, "Curation — increases coherence", d.curation, d.recs, d.sortRecs, {
    elevate: "Elevate concept", promote: "Promote to Core Model", extract: "Extract reusable concept", refactor: "Refactor into a family", fieldmap: "Update the Field Map",
  });
  section(L, "Maintenance — reduces entropy", d.maintenance, d.recs, d.sortRecs, {
    connect: "Connect", update: "Update", merge: "Merge / disambiguate", archive: "Archive",
  });

  L.push(`## Implicit links (vault-wide)`, "", `_Concept mentions found in prose that are not yet wikilinked. Latent relationships to make explicit — one of the strongest coherence levers._`, "");
  const mag = d.implicit.filter((l) => l.fromFolder === "03 Products" || l.from.includes("Magnolia"));
  const rest = d.implicit.filter((l) => !(l.fromFolder === "03 Products" || l.from.includes("Magnolia")));
  const line = (l) => `- ${badge(d.implicitConf(l))} — \`${l.from}\` → **[[${l.toTitle}]]** (${l.count}× "${l.term}")`;
  L.push(`### Magnolia → conceptual graph (${mag.length})`, "");
  for (const l of mag.slice(0, 40)) L.push(line(l));
  L.push("", `### Across the rest of the field (top ${Math.min(rest.length, 100)} of ${fmt(rest.length)})`, "");
  for (const l of rest.slice(0, 100)) L.push(line(l));
  if (rest.length > 100) L.push("", `_+${fmt(rest.length - 100)} more in governance.json._`);
  L.push("");
  return L.join("\n") + "\n";
}

main().catch((e) => fail(e.stack || String(e)));
