// @vitest-environment jsdom

import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdapterAccountDropdown } from "./AdapterAccountDropdown";
import { listAdapterOptions } from "../adapters/metadata";

/** The two adapters the fixtures hold accounts for. */
const FIXTURE_ACCOUNT_TYPES = new Set(["codex_local", "claude_local"]);

const mockAdapterAccountsApi = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock("../api/adapterAccounts", () => ({ adapterAccountsApi: mockAdapterAccountsApi }));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

async function act(callback: () => void | Promise<void>) {
  await callback();
  await Promise.resolve();
  await new Promise((resolve) => window.setTimeout(resolve, 0));
}

async function flushReact() {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
}

const CODEX_A = {
  adapterType: "codex_local",
  handle: "acct-a",
  label: "xxx@gmail.com",
  secretId: "s-a",
  secretName: "CODEX_HOME_acct-a",
  envKey: "CODEX_HOME",
  status: "active" as const,
};

const CODEX_B = { ...CODEX_A, handle: "acct-b", label: "yyy@gmail.com", secretId: "s-b" };

const CLAUDE_C = {
  adapterType: "claude_local",
  handle: "acct-c",
  label: "zzz@gmail.com",
  secretId: "s-c",
  secretName: "CLAUDE_CONFIG_DIR_acct-c",
  envKey: "CLAUDE_CONFIG_DIR",
  status: "active" as const,
};

const MISMATCHED = { ...CODEX_A, handle: "acct-x", label: null, secretId: "s-x", status: "mismatch" as const };

