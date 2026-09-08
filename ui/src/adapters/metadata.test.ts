import { describe, expect, it } from "vitest";
import {
  isEnabledAdapterType,
  isValidAdapterType,
  isVisualAdapterChoice,
  listAdapterOptions,
} from "./metadata";
import type { UIAdapterModule } from "./types";
// Deliberately the real server registry across the package boundary, not a
// mock: mocking it would compare the UI's keys against a fixture and reduce
// this to the two-empty-objects case the `length > 0` guard below exists to
// catch, which is precisely the drift it is meant to detect.
import { listServerAdapters } from "../../../server/src/adapters/registry.js";

const externalAdapter: UIAdapterModule = {
  type: "external_test",
  label: "External Test",
  parseStdoutLine: () => [],
  ConfigFields: () => null,
  buildAdapterConfig: () => ({}),
};

describe("adapter metadata", () => {
  it("treats registered external adapters as enabled by default", () => {
    expect(isEnabledAdapterType("external_test")).toBe(true);

    expect(
      listAdapterOptions((type) => type, [externalAdapter]),
    ).toEqual([
      {
        value: "external_test",
        label: "external_test",
        comingSoon: false,
        hidden: false,
        experimental: false,
      },
    ]);
  });

  it("keeps intentionally withheld built-in adapters marked as coming soon", () => {
    expect(isEnabledAdapterType("process")).toBe(false);
    expect(isEnabledAdapterType("http")).toBe(false);
  });

  it("marks the retired ACPX adapter as unavailable for new selections", () => {
    expect(isEnabledAdapterType("acpx_local")).toBe(false);
    expect(isValidAdapterType("acpx_local")).toBe(false);
    expect(isVisualAdapterChoice("acpx_local")).toBe(false);

    expect(
      listAdapterOptions((type) => type, [
        {
          ...externalAdapter,
          type: "acpx_local",
        },
      ]),
    ).toEqual([
      {
        value: "acpx_local",
        label: "acpx_local",
        comingSoon: true,
        hidden: false,
        experimental: false,
      },
    ]);
  });
});

/**
 * `accountEnvKey` in the display registry duplicates a fact the server declares
 * on `accountBinding`. The duplication is deliberate — it gives the account
 * picker the full set of account variables to clear with no query and so no
 * loading state — but a duplicate rots the moment one side moves. Nothing else
 * would notice: the picker would simply stop clearing the newer adapter's
 * variable, and an agent would keep running as the previous vendor's account.
 */
describe("adapter account env keys", () => {
  function uiAccountEnvKeys(): Record<string, string> {
    return Object.fromEntries(
      listAdapterOptions()
        .filter((option) => option.accountEnvKey)
        .map((option) => [option.value, option.accountEnvKey!]),
    );
  }

  function serverAccountEnvKeys(): Record<string, string> {
    return Object.fromEntries(
      listServerAdapters()
        .filter((adapter) => adapter.accountBinding)
        .map((adapter) => [adapter.type, adapter.accountBinding!.envKey]),
    );
  }

  it("agree exactly with the server's declared account bindings", () => {
    const server = serverAccountEnvKeys();
    // Guards the comparison against passing on two empty objects, which is what
    // a broken import on either side would produce.
    expect(Object.keys(server).length).toBeGreaterThan(0);
    expect(uiAccountEnvKeys()).toEqual(server);
  });
});
