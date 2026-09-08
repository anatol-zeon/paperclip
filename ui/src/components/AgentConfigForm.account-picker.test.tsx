// @vitest-environment jsdom

import { useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Agent } from "@paperclipai/shared";
import { DEFAULT_CODEX_LOCAL_BYPASS_APPROVALS_AND_SANDBOX } from "@paperclipai/adapter-codex-local";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ToastProvider } from "../context/ToastContext";
import { AgentConfigForm, buildAccountEnvUpdate } from "./AgentConfigForm";
import { defaultCreateValues } from "./agent-config-defaults";

const CODEX_A = {
  adapterType: "codex_local",
  handle: "acct-a",
  label: "xxx@gmail.com",
  secretId: "s-a",
  secretName: "CODEX_HOME_acct-a",
  envKey: "CODEX_HOME",
  status: "active" as const,
};

describe("buildAccountEnvUpdate", () => {
  it("binds the chosen account and keeps every unrelated variable", () => {
    const next = buildAccountEnvUpdate(
      { HTTP_PROXY: "http://proxy", CODEX_HOME: "/old/path" },
      { adapterType: "codex_local", account: CODEX_A, clearEnvKeys: ["CLAUDE_CONFIG_DIR"] },
    );
    expect(next).toEqual({
      HTTP_PROXY: "http://proxy",
      CODEX_HOME: { type: "secret_ref", secretId: "s-a" },
    });
  });

  it("drops the previous vendor's account variable", () => {
    const next = buildAccountEnvUpdate(
      { CLAUDE_CONFIG_DIR: { type: "secret_ref", secretId: "s-c" } },
      { adapterType: "codex_local", account: CODEX_A, clearEnvKeys: ["CLAUDE_CONFIG_DIR"] },
    );
    expect(next).toEqual({ CODEX_HOME: { type: "secret_ref", secretId: "s-a" } });
  });

  it("clears every account variable for the company default", () => {
    const next = buildAccountEnvUpdate(
      { CODEX_HOME: { type: "secret_ref", secretId: "s-a" }, HTTP_PROXY: "http://proxy" },
      {
        adapterType: "codex_local",
        account: null,
        clearEnvKeys: ["CODEX_HOME", "CLAUDE_CONFIG_DIR"],
      },
    );
    expect(next).toEqual({ HTTP_PROXY: "http://proxy" });
  });
});

/* ---------------------------------------------------------------- *
 * The picker wired into the form. Both modes are covered: create
 * writes into the caller's draft, edit accumulates into the overlay
 * and reaches the caller through the normal save path.
 * ---------------------------------------------------------------- */

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

const mockAdapterAccountsApi = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock("../api/adapterAccounts", () => ({ adapterAccountsApi: mockAdapterAccountsApi }));

const mockAgentsApi = vi.hoisted(() => ({
  adapterModels: vi.fn(),
  detectModel: vi.fn(),
  list: vi.fn(),
  testEnvironment: vi.fn(),
  getActiveAdapterAuthLoginSession: vi.fn(),
  getActiveClaudeSetupTokenLoginSession: vi.fn(),
  getClaudeOAuthTokenStatus: vi.fn(),
}));
vi.mock("../api/agents", () => ({ agentsApi: mockAgentsApi }));

const mockEnvironmentsApi = vi.hoisted(() => ({ list: vi.fn(), capabilities: vi.fn() }));
vi.mock("../api/environments", () => ({ environmentsApi: mockEnvironmentsApi }));

const mockInstanceSettingsApi = vi.hoisted(() => ({
  get: vi.fn(),
  getExperimental: vi.fn(),
  getGeneral: vi.fn(),
}));
vi.mock("../api/instanceSettings", () => ({ instanceSettingsApi: mockInstanceSettingsApi }));

const mockSecretsApi = vi.hoisted(() => ({
  list: vi.fn(),
  listProposals: vi.fn(),
  listUserSecretDefinitions: vi.fn(),
}));
vi.mock("../api/secrets", () => ({ secretsApi: mockSecretsApi }));

vi.mock("../context/CompanyContext", () => ({
  useCompany: () => ({
    companies: [{ id: "company-1", name: "Paperclip" }],
    selectedCompanyId: "company-1",
    selectedCompany: { id: "company-1", name: "Paperclip" },
    selectionSource: "bootstrap",
    loading: false,
    error: null,
    setSelectedCompanyId: vi.fn(),
    reloadCompanies: vi.fn(),
    createCompany: vi.fn(),
  }),
}));

vi.mock("../adapters", () => ({
  getUIAdapter: (type: string) => ({
    type,
    label: type,
    ConfigFields: () => <div data-testid="adapter-config-fields" />,
    buildAdapterConfig: (values: { model?: string }) => ({ model: values.model || undefined }),
    parseStdoutLine: () => [],
  }),
}));

vi.mock("../adapters/use-adapter-capabilities", () => ({
  useAdapterCapabilities: () => () => ({
    supportsInstructionsBundle: true,
    supportsSkills: true,
    supportsLocalAgentJwt: true,
    requiresMaterializedRuntimeSkills: false,
    supportsAcp: true,
  }),
}));

