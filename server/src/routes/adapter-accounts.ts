import { Router } from "express";
import type { Db } from "@paperclipai/db";

import { listServerAdapters } from "../adapters/index.js";
import {
  listAdapterAccounts,
  type AdapterAccountBindingEntry,
} from "../services/adapter-accounts.js";
import { secretService } from "../services/secrets.js";
import { assertCompanyAccess } from "./authz.js";

/**
 * The company-scoped account listing. It is read-only: it names the company's
 * vendor accounts so the agent form can offer them, and it returns no credential
 * value and no home path — only the non-secret identity and the secret's id, so
 * the form can bind an agent to it through the normal secret-ref path.
 */
export function adapterAccountRoutes(db: Db) {
  const router = Router();

  router.get("/companies/:companyId/adapter-accounts", async (req, res, next) => {
    try {
      const companyId = req.params.companyId;
      // The access check runs before any listing work: nothing about the
      // company's secrets may be read — not even to be discarded — until the
      // caller is known to belong to it.
      await assertCompanyAccess(req, companyId);
      const svc = secretService(db);
      const accounts = await listAdapterAccounts(companyId, {
        listAdapterBindings: () =>
          listServerAdapters()
            .filter((adapter) => adapter.accountBinding != null)
            .map((adapter): AdapterAccountBindingEntry => ({
              adapterType: adapter.type,
              binding: adapter.accountBinding!,
            })),
        listSecrets: async (id) => {
          const secrets = await svc.list(id);
          return secrets.map((secret: { id: string; name: string }) => ({
            id: secret.id,
            name: secret.name,
          }));
        },
        resolveSecretValue: (id, secretId) =>
          svc.resolveSecretValueForAccountListing(id, secretId, {
            configPath: "adapter-accounts.list",
          }),
      });
      res.json(accounts);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
