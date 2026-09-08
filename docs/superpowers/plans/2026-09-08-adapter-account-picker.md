# Единый пикер «вендор + аккаунт» — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Заменить пару «выбор вендора сверху + ручная переменная окружения снизу» одним списком вида «codex — xxx@gmail.com», выбор строки в котором переключает агента на нужную учётку одним кликом.

**Architecture:** Адаптер декларирует необязательную capability `accountBinding` — имя переменной, префикс имени секрета и функцию чтения несекретной идентичности из каталога кредов. Сервер перечисляет секреты компании по этим префиксам и отдаёт плоский список учёток. UI показывает список и одним PATCH пишет `adapterType` вместе с биндингом `adapterConfig.env[envKey]` на секрет учётки. Путь исполнения ранов не меняется: пикер записывает ровно то поле, которое сегодня заполняется руками.

**Tech Stack:** TypeScript, pnpm-воркспейс, Express (server), React + TanStack Query (ui), Vitest, Drizzle.

---

## Область работы

Это **фаза 1** из спеки `docs/superpowers/specs/2026-09-08-adapter-account-picker-design.md`: только чтение списка и переключение. Результат — работающая и проверяемая функциональность сама по себе.

**Вендоры в этой фазе:** `codex_local` и `claude_local`. Формат идентичности у обоих проверен на живых данных.

**Вне области этой фазы** (отдельные планы):

- `grok_local` — у адаптера есть промоушен учёток, но формат идентификатора аккаунта в его файле кредов не подтверждён; включать наугад нельзя.
- Добавление и удаление учёток из интерфейса (фаза 2).
- Стейджинг дома учётки в sandbox для Claude (фаза 3). В sandbox-ланe явный `CLAUDE_CONFIG_DIR` с host-путём и сегодня игнорируется — `packages/adapters/claude-local/src/server/acp.ts:265`. Это существующее поведение, фаза 1 его не меняет и не чинит.
- Таблица метаданных с подписями. В фазе 1 подпись читается с диска и кэшируется в памяти процесса; отдельная таблица нужна только когда появятся удалённые дома и регистрация учёток, то есть в фазе 2.

## Структура файлов

Новые файлы:

- `packages/adapter-utils/src/account-binding.ts` — тип capability и валидатор.
- `packages/adapters/codex-local/src/server/account-identity.ts` — чтение идентичности учётки Codex.
- `packages/adapters/claude-local/src/server/account-identity.ts` — то же для Claude.
- `packages/shared/src/types/adapter-account.ts` — форма строки списка, общая для сервера и UI.
- `server/src/services/adapter-accounts.ts` — сборка списка из секретов компании.
- `server/src/routes/adapter-accounts.ts` — HTTP-роут.
- `ui/src/api/adapterAccounts.ts` — клиент.
- `ui/src/components/AdapterAccountDropdown.tsx` — компонент пикера.

Правки в существующих (намеренно точечные, чтобы форк дешево ребейзился):

- `packages/adapter-utils/src/types.ts` — одно необязательное поле в `ServerAdapterModule`.
- `packages/adapter-utils/src/index.ts` — реэкспорт.
- `packages/adapters/*/src/server/index.ts` — реэкспорт двух новых функций.
- `packages/shared/src/types/index.ts` — реэкспорт типа.
- `server/src/adapters/registry.ts` — по одному полю в двух объектах адаптеров.
- `server/src/services/secrets.ts` — одна узкоцелевая обёртка резолва.
- `server/src/routes/index.ts`, `server/src/app.ts` — монтирование роута.
- `server/src/routes/agents.ts:807` — снятие хардкода префикса.
- `ui/src/components/AgentConfigForm.tsx` — одна замена компонента и один обработчик.

---

### Task 1: Capability `accountBinding`

**Files:**
- Create: `packages/adapter-utils/src/account-binding.ts`
- Test: `packages/adapter-utils/src/account-binding.test.ts`
- Modify: `packages/adapter-utils/src/types.ts` (около строки 528, рядом с `loginCapability`)
- Modify: `packages/adapter-utils/src/index.ts`

- [ ] **Step 1: Написать падающий тест**

Создать `packages/adapter-utils/src/account-binding.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { isAdapterAccountBinding } from "./account-binding.js";

const valid = {
  envKey: "CODEX_HOME",
  secretPrefix: "CODEX_HOME_",
  readIdentity: async () => null,
};

describe("isAdapterAccountBinding", () => {
  it("accepts a complete binding", () => {
    expect(isAdapterAccountBinding(valid)).toBe(true);
  });

  it("rejects a blank env key", () => {
    expect(isAdapterAccountBinding({ ...valid, envKey: "   " })).toBe(false);
  });

  it("rejects a prefix that cannot separate the handle", () => {
    expect(isAdapterAccountBinding({ ...valid, secretPrefix: "CODEX_HOME" })).toBe(false);
  });

  it("rejects a non-function readIdentity", () => {
    expect(isAdapterAccountBinding({ ...valid, readIdentity: "nope" })).toBe(false);
  });

  it("rejects a non-object", () => {
    expect(isAdapterAccountBinding(null)).toBe(false);
  });
});
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `npx vitest run packages/adapter-utils/src/account-binding.test.ts`
Expected: FAIL — `Failed to resolve import "./account-binding.js"`.

- [ ] **Step 3: Написать минимальную реализацию**

Создать `packages/adapter-utils/src/account-binding.ts`:

```ts
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
  /** The vendor's stable account id. It names the account's home and secret. */
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
   * `<secretPrefix><handle>`, so the prefix must end with a separator, or the
   * handle cannot be read back out of the name.
   */
  secretPrefix: string;
  /**
   * Reads the non-secret identity out of a credential home. Returns null when
   * the directory holds no usable credential. Never returns token bytes.
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
  if (typeof candidate.envKey !== "string" || candidate.envKey.trim().length === 0) return false;
  if (typeof candidate.secretPrefix !== "string") return false;
  if (candidate.secretPrefix.trim().length === 0) return false;
  if (!candidate.secretPrefix.endsWith("_")) return false;
  if (typeof candidate.readIdentity !== "function") return false;
  return true;
}
```

- [ ] **Step 4: Запустить тест и убедиться, что он проходит**

Run: `npx vitest run packages/adapter-utils/src/account-binding.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Добавить поле в `ServerAdapterModule`**

В `packages/adapter-utils/src/types.ts` сразу после объявления `loginCapability` (строка 528), внутри того же интерфейса, перед закрывающей скобкой:

```ts
  /**
   * Optional: declare that one agent can select which of the company's login
   * accounts it runs as. The server uses it to list the company's accounts for
   * this adapter and to name each account's secret. An adapter with a single
   * shared credential home omits it. The capability data holds no secret.
   */
  accountBinding?: import("./account-binding.js").AdapterAccountBinding;
