import fs from "node:fs/promises";
import path from "node:path";
import type { AdapterAccountIdentity } from "@paperclipai/adapter-utils";

const CONFIG_FILE_NAME = ".claude.json";

// Nothing upstream trims or blanks-out these fields before they reach us — unlike
// `readCodexAccountIdentity` (account-identity.ts, codex-local), which reports an
// already-normalized id from `readCodexAuthInfo`. This reader owns the raw
// `.claude.json` parse, so both the handle and the label trim here.
function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/**
 * Reads the non-secret identity of the Claude account whose config home is
 * `homeDir`. The handle is the OAuth account uuid; the label is the account's
 * email address when the config carries one.
 *
 * Returns null when the directory holds no readable config, or when the config
 * names no OAuth account. The function reads no credential file and returns no
 * token bytes: `.claude.json` holds the account profile, while the tokens live
 * in a separate `.credentials.json` this function never opens.
 */
export async function readClaudeAccountIdentity(
  homeDir: string,
): Promise<AdapterAccountIdentity | null> {
  let raw: string;
  try {
    raw = await fs.readFile(path.join(homeDir, CONFIG_FILE_NAME), "utf8");
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  const account = (parsed as Record<string, unknown>).oauthAccount;
  if (typeof account !== "object" || account === null || Array.isArray(account)) return null;
  const record = account as Record<string, unknown>;
  const handle = readString(record, "accountUuid");
  if (!handle) return null;
  return { handle, label: readString(record, "emailAddress") };
}
