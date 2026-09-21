import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";
import { CONFIG_DIR, CONFIG_FILE, getConfigPath } from "./xdg.js";
import type { Config } from "./types.js";
import { validateConfig } from "./validate.js";

export { getConfigPath };
export type { Config } from "./types.js";

export function configExists(): boolean {
  return existsSync(CONFIG_FILE);
}

export function loadConfig(): Config | null {
  if (!existsSync(CONFIG_FILE)) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(CONFIG_FILE, "utf-8"));
  } catch {
    throw new Error(`Invalid config file ${CONFIG_FILE}: file is not valid JSON.`);
  }

  try {
    const config = validateConfig(parsed);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed) &&
      !("schemaVersion" in parsed)
    ) {
      saveConfig(config);
    }
    return config;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid config file ${CONFIG_FILE}: ${reason}`);
  }
}

export function saveConfig(config: Config): void {
  const validated = validateConfig(config);
  mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });

  const tempFile = join(CONFIG_DIR, `.${basename(CONFIG_FILE)}.${process.pid}.${Date.now()}.tmp`);

  try {
    chmodSync(CONFIG_DIR, 0o700);
    writeFileSync(tempFile, `${JSON.stringify(validated, null, 2)}\n`, {
      flag: "wx",
      mode: 0o600,
    });
    renameSync(tempFile, CONFIG_FILE);
    chmodSync(CONFIG_FILE, 0o600);
  } catch (error) {
    try {
      if (existsSync(tempFile)) unlinkSync(tempFile);
    } catch {
      // Ignore cleanup errors and report the first write error.
    }
    throw error;
  }
}

export function deleteConfig(): boolean {
  if (existsSync(CONFIG_FILE)) {
    unlinkSync(CONFIG_FILE);
    return true;
  }
  return false;
}

export function getConfigOrThrow(): Config {
  const config = loadConfig();
  if (config) return config;
  throw new Error("No configuration found. Run `whstats config setup` to configure credentials.");
}
