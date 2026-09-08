// The adapter account-binding capability. An adapter declares this optional
// capability when one agent can select which of the company's login accounts it
// runs as: the agent's environment variable named by `envKey` points at that
// account's own credential home, and the company secret named
// `<secretPrefix><handle>` carries the path to it.
//
// Security (secret handling): the capability data holds no secret. The scalar
// fields carry only a fixed, non-secret value. `readIdentity` reads a credential
// home from disk and returns only the non-secret identity — the vendor account
// id and a display label. It must never return, log, or throw token bytes.

/** The non-secret identity of one vendor login account. */
export interface AdapterAccountIdentity {
  /**
   * The vendor's stable account id. It names the account's company secret,
   * whose value carries the path to the account's home.
   */
  handle: string;
  /** A human-readable label, normally an email. Null when unavailable. */
  label: string | null;
}

/** The optional adapter account-binding capability. */
export interface AdapterAccountBinding {
  /** The environment variable that selects this account's credential home. */
  envKey: string;
  /**
   * The company-secret name prefix. One account's secret is named
   * `<secretPrefix><handle>`, so the prefix must end with `_`, or the handle
   * cannot be read back out of the name.
   */
  secretPrefix: string;
  /**
   * Reads the non-secret identity out of a credential home. Returns null when
   * the directory holds no usable credential. Never returns token bytes.
   * A rejection is treated as unavailable, the same as null; prefer returning
   * null. Always return the identity actually found in the directory — never
   * coerce it to an expected handle. The caller compares it to detect a home
   * holding a different account.
   */
  readIdentity: (homeDir: string) => Promise<AdapterAccountIdentity | null>;
}

/**
 * The runtime validator. It fails closed: a malformed capability is rejected, so
 * the registry never accepts a partial one.
 */
export function isAdapterAccountBinding(value: unknown): value is AdapterAccountBinding {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const candidate = value as Partial<AdapterAccountBinding>;
  if (typeof candidate.envKey !== "string") return false;
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(candidate.envKey)) return false;
  if (typeof candidate.secretPrefix !== "string") return false;
  if (!/^[A-Za-z][A-Za-z0-9_]*_$/.test(candidate.secretPrefix)) return false;
  if (typeof candidate.readIdentity !== "function") return false;
  return true;
}

/**
 * Validates the optional account-binding capability of an adapter module. The
 * function is a no-op when the module declares no account binding. It throws a
 * clear error when the module declares a malformed capability, so the loader
 * fails closed.
 */
export function validateAdapterAccountBinding(mod: {
  type?: unknown;
  accountBinding?: unknown;
}): void {
  if (mod.accountBinding === undefined) return;
  if (!isAdapterAccountBinding(mod.accountBinding)) {
    const adapterType = typeof mod.type === "string" && mod.type.length > 0 ? mod.type : "unknown";
    throw new Error(`Adapter "${adapterType}" declares an invalid account binding.`);
  }
}