```

- [ ] **Step 6: Реэкспортировать из пакета**

В `packages/adapter-utils/src/index.ts` добавить:

```ts
export { isAdapterAccountBinding } from "./account-binding.js";
export type { AdapterAccountBinding, AdapterAccountIdentity } from "./account-binding.js";
```

- [ ] **Step 7: Проверить типы**

Run: `npx tsc -p packages/adapter-utils/tsconfig.json --noEmit`
Expected: без ошибок. Если у пакета нет своего tsconfig — `npx tsc -p tsconfig.json --noEmit`.

- [ ] **Step 8: Коммит**

```bash
git add packages/adapter-utils/src/account-binding.ts packages/adapter-utils/src/account-binding.test.ts packages/adapter-utils/src/types.ts packages/adapter-utils/src/index.ts
git commit -m "feat(adapter-utils): add the account-binding capability"
```

---

### Task 2: Идентичность учётки Codex

**Files:**
- Create: `packages/adapters/codex-local/src/server/account-identity.ts`
- Test: `packages/adapters/codex-local/src/server/account-identity.test.ts`
- Modify: `packages/adapters/codex-local/src/server/index.ts`

Переиспользуется существующий `readCodexAuthInfo(codexHome)` из `quota.ts:115` — он уже читает `auth.json`, достаёт `accountId` и разбирает email из JWT.

- [ ] **Step 1: Написать падающий тест**

Создать `packages/adapters/codex-local/src/server/account-identity.test.ts`:

```ts
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readCodexAccountIdentity } from "./account-identity.js";

// A minimal unsigned JWT: the parser reads only the base64url payload segment.
function jwt(payload: Record<string, unknown>): string {
  const body = Buffer.from(JSON.stringify(payload), "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `header.${body}.signature`;
}

describe("readCodexAccountIdentity", () => {
  let home: string;

  beforeEach(async () => {
    home = await mkdtemp(path.join(os.tmpdir(), "codex-identity-"));
  });

  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
  });

  it("returns null when the home holds no auth file", async () => {
    expect(await readCodexAccountIdentity(home)).toBeNull();
  });

  it("returns null when the auth file is unparsable", async () => {
    await writeFile(path.join(home, "auth.json"), "{ not json", "utf8");
    expect(await readCodexAccountIdentity(home)).toBeNull();
  });

  it("returns the account id with no label when the token carries no email", async () => {
    await writeFile(
      path.join(home, "auth.json"),
      JSON.stringify({
        tokens: {
          account_id: "acct-123",
          access_token: "access",
          id_token: jwt({ sub: "user" }),
          refresh_token: "refresh",
        },
      }),
      "utf8",
    );
    expect(await readCodexAccountIdentity(home)).toEqual({ handle: "acct-123", label: null });
  });

  it("returns the ChatGPT account email as the label", async () => {
    await writeFile(
      path.join(home, "auth.json"),
      JSON.stringify({
        tokens: {
          account_id: "acct-456",
          access_token: "access",
          id_token: jwt({
            "https://api.openai.com/auth": { chatgpt_user_email: "xxx@gmail.com" },
          }),
          refresh_token: "refresh",
        },
      }),
      "utf8",
    );
    expect(await readCodexAccountIdentity(home)).toEqual({
      handle: "acct-456",
      label: "xxx@gmail.com",
    });
  });

  it("returns null when the auth file carries no account id", async () => {
    await writeFile(
      path.join(home, "auth.json"),
      JSON.stringify({ tokens: { access_token: "access" } }),
      "utf8",
    );
    expect(await readCodexAccountIdentity(home)).toBeNull();
  });
});
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `npx vitest run packages/adapters/codex-local/src/server/account-identity.test.ts`
Expected: FAIL — `Failed to resolve import "./account-identity.js"`.

- [ ] **Step 3: Написать минимальную реализацию**

Создать `packages/adapters/codex-local/src/server/account-identity.ts`:

```ts
import type { AdapterAccountIdentity } from "@paperclipai/adapter-utils";
import { readCodexAuthInfo } from "./quota.js";

/**
 * Reads the non-secret identity of the Codex account whose credential home is
 * `homeDir`. The handle is the vendor account id that already names the
 * account's own home and its company secret; the label is the ChatGPT account
 * email when the token carries one.
 *
 * Returns null when the directory holds no usable subscription credential — a
 * missing or unparsable `auth.json`, or one with no account id. The function
 * returns no token bytes.
 */
export async function readCodexAccountIdentity(
  homeDir: string,
): Promise<AdapterAccountIdentity | null> {
  const info = await readCodexAuthInfo(homeDir);
  if (!info) return null;
  const handle = typeof info.accountId === "string" ? info.accountId.trim() : "";
  if (handle.length === 0) return null;
  const label = typeof info.email === "string" && info.email.trim().length > 0
    ? info.email.trim()
    : null;
  return { handle, label };
}
```

- [ ] **Step 4: Запустить тест и убедиться, что он проходит**

Run: `npx vitest run packages/adapters/codex-local/src/server/account-identity.test.ts`
Expected: PASS, 5 tests.

Если тест «returns the account id with no label» упадёт из-за того, что `readCodexAuthInfo` требует другого поля — открыть `packages/adapters/codex-local/src/server/quota.ts:115` и привести фикстуру к принимаемой форме файла. Реализацию при этом не менять.

- [ ] **Step 5: Реэкспортировать из серверного входа пакета**

В `packages/adapters/codex-local/src/server/index.ts` добавить строку:

```ts
export { readCodexAccountIdentity } from "./account-identity.js";
```

- [ ] **Step 6: Коммит**

```bash
git add packages/adapters/codex-local/src/server/account-identity.ts packages/adapters/codex-local/src/server/account-identity.test.ts packages/adapters/codex-local/src/server/index.ts
git commit -m "feat(codex-local): read the non-secret identity of an account home"
```

---

### Task 3: Идентичность учётки Claude

**Files:**
- Create: `packages/adapters/claude-local/src/server/account-identity.ts`
- Test: `packages/adapters/claude-local/src/server/account-identity.test.ts`
- Modify: `packages/adapters/claude-local/src/server/index.ts`

Идентичность лежит в `<homeDir>/.claude.json`, в блоке `oauthAccount`: `accountUuid` — стабильный ключ, `emailAddress` — подпись.

- [ ] **Step 1: Написать падающий тест**

Создать `packages/adapters/claude-local/src/server/account-identity.test.ts`:

