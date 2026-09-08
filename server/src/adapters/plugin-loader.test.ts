import { describe, expect, it } from "vitest";
import type { AdapterAccountBinding, AdapterLoginCapability } from "@paperclipai/adapter-utils";
import { validateAdapterModule } from "./plugin-loader.js";

// A minimal external adapter module. The loader calls `createServerAdapter()`
// and then validates the returned module. Each test controls the returned
// `loginCapability` and `accountBinding` to check the fail-closed rule at load
// time.
function makeModule(loginCapability?: unknown, accountBinding?: unknown) {
  return {
    createServerAdapter: () => ({
      type: "vendor_local",
      execute: async () => ({}),
      testEnvironment: async () => ({}),
      ...(loginCapability === undefined ? {} : { loginCapability }),
      ...(accountBinding === undefined ? {} : { accountBinding }),
    }),
  };
}

const validLoginCapability: AdapterLoginCapability = {
  panelMode: "displayed_code",
  timeoutPolicy: "caller_bounded",
  getCommand: () => "vendor login",
  parsePrompt: () => null,
};

const validAccountBinding: AdapterAccountBinding = {
  envKey: "CODEX_HOME",
  secretPrefix: "CODEX_HOME_",
  readIdentity: async () => null,
};

describe("validateAdapterModule login capability", () => {
  it("loads an adapter with no login capability", () => {
    expect(() => validateAdapterModule(makeModule(), "vendor-pkg")).not.toThrow();
  });

  it("loads an adapter with a well-formed login capability", () => {
    expect(() => validateAdapterModule(makeModule(validLoginCapability), "vendor-pkg")).not.toThrow();
  });

  it("rejects an adapter with a malformed login capability", () => {
    const bad = { ...validLoginCapability, panelMode: "hidden_code" };
    expect(() => validateAdapterModule(makeModule(bad), "vendor-pkg")).toThrow(
      /invalid login capability/,
    );
  });

  it("rejects an adapter with a non-object login capability", () => {
    expect(() => validateAdapterModule(makeModule("displayed_code"), "vendor-pkg")).toThrow(
      /invalid login capability/,
    );
  });
});

describe("validateAdapterModule account binding", () => {
  it("loads an adapter with no account binding", () => {
    expect(() => validateAdapterModule(makeModule(undefined, undefined), "vendor-pkg")).not.toThrow();
  });

  it("loads an adapter with a well-formed account binding", () => {
    expect(() =>
      validateAdapterModule(makeModule(undefined, validAccountBinding), "vendor-pkg"),
    ).not.toThrow();
  });

  it("rejects an adapter with a malformed account binding", () => {
    const bad = { ...validAccountBinding, envKey: "codex-home!" };
    expect(() => validateAdapterModule(makeModule(undefined, bad), "vendor-pkg")).toThrow(
      /invalid account binding/,
    );
  });

  it("rejects an adapter with a non-object account binding", () => {
    expect(() =>
      validateAdapterModule(makeModule(undefined, "CODEX_HOME"), "vendor-pkg"),
    ).toThrow(/invalid account binding/);
  });
});
