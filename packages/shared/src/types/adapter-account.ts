/**
 * The state of one listed account.
 *
 * - `active`: the account's home holds a readable credential whose identity
 *   matches the handle in the secret's name.
 * - `unavailable`: the home is missing or unreadable, the secret could not be
 *   resolved, or the adapter's reader failed. The row is still listed, so a
 *   user can see the account exists and needs a login.
 * - `mismatch`: the home holds a credential for a DIFFERENT account than the
 *   secret's name claims. Binding an agent to it would run the agent as the
 *   wrong account, so the row is listed but must not be offered for selection.
 */
export type AdapterAccountStatus = "active" | "unavailable" | "mismatch";

/** One selectable vendor account in one company. */
export interface AdapterAccount {
  /** The adapter this account belongs to, e.g. `codex_local`. */
  adapterType: string;
  /** The vendor account id, read back out of the secret's name. */
  handle: string;
  /**
   * The display label, normally an email. Null when it could not be read, or is
   * withheld on a mismatched row.
   */
  label: string | null;
  /** The company secret that carries the path to this account's home. */
  secretId: string;
  /** That secret's name, e.g. `CODEX_HOME_<handle>`. */
  secretName: string;
  /** The environment variable an agent sets to select this account. */
  envKey: string;
  status: AdapterAccountStatus;
}
