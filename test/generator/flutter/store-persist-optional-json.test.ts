// The Flutter persisted-store codec, widened to NULLABLE cells and `json`
// (`loom.store-lifetime-target-unsupported#flutter-field`, and the flutter half
// of ledger row `feliz-flutter-persist-codec-asymmetry`).
//
// Before this, `persist: local` over a `string?` or a `json` field was REFUSED
// on Flutter while the four JS frontends persisted both without a thought
// (Zustand's `createJSONStorage` serialises the whole state) — a per-target
// gap, not a shared limit.  Two conversions were missing and both are total:
// an absent key restores a nullable cell as `null` (the RIGHT value for it),
// and a `json` cell IS json, so storing the decoded value back is the identity.
//
// RUNTIME-proved (recorded in the packet hand-off, not reproducible in vitest):
// five `flutter test` cases against a mocked `shared_preferences` — an absent
// nullable cell restores as null; a present one restores its value; junk in
// either restores null without throwing; a nested `json` payload round-trips
// verbatim; and a write through a generated setter fires the `listenSelf`
// mirror, whose blob a re-boot reads back.
//
// The `url` tier is deliberately NARROWER and that is the interesting half —
// see the last case.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

function system(urlFields: string): string {
  return `
system Persist {
  api A from D
  subdomain D { context C {
    aggregate Thing { name: string }
    repository Things for Thing {}
  } }
  storage db { type: postgres }
  resource st { for: C, kind: state, use: db }
  ui App {
    framework: flutter
    api Shop: A
    store Prefs persist: local {
      state {
        plain: string = "x"
        nickname: string?
        retryCount: int?
        lastSeen: datetime?
        blob: json
      }
      action setPlain(v: string) { plain := v }
    }
    store Filters persist: url {
      state {
        q: string = ""
${urlFields}
      }
      action setQ(v: string) { q := v }
    }
    page Home {
      route: "/"
      body: Stack { Heading { "H", level: 1 }, Text { Prefs.plain }, Text { Filters.q } }
    }
  }
  deployable api1 { platform: node contexts: [C] dataSources: [st] serves: A port: 8081 }
  deployable app { platform: flutter targets: api1 ui: App { Shop: api1 } port: 3006 }
}`;
}

async function storesDart(urlFields = "        extra: json"): Promise<string> {
  const files = await generateSystemFiles(system(urlFields));
  const entry = [...files.entries()].find(([k]) => k.endsWith("app/lib/stores.dart"));
  expect(entry, "no app/lib/stores.dart emitted").toBeDefined();
  return entry![1];
}

describe("flutter persisted stores — nullable cells and `json`", () => {
  it("a nullable cell restores as NULL when the key is absent", async () => {
    const src = await storesDart();
    expect(src).toContain("static String? _loadNickname(Map<String, dynamic> blob) {");
    expect(src).toContain("if (raw == null) return null;");
    // Not the type zero a non-nullable cell falls back to.
    expect(src).not.toContain(
      "static String? _loadNickname(Map<String, dynamic> blob) {\n    final raw = blob['nickname'];\n    if (raw == null) return '';",
    );
  });

  it("a nullable numeric / datetime cell tolerates JUNK without a dead `?? null`", async () => {
    const src = await storesDart();
    expect(src).toContain("return raw is int ? raw : int.tryParse(raw.toString());");
    expect(src).toContain("return DateTime.tryParse(raw.toString());");
    // The conversions embed `?? <dflt>`; with `null` as the default that tail
    // is `?? null` — legal Dart, but `dead_null_aware_expression`.
    expect(src).not.toContain("?? null;");
  });

  it("a `json` cell is stored and restored VERBATIM — the identity conversion", async () => {
    const src = await storesDart();
    expect(src).toContain("static dynamic _loadBlob(Map<String, dynamic> blob) {");
    expect(src).toContain("return blob.containsKey('blob') ? blob['blob'] :");
    // The write side is the bare cell — no encode, no re-shape.
    expect(src).toContain("'blob': s.blob,");
  });

  it("the mirror null-guards only the conversions that DEREFERENCE", async () => {
    const src = await storesDart();
    // `datetime?` needs the guard (`.toIso8601String()` on null throws)…
    expect(src).toContain("'lastSeen': s.lastSeen == null ? null : s.lastSeen!.toIso8601String(),");
    // …a `String?` / `int?` write is the identity and needs none.
    expect(src).toContain("'nickname': s.nickname,");
    expect(src).toContain("'retryCount': s.retryCount,");
  });

  it("a `json` cell at the `url` tier encodes, and its import is pulled in", async () => {
    const src = await storesDart();
    expect(src).toContain("'extra': s.extra == null ? null : jsonEncode(s.extra),");
    expect(src).toContain("return jsonDecode(raw);");
    // `jsonDecode` THROWS on junk — the try/catch is what keeps the loader
    // total, the rule the whole codec module rests on.
    expect(src).toContain("    } catch (_) {");
    // And the import cannot dangle: same content-sniff as every other on-demand
    // import in this file.
    expect(src).toContain("import 'dart:convert';");
  });

  it("a NULLABLE cell is still refused at the `url` tier — and that is the point", async () => {
    // `hydrateFromUrl` (the browser back/forward half) re-seeds via `copyWith`,
    // whose `x ?? this.x` parameter shape cannot set a cell to null.  So an
    // absent param would silently KEEP the old value — a wrong value, not a
    // missing feature.  The gate fires rather than emitting that.
    await expect(storesDart("        since: datetime?")).rejects.toThrow(
      /store-lifetime-target-unsupported/,
    );
  });

  it("a `dynamic` copyWith param carries no `?` — Dart calls that unnecessary", async () => {
    const src = await storesDart();
    expect(src).toContain("dynamic blob");
    expect(src).not.toContain("dynamic? blob");
  });
});
