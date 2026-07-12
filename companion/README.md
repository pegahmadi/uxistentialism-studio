# Studio Sync Companion (WS-2)

A local Node.js daemon that keeps the hosted UXistentialism Studio in sync with
your Mac — without commits, pushes, or redeploys:

- **Vault sync.** Watches the Obsidian vault (read-only), regenerates the
  sanitized projection through the shared pure projector, validates it with the
  shared public-safety validator, wraps it in the contract §1 envelope, and
  POSTs it to `POST /api/ingest/obsidian`.
- **Editorial Board inbox.** Watches `~/.studio-inbox/` for data-only board
  artifacts (contract §2b), validates them locally, builds the envelope, and
  POSTs to `POST /api/ingest/editorial-board`. There is **no direct-POST
  fallback** — if the companion is offline, artifacts wait in the inbox and are
  drained on the next start.

The companion **never writes to the vault**, never writes
`data/projections/*.json`, and never logs the sync secret or private paths.

## Requirements

- Node.js ≥ 18 (global `fetch`); developed against Node 24
- npm dependencies: `chokidar` only

```bash
cd companion
npm install --cache /tmp/npm-cache-ws2   # temp cache: the default ~/.npm cache is corrupted on this machine
```

## Configuration

Create `~/.config/uxistentialism-studio/config.json`:

```json
{
  "vaultPath": "/Users/you/Desktop/Obsidian-UXistentialism",
  "studioUrl": "https://<the confirmed production URL>",
  "syncSecret": "<STUDIO_SYNC_SECRET value>",
  "watchGlob": "UXistentialism/**/*.md",
  "debounceMs": 3000,
  "reconcileIntervalMs": 21600000,
  "inboxPath": "/Users/you/.studio-inbox",
  "logPath": "/Users/you/Library/Logs/studio-companion.log"
}
```

Required: `vaultPath`, `studioUrl`, `syncSecret`, `inboxPath`.
Defaults: `watchGlob` `UXistentialism/**/*.md`, `debounceMs` 3000,
`reconcileIntervalMs` 21600000 (6h).

**The config file must be mode 600.** It holds the sync secret, and the
companion refuses to start otherwise:

```bash
chmod 600 ~/.config/uxistentialism-studio/config.json
```

`syncSecret` must match the `STUDIO_SYNC_SECRET` environment variable on the
hosted Studio. After rotating it, update both and restart the companion.

## Running manually

```bash
node companion/index.mjs
```

On startup the companion drains any waiting inbox artifacts, runs one full
vault sync, then watches for changes. Useful signals:

- `SIGUSR1` — immediate sync + inbox drain, bypassing the debounce:
  `pkill -USR1 -f 'companion/index.mjs'`
- `SIGTERM` / `Ctrl-C` — clean shutdown

## Install as a LaunchAgent (manual step)

The template lives at `companion/launch-agent.plist`. Installation is manual
and deliberately not automated:

1. Fill in the placeholders (`__NODE_PATH__` — from `which node`,
   `__COMPANION_DIR__`, `__LOG_PATH__`).
2. `cp companion/launch-agent.plist ~/Library/LaunchAgents/com.uxistentialism.studio-companion.plist`
3. `launchctl load ~/Library/LaunchAgents/com.uxistentialism.studio-companion.plist`

Verify with `launchctl list | grep uxistentialism`.

## Local state

- `~/.config/uxistentialism-studio/status.json` — written atomically
  (temp file + rename), mode 600. Holds per-endpoint sync status and the two
  independent revision sequences (`obsidianProjection`, `editorialBoard`).
- `~/.studio-inbox/` and `~/.studio-inbox/rejected/` — created/verified
  mode 700. Artifacts that fail validation (or are rejected by the server as
  contract drift) are preserved under `rejected/` with a timestamp prefix.

## Behavior reference

| Server response | Companion behavior |
|---|---|
| 200 `accepted` / 200 `idempotent` | Success — records `lastSuccess` and the revision sent. Idempotent responses refresh the server heartbeat, so an unchanged vault never goes operationally stale. |
| 409 `stale_payload` / `duplicate` | Non-retryable conflict. No `lastSuccess`; the revision sequence recovers to `storedRevision` so the next submission uses `storedRevision + 1` with a fresh projection. |
| Other 4xx | Contract drift — logged loudly, never retried. Inbox artifacts move to `rejected/`. |
| 5xx / network error | 3 retries at 5s intervals, then stop until the next trigger (file event, reconciliation, `SIGUSR1`, or restart). Inbox artifacts stay in the inbox. |

Local validation failures (public-safety scan, §2a/§2b schema) are never
submitted: the error is logged with redacted messages and, for inbox
artifacts, the file moves to `rejected/`.

## Troubleshooting

- **"Config file permissions are too open"** — `chmod 600` the config file.
- **"Config file is not valid JSON"** — the message is deliberately generic so
  the secret can never leak into a log; check the file by hand.
- **"authentication failed (401)"** — the local `syncSecret` does not match
  the server's `STUDIO_SYNC_SECRET`.
- **"contract drift"** — the payload passed local validation but the server
  rejected it. Do not force-resubmit: the local code and the deployed contract
  version have diverged.
- **Vault edits not syncing** — confirm the note is under `watchGlob`, wait
  `debounceMs` + a few seconds, check the log (`logPath`), or send `SIGUSR1`.
- **status.json unreadable/corrupt** — the companion starts fresh and the
  revision sequence self-heals through the server's 409 → `storedRevision`
  recovery.
- **Logs** never contain the secret, the vault path, the inbox path, or your
  home directory; those appear as `[redacted-secret]`, `[vault]`, `[inbox]`,
  and `~`.

## Tests

```bash
cd companion
npm test          # zero-dependency node test suite (synthetic vaults + mock HTTP server)
```

The tests never touch the real vault, the real inbox, or the network.
