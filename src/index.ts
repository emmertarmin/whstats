#!/usr/bin/env bun

import { CliError } from "./cli/errors.js";
import { printCommandHelp, printRootHelp } from "./cli/help.js";
import { parseCli } from "./cli/parse.js";
import { rootCommand } from "./cli/registry.js";
import { printVersion } from "./commands/version.js";

export async function runCli(args: string[]): Promise<number> {
  const parsed = parseCli(args);

  if (parsed.values.version === true) {
    printVersion();
    return 0;
  }

  if (parsed.values.help === true) {
    if (parsed.path.length === 0) printRootHelp();
    else printCommandHelp(parsed.command, parsed.path);
    return 0;
  }

  if (parsed.command === rootCommand) {
    printRootHelp();
    return 0;
  }

  if (typeof parsed.command.execute !== "function") {
    printCommandHelp(parsed.command, parsed.path);
    return 0;
  }

  const result = await parsed.command.execute({
    values: parsed.values,
    positionals: parsed.positionals,
    path: parsed.path,
  });
  return result ?? 0;
}

runCli(process.argv.slice(2))
  .then((status) => {
    process.exit(status);
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Error: ${message}`);
    process.exit(error instanceof CliError ? error.exitCode : 1);
  });
