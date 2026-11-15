// M-FT.11 — where the `if` statement may be written.
//
// In a domain body it is valid on every backend: lowering rewrites an early
// `return` into branch-total form and every backend renders the result, so a
// model's validity does not depend on the target.  A ui body is the one place
// it does not render — every frontend expresses a condition as a VALUE — and
// that refusal is target-neutral too (`loom.if-stmt-page-body-unsupported`).
//
// The ui gate is proved twice: the offending shape errors, and the same model
// without the statement does NOT (the gate is placement-specific, not a
// blanket ban).

import { describe, expect, it } from "vitest";
import { enrichLoomModel } from "../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../src/ir/lower/lower.js";
import { validateLoomModel } from "../../src/ir/validate/validate.js";
import { parseString } from "../_helpers/parse.js";

async function codes(src: string): Promise<string[]> {
  const { model, errors } = await parseString(src);
  if (errors.length) throw new Error(`unexpected parse errors:\n${errors.join("\n")}`);
  return validateLoomModel(enrichLoomModel(lowerModel(model))).map((d) => d.code ?? "");
}

/** A one-context system whose only operation body is `body`, on `platform`. */
const backendSys = (platform: string, body: string): string => `system S {
  subdomain M { context C {
    enum Status { Open, Done }
    aggregate Task {
      title: string
      count: int
      status: Status
      operation run(n: int) {
${body}
      }
    }
    repository Tasks for Task {}
  } }
  storage primary { type: postgres }
  resource state { for: C, kind: state, use: primary }
  deployable api { platform: ${platform}, contexts: [C], dataSources: [state], port: 3000 }
}`;

const IF_BODY = `        if n > 0 {
          count := 1
        } else {
          count := 2
        }`;

/** A RETURNING operation body with an early `return` from a branch — `return`
 *  only parses with a value, so it needs its own one-context system. */
const returningSys = (platform: string): string => `system S {
  subdomain M { context C {
    aggregate Task {
      title: string
      count: int
      operation run(n: int): int {
        if n > 0 {
          return 1
        }
        count := n
        return count
      }
    }
    repository Tasks for Task {}
  } }
  storage primary { type: postgres }
  resource state { for: C, kind: state, use: primary }
  deployable api { platform: ${platform}, contexts: [C], dataSources: [state], port: 3000 }
}`;
const GUARD_IN_BRANCH = `        if n > 0 {
          precondition count > 0
          count := 1
        }`;
const NESTED = `        if n > 0 {
          if n > 5 {
            count := 1
          }
        }`;

const errors = async (src: string): Promise<string[]> => {
  const { model, errors: parseErrors } = await parseString(src);
  if (parseErrors.length) throw new Error(`unexpected parse errors:\n${parseErrors.join("\n")}`);
  return validateLoomModel(enrichLoomModel(lowerModel(model)))
    .filter((d) => d.severity === "error")
    .map((d) => d.code ?? d.message);
};

describe("the `if` statement in a domain body is valid on every backend", () => {
  for (const p of ["node", "dotnet", "java", "python", "elixir"]) {
    it(`admits a plain, a nested, a guarding and an early-returning \`if\` on ${p}`, async () => {
      expect(await errors(backendSys(p, IF_BODY))).toEqual([]);
      expect(await errors(backendSys(p, NESTED))).toEqual([]);
      expect(await errors(backendSys(p, GUARD_IN_BRANCH))).toEqual([]);
      expect(await errors(returningSys(p))).toEqual([]);
    });
  }
});

const uiSys = (framework: string, webPlatform: string, action: string): string => `system S {
  subdomain M { context C {
    aggregate Task { title: string }
    repository Tasks for Task {}
  } }
  storage primary { type: postgres }
  resource state { for: C, kind: state, use: primary }
  deployable api { platform: node, contexts: [C], dataSources: [state], port: 3000 }
  ui Web {
    framework: ${framework}
    page Home {
      state { n: int = 0 }
      action bump() {
${action}
      }
      body: Stack { Button { label: "go", onClick: bump } }
    }
  }
  deployable web { platform: ${webPlatform}, ui: Web, targets: api, port: 3100 }
}`;

const UI_IF = `        if n == 0 {
          n := 1
        }`;
const UI_NO_IF = `        n := 1`;

describe("loom.if-stmt-page-body-unsupported", () => {
  it("errors for a page action on EVERY SPA frontend, not just one", async () => {
    for (const framework of ["react", "vue", "svelte", "angular", "feliz", "flutter"]) {
      expect(await codes(uiSys(framework, framework, UI_IF)), `framework ${framework}`).toContain(
        "loom.if-stmt-page-body-unsupported",
      );
    }
  });

  // LiveView is the frontend whose ui is MOUNTED ON THE BACKEND deployable (no
  // `targets:`), so it is spelled out rather than folded into the loop above.
  it("errors on a phoenixLiveView page action too", async () => {
    const src = `system S {
  subdomain M { context C {
    aggregate Task { title: string }
    repository Tasks for Task {}
  } }
  storage primary { type: postgres }
  resource state { for: C, kind: state, use: primary }
  ui Web {
    framework: phoenixLiveView
    page Home {
      state { n: int = 0 }
      action bump() {
        if n == 0 {
          n := 1
        }
      }
      body: Stack { Button { label: "go", onClick: bump } }
    }
  }
  deployable web {
    platform: elixir
    contexts: [C]
    dataSources: [state]
    ui: Web
    port: 4000
  }
}`;
    expect(await codes(src)).toContain("loom.if-stmt-page-body-unsupported");
  });

  it("does NOT fire on a page whose action has no `if`", async () => {
    expect(await codes(uiSys("react", "react", UI_NO_IF))).not.toContain(
      "loom.if-stmt-page-body-unsupported",
    );
  });

  it("reaches an `if` inside a store action too", async () => {
    const src = `system S {
  subdomain M { context C {
    aggregate Task { title: string }
    repository Tasks for Task {}
  } }
  storage primary { type: postgres }
  resource state { for: C, kind: state, use: primary }
  deployable api { platform: node, contexts: [C], dataSources: [state], port: 3000 }
  ui Web {
    framework: react
    store Cart {
      state { n: int = 0 }
      action bump() {
        if n == 0 {
          n := 1
        }
      }
    }
    page Home { body: Stack { Heading { text: "hi" } } }
  }
  deployable web { platform: react, ui: Web, targets: api, port: 3100 }
}`;
    expect(await codes(src)).toContain("loom.if-stmt-page-body-unsupported");
  });
});
