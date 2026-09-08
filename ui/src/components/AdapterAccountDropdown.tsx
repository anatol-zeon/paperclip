/**
 * @fileoverview The vendor-and-account picker: one row per vendor account the
 * company holds, grouped under its adapter. It wraps, rather than replaces,
 * the plain adapter picker, so `ConfigureBuiltInAgentModal` stays untouched.
 */

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react";
import type { AdapterAccount, EnvBinding } from "@paperclipai/shared";
import { adapterAccountsApi } from "../api/adapterAccounts";
import { getAdapterLabel } from "../adapters/adapter-display-registry";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/**
 * What one click on the picker means. The component emits the whole instruction
 * at once — the adapter to run, the account to bind, and every account variable
 * that must be dropped — so the form can persist it in a single patch and never
 * leave an agent pointing at the previous vendor's home.
 */
export interface AdapterAccountSelection {
  adapterType: string;
  /** The account to bind, or null for the company's default credential home. */
  account: AdapterAccount | null;
  /** Account env keys to remove from the agent's environment. */
  clearEnvKeys: string[];
}

/**
 * True when `binding` is the agent's reference to `secretId`. Only a
 * `secret_ref` counts: a legacy plaintext string or a user-secret reference
 * names no company secret and so can never denote an account.
 */
function referencesSecret(binding: EnvBinding | undefined, secretId: string): boolean {
  return (
    typeof binding === "object"
    && binding !== null
    && "type" in binding
    && binding.type === "secret_ref"
    && binding.secretId === secretId
  );
}

export function AdapterAccountDropdown({
  companyId,
  adapterType,
  envBindings,
  disabledTypes,
  onSelect,
}: {
  companyId: string | null;
  adapterType: string;
  /** The agent's current environment, used to mark the selected account. */
  envBindings: Record<string, EnvBinding>;
  disabledTypes: Set<string>;
  onSelect: (selection: AdapterAccountSelection) => void;
}) {
  const [open, setOpen] = useState(false);

  // Fetched on demand and never on a timer: every listing resolves each
  // account's secret, which writes an audit event and bumps that secret's
  // `lastResolvedAt`. The query key is per company, so every mounted picker
  // shares one request rather than each issuing its own.
  const { data: accounts = [] } = useQuery<AdapterAccount[]>({
    queryKey: ["adapter-accounts", companyId ?? "none"],
    queryFn: () => adapterAccountsApi.list(companyId!),
    enabled: Boolean(companyId),
  });

  const visible = useMemo(
    () => accounts.filter((account) => !disabledTypes.has(account.adapterType)),
    [accounts, disabledTypes],
  );

  // Every account variable any listed adapter uses. A selection clears all of
  // them except the one it sets, so switching vendors cannot leave the previous
  // vendor's home bound on the agent.
  const allEnvKeys = useMemo(
    () => Array.from(new Set(visible.map((account) => account.envKey))),
    [visible],
  );

  const vendors = useMemo(() => {
    const byType = new Map<string, AdapterAccount[]>();
    for (const account of visible) {
      const rows = byType.get(account.adapterType) ?? [];
      rows.push(account);
      byType.set(account.adapterType, rows);
    }
    if (!byType.has(adapterType)) byType.set(adapterType, []);
    return Array.from(byType.entries());
  }, [visible, adapterType]);

  // An account is bound only when the agent's variable FOR THAT ACCOUNT'S key
  // references that account's own secret. Matching on the secret id alone would
  // light up an account whenever any unrelated variable happened to reference
  // the same secret. This stays a per-row predicate rather than one winner, so
  // an env that binds two vendors' homes shows both rather than hiding one.
  const isBound = (account: AdapterAccount) =>
    referencesSecret(envBindings[account.envKey], account.secretId);

  // The account the trigger names: the one bound for the adapter the agent
  // actually runs. A leftover binding for some other vendor must not rename it.
  const selected =
    visible.find((account) => account.adapterType === adapterType && isBound(account)) ?? null;

  const triggerLabel = selected
    ? `${getAdapterLabel(selected.adapterType)} — ${selected.label ?? selected.handle}`
    : getAdapterLabel(adapterType);

  function choose(selection: AdapterAccountSelection) {
    onSelect(selection);
    setOpen(false);
  }

  // Rows below hover on `muted`, not on the sibling adapter picker's `accent`:
  // here `bg-accent` is the "this one is bound" marker, and a `hover:bg-accent/50`
  // alongside it would leave every row carrying the marker's name, so nothing
  // could tell a bound row from an idle one.

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-sm hover:bg-accent/50 transition-colors w-full justify-between"
        >
          <span className="truncate">{triggerLabel}</span>
          <ChevronDown className="h-3 w-3 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) p-1" align="start">
        {vendors.map(([type, rows]) => (
          <div key={type} className="py-1">
            <div className="px-2 py-1 text-(length:--text-nano) uppercase text-muted-foreground">
              {getAdapterLabel(type)}
            </div>
            <button
              type="button"
              data-default-row={type}
              className={cn(
                "flex w-full items-center justify-between rounded px-2 py-1.5 text-sm hover:bg-muted/60",
                type === adapterType && selected === null && "bg-accent",
              )}
              onClick={() =>
                choose({ adapterType: type, account: null, clearEnvKeys: allEnvKeys })
              }
            >
              <span className="text-muted-foreground">Учётка компании по умолчанию</span>
            </button>
            {rows.map((account) => {
              // A mismatched home holds a different account than the secret's
              // name claims, so binding it would run the agent as the wrong
              // account. `disabled` on a native button is what makes the row
              // unreachable by keyboard as well as by pointer — do not swap it
              // for `aria-disabled` plus a click guard.
              const unusable = account.status === "mismatch";
              return (
                <button
                  key={account.secretId}
                  type="button"
                  data-account-row={account.secretId}
                  disabled={unusable}
                  title={
                    unusable
                      ? "Каталог этой учётки содержит креды другого аккаунта"
                      : undefined
                  }
                  className={cn(
                    "flex w-full items-center justify-between rounded px-2 py-1.5 text-sm",
                    unusable ? "cursor-not-allowed opacity-40" : "hover:bg-muted/60",
                    isBound(account) && !unusable && "bg-accent",
                  )}
                  onClick={() => {
                    if (unusable) return;
                    choose({
                      adapterType: account.adapterType,
                      account,
                      clearEnvKeys: allEnvKeys.filter((key) => key !== account.envKey),
                    });
                  }}
                >
                  <span className="truncate">{account.label ?? account.handle}</span>
                  {account.status === "unavailable" && (
                    <span className="text-(length:--text-nano) text-muted-foreground">
                      нужен вход
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </PopoverContent>
    </Popover>
  );
}