```ts
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readClaudeAccountIdentity } from "./account-identity.js";

describe("readClaudeAccountIdentity", () => {
  let home: string;

  beforeEach(async () => {
    home = await mkdtemp(path.join(os.tmpdir(), "claude-identity-"));
  });

  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
  });

  it("returns null when the home holds no config file", async () => {
    expect(await readClaudeAccountIdentity(home)).toBeNull();
  });

  it("returns null when the config file is unparsable", async () => {
    await writeFile(path.join(home, ".claude.json"), "{ not json", "utf8");
    expect(await readClaudeAccountIdentity(home)).toBeNull();
  });

  it("returns null when the config carries no oauth account", async () => {
    await writeFile(path.join(home, ".claude.json"), JSON.stringify({ userID: "u1" }), "utf8");
    expect(await readClaudeAccountIdentity(home)).toBeNull();
  });

  it("returns the account uuid and the email address", async () => {
    await writeFile(
      path.join(home, ".claude.json"),
      JSON.stringify({
        oauthAccount: {
          accountUuid: "be84a247-2895-4416-bf5b-a410501b5d06",
          emailAddress: "zzz@gmail.com",
          organizationUuid: "96338dc3-ffb7-407e-850a-5ba6812d4fa6",
        },
      }),
      "utf8",
    );
    expect(await readClaudeAccountIdentity(home)).toEqual({
      handle: "be84a247-2895-4416-bf5b-a410501b5d06",
      label: "zzz@gmail.com",
    });
  });

  it("returns the account uuid with no label when the email is absent", async () => {
    await writeFile(
      path.join(home, ".claude.json"),
      JSON.stringify({ oauthAccount: { accountUuid: "uuid-only" } }),
      "utf8",
    );
    expect(await readClaudeAccountIdentity(home)).toEqual({ handle: "uuid-only", label: null });
  });
});
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `npx vitest run packages/adapters/claude-local/src/server/account-identity.test.ts`
Expected: FAIL — `Failed to resolve import "./account-identity.js"`.

- [ ] **Step 3: Написать минимальную реализацию**

Создать `packages/adapters/claude-local/src/server/account-identity.ts`:

```ts
import fs from "node:fs/promises";
import path from "node:path";
import type { AdapterAccountIdentity } from "@paperclipai/adapter-utils";

const CONFIG_FILE_NAME = ".claude.json";

function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/**
 * Reads the non-secret identity of the Claude account whose config home is
 * `homeDir`. The handle is the OAuth account uuid; the label is the account's
 * email address when the config carries one.
 *
 * Returns null when the directory holds no readable config, or when the config
 * names no OAuth account. The function reads no credential file and returns no
 * token bytes: `.claude.json` holds the account profile, while the tokens live
 * in a separate `.credentials.json` this function never opens.
 */
