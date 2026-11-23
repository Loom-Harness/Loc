// Census: every `theme {}` token is honoured or refused, never dropped
// (`src/util/theme-tokens.ts`).
//
// For every design — each built-in pack in `designs/` and each self-rendered
// frontend in `TARGET_FACTS` — the fixture is generated once with every token
// set, then once per token with only that token changed.  A token the design
// honours must change the generated ui project; a token it does not honour must
// leave it byte-identical.  The table is held both ways, so a design that
// starts honouring a token fails here until the table says so (and the
// refusal diagnostic stops firing), and a design that stops fails too.
//
// This is a wiring claim: it observes that a token reaches the emitted project,
// not how a browser paints it (the behavioural one-typeface probe covers the
// font on the booted forms).

import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  THEME_TOKENS,
  THEME_TOKENS_HONOURED,
  type ThemeToken,
} from "../../../src/util/theme-tokens.js";
import { generateSystemFilesUnchecked } from "../../_helpers/generate.js";
import { type ThemeCase, themeCases, themedFixture, uiFiles } from "../../_helpers/theme.js";

/** Two values per token: the base, and the one a variant swaps in. */
const VALUES: Record<ThemeToken, readonly [string, string]> = {
  primary: ["#123456", "#654321"],
  neutral: ["#234567", "#765432"],
  secondary: ["#345678", "#876543"],
  accent: ["#456789", "#987654"],
  success: ["#56789a", "#a98765"],
  warning: ["#6789ab", "#ba9876"],
  error: ["#789abc", "#cba987"],
  radius: ["sm", "xl"],
  fontFamily: ["Basefont, sans-serif", "Otherfont, serif"],
  fontFamilyMono: ["Basemono, monospace", "Othermono, monospace"],
  colorScheme: ["light", "dark"],
};

function sameFiles(a: Map<string, string>, b: Map<string, string>): boolean {
  if (a.size !== b.size) return false;
  for (const [p, s] of a) if (b.get(p) !== s) return false;
  return true;
}

/** The census sets every token, the ones a design refuses included, to measure
 *  which reach the generated project. */
const WHY = "sets refused theme tokens on purpose to measure which tokens reach the output";
const generate = (src: string) => generateSystemFilesUnchecked(src, WHY);

/** The tokens whose change reaches the ui project. */
async function honoured(c: ThemeCase): Promise<ThemeToken[]> {
  const base = Object.fromEntries(THEME_TOKENS.map((t) => [t, VALUES[t][0]])) as Record<
    ThemeToken,
    string
  >;
  const baseFiles = uiFiles(c, await generate(themedFixture(c, base)));
  const out: ThemeToken[] = [];
  for (const t of THEME_TOKENS) {
    const variant = uiFiles(c, await generate(themedFixture(c, { ...base, [t]: VALUES[t][1] })));
    if (!sameFiles(baseFiles, variant)) out.push(t);
  }
  return out;
}

const MEASURED: Record<string, ThemeToken[]> = {};

describe("theme token coverage", () => {
  const all = themeCases();

  it.each(all.map((c) => [c.design, c] as const))(
    "%s honours exactly the tokens the table names",
    async (_name, c) => {
      const got = await honoured(c);
      MEASURED[c.design] = got;
      expect(got, `${c.design}: honoured tokens`).toEqual([
        ...(THEME_TOKENS_HONOURED[c.design] ?? []),
      ]);
    },
    300_000,
  );

  it("the table names no design that does not exist", () => {
    if (process.env.LOOM_THEME_TOKEN_DUMP) {
      writeFileSync(process.env.LOOM_THEME_TOKEN_DUMP, JSON.stringify(MEASURED, null, 2));
    }
    const designs = new Set(all.map((c) => c.design));
    for (const d of Object.keys(THEME_TOKENS_HONOURED)) expect(designs.has(d), d).toBe(true);
  });
});
