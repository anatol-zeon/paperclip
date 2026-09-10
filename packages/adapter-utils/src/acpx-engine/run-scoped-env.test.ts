// Server-owned run scratch paths must not change the resumable-session
// fingerprint, while user-owned environment changes still must.
// Upstream: paperclipai/paperclip#11180, #11685.

import { describe, expect, it } from "vitest";
import { buildSessionFingerprint } from "./execute.js";
import type { SessionFingerprintIdentity } from "./run-contracts.js";
import { stripRunScopedScratchEnvForFingerprint } from "./run-scoped-env.js";

const SCRATCH_A = "/tmp/paperclip-run-cmp-2-aaaaaaaa";
const SCRATCH_B = "/tmp/paperclip-run-cmp-2-bbbbbbbb";

// The environment Paperclip forwards for a run: stable user configuration plus
// the server-owned scratch entries it injects fresh on every heartbeat.
function runEnv(scratchDir: string, overrides: Record<string, string> = {}) {
  return {
    ANTHROPIC_MODEL: "claude-haiku-4-5",
    CLAUDE_CONFIG_DIR: "/home/dev/.claude-accounts/sub3",
    PAPERCLIP_RUN_SCRATCH_DIR: scratchDir,
    PAPERCLIP_TASK_SCRATCH_DIR: scratchDir,
    PAPERCLIP_SCRATCH_DIR: scratchDir,
    PAPERCLIP_TMPDIR: scratchDir,
    TMPDIR: scratchDir,
    TEMP: scratchDir,
    TMP: scratchDir,
    ...overrides,
  };
}

const BASE_IDENTITY: SessionFingerprintIdentity = {
  acpxAgent: "claude",
  agentCommand: "claude",
  cwd: "/work",
  mode: "persistent",
  permissionMode: "approve-all",
  nonInteractivePermissions: "deny",
  requestedModel: "",
  requestedThinkingEffort: "",
  fastMode: false,
  remoteExecutionIdentity: null,
  additionalSourcesIdentity: {},
  skillsIdentity: {},
  skillPromptInstructions: "",
  paperclipClaudeSettings: null,
  mcpServers: [],
  secretManifestHash: "0000",
  adapterEnvHash: "0000",
};

function fingerprintFor(env: Record<string, string>, scratchDir: string) {
  return buildSessionFingerprint({
    ...BASE_IDENTITY,
    adapterEnvHash: JSON.stringify(
      stripRunScopedScratchEnvForFingerprint(env, scratchDir),
    ),
  });
}

describe("run-scoped scratch env and the session fingerprint", () => {
  it("keeps the fingerprint stable across two runs that differ only by scratch dir", () => {
    expect(fingerprintFor(runEnv(SCRATCH_A), SCRATCH_A)).toBe(
      fingerprintFor(runEnv(SCRATCH_B), SCRATCH_B),
    );
  });

  it("control: the same two runs DO differ when the scratch entries are not filtered", () => {
    // Without the filter the fingerprint churns every heartbeat, which is the
    // defect this module exists to prevent. If this control ever stops failing
    // to match, the test above has stopped proving anything.
    const unfiltered = (env: Record<string, string>) =>
      buildSessionFingerprint({
        ...BASE_IDENTITY,
        adapterEnvHash: JSON.stringify(env),
      });
    expect(unfiltered(runEnv(SCRATCH_A))).not.toBe(
      unfiltered(runEnv(SCRATCH_B)),
    );
  });

  it("still invalidates the fingerprint when user configuration changes", () => {
    const changedUserValue = runEnv(SCRATCH_B, {
      CLAUDE_CONFIG_DIR: "/home/dev/.claude-accounts/sub2",
    });
    expect(fingerprintFor(runEnv(SCRATCH_A), SCRATCH_A)).not.toBe(
      fingerprintFor(changedUserValue, SCRATCH_B),
    );
  });

  it("keeps a user-configured temp dir in the fingerprint", () => {
    // The scratch builder leaves a user-set TMPDIR alone, so its value differs
    // from the run scratch dir and must keep invalidating the session.
    const userTmp = runEnv(SCRATCH_A, { TMPDIR: "/mnt/fast-scratch" });
    const strippedUserTmp = stripRunScopedScratchEnvForFingerprint(
      userTmp,
      SCRATCH_A,
    );
    expect(strippedUserTmp.TMPDIR).toBe("/mnt/fast-scratch");

    const otherUserTmp = runEnv(SCRATCH_B, { TMPDIR: "/mnt/other-scratch" });
    expect(fingerprintFor(userTmp, SCRATCH_A)).not.toBe(
      fingerprintFor(otherUserTmp, SCRATCH_B),
    );
  });

  it("drops every server-owned scratch key it injected", () => {
    const stripped = stripRunScopedScratchEnvForFingerprint(
      runEnv(SCRATCH_A),
      SCRATCH_A,
    );
    expect(Object.keys(stripped).sort()).toEqual([
      "ANTHROPIC_MODEL",
      "CLAUDE_CONFIG_DIR",
    ]);
  });

  it("does not modify the environment forwarded to the child", () => {
    const env = runEnv(SCRATCH_A);
    const before = { ...env };
    stripRunScopedScratchEnvForFingerprint(env, SCRATCH_A);
    expect(env).toEqual(before);
  });

  it("drops nothing when the run has no scratch directory", () => {
    const env = runEnv(SCRATCH_A);
    expect(stripRunScopedScratchEnvForFingerprint(env, null)).toEqual(env);
    expect(stripRunScopedScratchEnvForFingerprint(env, "  ")).toEqual(env);
  });
});
