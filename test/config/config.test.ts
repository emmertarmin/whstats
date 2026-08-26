import { describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { Config } from "../../src/config/types.js";
import { validateConfig } from "../../src/config/validate.js";
import { createCliEnvironment, runCli } from "../helpers/cli.js";
import { loadFixture } from "../helpers/fixtures.js";

const configModuleUrl = pathToFileURL(resolve(import.meta.dir, "../../src/config/index.ts")).href;

interface ConfigScriptResult {
  exitCode: number;
  stderr: Uint8Array;
  stdout: Uint8Array;
}

function makeValidConfig(): Config {
  return {
    schemaVersion: 1,
    redmine: {
      url: "https://redmine.example.test///",
      apiKey: "api-key-secret-sentinel",
    },
    presence: {
      server: "sql.example.test",
      database: "work_hours_test",
      user: "test_user",
      password: "database-password-secret-sentinel",
      userId: 70001,
      timeZone: "Europe/Berlin",
    },
    report: {
      targetHoursPerDay: 7.5,
      excusedIssueIds: [90001, 90002],
    },
  };
}

function isolatedHome(): { home: string; configPath: string; cleanup: () => void } {
  const home = mkdtempSync(join(tmpdir(), "whstats-v3-config-test-"));
  return {
    home,
    configPath: join(home, ".config", "whstats", "config.json"),
    cleanup: () => rmSync(home, { recursive: true, force: true }),
  };
}

function runConfigScript(home: string, body: string): ConfigScriptResult {
  return Bun.spawnSync([process.execPath, "--eval", body], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      HOME: home,
      XDG_CONFIG_HOME: join(home, ".config"),
    },
    stderr: "pipe",
    stdout: "pipe",
  });
}

function writeConfig(configPath: string, content: string): void {
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, content);
}

function cloneConfig(): Record<string, unknown> {
  return structuredClone(makeValidConfig()) as unknown as Record<string, unknown>;
}

describe("v3 config validation", () => {
  test("accepts all nested values and normalizes Redmine trailing slashes", async () => {
    const fixture = await loadFixture<Config>("config/v3-valid.json");
    const config = validateConfig(fixture);

    expect(config).toEqual({
      ...fixture,
      redmine: { ...fixture.redmine, url: "https://redmine.example.test" },
    });
    expect(config.presence.userId).toBe(70001);
    expect(config.report.excusedIssueIds).toEqual([90001, 90002]);
  });

  const invalidCases: Array<[string, (config: Record<string, unknown>) => unknown, string]> = [
    ["root", () => null, "root must be an object"],
    ["schemaVersion", (config) => ({ ...config, schemaVersion: 2 }), "schemaVersion must be 1"],
    ["redmine", (config) => ({ ...config, redmine: null }), "redmine must be an object"],
    ["presence", (config) => ({ ...config, presence: [] }), "presence must be an object"],
    ["report", (config) => ({ ...config, report: undefined }), "report must be an object"],
    [
      "redmine.url",
      (config) => ({ ...config, redmine: { ...(config.redmine as object), url: " " } }),
      "redmine.url must be a non-empty string",
    ],
    [
      "redmine.apiKey",
      (config) => ({ ...config, redmine: { ...(config.redmine as object), apiKey: 1 } }),
      "redmine.apiKey must be a non-empty string",
    ],
    [
      "presence.server",
      (config) => ({ ...config, presence: { ...(config.presence as object), server: false } }),
      "presence.server must be a non-empty string",
    ],
    [
      "presence.database",
      (config) => ({ ...config, presence: { ...(config.presence as object), database: "" } }),
      "presence.database must be a non-empty string",
    ],
    [
      "presence.user",
      (config) => ({ ...config, presence: { ...(config.presence as object), user: null } }),
      "presence.user must be a non-empty string",
    ],
    [
      "presence.password",
      (config) => ({ ...config, presence: { ...(config.presence as object), password: [] } }),
      "presence.password must be a non-empty string",
    ],
    [
      "presence.userId zero",
      (config) => ({ ...config, presence: { ...(config.presence as object), userId: 0 } }),
      "presence.userId must be a positive integer",
    ],
    [
      "presence.userId fraction",
      (config) => ({ ...config, presence: { ...(config.presence as object), userId: 1.5 } }),
      "presence.userId must be a positive integer",
    ],
    [
      "presence.timeZone type",
      (config) => ({ ...config, presence: { ...(config.presence as object), timeZone: 1 } }),
      "presence.timeZone must be a non-empty string",
    ],
    [
      "presence.timeZone value",
      (config) => ({
        ...config,
        presence: { ...(config.presence as object), timeZone: "Berlin/Invalid" },
      }),
      "presence.timeZone must be a valid IANA time zone",
    ],
    [
      "report.targetHoursPerDay type",
      (config) => ({
        ...config,
        report: { ...(config.report as object), targetHoursPerDay: "8" },
      }),
      "report.targetHoursPerDay must be a positive number",
    ],
    [
      "report.targetHoursPerDay zero",
      (config) => ({
        ...config,
        report: { ...(config.report as object), targetHoursPerDay: 0 },
      }),
      "report.targetHoursPerDay must be a positive number",
    ],
    [
      "report.excusedIssueIds type",
      (config) => ({ ...config, report: { ...(config.report as object), excusedIssueIds: {} } }),
      "report.excusedIssueIds must be an array",
    ],
    [
      "report.excusedIssueIds values",
      (config) => ({
        ...config,
        report: { ...(config.report as object), excusedIssueIds: [1, -2] },
      }),
      "report.excusedIssueIds must contain only positive integers",
    ],
    [
      "report.excusedIssueIds fractions",
      (config) => ({
        ...config,
        report: { ...(config.report as object), excusedIssueIds: [1.5] },
      }),
      "report.excusedIssueIds must contain only positive integers",
    ],
    [
      "report.excusedIssueIds duplicates",
      (config) => ({
        ...config,
        report: { ...(config.report as object), excusedIssueIds: [1, 1] },
      }),
      "report.excusedIssueIds must contain unique IDs",
    ],
  ];

  for (const [name, mutate, message] of invalidCases) {
    test(`rejects invalid ${name}`, () => {
      expect(() => validateConfig(mutate(cloneConfig()))).toThrow(message);
    });
  }

  test("rejects non-finite targets", () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY]) {
      const config = makeValidConfig();
      config.report.targetHoursPerDay = value;
      expect(() => validateConfig(config)).toThrow(
        "report.targetHoursPerDay must be a positive number",
      );
    }
  });

  test("requires an HTTP or HTTPS Redmine URL", () => {
    for (const [url, message] of [
      ["not a url", "redmine.url must be a valid URL"],
      ["ftp://redmine.example.test", "redmine.url must use http or https"],
    ]) {
      const config = makeValidConfig();
      config.redmine.url = url!;
      expect(() => validateConfig(config)).toThrow(message!);
    }
  });
});

