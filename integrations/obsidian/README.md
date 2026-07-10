# Obsidian → Studio projection (read-only)

The first source connector. Obsidian is the **source of truth**; the Studio is a
lens that reads a **sanitized, metadata-only projection** of it — never the live
vault. See [`docs/vault-audit-plan.md`](../../docs/vault-audit-plan.md) and the
integration architecture in the project history.

## Boundary & safety

- **Read-only.** Reuses the audit tool's `_shared.mjs`; the vault is never
  written, renamed, or deleted.
- **The app never reads the vault.** In production it reads only the committed
  `data/projections/obsidian.json`. The vault is not present in the deploy.
- **`allowlist.json` is the privacy gate.** Only items listed there are
  projected, and only these metadata fields: `title`, `kind`, `category`,
  `summary`, `presentIn`, plus vault-derived `backlinks` (a number) and
  `connections` (allowlisted ↔ allowlisted only) and `emerging` (term + count).
  **Never** note bodies, private notes, or the vault path.
- **Reversible.** Delete `data/projections/obsidian.json` and the app falls back
  to the hand-curated `lib/content.ts`.
- No database. No live vault access in production.

## Use

1. Ensure the vault path is set (the audit tool's gitignored
   `tools/vault-audit/audit.config.json`, or `VAULT_PATH`).
2. Curate `allowlist.json` — everything in it becomes public.
3. Generate:
   ```
   node integrations/obsidian/project.mjs
   ```
4. Review `data/projections/obsidian.json`, then commit it.

The app reads the projection through `lib/projection.ts`.
