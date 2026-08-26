import type { FlagDefinition } from "./types.js";

export const outputFlag: FlagDefinition = {
  name: "output",
  aliases: ["o"],
  type: "string",
  valueLabel: "terminal|markdown|json",
  description: "Select output format",
  choices: ["terminal", "markdown", "json"],
};

export const rangeFlags: FlagDefinition[] = [
  {
    name: "from",
    type: "date",
    valueLabel: "date",
    description: "Start date, as YYYY-MM-DD",
    conflictsWith: ["preset"],
  },
  {
    name: "to",
    type: "date",
    valueLabel: "date",
    description: "End date, as YYYY-MM-DD",
    conflictsWith: ["preset"],
  },
];

export const verboseFlag: FlagDefinition = {
  name: "verbose",
  type: "boolean",
  description: "Show detailed report rows",
};