describe("v3 config loading and saving", () => {
  test("returns null when the file is missing", () => {
    const env = isolatedHome();
    try {
      const result = runConfigScript(
        env.home,
        `const { loadConfig } = await import(${JSON.stringify(configModuleUrl)}); console.log(JSON.stringify(loadConfig()));`,
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout.toString()).toBe("null\n");
      expect(result.stderr.toString()).toBe("");
    } finally {
      env.cleanup();
    }
  });

  test("rejects flat legacy config clearly", async () => {
    const env = isolatedHome();
    try {
      const legacy = await loadFixture<unknown>("config/legacy-valid.json");
      writeConfig(env.configPath, JSON.stringify(legacy));
      const result = runConfigScript(
        env.home,
        `const { loadConfig } = await import(${JSON.stringify(configModuleUrl)}); loadConfig();`,
      );
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr.toString()).toContain("Invalid config file");
      expect(result.stderr.toString()).toContain("schemaVersion must be 1");
    } finally {
      env.cleanup();
    }
  });

  test("reports malformed JSON without parser excerpts or secrets", () => {
    const env = isolatedHome();
    try {
      const apiKey = "malformed-api-key-secret-sentinel";
      const password = "malformed-password-secret-sentinel";
      const malformed = `{"redmine":{"apiKey":"${apiKey}"},"presence":{"password":"${password}"},}`;
      writeConfig(env.configPath, malformed);
      const result = runConfigScript(
        env.home,
        `const { loadConfig } = await import(${JSON.stringify(configModuleUrl)}); loadConfig();`,
      );
      const stderr = result.stderr.toString();

      expect(result.exitCode).not.toBe(0);
      expect(stderr).toContain(`Invalid config file ${env.configPath}: file is not valid JSON.`);
      expect(stderr).not.toContain(apiKey);
      expect(stderr).not.toContain(password);
      expect(stderr).not.toContain(malformed);
      expect(stderr).not.toMatch(
        /JSON Parse error|Expected.*JSON|at position|line \d+ column \d+/i,
      );
    } finally {
      env.cleanup();
    }
  });

  test("normal atomic save works and leaves no temporary file", () => {
    const env = isolatedHome();
    try {
      const config = makeValidConfig();
      const result = runConfigScript(
        env.home,
        `
          const { loadConfig, saveConfig } = await import(${JSON.stringify(configModuleUrl)});
          saveConfig(${JSON.stringify(config)});
          console.log(JSON.stringify(loadConfig()));
        `,
      );
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout.toString())).toEqual({
        ...config,
        redmine: { ...config.redmine, url: "https://redmine.example.test" },
      });
      expect(statSync(dirname(env.configPath)).mode & 0o777).toBe(0o700);
      expect(statSync(env.configPath).mode & 0o777).toBe(0o600);
      expect(readdirSync(dirname(env.configPath)).filter((name) => name.endsWith(".tmp"))).toEqual(
        [],
      );
      expect(readFileSync(env.configPath, "utf8")).toEndWith("\n");
    } finally {
      env.cleanup();
    }
  });

  test("does not overwrite a pre-existing temporary path", () => {
    const env = isolatedHome();
    try {
      const sentinelPath = join(dirname(env.configPath), "collision-sentinel");
      const sentinel = "pre-existing-temp-content-sentinel";
      const fixedTime = 1_700_000_000_123;
      const result = runConfigScript(
        env.home,
        `
          const { linkSync, mkdirSync, writeFileSync } = await import("node:fs");
          const { basename, dirname, join } = await import("node:path");
          const configPath = ${JSON.stringify(env.configPath)};
          const sentinelPath = ${JSON.stringify(sentinelPath)};
          const fixedTime = ${fixedTime};
          mkdirSync(dirname(configPath), { recursive: true });
          writeFileSync(sentinelPath, ${JSON.stringify(sentinel)});
          const tempPath = join(
            dirname(configPath),
            \`.\${basename(configPath)}.\${process.pid}.\${fixedTime}.tmp\`,
          );
          linkSync(sentinelPath, tempPath);
          Date.now = () => fixedTime;
          const { saveConfig } = await import(${JSON.stringify(configModuleUrl)});
          saveConfig(${JSON.stringify(makeValidConfig())});
        `,
      );

      expect(result.exitCode).not.toBe(0);
      expect(result.stderr.toString()).toContain("EEXIST");
      expect(readFileSync(sentinelPath, "utf8")).toBe(sentinel);
      expect(existsSync(env.configPath)).toBe(false);
      expect(readdirSync(dirname(env.configPath)).filter((name) => name.endsWith(".tmp"))).toEqual(
        [],
      );
    } finally {
      env.cleanup();
    }
  });

  test("repairs existing directory and file permissions on save", () => {
    const env = isolatedHome();
    try {
      mkdirSync(dirname(env.configPath), { recursive: true, mode: 0o777 });
      writeFileSync(env.configPath, "old", { mode: 0o666 });
      chmodSync(dirname(env.configPath), 0o777);
      chmodSync(env.configPath, 0o666);
      const result = runConfigScript(
        env.home,
        `const { saveConfig } = await import(${JSON.stringify(configModuleUrl)}); saveConfig(${JSON.stringify(makeValidConfig())});`,
      );
      expect(result.exitCode).toBe(0);
      expect(statSync(dirname(env.configPath)).mode & 0o777).toBe(0o700);
      expect(statSync(env.configPath).mode & 0o777).toBe(0o600);
    } finally {
      env.cleanup();
    }
  });

  test("removes the temporary file when the atomic rename fails", () => {
    const env = isolatedHome();
    try {
      mkdirSync(env.configPath, { recursive: true });
      const result = runConfigScript(
        env.home,
        `const { saveConfig } = await import(${JSON.stringify(configModuleUrl)}); saveConfig(${JSON.stringify(makeValidConfig())});`,
      );
      expect(result.exitCode).not.toBe(0);
      expect(readdirSync(dirname(env.configPath)).filter((name) => name.endsWith(".tmp"))).toEqual(
        [],
      );
    } finally {
      env.cleanup();
    }
  });
});

