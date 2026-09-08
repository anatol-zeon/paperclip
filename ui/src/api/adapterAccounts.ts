/**
 * @fileoverview Frontend API client for the company's vendor account listing.
 */

import type { AdapterAccount } from "@paperclipai/shared";
import { api } from "./client";

export const adapterAccountsApi = {
  /**
   * List the company's vendor accounts.
   *
   * The server resolves every account's secret to answer, which writes an audit
   * event and bumps that secret's `lastResolvedAt`. Callers fetch on demand —
   * never on an interval — so those two records keep meaning what they say.
   */
  list: (companyId: string) =>
    api.get<AdapterAccount[]>(`/companies/${companyId}/adapter-accounts`),
};
