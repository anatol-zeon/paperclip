import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

const mockAssertCompanyAccess = vi.hoisted(() => vi.fn());
vi.mock("../routes/authz.js", () => ({
  assertCompanyAccess: mockAssertCompanyAccess,
}));

const mockListAdapterAccounts = vi.hoisted(() => vi.fn());
vi.mock("../services/adapter-accounts.js", () => ({
  listAdapterAccounts: mockListAdapterAccounts,
}));

const { adapterAccountRoutes } = await import("../routes/adapter-accounts.js");

const ACCOUNT = {
  adapterType: "codex_local",
  handle: "acct-a",
  label: "xxx@gmail.com",
  secretId: "s-a",
  secretName: "CODEX_HOME_acct-a",
  envKey: "CODEX_HOME",
  status: "active" as const,
};

function app() {
  const server = express();
  server.use(express.json());
  server.use(adapterAccountRoutes({} as never));
  return server;
}

describe("GET /companies/:companyId/adapter-accounts", () => {
  it("returns the company's accounts", async () => {
    mockAssertCompanyAccess.mockResolvedValue(undefined);
    mockListAdapterAccounts.mockResolvedValue([ACCOUNT]);

    const res = await request(app()).get("/companies/company-1/adapter-accounts");

    expect(res.status).toBe(200);
    expect(res.body).toEqual([ACCOUNT]);
    expect(mockListAdapterAccounts).toHaveBeenCalledWith("company-1", expect.anything());
  });

  it("enforces company access before listing", async () => {
    mockAssertCompanyAccess.mockRejectedValue(
      Object.assign(new Error("forbidden"), { status: 403 }),
    );
    mockListAdapterAccounts.mockClear();

    const res = await request(app()).get("/companies/company-2/adapter-accounts");

    expect(res.status).toBe(403);
    expect(mockListAdapterAccounts).not.toHaveBeenCalled();
  });
});
