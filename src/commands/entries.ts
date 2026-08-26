import { NotImplementedCliError } from "../cli/errors.js";
import { outputFlag, rangeFlags } from "../cli/shared-flags.js";
import type { CommandDefinition } from "../cli/types.js";
import { rangePresets } from "./report.js";

const entriesListCommand: CommandDefinition = {
  name: "list",
  aliases: ["ls"],
  summary: "List time entries",
  description:
    "List Redmine time entries for a preset or inclusive date range. This is a Phase 1 skeleton.",
  requiresConfig: true,
  flags: [...rangeFlags, outputFlag],
  positionals: [
    { name: "preset", description: "Range preset", required: false, choices: rangePresets },
  ],
  examples: [
    "whstats entries list recent",
    "whstats entries list --from 2026-08-01 --to 2026-08-31",
  ],
  execute: () => {
    throw new NotImplementedCliError("entries list");
  },
};

const entriesAddCommand: CommandDefinition = {
  name: "add",
  summary: "Add a Redmine time entry",
  description:
    "Add a Redmine time entry through an interactive form or flags. This is a Phase 1 skeleton and does not write.",
  requiresConfig: true,
  requiresTty: true,
  flags: [
    { name: "date", type: "date", valueLabel: "date", description: "Entry date as YYYY-MM-DD" },
    { name: "issue", type: "integer", valueLabel: "id", description: "Redmine issue ID" },
    { name: "hours", type: "string", valueLabel: "hours", description: "Booked hours" },
    { name: "comment", type: "string", valueLabel: "text", description: "Entry comment" },
    { name: "dry-run", type: "boolean", description: "Validate and preview without writing" },
  ],
  examples: [
    'whstats entries add --date 2026-08-26 --issue 43135 --hours 2.5 --comment "Implementation"',
  ],
  execute: () => {
    throw new NotImplementedCliError("entries add");
  },
};

const entriesEditCommand: CommandDefinition = {
  name: "edit",
  summary: "Edit a Redmine time entry",
  description: "Edit one Redmine time entry. This is a Phase 1 skeleton and does not write.",
  requiresConfig: true,
  requiresTty: true,
  flags: [
    { name: "date", type: "date", valueLabel: "date", description: "Replacement entry date" },
    { name: "issue", type: "integer", valueLabel: "id", description: "Replacement issue ID" },
    { name: "hours", type: "string", valueLabel: "hours", description: "Replacement booked hours" },
    { name: "comment", type: "string", valueLabel: "text", description: "Replacement comment" },
    { name: "dry-run", type: "boolean", description: "Validate and preview without writing" },
  ],
  positionals: [{ name: "entry-id", description: "Redmine time-entry ID", required: true }],
  examples: ["whstats entries edit 123456"],
  execute: () => {
    throw new NotImplementedCliError("entries edit");
  },
};

export const entriesCommand: CommandDefinition = {
  name: "entries",
  aliases: ["entry"],
  summary: "Browse and manage Redmine time entries",
  description:
    "Open the interactive entry browser, or use a nested entry command. This is a Phase 1 skeleton.",
  requiresConfig: true,
  requiresTty: true,
  subcommands: [entriesListCommand, entriesAddCommand, entriesEditCommand],
  execute: () => {
    throw new NotImplementedCliError("entries browser");
  },
};