describe("AdapterAccountDropdown", () => {
  let container: HTMLDivElement;
  // Every root a test mounts, so `afterEach` can tear it down. Wiping the DOM
  // is not enough: an abandoned root keeps its Radix dismissable layer's
  // document-level listeners and its focus guards alive, and those leaked
  // layers stop a LATER test's popover from opening at all.
  let roots: { unmount: () => void }[] = [];

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    mockAdapterAccountsApi.list.mockResolvedValue([CODEX_A, CODEX_B, CLAUDE_C]);
  });

  afterEach(async () => {
    for (const root of roots) {
      await act(async () => root.unmount());
    }
    roots = [];
    container.remove();
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  async function render(props: Partial<Parameters<typeof AdapterAccountDropdown>[0]> = {}) {
    const onSelect = vi.fn();
    const root = createRoot(container);
    roots.push(root);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <AdapterAccountDropdown
            companyId="company-1"
            adapterType="codex_local"
            envBindings={{}}
            disabledTypes={new Set()}
            onSelect={onSelect}
            {...props}
          />
        </QueryClientProvider>,
      );
    });
    await flushReact();
    // Radix mounts the popover content only while the popover is open, so the
    // rows do not exist until the trigger is clicked.
    await act(async () => {
      container.querySelector<HTMLButtonElement>("button")?.click();
    });
    await flushReact();
    return { onSelect, root };
  }

  function accountButtons() {
    return Array.from(document.querySelectorAll<HTMLButtonElement>("[data-account-row]"));
  }

  /** The popover content is portalled out, so the trigger is what stays here. */
  function trigger() {
    return container.querySelector<HTMLButtonElement>("button");
  }

  function defaultRow(type = "codex_local") {
    return document.querySelector<HTMLButtonElement>(`[data-default-row='${type}']`);
  }

  it("lists every account with its email under its vendor", async () => {
    await render();
    const labels = accountButtons().map((button) => button.textContent);
    expect(labels.some((text) => text?.includes("xxx@gmail.com"))).toBe(true);
    expect(labels.some((text) => text?.includes("yyy@gmail.com"))).toBe(true);
    expect(labels.some((text) => text?.includes("zzz@gmail.com"))).toBe(true);
  });

  it("emits the adapter type, the account and the env keys to clear", async () => {
    const { onSelect } = await render();
    const row = accountButtons().find((button) => button.textContent?.includes("zzz@gmail.com"));
    await act(async () => row?.click());

    expect(onSelect).toHaveBeenCalledWith({
      adapterType: "claude_local",
      account: CLAUDE_C,
      clearEnvKeys: ["CODEX_HOME"],
    });
  });

  it("clears every account env key when the company default is chosen", async () => {
    const { onSelect } = await render();
    const row = Array.from(
      document.querySelectorAll<HTMLButtonElement>("[data-default-row='codex_local']"),
    )[0];
    await act(async () => row?.click());

    expect(onSelect).toHaveBeenCalledWith({
      adapterType: "codex_local",
      account: null,
      clearEnvKeys: ["CLAUDE_CONFIG_DIR", "CODEX_HOME"],
    });
  });

  it("does not offer a mismatched account for selection", async () => {
    mockAdapterAccountsApi.list.mockResolvedValue([MISMATCHED]);
    const { onSelect } = await render();
    const row = accountButtons().find((button) => button.textContent?.includes("acct-x"));
    expect(row?.disabled).toBe(true);
    // The row says why on its face, not only in a `title` a touch user never
    // sees.
    expect(row?.textContent).toContain("Wrong account");
    // `disabled` is also what keeps the row off the keyboard path: an
    // `aria-disabled` row guarded only in `onClick` would still take focus and
    // still activate on Enter.
    row?.focus();
    expect(document.activeElement).not.toBe(row);
    await act(async () => row?.click());
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("falls back to the handle when an account has no label", async () => {
    mockAdapterAccountsApi.list.mockResolvedValue([{ ...CODEX_A, label: null }]);
    await render();
    expect(accountButtons()[0]?.textContent).toContain("acct-a");
  });

  it("marks the account the agent's own variable references, not any other secret", async () => {
    await render({
      envBindings: {
        // An unrelated secret binding must never read as an account selection.
        OPENAI_API_KEY: { type: "secret_ref", secretId: "s-b" },
        CODEX_HOME: { type: "secret_ref", secretId: "s-a" },
      },
    });
    const selected = accountButtons().filter((button) =>
      button.className.includes("bg-accent"),
    );
    expect(selected).toHaveLength(1);
    expect(selected[0]?.textContent).toContain("xxx@gmail.com");
  });

  it("offers the company default while the account list is still loading", async () => {
    // The clear set is static, so it is fully known before a single account
    // arrives. Gating this row on the query instead blocked every vendor in the
    // list, which is the whole adapter picker.
    mockAdapterAccountsApi.list.mockReturnValue(new Promise(() => {}));
    const { onSelect } = await render();
    const row = defaultRow();
    expect(row?.disabled).toBe(false);
    await act(async () => row?.click());

    expect(onSelect).toHaveBeenCalledWith({
      adapterType: "codex_local",
      account: null,
      clearEnvKeys: ["CLAUDE_CONFIG_DIR", "CODEX_HOME"],
    });
  });

  it("offers the company default when the account list failed to load", async () => {
    mockAdapterAccountsApi.list.mockRejectedValue(new Error("listing unavailable"));
    const { onSelect } = await render();
    const row = defaultRow();
    expect(row?.disabled).toBe(false);
    await act(async () => row?.click());

    // A failed listing must not cost the user the ability to unbind: the
    // account variables are still cleared and nothing is bound in their place.
    expect(onSelect).toHaveBeenCalledWith({
      adapterType: "codex_local",
      account: null,
      clearEnvKeys: ["CLAUDE_CONFIG_DIR", "CODEX_HOME"],
    });
  });

  it("clears a disabled adapter's account key too", async () => {
    const { onSelect } = await render({ disabledTypes: new Set(["claude_local"]) });
    const row = defaultRow();
    await act(async () => row?.click());

    expect(onSelect).toHaveBeenCalledWith({
      adapterType: "codex_local",
      account: null,
      clearEnvKeys: ["CLAUDE_CONFIG_DIR", "CODEX_HOME"],
    });
  });

  it("names an unavailable selection by its state, never by its raw handle", async () => {
    mockAdapterAccountsApi.list.mockResolvedValue([
      { ...CODEX_A, label: null, status: "unavailable" as const },
    ]);
    await render({ envBindings: { CODEX_HOME: { type: "secret_ref", secretId: "s-a" } } });

    expect(trigger()?.textContent).not.toContain("acct-a");
    expect(trigger()?.textContent).toContain("Needs login");
    expect(trigger()?.title).toContain("acct-a");
  });

  it("names an active account with no email by its handle, not as a login problem", async () => {
    // Both adapters report an account whose credential carries no email as
    // active with a null label. Reading the phrase off label nullity would tell
    // a user to re-login to an account that works.
    mockAdapterAccountsApi.list.mockResolvedValue([{ ...CODEX_A, label: null }]);
    await render({ envBindings: { CODEX_HOME: { type: "secret_ref", secretId: "s-a" } } });

    expect(trigger()?.textContent).toContain("acct-a");
    expect(trigger()?.textContent).not.toContain("Needs login");
  });

  it("names a mismatched selection as a mismatch, never by its raw handle", async () => {
    mockAdapterAccountsApi.list.mockResolvedValue([MISMATCHED]);
    await render({ envBindings: { CODEX_HOME: { type: "secret_ref", secretId: "s-x" } } });

    expect(trigger()?.textContent).not.toContain("acct-x");
    expect(trigger()?.textContent).toContain("Wrong account");
    expect(trigger()?.title).toContain("acct-x");
  });
  it("offers a vendor that has no accounts, and lets it be selected", async () => {
    // Most adapters declare no account binding at all, so the account listing
    // can never be what decides which vendors exist.
    const vendor = listAdapterOptions().find(
      (option) => !option.comingSoon && !FIXTURE_ACCOUNT_TYPES.has(option.value),
    );
    expect(vendor).toBeTruthy();

    const { onSelect } = await render();
    const row = defaultRow(vendor!.value);
    expect(row).toBeTruthy();
    expect(row?.disabled).toBe(false);
    await act(async () => row?.click());

    expect(onSelect).toHaveBeenCalledWith({
      adapterType: vendor!.value,
      account: null,
      clearEnvKeys: ["CLAUDE_CONFIG_DIR", "CODEX_HOME"],
    });
  });

  it("keeps a coming-soon vendor unselectable", async () => {
    const vendor = listAdapterOptions().find((option) => option.comingSoon);
    expect(vendor).toBeTruthy();

    const { onSelect } = await render();
    const row = defaultRow(vendor!.value);
    expect(row?.disabled).toBe(true);
    row?.focus();
    expect(document.activeElement).not.toBe(row);
    await act(async () => row?.click());
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("offers the whole adapter registry minus disabledTypes when there are no accounts", async () => {
    mockAdapterAccountsApi.list.mockResolvedValue([]);
    const hidden = "http";
    await render({ disabledTypes: new Set([hidden]) });

    const offered = Array.from(
      document.querySelectorAll<HTMLElement>("[data-default-row]"),
    ).map((node) => node.dataset.defaultRow);
    const expected = listAdapterOptions()
      .map((option) => option.value)
      .filter((type) => type !== hidden);

    expect(offered).toEqual(expected);
    // Guards the assertion above against passing on a one-or-two-entry list,
    // which is all an account-derived vendor list could ever produce.
    expect(offered.length).toBeGreaterThan(2);
  });
  it("does not mark the company default as selected when the listing failed", async () => {
    // Until the listing resolves nothing can be recognised as bound, so an
    // unguarded mark claims the agent is on the company default when it is not
    // — and a failed listing never resolves, making that claim permanent.
    mockAdapterAccountsApi.list.mockRejectedValue(new Error("listing unavailable"));
    await render({ envBindings: { CODEX_HOME: { type: "secret_ref", secretId: "s-a" } } });

    expect(defaultRow()?.className).not.toContain("bg-accent");
  });

  it("marks the company default as selected once the listing shows nothing bound", async () => {
    // The counterpart: the mark is guarded, not removed.
    await render();

    expect(defaultRow()?.className).toContain("bg-accent");
  });
});
