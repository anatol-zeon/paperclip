import { describe, expect, it } from "vitest";
import { isAdapterAccountBinding } from "./account-binding.js";
import type { AdapterAccountBinding } from "./account-binding.js";

const valid: AdapterAccountBinding = {
  envKey: "CODEX_HOME",
  secretPrefix: "CODEX_HOME_",
  readIdentity: async () => null,
};

describe("isAdapterAccountBinding", () => {
  it("accepts a complete binding", () => {
    expect(isAdapterAccountBinding(valid)).toBe(true);
  });

  it("rejects a blank env key", () => {
    expect(isAdapterAccountBinding({ ...valid, envKey: "   " })).toBe(false);
  });

  it("rejects a prefix that cannot separate the handle", () => {
    expect(isAdapterAccountBinding({ ...valid, secretPrefix: "CODEX_HOME" })).toBe(false);
  });

  it("rejects a non-function readIdentity", () => {
    expect(isAdapterAccountBinding({ ...valid, readIdentity: "nope" })).toBe(false);
  });

  it("rejects a non-object", () => {
    expect(isAdapterAccountBinding(null)).toBe(false);
  });

  it("rejects undefined", () => {
    expect(isAdapterAccountBinding(undefined)).toBe(false);
  });

  it("rejects an object with every field missing", () => {
    expect(isAdapterAccountBinding({})).toBe(false);
  });

  it("rejects an array carrying the valid fields", () => {
    const arrayLike = Object.assign([], valid);
    expect(isAdapterAccountBinding(arrayLike)).toBe(false);
  });
});
