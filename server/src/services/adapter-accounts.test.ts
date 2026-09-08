import { describe, expect, it, vi } from "vitest";

vi.mock("../middleware/logger.js", () => ({
  logger: {
    child: vi.fn().mockReturnThis(),
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
  },
  httpLogger: vi.fn(),
}));

import { logger } from "../middleware/logger.js";
import { listAdapterAccounts } from "./adapter-accounts.js";

const CODEX_BINDING = {
  envKey: "CODEX_HOME",
  secretPrefix: "CODEX_HOME_",
  readIdentity: async (homeDir: string) =>
    homeDir === "/homes/a"
      ? { handle: "acct-a", label: "xxx@gmail.com" }
      : homeDir === "/homes/b"
        ? { handle: "acct-b", label: "yyy@gmail.com" }
        : homeDir === "/homes/wrong"
          ? { handle: "someone-else", label: "zzz@gmail.com" }
          : null,
};

function deps(input: {
  secrets: { id: string; name: string }[];
  values: Record<string, string>;
}) {
  return {
    listAdapterBindings: () => [{ adapterType: "codex_local", binding: CODEX_BINDING }],
    listSecrets: async () => input.secrets,
    resolveSecretValue: async (_companyId: string, secretId: string) => {
      const value = input.values[secretId];
      if (value === undefined) throw new Error("resolve failed");
      return value;
    },
  };
}

describe("listAdapterAccounts", () => {
  it("returns one active row per account secret", async () => {
    const rows = await listAdapterAccounts(
      "company-1",
      deps({
        secrets: [
          { id: "s-a", name: "CODEX_HOME_acct-a" },
          { id: "s-b", name: "CODEX_HOME_acct-b" },
        ],
        values: { "s-a": "/homes/a", "s-b": "/homes/b" },
      }),
    );
    expect(rows).toEqual([
      {
        adapterType: "codex_local",
        handle: "acct-a",
        label: "xxx@gmail.com",
        secretId: "s-a",
        secretName: "CODEX_HOME_acct-a",
        envKey: "CODEX_HOME",
        status: "active",
      },
      {
        adapterType: "codex_local",
        handle: "acct-b",
        label: "yyy@gmail.com",
        secretId: "s-b",
        secretName: "CODEX_HOME_acct-b",
        envKey: "CODEX_HOME",
        status: "active",
      },
    ]);
  });

  it("ignores a secret whose name does not carry the prefix", async () => {
    const rows = await listAdapterAccounts(
      "company-1",
      deps({
        secrets: [{ id: "s-x", name: "OPENAI_API_KEY" }],
        values: { "s-x": "sk-whatever" },
      }),
    );
    expect(rows).toEqual([]);
  });

  it("lists an account whose home cannot be read as unavailable", async () => {
    const rows = await listAdapterAccounts(
      "company-1",
      deps({
        secrets: [{ id: "s-gone", name: "CODEX_HOME_acct-gone" }],
        values: { "s-gone": "/homes/missing" },
      }),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ handle: "acct-gone", label: null, status: "unavailable" });
  });

  it("lists an account as unavailable when its secret fails to resolve", async () => {
    const rows = await listAdapterAccounts(
      "company-1",
      deps({ secrets: [{ id: "s-bad", name: "CODEX_HOME_acct-bad" }], values: {} }),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ handle: "acct-bad", label: null, status: "unavailable" });
  });

  it("flags a home that holds a different account as a mismatch", async () => {
    const rows = await listAdapterAccounts(
      "company-1",
      deps({
        secrets: [{ id: "s-w", name: "CODEX_HOME_acct-a" }],
        values: { "s-w": "/homes/wrong" },
      }),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ handle: "acct-a", label: null, status: "mismatch" });
  });

  it("skips a secret whose name carries the prefix and nothing else", async () => {
    const rows = await listAdapterAccounts(
      "company-1",
      deps({ secrets: [{ id: "s-e", name: "CODEX_HOME_" }], values: { "s-e": "/homes/a" } }),
    );
    expect(rows).toEqual([]);
  });

  it("never lets one adapter's failure hide another's accounts", async () => {
    const failing = {
      envKey: "BOOM_HOME",
      secretPrefix: "BOOM_HOME_",
      readIdentity: async () => {
        throw new Error("adapter blew up");
      },
    };
    const rows = await listAdapterAccounts("company-1", {
      listAdapterBindings: () => [
        { adapterType: "boom_local", binding: failing },
        { adapterType: "codex_local", binding: CODEX_BINDING },
      ],
      listSecrets: async () => [
        { id: "s-boom", name: "BOOM_HOME_x" },
        { id: "s-a", name: "CODEX_HOME_acct-a" },
      ],
      resolveSecretValue: async (_c: string, id: string) =>
        id === "s-a" ? "/homes/a" : "/homes/boom",
    });
    expect(rows.map((row) => row.handle)).toEqual(["x", "acct-a"]);
    expect(rows[0]).toMatchObject({ status: "unavailable" });
    expect(rows[1]).toMatchObject({ status: "active" });

    // The throwing readIdentity is not silent: it leaves a log line naming
    // the adapter, and that line never carries the resolved home path or the
    // raw error (both of which the "adapter blew up" Error and "/homes/boom"
    // home dir would leak if logged wholesale).
    expect(vi.mocked(logger.warn)).toHaveBeenCalledTimes(1);
    const [warnPayload] = vi.mocked(logger.warn).mock.calls[0]!;
    expect(warnPayload).toMatchObject({ adapterType: "boom_local" });
    const warnPayloadText = JSON.stringify(warnPayload);
    expect(warnPayloadText).not.toContain("/homes/boom");
    expect(warnPayloadText).not.toContain("adapter blew up");
  });
});
