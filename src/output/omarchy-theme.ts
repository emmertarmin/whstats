import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { TerminalMarkdownTheme } from "./markdown-terminal.js";

function themeColor(value: unknown): string | undefined {
  if (typeof value !== "string" || !/^#[0-9a-f]{6}$/i.test(value)) return undefined;
  return value;
}

export function parseOmarchyTerminalTheme(input: string): TerminalMarkdownTheme | undefined {
  const colors = Bun.TOML.parse(input) as Record<string, unknown>;
  const accent = themeColor(colors.accent);
  const surface = themeColor(colors.lighter_background);
  const muted = themeColor(colors.muted);
  if (!accent || !surface || !muted) return undefined;
  return { accent, surface, muted };
}

export function loadOmarchyTerminalTheme(
  stateHome = process.env.XDG_STATE_HOME ?? join(homedir(), ".local", "state"),
): TerminalMarkdownTheme | undefined {
  const path = join(stateHome, "omarchy", "current", "theme", "colors.toml");
  try {
    return parseOmarchyTerminalTheme(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
}
