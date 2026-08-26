import { CliError } from "./errors.js";
import {
  collectCommandFlags,
  defaultCommandPath,
  defaultCommandPositionals,
  resolveCommandPath,
  resolveCommandPathFromNames,
  rootCommand,
} from "./registry.js";
import type {
  CommandDefinition,
  FlagDefinition,
  FlagValue,
  ParsedCli,
  ParsedValues,
} from "./types.js";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function buildFlagMaps(flags: FlagDefinition[]): {
  byLongName: Map<string, FlagDefinition>;
  byAlias: Map<string, FlagDefinition>;
} {
  const byLongName = new Map<string, FlagDefinition>();
  const byAlias = new Map<string, FlagDefinition>();
  for (const flag of flags) {
    byLongName.set(flag.name, flag);
    for (const alias of flag.aliases ?? []) byAlias.set(alias, flag);
  }
  return { byLongName, byAlias };
}

function parseFlagToken(
  arg: string,
  maps: ReturnType<typeof buildFlagMaps>,
): { flag: FlagDefinition | undefined; inlineValue?: string; displayName: string } {
  if (arg.startsWith("--")) {
    const body = arg.slice(2);
    const eq = body.indexOf("=");
    const name = eq === -1 ? body : body.slice(0, eq);
    return {
      flag: maps.byLongName.get(name),
      inlineValue: eq === -1 ? undefined : body.slice(eq + 1),
      displayName: `--${name}`,
    };
  }
  if (arg.startsWith("-") && arg.length > 1) {
    const alias = arg.slice(1);
    return { flag: maps.byAlias.get(alias), displayName: `-${alias}` };
  }
  return { flag: undefined, displayName: arg };
}

function parseDateValue(value: string, displayName: string): string {
  if (!DATE_RE.test(value)) throw new CliError(`Invalid date for ${displayName}: ${value}`);
  const date = new Date(`${value}T00:00:00`);
  if (
    date.getFullYear() !== Number(value.slice(0, 4)) ||
    date.getMonth() + 1 !== Number(value.slice(5, 7)) ||
    date.getDate() !== Number(value.slice(8, 10))
  ) {
    throw new CliError(`Invalid date for ${displayName}: ${value}`);
  }
  return value;
}

function coerceValue(flag: FlagDefinition, raw: string, displayName: string): FlagValue {
  switch (flag.type) {
    case "string":
      return raw;
    case "date":
      return parseDateValue(raw, displayName);
    case "integer": {
      const value = Number(raw);
      if (!Number.isInteger(value))
        throw new CliError(`Invalid integer for ${displayName}: ${raw}`);
      return value;
    }
    case "boolean":
      return true;
  }
}

function isKnownOptionToken(arg: string, maps: ReturnType<typeof buildFlagMaps>): boolean {
  if (!arg.startsWith("-") || arg === "-") return false;
  return parseFlagToken(arg, maps).flag !== undefined;
}

function parseValues(
  args: string[],
  flags: FlagDefinition[],
): { values: ParsedValues; positionals: string[] } {
  const maps = buildFlagMaps(flags);
  const values: ParsedValues = {};
  const positionals: string[] = [];

  for (const flag of flags) {
    if (flag.defaultValue !== undefined) values[flag.name] = flag.defaultValue;
  }

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === "--") {
      positionals.push(...args.slice(index + 1));
      break;
    }
    if (!arg.startsWith("-")) {
      positionals.push(arg);
      continue;
    }

    const { flag, inlineValue, displayName } = parseFlagToken(arg, maps);
    if (!flag) throw new CliError(`Unknown option: ${displayName}`);

    if (flag.type === "boolean") {
      if (inlineValue !== undefined)
        throw new CliError(`Option ${displayName} does not take a value`);
      values[flag.name] = true;
      continue;
    }

    const value = inlineValue ?? args[index + 1];
    if (value === undefined || (inlineValue === undefined && isKnownOptionToken(value, maps)))
      throw new CliError(`Missing value for option ${displayName}`);
    values[flag.name] = coerceValue(flag, value, displayName);
    if (inlineValue === undefined) index += 1;
  }

  for (const flag of flags) {
    if (flag.required && values[flag.name] === undefined)
      throw new CliError(`Missing required option: --${flag.name}`);
    const value = values[flag.name];
    if (typeof value === "string" && flag.choices && !flag.choices.includes(value)) {
      throw new CliError(
        `Invalid value for --${flag.name}: ${value}. Choices: ${flag.choices.join(", ")}`,
      );
    }
    if (values[flag.name] !== undefined) {
      for (const conflict of flag.conflictsWith ?? []) {
        if (values[conflict] !== undefined || (positionals.length > 0 && conflict === "preset")) {
          throw new CliError(
            `Option --${flag.name} conflicts with ${conflict === "preset" ? "preset" : `--${conflict}`}`,
          );
        }
      }
    }
  }

  return { values, positionals };
}

