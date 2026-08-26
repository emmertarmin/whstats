import { NotImplementedCliError } from "../cli/errors.js";
import { outputFlag, rangeFlags } from "../cli/shared-flags.js";
import type { CommandDefinition } from "../cli/types.js";
import { rangePresets } from "./report.js";

export const trendCommand: CommandDefinition = {
  name: "trend",
  summary: "Show booking coverage trend",
  description:
    "Show whether booking coverage is improving or deteriorating. This command is a Phase 1 skeleton.",
  requiresConfig: true,
  flags: [
    ...rangeFlags,
    {
      name: "bucket",
      type: "string",
      valueLabel: "day|week|month",
      description: "Trend bucket size",
      choices: ["day", "week", "month"],
      defaultValue: "week",
    },
    outputFlag,
  ],
  positionals: [
    { name: "preset", description: "Range preset", required: false, choices: rangePresets },
  ],
  examples: ["whstats trend", "whstats trend ytd --bucket month"],
  execute: () => {
    throw new NotImplementedCliError("trend");
  },
};
