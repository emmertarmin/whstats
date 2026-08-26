import { NotImplementedCliError } from "../cli/errors.js";
import { outputFlag, rangeFlags } from "../cli/shared-flags.js";
import type { CommandDefinition } from "../cli/types.js";
import { rangePresets } from "./report.js";

export const gapsCommand: CommandDefinition = {
  name: "gaps",
  summary: "Rank dates with the largest gaps",
  description: "Rank booking gaps and attendance shortfalls. This command is a Phase 1 skeleton.",
  requiresConfig: true,
  flags: [
    ...rangeFlags,
    {
      name: "limit",
      type: "integer",
      valueLabel: "count",
      description: "Maximum rows per section",
      defaultValue: 10,
    },
    outputFlag,
  ],
  positionals: [
    { name: "preset", description: "Range preset", required: false, choices: rangePresets },
  ],
  examples: ["whstats gaps", "whstats gaps rolling-year --limit 15"],
  execute: () => {
    throw new NotImplementedCliError("gaps");
  },
};
