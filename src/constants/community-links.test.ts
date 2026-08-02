import { describe, expect, test } from "bun:test";
import { campusCommunity, campusSite } from "../campus.config.ts";
import {
  DISCORD_URL,
  MESSENGER_CONTRIBUTE_TARGET,
  MESSENGER_CONTRIBUTE_URL,
  MESSENGER_MAINTAIN_TARGET,
  MESSENGER_MAINTAIN_URL,
  MESSENGER_SHORT_CONTRIBUTE_URL,
  MESSENGER_URL,
} from "./community-links.ts";

// Everything here must derive from campus.config.ts so a fork only edits
// that one file and these tests keep passing.
describe("community-links", () => {
  test("volunteer Messenger defaults to contribute short link", () => {
    expect(MESSENGER_URL).toBe(MESSENGER_CONTRIBUTE_URL);
    expect(MESSENGER_CONTRIBUTE_URL).toBe(
      `${campusSite.url}/messenger/contribute`,
    );
    expect(MESSENGER_MAINTAIN_URL).toBe(`${campusSite.url}/messenger/maintain`);
    expect(MESSENGER_SHORT_CONTRIBUTE_URL).toBe(
      campusCommunity.messengerShortContributeUrl,
    );
  });

  test("Messenger targets come from campus config", () => {
    expect(MESSENGER_CONTRIBUTE_TARGET).toBe(
      campusCommunity.messengerContributeTarget,
    );
    expect(MESSENGER_MAINTAIN_TARGET).toBe(
      campusCommunity.messengerMaintainTarget,
    );
  });

  test("Discord link comes from campus config", () => {
    expect(DISCORD_URL).toBe(campusCommunity.discordUrl);
  });
});