export async function readClaudeAccountIdentity(
  homeDir: string,
): Promise<AdapterAccountIdentity | null> {
  let raw: string;
  try {
    raw = await fs.readFile(path.join(homeDir, CONFIG_FILE_NAME), "utf8");
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  const account = (parsed as Record<string, unknown>).oauthAccount;
  if (typeof account !== "object" || account === null || Array.isArray(account)) return null;
  const record = account as Record<string, unknown>;
  const handle = readString(record, "accountUuid");
  if (!handle) return null;
  return { handle, label: readString(record, "emailAddress") };
}
```

- [ ] **Step 4: Запустить тест и убедиться, что он проходит**

Run: `npx vitest run packages/adapters/claude-local/src/server/account-identity.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Реэкспортировать из серверного входа пакета**

В `packages/adapters/claude-local/src/server/index.ts` добавить строку:

```ts
export { readClaudeAccountIdentity } from "./account-identity.js";
```

- [ ] **Step 6: Коммит**

```bash
git add packages/adapters/claude-local/src/server/account-identity.ts packages/adapters/claude-local/src/server/account-identity.test.ts packages/adapters/claude-local/src/server/index.ts
git commit -m "feat(claude-local): read the non-secret identity of a config home"
```

---

### Task 4: Объявить capability у двух адаптеров

**Files:**
- Modify: `server/src/adapters/registry.ts` (объект `claudeLocalAdapter` около строки 253, объект `codexLocalAdapter` около строки 328)
- Test: `server/src/adapters/account-binding-registration.test.ts`

- [ ] **Step 1: Написать падающий тест**

Создать `server/src/adapters/account-binding-registration.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { isAdapterAccountBinding } from "@paperclipai/adapter-utils";
import { getServerAdapter } from "./registry.js";

// The two adapters that carry per-account credential homes must declare the
// capability, and each must name the environment variable its own execute path
// already honors. A drift here silently empties the account list in the UI.
describe("account binding registration", () => {
  it("declares a valid binding for codex_local", () => {
    const binding = getServerAdapter("codex_local")?.accountBinding;
    expect(isAdapterAccountBinding(binding)).toBe(true);
    expect(binding?.envKey).toBe("CODEX_HOME");
    expect(binding?.secretPrefix).toBe("CODEX_HOME_");
  });

  it("declares a valid binding for claude_local", () => {
    const binding = getServerAdapter("claude_local")?.accountBinding;
    expect(isAdapterAccountBinding(binding)).toBe(true);
    expect(binding?.envKey).toBe("CLAUDE_CONFIG_DIR");
    expect(binding?.secretPrefix).toBe("CLAUDE_CONFIG_DIR_");
  });

  it("leaves an adapter with one shared credential home undeclared", () => {
    expect(getServerAdapter("gemini_local")?.accountBinding).toBeUndefined();
  });
});
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `npx vitest run server/src/adapters/account-binding-registration.test.ts`
Expected: FAIL — `expected false to be true` (capability ещё не объявлена).

- [ ] **Step 3: Объявить capability**

В `server/src/adapters/registry.ts` в блок импортов из `@paperclipai/adapter-claude-local/server` добавить `readClaudeAccountIdentity`, в блок импортов из `@paperclipai/adapter-codex-local/server` — `readCodexAccountIdentity`.

В объект `claudeLocalAdapter`, последней строкой перед закрывающей скобкой (после `loginCapability: claudeLoginCapability,`):

```ts
  accountBinding: {
    envKey: "CLAUDE_CONFIG_DIR",
    secretPrefix: "CLAUDE_CONFIG_DIR_",
    readIdentity: readClaudeAccountIdentity,
  },
```

В объект `codexLocalAdapter`, тем же местом (после `loginCapability: codexLoginCapability,`):

```ts
  accountBinding: {
    envKey: "CODEX_HOME",
    secretPrefix: "CODEX_HOME_",
    readIdentity: readCodexAccountIdentity,
  },
```

- [ ] **Step 4: Запустить тест и убедиться, что он проходит**

Run: `npx vitest run server/src/adapters/account-binding-registration.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Прогнать существующие тесты реестра**

Run: `npx vitest run server/src/adapters/registry.test.ts`
Expected: PASS, без новых падений.

- [ ] **Step 6: Коммит**

```bash
git add server/src/adapters/registry.ts server/src/adapters/account-binding-registration.test.ts
git commit -m "feat(adapters): declare the account binding for codex and claude"
```

---

### Task 5: Общий тип строки списка

**Files:**
- Create: `packages/shared/src/types/adapter-account.ts`
- Modify: `packages/shared/src/types/index.ts`

Тип без поведения, поэтому отдельного теста нет — его покрывают тесты сервиса и роута, которые им типизированы.

- [ ] **Step 1: Создать тип**

Создать `packages/shared/src/types/adapter-account.ts`:

```ts
/**
 * The state of one listed account.
 *
 * - `active`: the account's home holds a readable credential whose identity
 *   matches the handle in the secret's name.
 * - `unavailable`: the home is missing or holds no readable credential. The row
 *   is still listed, so a user can see the account exists and needs a login.
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
  /** The display label, normally an email. Null when it could not be read. */
  label: string | null;
  /** The company secret that carries the path to this account's home. */
  secretId: string;
  /** That secret's name, e.g. `CODEX_HOME_<handle>`. */
  secretName: string;
  /** The environment variable an agent sets to select this account. */
  envKey: string;
  status: AdapterAccountStatus;
}
```

- [ ] **Step 2: Реэкспортировать**

В `packages/shared/src/types/index.ts` добавить:

```ts
export type { AdapterAccount, AdapterAccountStatus } from "./adapter-account.js";
```

- [ ] **Step 3: Проверить типы**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: без ошибок.

- [ ] **Step 4: Коммит**

```bash
git add packages/shared/src/types/adapter-account.ts packages/shared/src/types/index.ts
git commit -m "feat(shared): add the adapter account row type"
```

---

### Task 6: Узкоцелевой резолв секрета для списка

**Files:**
- Modify: `server/src/services/secrets.ts` (константа рядом со строкой 98, функция рядом со строкой 1543, экспорт рядом со строкой 4502)

Сервису нужен путь к дому, а он лежит в значении секрета. Резолв значения — операция с аудитом, поэтому она делается отдельной обёрткой с собственным consumer id, ровно как это уже сделано для проверки device-login.

- [ ] **Step 1: Написать падающий тест**

Дописать в конец `server/src/__tests__/secrets-service.test.ts` новый блок:

```ts
describe("resolveSecretValueForAccountListing", () => {
  it("is exposed by the service", async () => {
    const { secretService } = await import("../services/secrets.js");
    const svc = secretService({} as never);
    expect(typeof svc.resolveSecretValueForAccountListing).toBe("function");
  });
});
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `npx vitest run server/src/__tests__/secrets-service.test.ts -t "is exposed by the service"`
Expected: FAIL — `expected "undefined" to be "function"`.

- [ ] **Step 3: Добавить константу**

В `server/src/services/secrets.ts` сразу после строки 98:

```ts
export const ACCOUNT_LISTING_SECRET_CONSUMER_ID = "adapter-account-listing";
```

- [ ] **Step 4: Добавить функцию**

В том же файле сразу после `resolveSecretValueForDeviceLoginCheck` (её тело заканчивается около строки 1559):

```ts
  /**
   * Resolves an account-home secret's value for the read-only account listing.
   * The listing needs the home path to read the account's non-secret identity
   * (its id and email); it reads no credential file itself.
   *
   * This is a separate, narrowly scoped entry point rather than a call to the
   * general resolve, so the access event names this consumer and an audit can
   * tell a listing read apart from a run's credential read.
   */
  async function resolveSecretValueForAccountListing(
    companyId: string,
    secretId: string,
    context: { configPath: string },
  ): Promise<string> {
    return (
      await resolveSecretValueInternal(companyId, secretId, "latest", {
        accessContext: {
          consumerType: "system",
          consumerId: ACCOUNT_LISTING_SECRET_CONSUMER_ID,
          actorType: "system",
          actorId: null,
          configPath: context.configPath,
        },
      })
    ).value;
  }
```

- [ ] **Step 5: Экспортировать из сервиса**

В возвращаемом объекте `secretService`, сразу после `resolveSecretValueForDeviceLoginCheck,` (строка 4502):

```ts
    resolveSecretValueForAccountListing,
```

- [ ] **Step 6: Запустить тест и убедиться, что он проходит**

Run: `npx vitest run server/src/__tests__/secrets-service.test.ts`
Expected: PASS, включая все ранее существовавшие тесты файла.

- [ ] **Step 7: Коммит**

```bash
git add server/src/services/secrets.ts server/src/__tests__/secrets-service.test.ts
git commit -m "feat(secrets): add a scoped resolve for the account listing"
```

---

### Task 7: Сервис сборки списка

**Files:**
- Create: `server/src/services/adapter-accounts.ts`
- Test: `server/src/services/adapter-accounts.test.ts`

- [ ] **Step 1: Написать падающий тест**

Создать `server/src/services/adapter-accounts.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { listAdapterAccounts } from "./adapter-accounts.js";

const CODEX_BINDING = {
  envKey: "CODEX_HOME",
  secretPrefix: "CODEX_HOME_",
  readIdentity: async (homeDir: string) =>
    homeDir === "/homes/a"
      ? { handle: "acct-a", label: "xxx@gmail.com" }
      : homeDir === "/homes/b"
        ? { handle: "acct-b", label: "yyy@gmail.com" }
        : homeDir === "/homes/wrong"
          ? { handle: "someone-else", label: "zzz@gmail.com" }
          : null,
};

function deps(input: {
  secrets: { id: string; name: string }[];
  values: Record<string, string>;
}) {
  return {
    listAdapterBindings: () => [{ adapterType: "codex_local", binding: CODEX_BINDING }],
    listSecrets: async () => input.secrets,
    resolveSecretValue: async (_companyId: string, secretId: string) => {
      const value = input.values[secretId];
      if (value === undefined) throw new Error("resolve failed");
      return value;
    },
  };
}

describe("listAdapterAccounts", () => {
  it("returns one active row per account secret", async () => {
    const rows = await listAdapterAccounts(
      "company-1",
      deps({
        secrets: [
          { id: "s-a", name: "CODEX_HOME_acct-a" },
          { id: "s-b", name: "CODEX_HOME_acct-b" },
        ],
        values: { "s-a": "/homes/a", "s-b": "/homes/b" },
      }),
    );
    expect(rows).toEqual([
      {
        adapterType: "codex_local",
        handle: "acct-a",
        label: "xxx@gmail.com",
        secretId: "s-a",
        secretName: "CODEX_HOME_acct-a",
        envKey: "CODEX_HOME",
        status: "active",
      },
      {
        adapterType: "codex_local",
        handle: "acct-b",
        label: "yyy@gmail.com",
        secretId: "s-b",
        secretName: "CODEX_HOME_acct-b",
        envKey: "CODEX_HOME",
        status: "active",
      },
    ]);
  });

  it("ignores a secret whose name does not carry the prefix", async () => {
    const rows = await listAdapterAccounts(
      "company-1",
      deps({
        secrets: [{ id: "s-x", name: "OPENAI_API_KEY" }],
        values: { "s-x": "sk-whatever" },
      }),
    );
    expect(rows).toEqual([]);
  });

  it("lists an account whose home cannot be read as unavailable", async () => {
    const rows = await listAdapterAccounts(
      "company-1",
      deps({
        secrets: [{ id: "s-gone", name: "CODEX_HOME_acct-gone" }],
        values: { "s-gone": "/homes/missing" },
      }),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ handle: "acct-gone", label: null, status: "unavailable" });
  });

  it("lists an account as unavailable when its secret fails to resolve", async () => {
    const rows = await listAdapterAccounts(
      "company-1",
      deps({ secrets: [{ id: "s-bad", name: "CODEX_HOME_acct-bad" }], values: {} }),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ handle: "acct-bad", label: null, status: "unavailable" });
  });

  it("flags a home that holds a different account as a mismatch", async () => {
    const rows = await listAdapterAccounts(
      "company-1",
      deps({
        secrets: [{ id: "s-w", name: "CODEX_HOME_acct-a" }],
        values: { "s-w": "/homes/wrong" },
      }),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ handle: "acct-a", label: null, status: "mismatch" });
  });

  it("skips a secret whose name carries the prefix and nothing else", async () => {
    const rows = await listAdapterAccounts(
      "company-1",
      deps({ secrets: [{ id: "s-e", name: "CODEX_HOME_" }], values: { "s-e": "/homes/a" } }),
    );
    expect(rows).toEqual([]);
  });

  it("never lets one adapter's failure hide another's accounts", async () => {
    const failing = {
      envKey: "BOOM_HOME",
      secretPrefix: "BOOM_HOME_",
      readIdentity: async () => {
        throw new Error("adapter blew up");
      },
    };
    const rows = await listAdapterAccounts("company-1", {
      listAdapterBindings: () => [
        { adapterType: "boom_local", binding: failing },
        { adapterType: "codex_local", binding: CODEX_BINDING },
      ],
      listSecrets: async () => [
        { id: "s-boom", name: "BOOM_HOME_x" },
        { id: "s-a", name: "CODEX_HOME_acct-a" },
      ],
      resolveSecretValue: async (_c: string, id: string) =>
        id === "s-a" ? "/homes/a" : "/homes/boom",
    });
    expect(rows.map((row) => row.handle)).toEqual(["x", "acct-a"]);
    expect(rows[0]).toMatchObject({ status: "unavailable" });
    expect(rows[1]).toMatchObject({ status: "active" });
  });
});
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `npx vitest run server/src/services/adapter-accounts.test.ts`
Expected: FAIL — `Failed to resolve import "./adapter-accounts.js"`.

