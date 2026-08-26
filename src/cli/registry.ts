import { configCommand } from "../commands/config.js";
import { entriesCommand } from "../commands/entries.js";
import { gapsCommand } from "../commands/gaps.js";
import { helpCommand } from "../commands/help.js";
import { reportCommand } from "../commands/report.js";
import { trendCommand } from "../commands/trend.js";
import { versionCommand } from "../commands/version.js";
import type { CommandDefinition, FlagDefinition } from "./types.js";

export const globalFlags: FlagDefinition[] = [
  { name: "help", aliases: ["h"], type: "boolean", description: "Show help" },
  { name: "version", aliases: ["v"], type: "boolean", description: "Show version" },
];

export const rootCommand: CommandDefinition = {
  name: "whstats",
  summary: "Work-hours statistics",
  description: "Compare Redmine booked hours with timelogger presence hours.",
  subcommands: [
    reportCommand,
    trendCommand,
    gapsCommand,
    entriesCommand,
    configCommand,
    helpCommand,
    versionCommand,
  ],
};

export const defaultCommandPath = ["report"];
export const defaultCommandPositionals = ["recent"];

export function getVisibleSubcommands(command: CommandDefinition): CommandDefinition[] {
  return (command.subcommands ?? []).filter((entry) => entry.hidden !== true);
}

export function findSubcommand(
  command: CommandDefinition,
  name: string,
): CommandDefinition | undefined {
  return (command.subcommands ?? []).find(
    (entry) => entry.name === name || (entry.aliases ?? []).includes(name),
  );
}

export function resolveCommandPath(args: string[]): {
  command: CommandDefinition;
  path: CommandDefinition[];
  consumed: number;
  unknownCommand?: string;
} {
  const path: CommandDefinition[] = [];
  let current = rootCommand;
  let index = 0;

  while (index < args.length) {
    const token = args[index];
    if (!token || token.startsWith("-")) break;

    const next = findSubcommand(current, token);
    if (!next) {
      if (path.length === 0 || (current.subcommands ?? []).length > 0) {
        return { command: current, path, consumed: index, unknownCommand: token };
      }
      break;
    }

    path.push(next);
    current = next;
    index += 1;
  }

  return { command: current, path, consumed: index };
}

export function resolveCommandPathFromNames(names: string[]): {
  command: CommandDefinition | undefined;
  path: CommandDefinition[];
} {
  const path: CommandDefinition[] = [];
  let current = rootCommand;

  for (const name of names) {
    const next = findSubcommand(current, name);
    if (!next) return { command: undefined, path };
    path.push(next);
    current = next;
  }

  return { command: path.at(-1) ?? rootCommand, path };
}

export function collectCommandFlags(command: CommandDefinition): FlagDefinition[] {
  return [...globalFlags, ...(command.flags ?? [])];
}
