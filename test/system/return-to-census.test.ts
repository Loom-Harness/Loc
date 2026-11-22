// Where a sign-in returns to is one rule (`src/util/return-to.ts`): every
// backend's OIDC handshake and every frontend's sign-in link read it, and none
// spells it again.  Two backends that disagreed on which `returnTo` to follow
// would make one of them an open redirect.
//
// What this holds, over the source tree: the cookie name and the pattern's
// character class appear in no file but the rule's own, and every reader
// imports the rule.  String tier on purpose: it checks the emitters' source,
// which no booted leg reads; the behaviour itself is the code-flow probe's
// (`test/support/oidc-code-flow.mjs`), which every backend's behavioural leg
// runs.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  isAcceptableReturnTo,
  parseReturnOrigins,
  RETURN_ORIGINS_ENV,
  RETURN_TO_COOKIE,
  RETURN_TO_PATH_PATTERN,
} from "../../src/util/return-to.js";
import { expectReach } from "../_helpers/census-reach.js";

const SRC = join(__dirname, "../../src");
const RULE = "util/return-to.ts";

/** The readers: each backend's OIDC handshake and each frontend's sign-in. */
const READERS = [
  "platform/hono/shared/auth-emit.ts",
  "generator/dotnet/auth-emit.ts",
  "generator/elixir/auth-emit.ts",
  "generator/python/auth-emit.ts",
  "generator/java/emit/auth.ts",
  "generator/_frontend/auth-ui.ts",
  "generator/feliz/auth-gate.ts",
  "generator/feliz/from-contract.ts",
  "generator/flutter/auth-gate.ts",
];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith(".ts") ? [p] : [];
  });
}

/** The pattern's character class, the part a hand-written copy would repeat. */
const CHAR_CLASS = RETURN_TO_PATH_PATTERN.slice(
  RETURN_TO_PATH_PATTERN.indexOf("["),
  RETURN_TO_PATH_PATTERN.indexOf("]") + 1,
);

describe("returnTo census — one rule, read everywhere", () => {
  const files = walk(SRC)
    .map((p) => [relative(SRC, p).split("\\").join("/"), readFileSync(p, "utf8")] as const)
    .filter(([p]) => !p.startsWith("language/generated/"));

  it("spells the cookie, the variable and the pattern only in the rule's own module", () => {
    expectReach("source files", files.length, 1000);
    const copies = files
      .filter(([p]) => p !== RULE)
      .filter(
        ([, text]) =>
          text.includes(RETURN_TO_COOKIE) ||
          text.includes(RETURN_ORIGINS_ENV) ||
          text.includes(CHAR_CLASS),
      )
      .map(([p]) => p);
    expect(copies).toEqual([]);
  });

  it("every reader imports the rule", () => {
    expectReach("readers", READERS.length, 9);
    const byPath = new Map(files);
    for (const reader of READERS) {
      const text = byPath.get(reader);
      expect(text, reader).toBeDefined();
      expect(text, reader).toMatch(/from "(\.\.\/)+util\/return-to\.js"/);
    }
  });

  it("the rule takes a same-origin path or an allowed origin, and nothing near either", () => {
    const allowed = parseReturnOrigins(" http://app.example:3101 , ");
    expect([...allowed]).toEqual(["http://app.example:3101"]);
    for (const ok of [
      "/",
      "/orders/7?tab=lines",
      "/mob/#/products",
      "/ops/a%20b",
      "http://app.example:3101",
      "http://app.example:3101/orders/7?tab=lines#x",
    ]) {
      expect(isAcceptableReturnTo(ok, allowed), ok).toBe(true);
    }
    for (const bad of [
      "",
      "orders",
      "//evil.example/x",
      "/\\evil.example/x",
      "https://evil.example/x",
      "http://app.example:3101.evil.com/x",
      "http://app.example.evil.com:3101/x",
      "http://app.example:3101@evil.example/x",
      "http://APP.example:3101/x",
      "https://app.example:3101/x",
      "http://app.example/x",
      "javascript:alert(1)",
      "/a b",
      "/a;b",
      "/a,b",
      '/a"b',
      `/${"a".repeat(2048)}`,
    ]) {
      expect(isAcceptableReturnTo(bad, allowed), bad).toBe(false);
    }
    // No allowed origin: only a same-origin path.
    expect(isAcceptableReturnTo("http://app.example:3101/x", new Set())).toBe(false);
  });
});
