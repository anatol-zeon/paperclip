import { expect, it, vi } from "vitest";
import { killVerifiedLocalProcess } from "./local-process-identity.js";

it.each([null, "replacement-process"])("does not signal a missing or recycled process: %s", async (current) => {
  const kill = vi.fn(() => true as const);
  expect(await killVerifiedLocalProcess(123, "original-process", {
    readIdentity: async () => current, kill,
  })).toBe(false);
  expect(kill).not.toHaveBeenCalled();
});

it("does not signal when no OS identity was captured at spawn", async () => {
  const readIdentity = vi.fn(async () => "current-process"), kill = vi.fn(() => true as const);
  expect(await killVerifiedLocalProcess(123, null, { readIdentity, kill })).toBe(false);
  expect(readIdentity).not.toHaveBeenCalled();
  expect(kill).not.toHaveBeenCalled();
});

it("signals only the matching process and handles exit during verification", async () => {
  const kill = vi.fn(() => true as const);
  expect(await killVerifiedLocalProcess(123, "original-process", {
    readIdentity: async () => "original-process", kill,
  })).toBe(true);
  expect(kill).toHaveBeenCalledWith(123, "SIGKILL");
  expect(await killVerifiedLocalProcess(123, "original-process", {
    readIdentity: async () => "original-process", kill: () => { throw new Error("ESRCH"); },
  })).toBe(false);
});