- [ ] **Step 3: Написать минимальную реализацию**

Создать `server/src/services/adapter-accounts.ts`:

```ts
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
```

- [ ] **Step 4: Запустить тест и убедиться, что он проходит**

Run: `npx vitest run server/src/services/adapter-accounts.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Коммит**

```bash
git add server/src/services/adapter-accounts.ts server/src/services/adapter-accounts.test.ts
git commit -m "feat(server): list the company's vendor accounts"
```

---

### Task 8: HTTP-роут

**Files:**
- Create: `server/src/routes/adapter-accounts.ts`
- Test: `server/src/__tests__/adapter-accounts-routes.test.ts`
- Modify: `server/src/routes/index.ts`
- Modify: `server/src/app.ts` (рядом со строкой 540, где монтируется `secretRoutes`)

- [ ] **Step 1: Написать падающий тест**

Создать `server/src/__tests__/adapter-accounts-routes.test.ts`:

```ts
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
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `npx vitest run server/src/__tests__/adapter-accounts-routes.test.ts`
Expected: FAIL — `Cannot find module '../routes/adapter-accounts.js'`.

- [ ] **Step 3: Написать минимальную реализацию**

Создать `server/src/routes/adapter-accounts.ts`:

```ts
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
```

- [ ] **Step 4: Запустить тест и убедиться, что он проходит**

Run: `npx vitest run server/src/__tests__/adapter-accounts-routes.test.ts`
Expected: PASS, 2 tests.

Если `assertCompanyAccess` в этом репозитории имеет другую сигнатуру — открыть `server/src/routes/authz.ts`, взять фактическую и привести к ней и вызов, и мок в тесте.

- [ ] **Step 5: Смонтировать роут**

В `server/src/routes/index.ts` добавить:

```ts
export { adapterAccountRoutes } from "./adapter-accounts.js";
```

В `server/src/app.ts` рядом с импортом `secretRoutes` (строка 57) добавить:

```ts
import { adapterAccountRoutes } from "./routes/adapter-accounts.js";
```

и рядом со строкой 540, сразу после `api.use(secretRoutes(db));`:

```ts
  api.use(adapterAccountRoutes(db));
```

- [ ] **Step 6: Проверить типы**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: без ошибок.

- [ ] **Step 7: Коммит**

```bash
git add server/src/routes/adapter-accounts.ts server/src/__tests__/adapter-accounts-routes.test.ts server/src/routes/index.ts server/src/app.ts
git commit -m "feat(server): expose the company adapter-account listing"
```

---

### Task 9: Клиент в UI

**Files:**
- Create: `ui/src/api/adapterAccounts.ts`

Тонкая обёртка над общим `api`-клиентом, поведения своего нет — покрывается тестом компонента в Task 10.

- [ ] **Step 1: Создать клиент**

Создать `ui/src/api/adapterAccounts.ts`:

```ts
/**
 * @fileoverview Frontend API client for the company's vendor account listing.
 */

import type { AdapterAccount } from "@paperclipai/shared";
import { api } from "./client";

export const adapterAccountsApi = {
  list: (companyId: string): Promise<AdapterAccount[]> =>
    api.get(`/companies/${companyId}/adapter-accounts`),
};
```

- [ ] **Step 2: Сверить форму вызова с соседним клиентом**

Открыть `ui/src/api/adapters.ts` и убедиться, что метод `api.get` вызывается так же (тот же способ передачи пути и разбора ответа). При расхождении — привести к тому, что уже используется в файле-соседе.

- [ ] **Step 3: Проверить типы**

Run: `npx tsc -p ui/tsconfig.json --noEmit`
Expected: без ошибок.

