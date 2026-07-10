# Vault Audit (read-only)

A standalone, dependency-free tool that reads the Obsidian vault (the thinking
archive) and produces a metadata manifest + a human-readable report. It is
**not** part of the Next.js app and is not wired into it.

See [`../../docs/vault-audit-plan.md`](../../docs/vault-audit-plan.md) for the
full plan, safety model, and sequence.

## Safety guarantees

- **Read-only.** No code path writes, renames, or deletes anything in the vault.
- **Writes only to `.vault-audit/`** at the repo root (gitignored).
- **Refuses to run** if the vault path resolves inside this repo.
- **No network, no AI, no dependencies.** Deterministic.

## Configure

Point the tool at your vault (which lives **outside** this repo) one of two ways:

- Env var:
  ```
  VAULT_PATH="/absolute/path/to/Vault" node tools/vault-audit/scan.mjs
  ```
- Or copy `audit.config.example.json` → `audit.config.json` (gitignored) and set
  `vaultPath`.

## Run

```
node tools/vault-audit/scan.mjs
```

Outputs (gitignored):

- `.vault-audit/vault-manifest.json` — full per-note metadata + link graph.
- `.vault-audit/audit-report.md` — overview, backlink hubs, and ontology signals
  (elevate / merge / rename candidates), orphans, and coverage.

Nothing here is committed, and nothing is written back to the vault.
