import { describe, expect, test } from "bun:test";
import type { Config } from "../../src/config/types.js";
import { reportCommand } from "../../src/commands/report.js";
import { createPresenceGateway } from "../../src/presence/client.js";
import { createRedmineGateway } from "../../src/redmine/gateway.js";
import { loadFixture } from "../helpers/fixtures.js";

describe("v3 config callers", () => {
  test("source clients compile with and use the nested fixture type", async () => {
    const config = await loadFixture<Config>("config/v3-valid.json");
    const redmineConfig: Parameters<typeof createRedmineGateway>[0] = config;
    const presenceConfig: Parameters<typeof createPresenceGateway>[0] = config;

    expect(redmineConfig.redmine.apiKey).toBe("api-key-secret-sentinel");
    expect(redmineConfig.redmine.url).toBe("https://redmine.example.test///");
    expect(presenceConfig.presence.userId).toBe(70001);
    expect(config.report.targetHoursPerDay).toBe(7.5);
    expect(config.report.excusedIssueIds).toEqual([90001, 90002]);
    expect(reportCommand.execute).toBeFunction();
  });
});
