import type { AdapterAccountBinding } from "@paperclipai/adapter-utils";
import type { AdapterAccount, AdapterAccountStatus } from "@paperclipai/shared";

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
      try {
        const homeDir = await deps.resolveSecretValue(companyId, secret.id);
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
      } catch {
        // Fail soft: the row stays listed as unavailable. No error detail is
        // kept, because a resolve or read failure can carry a path or a
        // provider message that does not belong in a listing response.
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
