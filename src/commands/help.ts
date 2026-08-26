import { CliError } from "../cli/errors.js";
import { printCommandHelp, printRootHelp } from "../cli/help.js";
import { resolveCommandPathFromNames } from "../cli/registry.js";
import type { CommandDefinition } from "../cli/types.js";

export const helpCommand: CommandDefinition = {
  name: "help",
  summary: "Show help",
  description: "Show root help or command-specific help.",
  positionals: [{ name: "command", description: "Command path", required: false, variadic: true }],
  examples: ["whstats help", "whstats help entries list"],
  execute: ({ positionals }) => {
    if (positionals.length === 0) {
      printRootHelp();
      return;
    }
    const resolved = resolveCommandPathFromNames(positionals);
    if (!resolved.command || resolved.path.length !== positionals.length) {
      throw new CliError(`Unknown help topic: ${positionals.join(" ")}`);
    }
    printCommandHelp(resolved.command, resolved.path);
  },
};
