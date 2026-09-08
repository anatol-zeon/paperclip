// @vitest-environment jsdom

import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdapterAccountDropdown } from "./AdapterAccountDropdown";

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

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    mockAdapterAccountsApi.list.mockResolvedValue([CODEX_A, CODEX_B, CLAUDE_C]);
  });

  afterEach(() => {
    container.remove();
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  async function render(props: Partial<Parameters<typeof AdapterAccountDropdown>[0]> = {}) {
    const onSelect = vi.fn();
    const root = createRoot(container);
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
      clearEnvKeys: ["CODEX_HOME", "CLAUDE_CONFIG_DIR"],
    });
  });

  it("does not offer a mismatched account for selection", async () => {
    mockAdapterAccountsApi.list.mockResolvedValue([MISMATCHED]);
    const { onSelect } = await render();
    const row = accountButtons().find((button) => button.textContent?.includes("acct-x"));
    expect(row?.disabled).toBe(true);
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
});
