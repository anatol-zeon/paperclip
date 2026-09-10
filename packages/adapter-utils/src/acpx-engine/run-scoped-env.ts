/**
 * Server-owned run scratch entries must not churn the session fingerprint.
 *
 * Paperclip creates a fresh scratch directory for every heartbeat and merges its
 * paths into the effective adapter environment (`buildHeartbeatRunScratchEnv` in
 * `server/src/services/run-scratch.ts`). Those values change on every run, so
 * folding them into `adapterEnvHash` rewrites the ACPX `configFingerprint` each
 * wake. The saved session then reaches the adapter and is still rejected as
 * incompatible ("does not match the current agent/cwd/mode/runtime identity"),
 * which makes a resumable session unreachable in practice.
 *
 * The entries must keep reaching the spawned child; only the fingerprint input
 * is filtered. See upstream paperclipai/paperclip#11180 and #11685.
 */

/**
 * The env keys `buildHeartbeatRunScratchEnv` assigns. `TMPDIR`/`TEMP`/`TMP` are
 * only assigned when the user has not configured them, so membership here is
 * not enough on its own to drop an entry — see
 * `stripRunScopedScratchEnvForFingerprint`.
 */
export const RUN_SCOPED_SCRATCH_ENV_KEYS: ReadonlySet<string> = new Set([
  "PAPERCLIP_RUN_SCRATCH_DIR",
  "PAPERCLIP_TASK_SCRATCH_DIR",
  "PAPERCLIP_SCRATCH_DIR",
  "PAPERCLIP_TMPDIR",
  "TMPDIR",
  "TEMP",
  "TMP",
]);

/**
 * Drop server-owned scratch entries from a session fingerprint's env input.
 *
 * An entry is dropped only when its key is one Paperclip assigns AND its value
 * is exactly the current run scratch directory. A user-configured `TMPDIR` (or
 * any other user value) therefore still invalidates the session, which is the
 * behavior a fingerprint exists to provide.
 *
 * Returns a copy; the caller's environment — the one forwarded to the child —
 * is never modified. With no scratch directory for the run, nothing is dropped.
 */
export function stripRunScopedScratchEnvForFingerprint(
  env: Record<string, string>,
  scratchDir: string | null | undefined,
): Record<string, string> {
  const dir = typeof scratchDir === "string" ? scratchDir.trim() : "";
  if (!dir) return { ...env };
  const next: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (RUN_SCOPED_SCRATCH_ENV_KEYS.has(key) && value === dir) continue;
    next[key] = value;
  }
  return next;
}
