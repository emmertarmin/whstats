import { collectCommandFlags, getVisibleSubcommands, rootCommand } from "./registry.js";
import type { ArgumentDefinition, CommandDefinition, FlagDefinition } from "./types.js";

function formatArgument(argument: ArgumentDefinition): string {
  const base = argument.variadic ? `${argument.name}...` : argument.name;
  return argument.required ? `<${base}>` : `[${base}]`;
}

function formatFlag(flag: FlagDefinition): string {
  const aliases = (flag.aliases ?? []).map((alias) =>
    alias.length === 1 ? `-${alias}` : `--${alias}`,
  );
  const value = flag.type === "boolean" ? "" : ` <${flag.valueLabel ?? flag.type}>`;
  return [`--${flag.name}`, ...aliases].join(", ") + value;
}

function formatDetails(flag: FlagDefinition): string {
  const details: string[] = [];
  if (flag.required) details.push("required");
  if (flag.defaultValue !== undefined) details.push(`default: ${String(flag.defaultValue)}`);
  if (flag.choices?.length) details.push(`choices: ${flag.choices.join(", ")}`);
  if (flag.conflictsWith?.length)
    details.push(
      `conflicts: ${flag.conflictsWith.map((entry) => (entry === "preset" ? "preset" : `--${entry}`)).join(", ")}`,
    );
  return details.length > 0 ? ` (${details.join("; ")})` : "";
}

function printUsage(command: CommandDefinition, path: CommandDefinition[]): void {
  const commandPath = path.length > 0 ? ` ${path.map((entry) => entry.name).join(" ")}` : "";
  const subcommands = getVisibleSubcommands(command);
  const args = (command.positionals ?? []).map(formatArgument).join(" ");
  const options = collectCommandFlags(command).length > 0 ? " [options]" : "";
  console.log("Usage:");
  if (subcommands.length > 0) console.log(`  whstats${commandPath} <subcommand>`);
  if (typeof command.execute === "function" || command.positionals || command.flags) {
    console.log(`  whstats${commandPath}${options}${args ? ` ${args}` : ""}`);
  }
}

export function printCommandHelp(command: CommandDefinition, path: CommandDefinition[]): void {
  const title =
    path.length === 0 ? rootCommand.name : `whstats ${path.map((entry) => entry.name).join(" ")}`;
  console.log(title);
  console.log();
  console.log(command.description ?? command.summary);
  console.log();
  printUsage(command, path);

  const positionals = command.positionals ?? [];
  if (positionals.length > 0) {
    console.log();
    console.log("Arguments:");
    for (const positional of positionals) {
      const choices = positional.choices?.length
        ? ` Choices: ${positional.choices.join(", ")}.`
        : "";
      console.log(`  ${formatArgument(positional)}`);
      console.log(`      ${positional.description}.${choices}`);
    }
  }

  const flags = collectCommandFlags(command).filter((flag) => flag.hidden !== true);
  if (flags.length > 0) {
    console.log();
    console.log("Options:");
    for (const flag of flags) {
      console.log(`  ${formatFlag(flag)}`);
      console.log(`      ${flag.description}${formatDetails(flag)}`);
    }
  }

  const subcommands = getVisibleSubcommands(command);
  if (subcommands.length > 0) {
    const prefix = path.map((entry) => entry.name).join(" ");
    console.log();
    console.log("Subcommands:");
    for (const subcommand of subcommands) {
      const label = prefix ? `${prefix} ${subcommand.name}` : subcommand.name;
      const aliases = subcommand.aliases?.length
        ? ` (aliases: ${subcommand.aliases.join(", ")})`
        : "";
      console.log(`  ${label}${aliases} - ${subcommand.summary}`);
    }
  }

  if (command.examples?.length) {
    console.log();
    console.log("Examples:");
    for (const example of command.examples) console.log(`  ${example}`);
  }
}

export function printRootHelp(): void {
  printCommandHelp(rootCommand, []);
  console.log();
  console.log("Run `whstats help <command>` for command-specific help.");
  console.log("With no arguments, whstats runs `whstats report recent`.");
}
