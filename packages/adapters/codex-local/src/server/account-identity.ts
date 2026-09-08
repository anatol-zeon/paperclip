import type { AdapterAccountIdentity } from "@paperclipai/adapter-utils";
import { readCodexAuthInfo } from "./quota.js";

/**
 * Reads the non-secret identity of the Codex account whose credential home is
 * `homeDir`. The handle is the vendor account id that names the account's
 * company secret; the label is the ChatGPT account email when the token
 * carries one.
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
  // `readCodexAuthInfo` already trims the account id and nulls a blank one
  // (quota.ts:155), so this only re-checks the type. Contrast
  // `readSubscriptionAccountId` (codex-auth-cache.ts:367), which returns the id
  // untrimmed because it feeds `toAccountHandle`. This path mints no handle — it
  // reports an already-normalized id — but if that upstream trim is ever removed,
  // do not reintroduce one here: see account-handle.ts:22-26 on aliasing.
  const handle = typeof info.accountId === "string" ? info.accountId : "";
  if (handle.length === 0) return null;
  const label = typeof info.email === "string" && info.email.trim().length > 0
    ? info.email.trim()
    : null;
  return { handle, label };
}
