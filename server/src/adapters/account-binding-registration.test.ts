import { describe, expect, it } from "vitest";
import { isAdapterAccountBinding } from "@paperclipai/adapter-utils";
import { getServerAdapter, listServerAdapters } from "./registry.js";

// The two adapters that carry per-account credential homes must declare the
// capability, and each must name the environment variable Codex's execute path
// already honors outright. Claude's binding names the right variable too, but
// it does not reach every Claude execution lane — see the caveat comment next
// to the `accountBinding` literal on `claudeLocalAdapter` in registry.ts. A
// drift here silently empties the account list in the UI.
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
    // getServerAdapter() has a non-nullable return type — an unknown or paused
    // type silently falls back to the generic `processAdapter`, which also has
    // no accountBinding. Pin the identity first so a future rename, removal,
    // or pause of gemini_local fails loudly here instead of the assertion
    // below passing vacuously against the fallback.
    const gemini = getServerAdapter("gemini_local");
    expect(gemini.type).toBe("gemini_local");
    expect(gemini.accountBinding).toBeUndefined();
  });

  // Built-in adapters are constructed as plain object literals in
  // registerBuiltInAdapters() and never pass through
  // validateAdapterAccountBinding — that validator's only caller is the
  // external-plugin loader. This sweep is the sole runtime check standing
  // between a future built-in and a malformed binding (e.g. a secretPrefix
  // missing its trailing underscore, which would make the account handle
  // impossible to slice back out of a stored secret name).
  it("declares no malformed binding on any registered adapter", () => {
    for (const adapter of listServerAdapters()) {
      if (adapter.accountBinding === undefined) continue;
      expect(isAdapterAccountBinding(adapter.accountBinding), adapter.type).toBe(true);
    }
  });

  // Prefixes must not nest. The listing loops every binding over every secret
  // and keeps each secret whose name starts with that binding's prefix, so if
  // one adapter's `secretPrefix` were a prefix of another's — say
  // `CODEX_HOME_` and `CODEX_HOME_ALT_` — the secret `CODEX_HOME_ALT_bob`
  // would match BOTH bindings and produce two rows sharing one secretId: the
  // real account, plus a phantom whose handle is `ALT_bob` and whose status is
  // a spurious `mismatch` — the loudest status the UI has, on an account that
  // does not exist.
  //
  // Nothing else guards this: `SECRET_PREFIX_RE` validates one prefix's shape
  // and never the set, so no per-adapter check can see the collision. Keeping
  // the guard here (rather than defending inside the listing loop) is
  // deliberate — the condition is unreachable with the shipped prefixes, and a
  // CI failure naming both adapters is more useful than silent de-duplication.
  //
  // Scope: built-in adapters only. A plugin adapter registering a nesting
  // prefix at runtime still slips through, because
  // `validateAdapterAccountBinding` inspects one module at a time and never
  // sees the registered set.
  it("declares no secretPrefix that nests inside another adapter's", () => {
    const bindings = listServerAdapters().flatMap((adapter) =>
      adapter.accountBinding
        ? [{ type: adapter.type, secretPrefix: adapter.accountBinding.secretPrefix }]
        : [],
    );

    const collisions: string[] = [];
    for (const outer of bindings) {
      for (const inner of bindings) {
        if (outer === inner) continue;
        if (inner.secretPrefix.startsWith(outer.secretPrefix)) {
          collisions.push(
            `${inner.type} ("${inner.secretPrefix}") nests inside ${outer.type} ("${outer.secretPrefix}")`,
          );
        }
      }
    }

    expect(collisions).toEqual([]);
  });
});
