import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readCodexAccountIdentity } from "./account-identity.js";

// A minimal unsigned JWT: the parser reads only the base64url payload segment.
function jwt(payload: Record<string, unknown>): string {
  const body = Buffer.from(JSON.stringify(payload), "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `header.${body}.signature`;
}

describe("readCodexAccountIdentity", () => {
  let home: string;

  beforeEach(async () => {
    home = await mkdtemp(path.join(os.tmpdir(), "codex-identity-"));
  });

  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
  });

  it("returns null when the home holds no auth file", async () => {
    expect(await readCodexAccountIdentity(home)).toBeNull();
  });

  it("returns null when the auth file is unparsable", async () => {
    await writeFile(path.join(home, "auth.json"), "{ not json", "utf8");
    expect(await readCodexAccountIdentity(home)).toBeNull();
  });

  it("returns the account id with no label when the token carries no email", async () => {
    await writeFile(
      path.join(home, "auth.json"),
      JSON.stringify({
        tokens: {
          account_id: "acct-123",
          access_token: "access",
          id_token: jwt({ sub: "user" }),
          refresh_token: "refresh",
        },
      }),
      "utf8",
    );
    expect(await readCodexAccountIdentity(home)).toEqual({ handle: "acct-123", label: null });
  });

  it("returns the ChatGPT account email as the label", async () => {
    await writeFile(
      path.join(home, "auth.json"),
      JSON.stringify({
        tokens: {
          account_id: "acct-456",
          access_token: "access",
          id_token: jwt({
            "https://api.openai.com/auth": { chatgpt_user_email: "xxx@gmail.com" },
          }),
          refresh_token: "refresh",
        },
      }),
      "utf8",
    );
    expect(await readCodexAccountIdentity(home)).toEqual({
      handle: "acct-456",
      label: "xxx@gmail.com",
    });
  });

  it("returns null when the auth file carries no account id", async () => {
    await writeFile(
      path.join(home, "auth.json"),
      JSON.stringify({ tokens: { access_token: "access" } }),
      "utf8",
    );
    expect(await readCodexAccountIdentity(home)).toBeNull();
  });

  it("returns no label when the token's email is blank", async () => {
    await writeFile(
      path.join(home, "auth.json"),
      JSON.stringify({
        tokens: {
          account_id: "acct-789",
          access_token: "access",
          id_token: jwt({ email: "   " }),
          refresh_token: "refresh",
        },
      }),
      "utf8",
    );
    expect(await readCodexAccountIdentity(home)).toEqual({ handle: "acct-789", label: null });
  });
});
