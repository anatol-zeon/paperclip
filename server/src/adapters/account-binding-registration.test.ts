import { describe, expect, it } from "vitest";
import { isAdapterAccountBinding } from "@paperclipai/adapter-utils";
import { getServerAdapter } from "./registry.js";

// The two adapters that carry per-account credential homes must declare the
// capability, and each must name the environment variable its own execute path
// already honors. A drift here silently empties the account list in the UI.
describe("account binding registration", () => {
  it("declares a valid binding for codex_local", () => {
    const binding = getServerAdapter("codex_local")?.accountBinding;
    expect(isAdapterAccountBinding(binding)).toBe(true);
    expect(binding?.envKey).toBe("CODEX_HOME");
    expect(binding?.secretPrefix).toBe("CODEX_HOME_");
  });

  it("declares a valid binding for claude_local", () => {
    const binding = getServerAdapter("claude_local")?.accountBinding;
    expect(isAdapterAccountBinding(binding)).toBe(true);
    expect(binding?.envKey).toBe("CLAUDE_CONFIG_DIR");
    expect(binding?.secretPrefix).toBe("CLAUDE_CONFIG_DIR_");
  });

  it("leaves an adapter with one shared credential home undeclared", () => {
    expect(getServerAdapter("gemini_local")?.accountBinding).toBeUndefined();
  });
});
