import type { AdapterAccountIdentity } from "@paperclipai/adapter-utils";
import { readCodexAuthInfo } from "./quota.js";

/**
 * Reads the non-secret identity of the Codex account whose credential home is
 * `homeDir`. The handle is the vendor account id that already names the
 * account's own home and its company secret; the label is the ChatGPT account
 * email when the token carries one.
 *
 * Returns null when the directory holds no usable subscription credential — a
 * missing or unparsable `auth.json`, or one with no account id. The function
 * returns no token bytes.
 */
export async function readCodexAccountIdentity(
  homeDir: string,
): Promise<AdapterAccountIdentity | null> {
  const info = await readCodexAuthInfo(homeDir);
  if (!info) return null;
  const handle = typeof info.accountId === "string" ? info.accountId.trim() : "";
  if (handle.length === 0) return null;
  const label = typeof info.email === "string" && info.email.trim().length > 0
    ? info.email.trim()
    : null;
  return { handle, label };
}
