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

const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const SECRET_PREFIX_RE = /^[A-Za-z][A-Za-z0-9_]*_$/;

/**
 * Checks one candidate against every rule and returns the first broken rule as
 * a human-readable reason, or null when the candidate is a well-formed
 * capability. Both `isAdapterAccountBinding` and `validateAdapterAccountBinding`
 * route through this one check, so the predicate and the thrown error can never
 * disagree.
 */
function accountBindingProblem(value: unknown): string | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return "the capability must be an object.";
  }
  const c = value as Partial<AdapterAccountBinding>;
  if (typeof c.envKey !== "string" || !ENV_KEY_RE.test(c.envKey)) {
    return `"envKey" must name an environment variable matching ${ENV_KEY_RE.source}.`;
  }
  if (typeof c.secretPrefix !== "string" || !SECRET_PREFIX_RE.test(c.secretPrefix)) {
    return `"secretPrefix" must match ${SECRET_PREFIX_RE.source}, so the handle can be read back out of the secret name.`;
  }
  if (typeof c.readIdentity !== "function") return `"readIdentity" must be a function.`;
  return null;
}

/**
 * The runtime validator. It fails closed: a malformed capability is rejected, so
 * the loader never accepts a partial one.
 */
export function isAdapterAccountBinding(value: unknown): value is AdapterAccountBinding {
  return accountBindingProblem(value) === null;
}

/**
 * Validates the optional account-binding capability of an adapter module. The
 * function is a no-op when the module declares no account binding. It throws a
 * clear error naming the broken rule when the module declares a malformed
 * capability, so the loader fails closed.
 */
export function validateAdapterAccountBinding(mod: {
  type?: unknown;
  accountBinding?: unknown;
}): void {
  if (mod.accountBinding === undefined) return;
  const problem = accountBindingProblem(mod.accountBinding);
  if (problem !== null) {
    const adapterType = typeof mod.type === "string" && mod.type.length > 0 ? mod.type : "unknown";
    throw new Error(`Adapter "${adapterType}" declares an invalid account binding: ${problem}`);
  }
}
