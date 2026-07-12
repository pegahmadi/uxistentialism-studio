# Obsidian → Studio projection (read-only)

The first source connector. Obsidian is the **source of truth**; the Studio
reads a **sanitized, metadata-only projection** of it — never the live vault.

## Two architectures, one projector

- **Live path (target architecture, WS-1/WS-2):** the local Studio Sync
  companion imports the pure `project()` function, wraps the result in the
  transport envelope, and POSTs it to the hosted Studio's ingestion API, which
  stores it in Upstash Redis. Routine vault updates require no git commit, push,
  or redeploy. See `CLAUDE.md` and `docs/INGESTION_CONTRACT.md`.
- **Fallback path (manual):** the CLI writes the committed fixture
  `data/projections/obsidian.json`, which the app reads only when Redis is
  unavailable or empty. The fixture is legacy-shaped, unversioned fallback data.

## Library use (companion-safe)

```js
import { project } from "./integrations/obsidian/project.mjs";
const { data, sourceUpdatedAt, missing } = await project({ vaultPath });
```

- Pure and read-only: throws (`VaultError`) on failure — never `process.exit` —
  and writes nothing.
- `data` contains exactly the contract's four fields:
  `{ generatedAt, concepts, connections, emerging }`.
- `sourceUpdatedAt` is envelope material: the newest mtime among **every**
  scanned note (non-allowlisted notes affect backlink/emerging counts). A single
  timestamp only — no identities, paths, or per-note mtimes are exposed.

## CLI use (manual fixture refresh)

1. Ensure the vault path is set (the audit tool's gitignored
   `tools/vault-audit/audit.config.json`, or `VAULT_PATH`).
2. Curate `allowlist.json` — everything in it becomes public.
3. Generate:
   ```
   node integrations/obsidian/project.mjs
   ```
4. Review `data/projections/obsidian.json`, then commit it.
   (`npm run refresh-studio` wraps this with vault-integrity verification,
   public-safety validation, lint, and build.)

## Boundary & safety

- **Read-only.** The vault is never written, renamed, or deleted — by the
  library or the CLI.
- **`allowlist.json` is the privacy gate.** Only listed items are projected, and
  only these metadata fields: `title`, `kind`, `category`, `summary`,
  `presentIn`, plus vault-derived `backlinks`, allowlisted↔allowlisted
  `connections`, and `emerging` (term + count). **Never** note bodies, private
  notes, or vault paths — in the fixture, in Redis, or in any payload.
- **Reversible.** Delete the fixture and the app falls back to the hand-curated
  `lib/content.ts`; Redis empty → fixture; both absent → curated defaults.

The app reads the projection through `lib/projection.ts`.

Maintained by the Coordinator (shared infrastructure — not owned by any
implementation workstream).
