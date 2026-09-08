import type { AdapterAccountBinding } from "@paperclipai/adapter-utils";
import type { AdapterAccount, AdapterAccountStatus } from "@paperclipai/shared";
import { logger } from "../middleware/logger.js";

/** One adapter that declares the account-binding capability. */
export interface AdapterAccountBindingEntry {
  adapterType: string;
  binding: AdapterAccountBinding;
}

/**
 * The service's collaborators, injected so the listing can be tested with no
 * database, no filesystem, and no adapter registry.
 */
export interface AdapterAccountDeps {
  listAdapterBindings: () => AdapterAccountBindingEntry[];
  listSecrets: (companyId: string) => Promise<{ id: string; name: string }[]>;
  resolveSecretValue: (companyId: string, secretId: string) => Promise<string>;
}

/**
 * Lists the company's selectable vendor accounts, one row per account-home
 * secret. The handle comes from the secret's name, which is the cheap and
 * always-available half of the identity; the label comes from the account's
 * home on disk.
 *
 * The listing is read-only and fails soft on every per-account error: a home
 * that cannot be read, a secret that cannot be resolved, and an adapter whose
 * reader throws all produce an `unavailable` row rather than an empty list or a
 * failed request. A user must still be able to see that an account exists —
 * that is exactly the state a re-login has to fix. The one status that is NOT
 * soft is `mismatch`: the home names a different account than the secret claims,
 * so the row must never be offered for selection.
 */
export async function listAdapterAccounts(
  companyId: string,
  deps: AdapterAccountDeps,
): Promise<AdapterAccount[]> {
  const secrets = await deps.listSecrets(companyId);
  const rows: AdapterAccount[] = [];

  for (const { adapterType, binding } of deps.listAdapterBindings()) {
    for (const secret of secrets) {
      if (!secret.name.startsWith(binding.secretPrefix)) continue;
      const handle = secret.name.slice(binding.secretPrefix.length);
      if (handle.length === 0) continue;

      let label: string | null = null;
      let status: AdapterAccountStatus = "unavailable";

      // Resolve and read are split into separate try blocks so each failure
      // mode is named. A resolve failure is already audited under the
      // listing's own consumer id by resolveSecretValueInternal before it
      // rethrows (see server/src/services/secrets.ts), so nothing further
      // needs recording here — the row below just records the fail-soft
      // status for the response.
      let homeDir: string;
      try {
        homeDir = await deps.resolveSecretValue(companyId, secret.id);
      } catch {
        rows.push({
          adapterType,
          handle,
          label: null,
          secretId: secret.id,
          secretName: secret.name,
          envKey: binding.envKey,
          status: "unavailable",
        });
        continue;
      }

      try {
        const identity = await binding.readIdentity(homeDir);
        if (identity) {
          if (identity.handle === handle) {
            label = identity.label;
            status = "active";
          } else {
            // The home holds a different account. Its label stays unread: this
            // row is named for the handle in the secret, and showing the other
            // account's email under that name would leak it to whoever can see
            // this account.
            status = "mismatch";
          }
        }
      } catch (error) {
        // Fail soft: the row stays listed as unavailable, and the failure
        // detail stays out of the response — a read failure can carry a
        // provider message that does not belong in a listing response — but
        // it is no longer dropped on the floor: it goes to the log instead,
        // minus the account's home path. Do NOT log the caught error
        // wholesale, and never log `homeDir`: homeDir is the secret's
        // resolved value, and a thrown filesystem error's message routinely
        // embeds the exact path it failed on, so logging the error as-is (or
        // the home path directly) would leak the secret through the log.
        // Log only a bounded discriminator — the error's class name — never
        // its message. A later "let's include the full error for
        // debuggability" change has to find another way to get that detail;
        // it does not get to reintroduce the leak here.
        logger.warn(
          { adapterType, errorType: error instanceof Error ? error.constructor.name : typeof error },
          "adapter account readIdentity failed",
        );
        status = "unavailable";
      }

      rows.push({
        adapterType,
        handle,
        label,
        secretId: secret.id,
        secretName: secret.name,
        envKey: binding.envKey,
        status,
      });
    }
  }

  return rows;
}
