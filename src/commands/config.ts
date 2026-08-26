import type { CommandDefinition } from "../cli/types.js";
import {
  deleteConfig,
  getConfigPath,
  loadConfig,
  promptForConfig,
  type Config,
} from "../config/index.js";

function maskSecret(_value: string): string {
  return "**********";
}

function maskConfig(config: Config): Config {
  return {
    ...config,
    redmine: {
      ...config.redmine,
      apiKey: maskSecret(config.redmine.apiKey),
    },
    presence: {
      ...config.presence,
      password: maskSecret(config.presence.password),
    },
  };
}

const configSetupCommand: CommandDefinition = {
  name: "setup",
  aliases: ["init"],
  summary: "Configure credentials",
  description: "Create or update the whstats config file.",
  requiresTty: true,
  execute: async () => {
    await promptForConfig(loadConfig());
  },
};

const configShowCommand: CommandDefinition = {
  name: "show",
  summary: "Show masked config",
  description: "Print current config with secrets masked.",
  execute: () => {
    const config = loadConfig();
    console.log(
      JSON.stringify(
        {
          path: getConfigPath(),
          configured: config !== null,
          config: config ? maskConfig(config) : null,
        },
        null,
        2,
      ),
    );
  },
};

const configPathCommand: CommandDefinition = {
  name: "path",
  summary: "Print config path",
  description: "Print only the config file path.",
  execute: () => {
    console.log(getConfigPath());
  },
};

const configResetCommand: CommandDefinition = {
  name: "reset",
  summary: "Delete saved config",
  description: "Delete the whstats config file.",
  execute: () => {
    console.log(deleteConfig() ? "Configuration deleted." : "No configuration file found.");
  },
};

export const configCommand: CommandDefinition = {
  name: "config",
  summary: "Manage configuration",
  description: "Set up, inspect, locate, or reset the whstats config file.",
  subcommands: [configSetupCommand, configShowCommand, configPathCommand, configResetCommand],
};
