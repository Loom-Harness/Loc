// The Flutter action-body gaps, from the EMITTER side (M-T1.32).
//
// `riverpod-emit.ts` had three `// TODO(flutter full-parity)` arms that fired
// on valid `.ddd` and emitted a comment where an effect belonged.  Valid Dart,
// a clean `flutter analyze`, and a button wired to an action that does nothing
// — so the only surface that could ever tell anyone was the generated source,
// which nobody reads.
//
// They are now internal floors behind `loom.flutter-action-body-unsupported`
// (phase ⑦, `validateFlutterActionBodies`).  This file pins the emitter half:
// the comment is GONE, and driving the emitter on a model that bypasses the
// validator throws with the code rather than degrading silently.  The
// validator half — which shapes are refused, and the react control proving they
// render elsewhere — is `test/ir/sentinel-gates.test.ts`.
//
// WHEN M-T1.32 LANDS: these expectations flip from "throws" to a real emission,
// in the same PR that deletes the register row.  That is what makes them the
// mission's verification rather than a freeze of the gap.

import { describe, expect, it } from "vitest";
import { generateSystemFilesUnchecked } from "../../_helpers/generate.js";

const sys = (actionBody: string) => `
system FlutterGaps {
  api A from D
  subdomain D { context C {
    error Rejected { reason: string }
    aggregate Order {
      code: string
      operation confirm(): Order or Rejected { code := "c" }
    }
    repository Orders for Order { }
  } }
  storage pg { type: postgres }
  resource st { for: C, kind: state, use: pg }
  ui App {
    framework: flutter
    api Shop: A
    page Edit {
      route: "/edit/:id"
      state { message: string = "" }
      action go() {
${actionBody}
      }
      body: Stack { Heading { "Edit", level: 1 }, Button { "go", onClick: go } }
    }
  }
  deployable api { platform: node, contexts: [C], dataSources: [st], serves: A, port: 8080 }
  deployable app { platform: flutter, targets: api, ui: App { Shop: api }, port: 3006 }
}`;

const WHY =
  "the Riverpod emitter's internal floor IS the subject — the phase-⑦ gate " +
  "makes these shapes unreachable through `ddd generate`";

describe("flutter action-body gaps — the emitter no longer degrades silently", () => {
  for (const [label, body] of [["toast", `        toast("hi")`]] as const) {
    it(`a \`${label}(…)\` view effect throws the coded floor instead of emitting a TODO`, async () => {
      await expect(generateSystemFilesUnchecked(sys(body), WHY)).rejects.toThrow(
        /internal: the Flutter Riverpod Notifier emitter cannot render a 'private-operation' call/,
      );
    });
  }

  it("a `match await` on a STANDARD agg op throws instead of dropping the whole effect", async () => {
    const body = `        match await Shop.Order.delete() {
          Order o    => { message := o.code }
          Rejected r => { message := r.reason }
        }`;
    await expect(generateSystemFilesUnchecked(sys(body), WHY)).rejects.toThrow(
      /internal: the Flutter Riverpod Notifier emitter cannot render a `match await` subject/,
    );
  });

  it("a `match await` on a DECLARED operation still emits the full effect (the control)", async () => {
    const body = `        match await Shop.Order.confirm() {
          Order o    => { message := o.code }
          Rejected r => { message := r.reason }
        }`;
    const files = await generateSystemFilesUnchecked(sys(body), WHY);
    const page = [...files.entries()].find(([k]) => k.endsWith("edit_page.dart"));
    expect(page, "no Edit page emitted").toBeDefined();
    const src = page![1];
    expect(src).toContain("Future<void> go(String id) async {");
    expect(src).toContain("http.post(apiUri('/orders/${id}/confirm')");
    expect(src).not.toContain("TODO(flutter full-parity)");
  }, 60_000);
});
