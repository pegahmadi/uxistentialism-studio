#!/usr/bin/env node
/* Vault watcher tests (WS-2, FIX 5): the default "**\/*.md" glob matches notes
 * at realistic vault-relative paths (top-level content dirs like
 * "02 Concepts (Ontology)"), the projector's skip set is honored, and
 * add/change/unlink events all trigger the pipeline. Uses a SYNTHETIC temp
 * vault only — never the real vault. */

import { mkdtemp, mkdir, writeFile, rm, unlink, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createVaultEventFilter, createVaultWatcher, VAULT_SKIP_FOLDERS } from "../vault-watcher.mjs";
import { createLogger } from "../logger.mjs";
import { check, summary, sleep } from "./_helpers.mjs";

const vaultPath = await mkdtemp(path.join(tmpdir(), "ws2-watch-vault-"));

console.log("Event filter (pure — no chokidar):");
{
  const relevant = createVaultEventFilter({ vaultPath, watchGlob: "**/*.md" });
  check(
    "realistic top-level-dir note matches the default glob",
    relevant(path.join(vaultPath, "02 Concepts (Ontology)", "Thrownness.md")),
  );
  check("root-level note matches", relevant(path.join(vaultPath, "Authority Debt.md")));
  check("deeply nested note matches", relevant(path.join(vaultPath, "03 Products", "Sub", "x.md")));
  check("non-md file ignored", !relevant(path.join(vaultPath, "05 Signals", "image.png")));
  check("path outside the vault ignored", !relevant(path.join(tmpdir(), "elsewhere", "x.md")));
  check("the vault root itself ignored", !relevant(vaultPath));
  for (const skip of VAULT_SKIP_FOLDERS) {
    check(`skip folder honored: ${skip}`, !relevant(path.join(vaultPath, skip, "x.md")));
  }
  check("nested skip folder honored", !relevant(path.join(vaultPath, "03 Products", ".trash", "x.md")));
  check("dot-directory honored", !relevant(path.join(vaultPath, ".hidden-dir", "x.md")));
  check("skip set mirrors the projector's DEFAULT_SKIP", JSON.stringify([...VAULT_SKIP_FOLDERS]) === JSON.stringify([".obsidian", ".trash", ".git", ".stversions", "node_modules", "Templates"]));

  // PROJECTOR PARITY — dot-prefix exclusion applies to DIRECTORY segments
  // only: the projector skips dot-directories but still READS dot-files.
  check(
    "parity: note inside a dot-directory ignored (.hidden-directory/note.md)",
    !relevant(path.join(vaultPath, ".hidden-directory", "note.md")),
  );
  check(
    "parity: dot-FILE at the vault root passes the filter (.hidden-note.md)",
    relevant(path.join(vaultPath, ".hidden-note.md")),
  );
  check(
    "parity: dot-FILE inside an ordinary directory passes the filter",
    relevant(path.join(vaultPath, "02 Concepts (Ontology)", ".hidden-note.md")),
  );

  const scoped = createVaultEventFilter({ vaultPath, watchGlob: "02 Concepts (Ontology)/**/*.md" });
  check("scoped glob matches inside its dir", scoped(path.join(vaultPath, "02 Concepts (Ontology)", "x.md")));
  check("scoped glob rejects outside its dir", !scoped(path.join(vaultPath, "03 Products", "x.md")));
}

console.log("Live chokidar integration (synthetic vault):");
{
  // Pre-existing structure before the watcher starts (ignoreInitial).
  const conceptsDir = path.join(vaultPath, "02 Concepts (Ontology)");
  await mkdir(conceptsDir, { recursive: true });
  await mkdir(path.join(vaultPath, "Templates"), { recursive: true });
  const preexisting = path.join(conceptsDir, "preexisting.md");
  await writeFile(preexisting, "# Pre\n");

  // Symlink-escape fixture (followSymlinks: false): an EXTERNAL directory —
  // never part of the vault — reachable only via a symlink beneath the vault.
  // Created before the watcher starts so ignoreInitial swallows the link.
  const externalDir = await mkdtemp(path.join(tmpdir(), "ws2-external-"));
  const externalNote = path.join(externalDir, "external-note.md");
  await writeFile(externalNote, "# External\n");
  await symlink(externalDir, path.join(vaultPath, "linked-external"), "dir");

  let syncs = 0;
  const lines = [];
  const logger = createLogger({ redactions: [[vaultPath, "[vault]"]], sink: (l) => lines.push(l) });
  const watcher = createVaultWatcher({
    vaultPath,
    watchGlob: "**/*.md",
    debounceMs: 60,
    onSync: async () => (syncs += 1),
    logger,
  });

  const waitFor = async (cond, ms = 5000) => {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      if (cond()) return true;
      await sleep(25);
    }
    return cond();
  };

  check("watcher reports ready", await waitFor(() => lines.some((l) => l.includes("vault watcher ready"))));
  check("ignoreInitial: no sync from pre-existing notes", syncs === 0, syncs);

  // add at a realistic vault-relative path
  const notePath = path.join(conceptsDir, "x.md");
  await writeFile(notePath, "# New note\n");
  check("edit at a realistic path triggers the pipeline", await waitFor(() => syncs === 1), syncs);

  // change
  await writeFile(notePath, "# New note, edited\n");
  check("change triggers the pipeline again", await waitFor(() => syncs === 2), syncs);

  // unlink — deleted allowlisted notes must sync (FIX 5)
  await unlink(notePath);
  check("unlink triggers the pipeline", await waitFor(() => syncs === 3), syncs);

  // skip folders stay silent
  await writeFile(path.join(vaultPath, "Templates", "template.md"), "# T\n");
  await sleep(400);
  check("Templates/ edit does not trigger", syncs === 3, syncs);

  // non-md files stay silent
  await writeFile(path.join(conceptsDir, "image.png"), "png-bytes");
  await sleep(400);
  check("non-md file does not trigger", syncs === 3, syncs);

  // PROJECTOR PARITY — dot-FILES are read by the projector, so their events
  // must trigger the pipeline (dot-prefix exclusion is dir-segments-only).
  await writeFile(path.join(conceptsDir, ".hidden-note.md"), "# Hidden but projected\n");
  check("dot-file edit triggers the pipeline (projector parity)", await waitFor(() => syncs === 4), syncs);

  // SYMLINK ESCAPE (followSymlinks: false) — changes to the external note
  // behind the in-vault symlink must NOT trigger the pipeline...
  await writeFile(externalNote, "# External, edited\n");
  await sleep(400);
  check("edit behind an in-vault symlink does not trigger (followSymlinks: false)", syncs === 4, syncs);

  // ...while a normal in-vault edit afterwards still does.
  await writeFile(path.join(conceptsDir, "after-symlink.md"), "# Still watched\n");
  check("normal in-vault edit still triggers after the symlink case", await waitFor(() => syncs === 5), syncs);

  check("no note filename ever logged", lines.every((l) => !l.includes("x.md") && !l.includes("preexisting") && !l.includes("hidden-note") && !l.includes("external-note")), lines);

  await watcher.close();
  await rm(externalDir, { recursive: true, force: true });
}

await rm(vaultPath, { recursive: true, force: true });
summary("vault-watcher");
