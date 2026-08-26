import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface CliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface CliEnvironment {
  home: string;
  env: Record<string, string | undefined>;
  cleanup: () => void;
}

export function createCliEnvironment(): CliEnvironment {
  const home = mkdtempSync(join(tmpdir(), "whstats-cli-test-"));
  return {
    home,
    env: {
      ...process.env,
      HOME: home,
      XDG_CONFIG_HOME: join(home, ".config"),
      HTTP_PROXY: "http://127.0.0.1:1",
      HTTPS_PROXY: "http://127.0.0.1:1",
      ALL_PROXY: "http://127.0.0.1:1",
      NO_PROXY: "",
    },
    cleanup: () => rmSync(home, { recursive: true, force: true }),
  };
}

export async function runCli(
  args: string[],
  environment: CliEnvironment,
  timeoutMs = 5_000,
): Promise<CliResult> {
  const processHandle = Bun.spawn({
    cmd: [process.execPath, "src/index.ts", ...args],
    cwd: process.cwd(),
    env: environment.env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const timeout = setTimeout(() => processHandle.kill(), timeoutMs);

  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(processHandle.stdout).text(),
      new Response(processHandle.stderr).text(),
      processHandle.exited,
    ]);
    return { stdout, stderr, exitCode };
  } finally {
    clearTimeout(timeout);
  }
}
