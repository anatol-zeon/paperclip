import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readClaudeAccountIdentity } from "./account-identity.js";

describe("readClaudeAccountIdentity", () => {
  let home: string;

  beforeEach(async () => {
    home = await mkdtemp(path.join(os.tmpdir(), "claude-identity-"));
  });

  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
  });

  it("returns null when the home holds no config file", async () => {
    expect(await readClaudeAccountIdentity(home)).toBeNull();
  });

  it("returns null when the config file is unparsable", async () => {
    await writeFile(path.join(home, ".claude.json"), "{ not json", "utf8");
    expect(await readClaudeAccountIdentity(home)).toBeNull();
  });

  it("returns null when the config carries no oauth account", async () => {
    await writeFile(path.join(home, ".claude.json"), JSON.stringify({ userID: "u1" }), "utf8");
    expect(await readClaudeAccountIdentity(home)).toBeNull();
  });

  it("returns the account uuid and the email address", async () => {
    await writeFile(
      path.join(home, ".claude.json"),
      JSON.stringify({
        oauthAccount: {
          accountUuid: "be84a247-2895-4416-bf5b-a410501b5d06",
          emailAddress: "zzz@gmail.com",
          organizationUuid: "96338dc3-ffb7-407e-850a-5ba6812d4fa6",
        },
      }),
      "utf8",
    );
    expect(await readClaudeAccountIdentity(home)).toEqual({
      handle: "be84a247-2895-4416-bf5b-a410501b5d06",
      label: "zzz@gmail.com",
    });
  });

  it("returns the account uuid with no label when the email is absent", async () => {
    await writeFile(
      path.join(home, ".claude.json"),
      JSON.stringify({ oauthAccount: { accountUuid: "uuid-only" } }),
      "utf8",
    );
    expect(await readClaudeAccountIdentity(home)).toEqual({ handle: "uuid-only", label: null });
  });
});
