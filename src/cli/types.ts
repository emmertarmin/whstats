export type FlagType = "boolean" | "string" | "integer" | "date";

export type FlagValue = boolean | string | number | undefined;

export type ParsedValues = Record<string, FlagValue>;

export interface FlagDefinition {
  name: string;
  aliases?: string[];
  type: FlagType;
  description: string;
  required?: boolean;
  defaultValue?: FlagValue;
  choices?: string[];
  conflictsWith?: string[];
  hidden?: boolean;
  valueLabel?: string;
}

export interface ArgumentDefinition {
  name: string;
  description: string;
  required?: boolean;
  variadic?: boolean;
  choices?: string[];
}

export interface CommandContext {
  values: ParsedValues;
  positionals: string[];
  path: CommandDefinition[];
}

export interface CommandDefinition {
  name: string;
  aliases?: string[];
  summary: string;
  description?: string;
  flags?: FlagDefinition[];
  positionals?: ArgumentDefinition[];
  examples?: string[];
  subcommands?: CommandDefinition[];
  hidden?: boolean;
  requiresConfig?: boolean;
  requiresTty?: boolean;
  execute?: (context: CommandContext) => Promise<number | void> | number | void;
}

export interface ParsedCli {
  command: CommandDefinition;
  path: CommandDefinition[];
  values: ParsedValues;
  positionals: string[];
}
