import type { CommandDefinition } from "../cli/types.js";
import { VERSION } from "../version.js";

export function printVersion(): void {
  console.log(`whstats v${VERSION}`);
}

export const versionCommand: CommandDefinition = {
  name: "version",
  summary: "Show version",
  description: "Print the whstats version.",
  execute: () => {
    printVersion();
  },
};