function validatePositionals(command: CommandDefinition, positionals: string[]): void {
  const definitions = command.positionals ?? [];
  const required = definitions.filter((entry) => entry.required).length;
  const variadic = definitions.some((entry) => entry.variadic);
  if (positionals.length < required)
    throw new CliError(
      `Missing required argument: ${definitions[positionals.length]?.name ?? "argument"}`,
    );
  if (!variadic && positionals.length > definitions.length)
    throw new CliError(`Unexpected argument: ${positionals[definitions.length]}`);
  for (let index = 0; index < positionals.length; index += 1) {
    const definition = definitions[Math.min(index, definitions.length - 1)];
    if (definition?.choices && !definition.choices.includes(positionals[index]!)) {
      throw new CliError(
        `Invalid value for ${definition.name}: ${positionals[index]}. Choices: ${definition.choices.join(", ")}`,
      );
    }
  }
}

function parseEffectiveCli(effectiveArgs: string[]): ParsedCli {
  const resolved = resolveCommandPath(effectiveArgs);
  if (resolved.unknownCommand) {
    const path = resolved.path.map((entry) => entry.name).join(" ");
    throw new CliError(
      path
        ? `Unknown subcommand for ${path}: ${resolved.unknownCommand}`
        : `Unknown command: ${resolved.unknownCommand}`,
    );
  }

  const command = resolved.path.at(-1) ?? rootCommand;
  const flags = collectCommandFlags(command);
  const parsed = parseValues(effectiveArgs.slice(resolved.consumed), flags);
  validatePositionals(command, parsed.positionals);

  return { command, path: resolved.path, values: parsed.values, positionals: parsed.positionals };
}

function isRootHelpOrVersion(arg: string): boolean {
  return arg === "--help" || arg === "-h" || arg === "--version" || arg === "-v";
}

function isReportFlagToken(arg: string): boolean {
  const reportCommand = resolveCommandPathFromNames(defaultCommandPath).command;
  if (!reportCommand) return false;
  return isKnownOptionToken(arg, buildFlagMaps(collectCommandFlags(reportCommand)));
}

function hasExplicitRangeFlag(args: string[]): boolean {
  const reportCommand = resolveCommandPathFromNames(defaultCommandPath).command;
  if (!reportCommand) return false;
  const maps = buildFlagMaps(collectCommandFlags(reportCommand));
  return args.some((arg) => {
    const { flag } = parseFlagToken(arg, maps);
    return flag?.name === "from" || flag?.name === "to";
  });
}

export function parseCli(args: string[]): ParsedCli {
  if (args.length === 0)
    return parseEffectiveCli([...defaultCommandPath, ...defaultCommandPositionals]);

  if (args[0]?.startsWith("-") && !isRootHelpOrVersion(args[0]) && isReportFlagToken(args[0])) {
    const defaultPositionals = hasExplicitRangeFlag(args) ? [] : defaultCommandPositionals;
    return parseEffectiveCli([...defaultCommandPath, ...defaultPositionals, ...args]);
  }

  return parseEffectiveCli(args);
}

export function parseDefaultCli(): ParsedCli {
  const resolved = resolveCommandPathFromNames(defaultCommandPath);
  if (!resolved.command) throw new CliError("Default command is invalid");
  return {
    command: resolved.command,
    path: resolved.path,
    values: {},
    positionals: defaultCommandPositionals,
  };
}
