/*
 * Companion configuration loader (WS-2).
 *
 * Reads ~/.config/uxistentialism-studio/config.json (overridable for tests).
 *
 * Security posture (PLAN.md rule 6, WORKSTREAM Coordinator Amendment #7):
 *   - REFUSES TO START unless the config file is exactly owner-accessible
 *     (no group/other permission bits — i.e. mode 600).
 *   - The sync secret is exposed as a NON-ENUMERABLE property so it can never
 *     be serialized by JSON.stringify, Object.entries, spread, or logging.
 *   - JSON parse failures raise a generic message: V8's SyntaxError text can
 *     quote file content, which could include the secret.
 *   - vaultPath is realpath-normalized (symlink-resolved) at load time.
 *     inboxPath is resolved here and realpath-normalized by the caller after
 *     the directory is ensured to exist.
 */

import { readFile, stat, realpath } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

export const DEFAULT_CONFIG_PATH = path.join(
  os.homedir(),
  ".config",
  "uxistentialism-studio",
  "config.json",
);

export class ConfigError extends Error {
  constructor(message, code = "CONFIG_ERROR") {
    super(message);
    this.name = "ConfigError";
    this.code = code;
  }
}

const DEFAULTS = {
  watchGlob: "UXistentialism/**/*.md",
  debounceMs: 3000,
  reconcileIntervalMs: 21600000, // 6h
};

function requireString(parsed, key) {
  const v = parsed[key];
  if (typeof v !== "string" || v.length === 0) {
    throw new ConfigError(`Config field "${key}" must be a non-empty string.`, "CONFIG_FIELD");
  }
  return v;
}

function optionalPositiveInt(parsed, key, fallback) {
  const v = parsed[key];
  if (v === undefined || v === null) return fallback;
  if (!Number.isInteger(v) || v <= 0) {
    throw new ConfigError(`Config field "${key}" must be a positive integer.`, "CONFIG_FIELD");
  }
  return v;
}

/**
 * @param {object} [opts]
 * @param {string} [opts.configPath]
 * @returns {Promise<object>} frozen config; `syncSecret` is non-enumerable
 */
export async function loadConfig({ configPath = DEFAULT_CONFIG_PATH } = {}) {
  let st;
  try {
    st = await stat(configPath);
  } catch {
    throw new ConfigError(
      `Config file not found at ${configPath}. See companion/README.md for setup.`,
      "CONFIG_MISSING",
    );
  }
  if (!st.isFile()) {
    throw new ConfigError(`Config path is not a regular file: ${configPath}`, "CONFIG_NOT_FILE");
  }
  if ((st.mode & 0o077) !== 0) {
    throw new ConfigError(
      "Config file permissions are too open — it holds the sync secret and must be " +
        `mode 600. Refusing to start. Fix with: chmod 600 ${configPath}`,
      "CONFIG_PERMISSIONS",
    );
  }

  let parsed;
  try {
    parsed = JSON.parse(await readFile(configPath, "utf8"));
  } catch {
    // Deliberately generic: JSON.parse error text can quote file content,
    // which could include the secret.
    throw new ConfigError("Config file is not valid JSON.", "CONFIG_INVALID_JSON");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ConfigError("Config file must contain a JSON object.", "CONFIG_INVALID_JSON");
  }

  const rawVaultPath = requireString(parsed, "vaultPath");
  const studioUrl = requireString(parsed, "studioUrl").replace(/\/+$/, "");
  if (!/^https?:\/\//.test(studioUrl)) {
    throw new ConfigError('Config field "studioUrl" must be an http(s) URL.', "CONFIG_FIELD");
  }
  const syncSecret = requireString(parsed, "syncSecret");
  const rawInboxPath = requireString(parsed, "inboxPath");

  let vaultPath;
  try {
    vaultPath = await realpath(path.resolve(rawVaultPath)); // symlink-normalized root
  } catch {
    throw new ConfigError(
      "Configured vaultPath does not exist or is not accessible.",
      "CONFIG_VAULT_PATH",
    );
  }

  const config = {
    vaultPath,
    inboxPath: path.resolve(rawInboxPath),
    studioUrl,
    watchGlob: typeof parsed.watchGlob === "string" ? parsed.watchGlob : DEFAULTS.watchGlob,
    debounceMs: optionalPositiveInt(parsed, "debounceMs", DEFAULTS.debounceMs),
    reconcileIntervalMs: optionalPositiveInt(
      parsed,
      "reconcileIntervalMs",
      DEFAULTS.reconcileIntervalMs,
    ),
    logPath: typeof parsed.logPath === "string" ? parsed.logPath : null,
    configPath,
    statusPath: path.join(path.dirname(configPath), "status.json"),
  };

  // The secret must never be serializable: non-enumerable, read-only.
  Object.defineProperty(config, "syncSecret", {
    value: syncSecret,
    enumerable: false,
    writable: false,
    configurable: false,
  });

  return Object.freeze(config);
}
