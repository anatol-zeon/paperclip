/**
 * @fileoverview The vendor-and-account picker used by the agent form's
 * "Adapter type" field: every adapter, with the company's accounts for it
 * listed underneath.
 *
 * It REPLACES `AdapterTypeDropdown` in that field — it does not wrap it — so it
 * must offer everything that dropdown offered, and it seeds itself from the
 * same registry source (`listAdapterOptions`) for exactly that reason. The
 * fetched account list only decorates those vendors; it never decides which
 * vendors exist. Deriving the vendor list from the accounts hid every adapter
 * with no account binding — all but two of them — and with no accounts at all
 * left the user unable to change adapter type.
 *
 * `AdapterTypeDropdown` itself is untouched and still serves
 * `ConfigureBuiltInAgentModal`, which has no account concept.
 */

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react";
import type { AdapterAccount, EnvBinding } from "@paperclipai/shared";
import { adapterAccountsApi } from "../api/adapterAccounts";
import { getAdapterDisplay, getAdapterLabel } from "../adapters/adapter-display-registry";
import { listAdapterOptions } from "../adapters/metadata";
import { queryKeys } from "../lib/queryKeys";
import { OpenCodeLogoIcon } from "./OpenCodeLogoIcon";
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

/** The account's home needs a fresh login before an agent can run as it. */
const NEEDS_LOGIN = "Needs login";
/** The home holds a different account than this row's secret name claims. */
const WRONG_ACCOUNT = "Wrong account";

/**
 * What the collapsed trigger says about the bound account. `handle` is an
 * opaque vendor account id — a UUID for Codex — and the trigger is the only
 * text on screen while the popover is shut, so a bare handle there reads as a
 * glitch rather than as an account. Name the problem instead; the handle stays
 * in the trigger's tooltip either way.
 *
 * The phrase comes from `status`, never from whether `label` happens to be
 * null. Both adapters read an account whose credential carries no email as
 * `active` with a null label, so a `label ?? NEEDS_LOGIN` fallback would tell a
 * user to re-login to an account that is working fine. An active account with
 * no email is named by its handle: opaque, but true.
 */
function accountTriggerText(account: AdapterAccount): string {
  if (account.status === "mismatch") return WRONG_ACCOUNT;
  if (account.status === "unavailable") return NEEDS_LOGIN;
  return account.label ?? account.handle;
}

/** One vendor as the picker offers it: the adapter, plus any accounts for it. */
interface VendorRow {
  type: string;
  label: string;
  comingSoon: boolean;
  experimental: boolean;
  accounts: AdapterAccount[];
}