- [ ] **Step 4: Коммит**

```bash
git add ui/src/api/adapterAccounts.ts
git commit -m "feat(ui): add the adapter-account api client"
```

---

### Task 10: Компонент пикера

**Files:**
- Create: `ui/src/components/AdapterAccountDropdown.tsx`
- Test: `ui/src/components/AdapterAccountDropdown.test.tsx`

Компонент показывает под каждым вендором его учётки. Он не заменяет `AdapterTypeDropdown` — он его использует, поэтому второй потребитель, `ConfigureBuiltInAgentModal`, остаётся нетронутым.

- [ ] **Step 1: Написать падающий тест**

Создать `ui/src/components/AdapterAccountDropdown.test.tsx`:

```tsx
// @vitest-environment jsdom

import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdapterAccountDropdown } from "./AdapterAccountDropdown";

const mockAdapterAccountsApi = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock("../api/adapterAccounts", () => ({ adapterAccountsApi: mockAdapterAccountsApi }));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

async function act(callback: () => void | Promise<void>) {
  await callback();
  await Promise.resolve();
  await new Promise((resolve) => window.setTimeout(resolve, 0));
}

async function flushReact() {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
}

const CODEX_A = {
  adapterType: "codex_local",
  handle: "acct-a",
  label: "xxx@gmail.com",
  secretId: "s-a",
  secretName: "CODEX_HOME_acct-a",
  envKey: "CODEX_HOME",
  status: "active" as const,
};

const CODEX_B = { ...CODEX_A, handle: "acct-b", label: "yyy@gmail.com", secretId: "s-b" };

const CLAUDE_C = {
  adapterType: "claude_local",
  handle: "acct-c",
  label: "zzz@gmail.com",
  secretId: "s-c",
  secretName: "CLAUDE_CONFIG_DIR_acct-c",
  envKey: "CLAUDE_CONFIG_DIR",
  status: "active" as const,
};

const MISMATCHED = { ...CODEX_A, handle: "acct-x", label: null, secretId: "s-x", status: "mismatch" as const };

describe("AdapterAccountDropdown", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    mockAdapterAccountsApi.list.mockResolvedValue([CODEX_A, CODEX_B, CLAUDE_C]);
  });

  afterEach(() => {
    container.remove();
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  async function render(props: Partial<Parameters<typeof AdapterAccountDropdown>[0]> = {}) {
    const onSelect = vi.fn();
    const root = createRoot(container);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <AdapterAccountDropdown
            companyId="company-1"
            adapterType="codex_local"
            envBindings={{}}
            disabledTypes={new Set()}
            onSelect={onSelect}
            {...props}
          />
        </QueryClientProvider>,
      );
    });
    await flushReact();
    return { onSelect, root };
  }

  function accountButtons() {
    return Array.from(document.querySelectorAll<HTMLButtonElement>("[data-account-row]"));
  }

  it("lists every account with its email under its vendor", async () => {
    await render();
    const labels = accountButtons().map((button) => button.textContent);
    expect(labels.some((text) => text?.includes("xxx@gmail.com"))).toBe(true);
    expect(labels.some((text) => text?.includes("yyy@gmail.com"))).toBe(true);
    expect(labels.some((text) => text?.includes("zzz@gmail.com"))).toBe(true);
  });

  it("emits the adapter type, the account and the env keys to clear", async () => {
    const { onSelect } = await render();
    const row = accountButtons().find((button) => button.textContent?.includes("zzz@gmail.com"));
    await act(async () => row?.click());

    expect(onSelect).toHaveBeenCalledWith({
      adapterType: "claude_local",
      account: CLAUDE_C,
      clearEnvKeys: ["CODEX_HOME"],
    });
  });

  it("clears every account env key when the company default is chosen", async () => {
    const { onSelect } = await render();
    const row = Array.from(
      document.querySelectorAll<HTMLButtonElement>("[data-default-row='codex_local']"),
    )[0];
    await act(async () => row?.click());

    expect(onSelect).toHaveBeenCalledWith({
      adapterType: "codex_local",
      account: null,
      clearEnvKeys: ["CODEX_HOME", "CLAUDE_CONFIG_DIR"],
    });
  });

  it("does not offer a mismatched account for selection", async () => {
    mockAdapterAccountsApi.list.mockResolvedValue([MISMATCHED]);
    const { onSelect } = await render();
    const row = accountButtons().find((button) => button.textContent?.includes("acct-x"));
    expect(row?.disabled).toBe(true);
    await act(async () => row?.click());
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("falls back to the handle when an account has no label", async () => {
    mockAdapterAccountsApi.list.mockResolvedValue([{ ...CODEX_A, label: null }]);
    await render();
    expect(accountButtons()[0]?.textContent).toContain("acct-a");
  });

  it("marks the account the agent's own variable references, not any other secret", async () => {
    await render({
      envBindings: {
        // An unrelated secret binding must never read as an account selection.
        OPENAI_API_KEY: { type: "secret_ref", secretId: "s-b" },
        CODEX_HOME: { type: "secret_ref", secretId: "s-a" },
      },
    });
    const selected = accountButtons().filter((button) =>
      button.className.includes("bg-accent"),
    );
    expect(selected).toHaveLength(1);
    expect(selected[0]?.textContent).toContain("xxx@gmail.com");
  });
});
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `npx vitest run ui/src/components/AdapterAccountDropdown.test.tsx`
Expected: FAIL — `Failed to resolve import "./AdapterAccountDropdown"`.

- [ ] **Step 3: Написать минимальную реализацию**

Создать `ui/src/components/AdapterAccountDropdown.tsx`:

```tsx
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react";
import type { AdapterAccount, EnvBinding } from "@paperclipai/shared";
import { adapterAccountsApi } from "../api/adapterAccounts";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { getAdapterLabel } from "@/adapters";

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

  // An account counts as selected only when the agent's variable FOR THAT
  // ACCOUNT'S key references that account's own secret. Matching on the secret
  // id alone would light up an account whenever any unrelated variable happened
  // to reference the same secret.
  const selected =
    visible.find((account) => {
      const binding = envBindings[account.envKey];
      return (
        typeof binding === "object" &&
        binding !== null &&
        "type" in binding &&
        binding.type === "secret_ref" &&
        binding.secretId === account.secretId
      );
    }) ?? null;

  const triggerLabel = selected
    ? `${getAdapterLabel(selected.adapterType)} — ${selected.label ?? selected.handle}`
    : getAdapterLabel(adapterType);

  function choose(selection: AdapterAccountSelection) {
    onSelect(selection);
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-sm hover:bg-accent/50 transition-colors w-full justify-between">
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
              data-default-row={type}
              className={cn(
                "flex w-full items-center justify-between rounded px-2 py-1.5 text-sm hover:bg-accent/50",
                type === adapterType && selected === null && "bg-accent",
              )}
              onClick={() =>
                choose({ adapterType: type, account: null, clearEnvKeys: allEnvKeys })
              }
            >
              <span className="text-muted-foreground">Учётка компании по умолчанию</span>
            </button>
            {rows.map((account) => {
              const unusable = account.status === "mismatch";
              return (
                <button
                  key={account.secretId}
                  data-account-row={account.secretId}
                  disabled={unusable}
                  title={
                    unusable
                      ? "Каталог этой учётки содержит креды другого аккаунта"
                      : undefined
                  }
                  className={cn(
                    "flex w-full items-center justify-between rounded px-2 py-1.5 text-sm",
                    unusable ? "cursor-not-allowed opacity-40" : "hover:bg-accent/50",
                    account === selected && !unusable && "bg-accent",
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
```

- [ ] **Step 4: Запустить тест и убедиться, что он проходит**

Run: `npx vitest run ui/src/components/AdapterAccountDropdown.test.tsx`
Expected: PASS, 6 tests.

Тест открывает поповер не кликом, а полагается на то, что содержимое отрендерено. Если Radix монтирует содержимое только в открытом состоянии, добавить в тест перед чтением строк:

```tsx
await act(async () => {
  container.querySelector<HTMLButtonElement>("button")?.click();
});
await flushReact();
```

- [ ] **Step 5: Сверить импорт `getAdapterLabel`**

Открыть `ui/src/components/AgentConfigForm.tsx` и найти, откуда импортируется `getAdapterLabel` (он используется в `AdapterTypeDropdown`, строка 3253). Привести импорт в новом файле к тому же пути.

- [ ] **Step 6: Коммит**

```bash
git add ui/src/components/AdapterAccountDropdown.tsx ui/src/components/AdapterAccountDropdown.test.tsx
git commit -m "feat(ui): add the vendor-and-account picker"
```

---

### Task 11: Встроить пикер в форму агента

**Files:**
- Modify: `ui/src/components/AgentConfigForm.tsx` (обработчик рядом со строкой 590, замена компонента на строке 1379)
- Test: `ui/src/components/AgentConfigForm.account-picker.test.tsx`

Обработчик пишется по образцу уже существующего `handleClaudeLoginStoredEdit` (строка ~552) — он ровно так же ставит один env-биндинг в обоих режимах формы.

- [ ] **Step 1: Написать падающий тест**

Создать `ui/src/components/AgentConfigForm.account-picker.test.tsx`:

```tsx
// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { buildAccountEnvUpdate } from "./AgentConfigForm";

const CODEX_A = {
  adapterType: "codex_local",
  handle: "acct-a",
  label: "xxx@gmail.com",
  secretId: "s-a",
  secretName: "CODEX_HOME_acct-a",
  envKey: "CODEX_HOME",
  status: "active" as const,
};

describe("buildAccountEnvUpdate", () => {
  it("binds the chosen account and keeps every unrelated variable", () => {
    const next = buildAccountEnvUpdate(
      { HTTP_PROXY: "http://proxy", CODEX_HOME: "/old/path" },
      { adapterType: "codex_local", account: CODEX_A, clearEnvKeys: ["CLAUDE_CONFIG_DIR"] },
    );
    expect(next).toEqual({
      HTTP_PROXY: "http://proxy",
      CODEX_HOME: { type: "secret_ref", secretId: "s-a" },
    });
  });

  it("drops the previous vendor's account variable", () => {
    const next = buildAccountEnvUpdate(
      { CLAUDE_CONFIG_DIR: { type: "secret_ref", secretId: "s-c" } },
      { adapterType: "codex_local", account: CODEX_A, clearEnvKeys: ["CLAUDE_CONFIG_DIR"] },
    );
    expect(next).toEqual({ CODEX_HOME: { type: "secret_ref", secretId: "s-a" } });
  });

  it("clears every account variable for the company default", () => {
    const next = buildAccountEnvUpdate(
      { CODEX_HOME: { type: "secret_ref", secretId: "s-a" }, HTTP_PROXY: "http://proxy" },
      {
        adapterType: "codex_local",
        account: null,
        clearEnvKeys: ["CODEX_HOME", "CLAUDE_CONFIG_DIR"],
      },
    );
    expect(next).toEqual({ HTTP_PROXY: "http://proxy" });
  });
});
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `npx vitest run ui/src/components/AgentConfigForm.account-picker.test.tsx`
Expected: FAIL — `buildAccountEnvUpdate is not a function`.

- [ ] **Step 3: Добавить чистую функцию сборки env**

В `ui/src/components/AgentConfigForm.tsx`, рядом с другими экспортируемыми хелперами верхнего уровня (около `supportsAdapterModelRefresh`, строка 158):

```tsx
/**
 * Applies one picker selection to an agent's environment. Pure, so the rule —
 * bind the chosen account, drop every other vendor's account variable, keep
 * everything unrelated — is testable without rendering the form.
 */
export function buildAccountEnvUpdate(
  currentEnv: Record<string, EnvBinding>,
  selection: AdapterAccountSelection,
): Record<string, EnvBinding> {
  const next: Record<string, EnvBinding> = { ...currentEnv };
  for (const key of selection.clearEnvKeys) delete next[key];
  if (selection.account) {
    next[selection.account.envKey] = {
      type: "secret_ref",
      secretId: selection.account.secretId,
    };
  }
  return next;
}
```

Добавить импорт типа в шапку файла:

```tsx
import {
  AdapterAccountDropdown,
  type AdapterAccountSelection,
} from "./AdapterAccountDropdown";
```

- [ ] **Step 4: Запустить тест и убедиться, что он проходит**

Run: `npx vitest run ui/src/components/AgentConfigForm.account-picker.test.tsx`
Expected: PASS, 3 tests.

- [ ] **Step 5: Подключить обработчик**

В `ui/src/components/AgentConfigForm.tsx` сразу после `handleApplyStoredClaudeLoginEdit` (около строки 600) добавить:

```tsx
  // The picker's single write. It sets the adapter type and the account binding
  // together, so an agent is never persisted with one vendor's adapter and
  // another vendor's credential home. Create mode writes into the draft; edit
  // mode flushes any pending editor draft first, so a hand-typed variable is not
  // lost, then marks the merged set into the overlay for the normal save path.
  const handleAccountSelect = (selection: AdapterAccountSelection) => {
    if (isCreate) {
      if (!set) return;
      const existing = (val!.envBindings ?? {}) as Record<string, EnvBinding>;
      set({
        adapterType: selection.adapterType,
        envBindings: buildAccountEnvUpdate(existing, selection),
      });
      return;
    }
    const flushedEnv = flushEnvironmentDraft();
    const baseEnv =
      flushedEnv ??
      (eff("adapterConfig", "env", (config.env ?? EMPTY_ENV) as Record<string, EnvBinding>));
    mark("adapterConfig", "env", buildAccountEnvUpdate(baseEnv, selection));
    mark("agent", "adapterType", selection.adapterType);
  };
```

- [ ] **Step 6: Заменить компонент**

В `ui/src/components/AgentConfigForm.tsx` строка 1379: заменить элемент `<AdapterTypeDropdown ... />` внутри `<Field label="Adapter type" ...>` на:

```tsx
              <AdapterAccountDropdown
                companyId={selectedCompanyId ?? null}
                adapterType={adapterType}
                envBindings={
                  eff(
                    "adapterConfig",
                    "env",
                    (config.env ?? EMPTY_ENV) as Record<string, EnvBinding>,
                  )
                }
                disabledTypes={adapterPickerDisabledTypes}
                onSelect={handleAccountSelect}
              />
```

Существующий обработчик `onChange` со сбросом полей при смене вендора не удалять: вынести его тело в функцию `resetAdapterDefaults(t: string)` рядом и вызывать её первой строкой `handleAccountSelect`, чтобы смена вендора через пикер сбрасывала те же поля, что и раньше.

Форма отдаёт компоненту весь текущий env и не вычисляет выбранную учётку сама: какой биндинг считается выбором, знает только список учёток, а он есть в компоненте.

- [ ] **Step 7: Прогнать тесты формы**

Run: `npx vitest run ui/src/components/AgentConfigForm.account-picker.test.tsx ui/src/components/OnboardingWizard.adapters.test.tsx ui/src/components/OnboardingWizard.test.tsx`
Expected: PASS. Любое падение здесь — регресс встраивания, а не новой функциональности: чинить встраивание, не трогая тесты.

- [ ] **Step 8: Коммит**

```bash
git add ui/src/components/AgentConfigForm.tsx ui/src/components/AgentConfigForm.account-picker.test.tsx
git commit -m "feat(ui): switch the agent form to the vendor-and-account picker"
```

---

### Task 12: Снять хардкод префикса секрета

**Files:**
- Modify: `server/src/routes/agents.ts:807`
- Test: `server/src/__tests__/agent-device-login-routes.test.ts`

Сейчас имя секрета собирается литералом `CODEX_HOME_${handle}`, из-за чего логин любого другого вендора не заведёт учётку под своим префиксом. Имя должно браться из capability адаптера, для которого идёт логин.

- [ ] **Step 1: Написать падающий тест**

Дописать в `server/src/__tests__/agent-device-login-routes.test.ts` новый тест внутри существующего describe-блока про промоушен:

```ts
  it("names the account secret from the adapter's declared prefix", async () => {
    const { accountSecretName } = await import("../routes/agents.js");
    expect(accountSecretName("codex_local", "acct-a")).toBe("CODEX_HOME_acct-a");
    expect(accountSecretName("claude_local", "acct-c")).toBe("CLAUDE_CONFIG_DIR_acct-c");
  });

  it("refuses to name a secret for an adapter with no account binding", async () => {
    const { accountSecretName } = await import("../routes/agents.js");
    expect(() => accountSecretName("gemini_local", "acct-g")).toThrow();
  });
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `npx vitest run server/src/__tests__/agent-device-login-routes.test.ts -t "names the account secret"`
Expected: FAIL — `accountSecretName is not a function`.

- [ ] **Step 3: Написать реализацию**

В `server/src/routes/agents.ts` рядом с другими хелперами верхнего уровня файла добавить:

```ts
/**
 * The company-secret name for one account home. The prefix comes from the
 * adapter's declared account binding, not from a literal, so a login for any
 * adapter that carries per-account homes names its secret under its own prefix.
 * Throws for an adapter that declares no binding: naming a secret for it would
 * create one no run can ever read.
 */
export function accountSecretName(adapterType: string, handle: string): string {
  const binding = getServerAdapter(adapterType)?.accountBinding;
  if (!binding) {
    throw new Error(`adapter ${adapterType} declares no account binding`);
  }
  return `${binding.secretPrefix}${handle}`;
}
```

Убедиться, что `getServerAdapter` уже импортирован в файле; если нет — добавить `import { getServerAdapter } from "../adapters/index.js";`.

Строку 807 заменить на:

```ts
            const secretName = accountSecretName(context.adapterType, handle);
```

- [ ] **Step 4: Запустить тест и убедиться, что он проходит**

Run: `npx vitest run server/src/__tests__/agent-device-login-routes.test.ts`
Expected: PASS, включая все ранее существовавшие тесты файла.

- [ ] **Step 5: Коммит**

```bash
git add server/src/routes/agents.ts server/src/__tests__/agent-device-login-routes.test.ts
git commit -m "refactor(agents): name the account secret from the adapter binding"
```

---

### Task 13: Регрессионный прогон

**Files:** нет (только запуск)

- [ ] **Step 1: Прогнать auth-тесты обоих адаптеров**

Run: `npx vitest run packages/adapters/codex-local/src/server packages/adapters/claude-local/src/server`
Expected: PASS. Это сетка на путь кредов — именно то, что план не должен был задеть.

- [ ] **Step 2: Прогнать серверные тесты секретов и логина**

Run: `npx vitest run server/src/__tests__/secrets-service.test.ts server/src/__tests__/agent-device-login-routes.test.ts server/src/__tests__/adapter-accounts-routes.test.ts server/src/services/adapter-accounts.test.ts`
Expected: PASS.

- [ ] **Step 3: Прогнать UI-тесты формы**

Run: `npx vitest run ui/src/components/AdapterAccountDropdown.test.tsx ui/src/components/AgentConfigForm.account-picker.test.tsx ui/src/components/OnboardingWizard.adapters.test.tsx`
Expected: PASS.

- [ ] **Step 4: Проверить типы всего дерева**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: без ошибок.

- [ ] **Step 5: Ручная проверка на живом стенде**

Запустить сервис, открыть форму любого агента и убедиться:

1. в поле «Adapter type» список показывает вендоров и под ними учётки с email;
2. выбор строки другого вендора сохраняет агента с новым `adapterType` и биндингом на секрет учётки;
3. в редакторе переменных ниже видно ровно один биндинг учётки, а руками прописанные переменные на месте;
4. выбор «Учётка компании по умолчанию» убирает биндинг и агент продолжает запускаться.

Пункт 4 — главный, он подтверждает, что старое поведение сохранено.

- [ ] **Step 6: Коммит отчёта, если что-то правилось**

```bash
git add -A
git commit -m "test: green regression sweep for the account picker"
```