describe("config commands", () => {
  test("config show masks only secrets and keeps the numeric user ID visible", async () => {
    const env = createCliEnvironment();
    try {
      const configPath = join(env.home, ".config", "whstats", "config.json");
      writeConfig(configPath, JSON.stringify(makeValidConfig()));
      const result = await runCli(["config", "show"], env);

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).not.toContain("api-key-secret-sentinel");
      expect(result.stdout).not.toContain("database-password-secret-sentinel");
      const shown = JSON.parse(result.stdout) as { configured: boolean; config: Config };
      expect(shown.config).toEqual({
        ...makeValidConfig(),
        redmine: {
          ...makeValidConfig().redmine,
          url: "https://redmine.example.test",
          apiKey: "**********",
        },
        presence: {
          ...makeValidConfig().presence,
          password: "**********",
        },
      });
    } finally {
      env.cleanup();
    }
  });

  test("config path is exactly one clean line and does not read the file", async () => {
    const env = createCliEnvironment();
    try {
      const configPath = join(env.home, ".config", "whstats", "config.json");
      const sentinel = "invalid JSON secret sentinel";
      writeConfig(configPath, sentinel);
      const result = await runCli(["config", "path"], env);

      expect(result).toEqual({ stdout: `${configPath}\n`, stderr: "", exitCode: 0 });
      expect(result.stdout.trim().split("\n")).toHaveLength(1);
      expect(readFileSync(configPath, "utf8")).toBe(sentinel);
    } finally {
      env.cleanup();
    }
  });
});