/** Kept identical to `AgentConfigForm`'s own badge, which is private to it. */
function ExperimentalBadge() {
  return (
    <span className="shrink-0 rounded border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-(length:--text-nano) font-medium leading-none text-amber-700 dark:text-amber-200">
      Experimental
    </span>
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
  // `lastResolvedAt`.
  const { data, isPending, isError, isSuccess } = useQuery<AdapterAccount[]>({
    queryKey: queryKeys.adapterAccounts.list(companyId),
    queryFn: () => adapterAccountsApi.list(companyId!),
    enabled: Boolean(companyId),
    // Deliberately off, against the app-wide default of `true`: with the global
    // 30s `staleTime`, every tab refocus would re-issue the listing and cost one
    // audit event and one `lastResolvedAt` bump PER ACCOUNT. Do not "restore
    // consistency" by deleting this line.
    refetchOnWindowFocus: false,
  });

  // `data` stays undefined until the listing actually succeeds. Loading, failed
  // and genuinely-empty are three different answers and the flags above keep
  // them apart; a `= []` default here would erase the difference and let the
  // picker act on an empty account set it never actually received.
  const accounts = useMemo(() => data ?? [], [data]);

  const visible = useMemo(
    () => accounts.filter((account) => !disabledTypes.has(account.adapterType)),
    [accounts, disabledTypes],
  );

  // Every account variable any listed adapter uses. A selection clears all of
  // them except the one it sets, so switching vendors cannot leave the previous
  // vendor's home bound on the agent.
  //
  // Built from the UNFILTERED list on purpose. `visible` drops accounts whose
  // adapter is disabled, and a disabled adapter's binding is exactly the one a
  // user can no longer see to remove: deriving the clear set from `visible`
  // would leave `CODEX_HOME` bound after disabling Codex and switching to
  // Claude.
  //
  // Accepted residual: an env key belonging to a vendor the company holds no
  // account secret for is not in this set and survives the switch. That is the
  // intended policy, not an oversight — with no account secrets there was no
  // account to choose through this picker, so such a binding was hand-typed,
  // and silently deleting hand-typed configuration on a vendor switch is the
  // more surprising outcome. It applies partially too: with Claude accounts but
  // no Codex ones, a hand-typed `CODEX_HOME` survives. Revisit only alongside a
  // server-supplied env-key set (the adapter registry knows every account
  // binding's key regardless of which secrets exist).
  const allEnvKeys = useMemo(
    () => Array.from(new Set(accounts.map((account) => account.envKey))),
    [accounts],
  );

  // The vendor list is the adapter registry, filtered exactly as
  // `AdapterTypeDropdown` filters it. Accounts are attached to the vendors that
  // have them; a vendor with none is still offered, because most adapters
  // declare no account binding at all and every one of them still has to be
  // selectable. An account whose adapter is not registered here is not shown —
  // the same type `AdapterTypeDropdown` would never have offered either — but
  // its env key still reaches `allEnvKeys` above, so a switch away still clears
  // it.
  const vendors = useMemo<VendorRow[]>(() => {
    const byType = new Map<string, AdapterAccount[]>();
    for (const account of visible) {
      const rows = byType.get(account.adapterType) ?? [];
      rows.push(account);
      byType.set(account.adapterType, rows);
    }
    return listAdapterOptions()
      .filter((option) => !disabledTypes.has(option.value))
      .map((option) => ({
        type: option.value,
        label: option.label,
        comingSoon: option.comingSoon,
        experimental: option.experimental,
        accounts: byType.get(option.value) ?? [],
      }));
  }, [visible, disabledTypes]);

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

  // The vendor the trigger speaks for: the bound account's adapter when there
  // is one, otherwise the agent's current adapter.
  const triggerType = selected?.adapterType ?? adapterType;
  const triggerLabel = selected
    ? `${getAdapterLabel(triggerType)} — ${accountTriggerText(selected)}`
    : getAdapterLabel(triggerType);

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
          title={selected ? `Account ${selected.handle}` : undefined}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-sm hover:bg-accent/50 transition-colors w-full justify-between"
        >
          <span className="inline-flex min-w-0 items-center gap-1.5">
            {triggerType === "opencode_local" ? <OpenCodeLogoIcon className="h-3.5 w-3.5" /> : null}
            <span className="truncate">{triggerLabel}</span>
            {getAdapterDisplay(triggerType).experimental && <ExperimentalBadge />}
          </span>
          <ChevronDown className="h-3 w-3 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) p-1" align="start">
        {vendors.map((vendor) => (
          <div key={vendor.type} className="py-1">
            <div className="flex items-center gap-1.5 px-2 py-1 text-(length:--text-nano) uppercase text-muted-foreground">
              {vendor.type === "opencode_local" ? <OpenCodeLogoIcon className="h-3.5 w-3.5" /> : null}
              <span>{vendor.label}</span>
              {vendor.experimental && <ExperimentalBadge />}
            </div>
            <button
              type="button"
              data-default-row={vendor.type}
              // Gated on `isSuccess`, never on `!isPending`: react-query reports
              // a failed query as `isPending === false` with `data` undefined,
              // so a `!isPending` gate would re-enable this row against an empty
              // account set — clearing nothing on exactly the path where a user
              // is most likely to retry, and leaving the previous vendor's home
              // bound while the UI claims the company default.
              disabled={vendor.comingSoon || !isSuccess}
              title={
                vendor.comingSoon
                  ? undefined
                  : isError
                    ? "Couldn't load this company's accounts, so switching back to the default cannot be done safely."
                    : isPending
                      ? "Loading this company's accounts…"
                      : undefined
              }
              className={cn(
                "flex w-full items-center justify-between rounded px-2 py-1.5 text-sm",
                isSuccess && !vendor.comingSoon
                  ? "hover:bg-muted/60"
                  : "cursor-not-allowed opacity-40",
                vendor.type === adapterType && selected === null && isSuccess && "bg-accent",
              )}
              onClick={() => {
                if (vendor.comingSoon || !isSuccess) return;
                choose({ adapterType: vendor.type, account: null, clearEnvKeys: allEnvKeys });
              }}
            >
              <span className="text-muted-foreground">Company default account</span>
              {vendor.comingSoon && (
                <span className="text-(length:--text-nano) text-muted-foreground">Coming soon</span>
              )}
            </button>
            {vendor.accounts.map((account) => {
              // A mismatched home holds a different account than the secret's
              // name claims, so binding it would run the agent as the wrong
              // account. `disabled` on a native button is what makes the row
              // unreachable by keyboard as well as by pointer — do not swap it
              // for `aria-disabled` plus a click guard.
              const unusable = account.status === "mismatch";
              // A coming-soon vendor is not selectable by any route, account
              // rows included.
              const blocked = unusable || vendor.comingSoon;
              return (
                <button
                  key={account.secretId}
                  type="button"
                  data-account-row={account.secretId}
                  disabled={blocked}
                  title={
                    unusable
                      ? "This account's home holds a different account's credentials, so it cannot be selected."
                      : `Account ${account.handle}`
                  }
                  className={cn(
                    "flex w-full items-center justify-between rounded px-2 py-1.5 text-sm",
                    blocked ? "cursor-not-allowed opacity-40" : "hover:bg-muted/60",
                    isBound(account) && !blocked && "bg-accent",
                  )}
                  onClick={() => {
                    if (blocked) return;
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
                      {NEEDS_LOGIN}
                    </span>
                  )}
                  {unusable && (
                    <span className="text-(length:--text-nano) text-muted-foreground">
                      {WRONG_ACCOUNT}
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