vi.mock("../adapters/use-disabled-adapters", () => ({
  useDisabledAdaptersSync: () => [],
}));

vi.mock("./MarkdownEditor", () => ({
  MarkdownEditor: ({ value }: { value: string }) => <textarea readOnly value={value} />,
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

async function act(callback: () => void | Promise<void>) {
  await callback();
  await Promise.resolve();
  await new Promise((resolve) => window.setTimeout(resolve, 0));
}

async function flushReact() {
  for (let i = 0; i < 4; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: "agent-1",
    companyId: "company-1",
    name: "Cody",
    role: "Engineer",
    title: null,
    icon: null,
    status: "idle",
    reportsTo: null,
    capabilities: null,
    adapterType: "codex_local",
    adapterConfig: {},
    runtimeConfig: {},
    defaultEnvironmentId: null,
    contextMode: "thin",
    budgetMonthlyCents: 0,
    spentMonthlyCents: 0,
    permissions: {},
    lastHeartbeatAt: null,
    metadata: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...overrides,
  } as Agent;
}

describe("AgentConfigForm adapter account picker", () => {
  let container: HTMLDivElement;
  // Every root a test mounts. An abandoned root keeps its Radix dismissable
  // layer's document listeners alive, and those leaked layers stop a LATER
  // test's popover from opening at all.
  let roots: Root[] = [];

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    mockAdapterAccountsApi.list.mockResolvedValue([CODEX_A, CODEX_B, CLAUDE_C]);
    mockAgentsApi.adapterModels.mockResolvedValue([]);
    mockAgentsApi.detectModel.mockResolvedValue(null);
    mockAgentsApi.list.mockResolvedValue([]);
    mockAgentsApi.getClaudeOAuthTokenStatus.mockResolvedValue(null);
    mockAgentsApi.getActiveAdapterAuthLoginSession.mockRejectedValue(new Error("none"));
    mockAgentsApi.getActiveClaudeSetupTokenLoginSession.mockRejectedValue(new Error("none"));
    mockEnvironmentsApi.list.mockResolvedValue([]);
    mockEnvironmentsApi.capabilities.mockResolvedValue({});
    mockInstanceSettingsApi.get.mockResolvedValue({ defaultEnvironmentId: null });
    mockInstanceSettingsApi.getExperimental.mockResolvedValue({ enableEnvironments: false });
    mockInstanceSettingsApi.getGeneral.mockResolvedValue({ executionMode: "any" });
    mockSecretsApi.list.mockResolvedValue([]);
    mockSecretsApi.listProposals.mockResolvedValue([]);
    mockSecretsApi.listUserSecretDefinitions.mockResolvedValue([]);
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

  function newQueryClient() {
    return new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
  }

  /** Open the picker that sits inside the "Adapter type" field. */
  async function openPicker() {
    const label = Array.from(container.querySelectorAll("label")).find(
      (node) => node.textContent === "Adapter type",
    );
    // A direct child of the field, so the hint's own tooltip button — which
    // sits deeper, next to the label — cannot be picked up instead.
    const trigger = label?.parentElement?.parentElement?.querySelector<HTMLButtonElement>(
      ":scope > button",
    );
    expect(trigger).toBeTruthy();
    await act(async () => trigger!.click());
    await flushReact();
  }

  async function clickAccount(secretId: string) {
    const row = document.querySelector<HTMLButtonElement>(`[data-account-row="${secretId}"]`);
    expect(row).toBeTruthy();
    await act(async () => row!.click());
    await flushReact();
  }

  async function renderCreate(overrides: Partial<typeof defaultCreateValues>) {
    const valuesRef = { current: { ...defaultCreateValues, ...overrides } };
    const root = createRoot(container);
    roots.push(root);

    function Harness() {
      const [values, setValues] = useState(valuesRef.current);
      valuesRef.current = values;
      return (
        <AgentConfigForm
          mode="create"
          values={values}
          onChange={(patch) => setValues((prev) => ({ ...prev, ...patch }))}
          hidePromptTemplate
          showAdapterTestEnvironmentButton={false}
        />
      );
    }

    await act(async () => {
      root.render(
        <QueryClientProvider client={newQueryClient()}>
          <ToastProvider>
            <TooltipProvider>
              <Harness />
            </TooltipProvider>
          </ToastProvider>
        </QueryClientProvider>,
      );
    });
    await flushReact();
    await openPicker();
    return { valuesRef };
  }

  async function renderEdit(agentOverrides: Partial<Agent>) {
    const onSave = vi.fn();
    const saveRef: { current: (() => void) | null } = { current: null };
    const root = createRoot(container);
    roots.push(root);

    await act(async () => {
      root.render(
        <QueryClientProvider client={newQueryClient()}>
          <ToastProvider>
            <TooltipProvider>
              <AgentConfigForm
                mode="edit"
                agent={makeAgent(agentOverrides)}
                onSave={onSave}
                hidePromptTemplate
                showAdapterTestEnvironmentButton={false}
                onSaveActionChange={(save) => {
                  saveRef.current = save;
                }}
              />
            </TooltipProvider>
          </ToastProvider>
        </QueryClientProvider>,
      );
    });
    await flushReact();
    await openPicker();

    async function save() {
      await act(async () => saveRef.current?.());
      await flushReact();
      return onSave.mock.calls[0]?.[0] as Record<string, unknown> | undefined;
    }

    return { onSave, save };
  }

  it("create mode binds the chosen account and leaves the vendor's settings alone", async () => {
    const { valuesRef } = await renderCreate({
      adapterType: "codex_local",
      model: "gpt-5-custom",
      envBindings: { CODEX_HOME: { type: "secret_ref", secretId: "s-a" } },
    });

    await clickAccount("s-b");

    expect(valuesRef.current.adapterType).toBe("codex_local");
    // The vendor did not change, so the reset must not fire and wipe the model.
    expect(valuesRef.current.model).toBe("gpt-5-custom");
    expect(valuesRef.current.envBindings).toEqual({
      CODEX_HOME: { type: "secret_ref", secretId: "s-b" },
    });
  });

  it("create mode resets the adapter defaults when the picker changes vendor", async () => {
    const { valuesRef } = await renderCreate({
      adapterType: "claude_local",
      model: "opus-custom",
      envBindings: {
        CLAUDE_CONFIG_DIR: { type: "secret_ref", secretId: "s-c" },
        HTTP_PROXY: "http://proxy",
      },
    });

    await clickAccount("s-a");

    expect(valuesRef.current.adapterType).toBe("codex_local");
    // The same reset the plain adapter dropdown applied: defaults back, plus
    // Codex's sandbox bypass.
    expect(valuesRef.current.model).toBe("");
    expect(valuesRef.current.dangerouslyBypassSandbox).toBe(
      DEFAULT_CODEX_LOCAL_BYPASS_APPROVALS_AND_SANDBOX,
    );
    // The env update is the picker's, not the reset's: the previous vendor's
    // account variable goes, everything unrelated stays.
    expect(valuesRef.current.envBindings).toEqual({
      HTTP_PROXY: "http://proxy",
      CODEX_HOME: { type: "secret_ref", secretId: "s-a" },
    });
  });

  it("create mode clears every account variable for the company default", async () => {
    const { valuesRef } = await renderCreate({
      adapterType: "codex_local",
      envBindings: {
        CODEX_HOME: { type: "secret_ref", secretId: "s-a" },
        HTTP_PROXY: "http://proxy",
      },
    });

    const row = document.querySelector<HTMLButtonElement>('[data-default-row="codex_local"]');
    expect(row).toBeTruthy();
    await act(async () => row!.click());
    await flushReact();

    expect(valuesRef.current.adapterType).toBe("codex_local");
    expect(valuesRef.current.envBindings).toEqual({ HTTP_PROXY: "http://proxy" });
  });

  it("edit mode saves the account binding without disturbing the adapter config", async () => {
    const { save } = await renderEdit({
      adapterType: "codex_local",
      adapterConfig: {
        model: "gpt-5-custom",
        env: { CODEX_HOME: { type: "secret_ref", secretId: "s-a" }, HTTP_PROXY: "http://proxy" },
      },
    });

    await clickAccount("s-b");
    const patch = await save();

    // The vendor did not change, so the patch must not carry an adapter switch
    // — that branch rebuilds the adapter config from scratch and would drop the
    // model the user chose.
    expect(patch?.adapterType).toBeUndefined();
    expect((patch?.adapterConfig as Record<string, unknown>).model).toBe("gpt-5-custom");
    expect((patch?.adapterConfig as Record<string, unknown>).env).toEqual({
      CODEX_HOME: { type: "secret_ref", secretId: "s-b" },
      HTTP_PROXY: "http://proxy",
    });
  });

  it("edit mode resets the adapter defaults when the picker changes vendor", async () => {
    const { save } = await renderEdit({
      adapterType: "claude_local",
      adapterConfig: {
        model: "opus-custom",
        env: {
          CLAUDE_CONFIG_DIR: { type: "secret_ref", secretId: "s-c" },
          HTTP_PROXY: "http://proxy",
        },
      },
    });

    await clickAccount("s-a");
    const patch = await save();

    expect(patch?.adapterType).toBe("codex_local");
    const adapterConfig = patch?.adapterConfig as Record<string, unknown>;
    expect(adapterConfig.model).toBe("");
    expect(adapterConfig.dangerouslyBypassApprovalsAndSandbox).toBe(
      DEFAULT_CODEX_LOCAL_BYPASS_APPROVALS_AND_SANDBOX,
    );
    expect(adapterConfig.env).toEqual({
      HTTP_PROXY: "http://proxy",
      CODEX_HOME: { type: "secret_ref", secretId: "s-a" },
    });
  });
});
