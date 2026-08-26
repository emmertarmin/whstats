import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadOmarchyTerminalTheme } from "../../src/output/omarchy-theme.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function temporaryStateHome(): string {
  const directory = mkdtempSync(join(tmpdir(), "whstats-omarchy-theme-"));
  temporaryDirectories.push(directory);
  return directory;
}

function writeTheme(stateHome: string, contents: string): void {
  const themeDirectory = join(stateHome, "omarchy", "current", "theme");
  mkdirSync(themeDirectory, { recursive: true });
  writeFileSync(join(themeDirectory, "colors.toml"), contents);
}

describe("optional Omarchy terminal theme", () => {
  test("loads the semantic colors from the active theme", () => {
    const stateHome = temporaryStateHome();
    writeTheme(
      stateHome,
      ['accent = "#faa968"', 'lighter_background = "#0a2540"', 'muted = "#2a6b78"'].join("\n"),
    );

    expect(loadOmarchyTerminalTheme(stateHome)).toEqual({
      accent: "#faa968",
      surface: "#0a2540",
      muted: "#2a6b78",
    });
  });

  test("returns no theme when Omarchy is absent", () => {
    expect(loadOmarchyTerminalTheme(temporaryStateHome())).toBeUndefined();
  });

  test("returns no theme for malformed or incomplete colors", () => {
    const malformedStateHome = temporaryStateHome();
    writeTheme(malformedStateHome, "not valid TOML =");
    expect(loadOmarchyTerminalTheme(malformedStateHome)).toBeUndefined();

    const incompleteStateHome = temporaryStateHome();
    writeTheme(incompleteStateHome, 'accent = "#faa968"');
    expect(loadOmarchyTerminalTheme(incompleteStateHome)).toBeUndefined();
  });
});
