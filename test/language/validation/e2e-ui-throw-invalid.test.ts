import { describe, expect, it } from "vitest";
import { parseString } from "../../_helpers/parse.js";

// ---------------------------------------------------------------------------
// `toThrow` in a UI e2e body — rejected at parse time (F7 / D-3(a)).
//
// `toThrow(<status>)` pins an HTTP STATUS.  A `test e2e` block whose target is
// a frontend deployable lowers to a Playwright spec driven through the
// generated page objects, where there is no HTTP status to pin:
//
//   - the emitted form validates CLIENT-side (a zod resolver derived from the
//     aggregate's own invariants), so an invalid submit issues no request at
//     all — there is no response, and therefore no status, not merely one that
//     is hard to observe;
//   - and the page object's `submit()` awaits the DETAIL page's testid, which
//     an invalid form never renders, so the promise neither resolves nor
//     rejects before the Playwright timeout.
//
// `ui-e2e-render.ts` used to drop the status argument silently and emit a bare
// `.rejects.toThrow()` — an assertion weaker than the one written, that then
// hung for the full 30s timeout and failed.  The author got no diagnostic.
//
// The api path keeps `toThrow(<status>)`: there it is a real response status
// off a real `fetch`.  See `e2e-render.ts`'s `/→ N\b/` matcher.
// ---------------------------------------------------------------------------

const CODE = "loom.e2e-ui-throw-invalid";

/** A system carrying a Hono backend and a React frontend over one context, with
 *  `<body>` spliced into a `test e2e … against <target>` block. */
const system = (target: string, body: string): string => `
  system S {
    subdomain D {
      context C {
        aggregate Technician with crudish {
          name: string
          skill: string
          invariant name.length > 0
          derived display: string = name
        }
        repository Technicians for Technician { }
      }
    }

    ui WebApp with scaffold(subdomains: [D]) { }
    storage primary { type: postgres }
    resource cState { for: C, kind: state, use: primary }

    deployable api { platform: node, contexts: [C], dataSources: [cState], port: 3000 }
    deployable webApp { platform: react, targets: api, ui: WebApp, port: 3001 }

    test e2e "probe" against ${target} {
${body}
    }
  }
`;

/** The same shape against a fullstack (phoenixLiveView) deployable, which can
 *  carry EITHER kind — the body's call root decides, exactly as `lowerE2E`'s
 *  `fullstackE2EKinds` dispatch does. */
const fullstack = (body: string): string => `
  system S {
    subdomain D {
      context C {
        aggregate Technician with crudish {
          name: string
          skill: string
          invariant name.length > 0
          derived display: string = name
        }
        repository Technicians for Technician { }
      }
    }

    ui WebApp with scaffold(subdomains: [D]) { }
    storage primary { type: postgres }
    resource cState { for: C, kind: state, use: primary }

    deployable app {
      platform: elixir
      contexts: [C]
      dataSources: [cState]
      ui: WebApp
      port: 4000
    }

    test e2e "probe" against app {
${body}
    }
  }
`;

const hasCode = async (src: string): Promise<boolean> => {
  const { diagnostics } = await parseString(src);
  return diagnostics.some((d) => d.code === CODE);
};

describe("toThrow in a ui e2e body — rejected, never silently weakened", () => {
  it("rejects toThrow(<status>) against a frontend deployable", async () => {
    const src = system(
      "webApp",
      `      expect(ui.technicians.create({ name: "", skill: "HVAC" })).toThrow(422)`,
    );
    const { diagnostics, errors } = await parseString(src);
    expect(diagnostics.some((d) => d.code === CODE)).toBe(true);
    // The message has to name the status the author wrote — the whole defect
    // was that `422` vanished without a word.
    expect(errors.join("\n")).toContain("422");
  });

  it("rejects a bare toThrow() against a frontend deployable", async () => {
    // Equally unrunnable: `submit()` awaits the detail testid, so on an invalid
    // form the promise settles only when a timeout fires.  The assertion can
    // never pass for the reason the author meant.
    expect(
      await hasCode(
        system("webApp", `      expect(ui.technicians.create({ name: "" })).toThrow()`),
      ),
    ).toBe(true);
  });

  it("names the locator matchers to write instead", async () => {
    const { errors } = await parseString(
      system(
        "webApp",
        `      expect(ui.technicians.create({ name: "", skill: "HVAC" })).toThrow(422)`,
      ),
    );
    const text = errors.join("\n");
    // A refusal that does not say what to write instead just moves the dead end:
    // name the DOM assertion that does work here, and the api block where a
    // status assertion belongs.
    expect(text).toContain("toHaveText");
    expect(text).toContain("against <backend-deployable>");
  });

  it("leaves toThrow(<status>) alone in an api e2e body", async () => {
    const src = system(
      "api",
      `      let t = api.technicians.create({ name: "Ada", skill: "HVAC" })
      api.technicians.destroy(t)
      expect(api.technicians.getById(t)).toThrow(404)`,
    );
    const { diagnostics, errors } = await parseString(src);
    expect(diagnostics.some((d) => d.code === CODE)).toBe(false);
    expect(errors).toEqual([]);
  });

  it("leaves a bare toThrow() alone in an api e2e body", async () => {
    expect(
      await hasCode(
        system(
          "api",
          `      expect(api.technicians.create({ name: "", skill: "HVAC" })).toThrow()`,
        ),
      ),
    ).toBe(false);
  });

  it("leaves a bare toThrow() alone in a domain unit test", async () => {
    const src = `
      system S {
        subdomain D {
          context C {
            aggregate Technician {
              name: string
              invariant name.length > 0
              test "empty name is rejected" {
                expect(Technician.create({ name: "" })).toThrow()
              }
            }
            repository Technicians for Technician { }
          }
        }
      }
    `;
    const { diagnostics, errors } = await parseString(src);
    expect(diagnostics.some((d) => d.code === CODE)).toBe(false);
    expect(errors).toEqual([]);
  });

  // --- the fullstack (phoenixLiveView) split -------------------------------
  // One deployable, two possible kinds.  The block's call ROOT decides which
  // renderer sees it, so the diagnostic has to follow the root, not the
  // platform — otherwise it either misses ui bodies or fails valid api ones.

  it("rejects toThrow(<status>) in a ui-rooted fullstack body", async () => {
    expect(
      await hasCode(
        fullstack(`      expect(ui.technicians.create({ name: "", skill: "HVAC" })).toThrow(422)`),
      ),
    ).toBe(true);
  });

  it("leaves toThrow(<status>) alone in an api-rooted fullstack body", async () => {
    const src = fullstack(
      `      let t = api.technicians.create({ name: "Ada", skill: "HVAC" })
      api.technicians.destroy(t)
      expect(api.technicians.getById(t)).toThrow(404)`,
    );
    const { diagnostics, errors } = await parseString(src);
    expect(diagnostics.some((d) => d.code === CODE)).toBe(false);
    expect(errors).toEqual([]);
  });
});
