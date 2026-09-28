// M-T5.1 — a value object BUILT by a domain body, whose invariant refuses the
// value, answers the domain-floor 422 PLUS one RFC 7807 `errors[]` entry
// (`{ pointer: "", message, code? }`) on all five backends.
//
// Before: node/.NET/java/python threw the plain domain-floor error (`detail`
// only, no `errors[]`, no `code`), and elixir never checked the value at all —
// the op persisted the body's rebinding through `force_change`, so `resize(0)`
// answered 204 with `{"value": 0}` stored.
//
// The runtime half is the behavioural tier's `vo-invariant-in-body` case (its
// wire golden carries the 422 body the other legs are diffed against); this
// file pins each backend's CARRIER, so a regression names the backend and the
// seam rather than surfacing as a golden divergence on one booted leg.  The
// last case is the byte-identity guard: a project with no value-object
// invariant emits none of it.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/index.js";
import { corpusSourceFor } from "../fixtures/corpus/harness.js";

type Backend = "node" | "dotnet" | "java" | "python" | "elixir";

async function files(backend: Backend): Promise<Map<string, string>> {
  // The corpus harness keys the elixir backend `vanilla` (its only emission).
  return generateSystemFiles(
    corpusSourceFor("vo-invariant-in-body", backend === "elixir" ? "vanilla" : backend),
  );
}

function find(fs: Map<string, string>, suffix: string): string {
  const hit = [...fs.entries()].find(([p]) => p.endsWith(suffix));
  if (!hit) throw new Error(`no emitted file ends with ${suffix}`);
  return hit[1];
}

describe("M-T5.1 — a value object refused inside a body answers 422 with errors[]", () => {
  it("node: the constructor raises ValueObjectInvariantError and every body router answers it", async () => {
    const fs = await files("node");
    expect(find(fs, "domain/value-objects.ts")).toContain(
      'throw new ValueObjectInvariantError("Qty", "Quantity must be positive", "msg.bqyhlx")',
    );
    expect(find(fs, "domain/value-objects.ts")).toContain(
      'throw new ValueObjectInvariantError("Label", "Invariant violated: text.length > 0")',
    );
    expect(find(fs, "domain/errors.ts")).toContain(
      "export class ValueObjectInvariantError extends DomainError",
    );
    const pd = find(fs, "http/problem-details.ts");
    expect(pd).toContain("export function valueObjectProblem(");
    expect(pd).toContain(
      'const entry = { pointer: "", message: localizeMessage(err.code, err.message)',
    );
    const answer = 'valueObjectProblem(c, err, 422, "Unprocessable Entity") ?? problem(422';
    expect(find(fs, "http/order.routes.ts")).toContain(answer);
    expect(find(fs, "http/workflows.ts")).toContain(answer);
  });

  it(".NET: its own exception, answered ahead of the DomainException arm", async () => {
    const fs = await files("dotnet");
    expect(find(fs, "Domain/ValueObjects/Qty.cs")).toContain(
      'throw new ValueObjectInvariantException("Qty", "Quantity must be positive", "msg.bqyhlx")',
    );
    expect(find(fs, "Domain/Common/DomainException.cs")).toContain(
      "public sealed class ValueObjectInvariantException : Exception",
    );
    const filter = find(fs, "Api/DomainExceptionFilter.cs");
    const vo = filter.indexOf("context.Exception is ValueObjectInvariantException voe");
    const domain = filter.indexOf("context.Exception is DomainException de");
    expect(vo).toBeGreaterThan(-1);
    expect(vo).toBeLessThan(domain);
    expect(filter).toContain('new { pointer = "", message = ');
  });

  it("java: a DomainException subclass with its own (more specific) advice handler", async () => {
    const fs = await files("java");
    expect(find(fs, "domain/valueobjects/Qty.java")).toContain(
      'throw new ValueObjectInvariantException("Qty", "Quantity must be positive", "msg.bqyhlx")',
    );
    expect(find(fs, "ValueObjectInvariantException.java")).toContain(
      "public class ValueObjectInvariantException extends DomainException",
    );
    const advice = find(fs, "ApiExceptionAdvice.java");
    expect(advice).toContain("@ExceptionHandler(ValueObjectInvariantException.class)");
    expect(advice).toContain('entry.put("pointer", "");');
  });

  it("python: a DomainError subclass with its own handler", async () => {
    const fs = await files("python");
    expect(find(fs, "app/domain/value_objects.py")).toContain(
      'raise ValueObjectInvariantError("Qty", "Quantity must be positive", "msg.bqyhlx")',
    );
    expect(find(fs, "app/domain/errors.py")).toContain(
      "class ValueObjectInvariantError(DomainError):",
    );
    const problems = [...fs.entries()].find(([, c]) =>
      c.includes("@app.exception_handler(ValueObjectInvariantError)"),
    );
    expect(problems, "a module registers the ValueObjectInvariantError handler").toBeDefined();
    expect(problems?.[1]).toContain('entry: dict[str, str] = {"pointer": "", "message": str(err)}');
  });

  it("elixir: the op persist re-runs the body-built value object's constructor", async () => {
    const fs = await files("elixir");
    const ctx = find(fs, "lib/d/orders.ex");
    const resize = ctx.slice(ctx.indexOf("def resize_order("));
    expect(resize.slice(0, resize.indexOf("\n  end"))).toContain(
      "|> D.Orders.OrderChangeset.validate_body_value_objects()",
    );
    const cs = find(fs, "lib/d/orders/order_changeset.ex");
    expect(cs).toContain("def validate_body_value_objects(changeset) do");
    expect(cs).toContain("|> __validate_body_vo(:qty, &D.Orders.Qty.new/1)");
    expect(cs).toContain('@loom_body_vo_codes %{"Quantity must be positive" => "msg.bqyhlx"}');
    const pd = find(fs, "problem_details.ex");
    expect(pd).toContain("case body_value_object_error(changeset) do");
    expect(pd).toContain('title: "Unprocessable Entity"');
  });

  // A4 — a `getById` miss inside a workflow is the not-found-on-load policy.
  // Four backends answered the declared 404 with "<Agg> <id> not found"; the
  // elixir workflows dispatcher could only say "Resource not found" (the
  // context facade's miss is a bare `{:error, :not_found}`), which the golden
  // recorded as the one elixir divergence of this case.
  it("elixir: a workflow getById miss answers the 404 naming the row", async () => {
    const fs = await files("elixir");
    expect(find(fs, "workflows/bump.ex")).toContain(
      '{:error, :not_found} -> {:error, {:not_found, "Order #{order_id} not found"}}',
    );
    expect(find(fs, "controllers/workflows_controller.ex")).toContain(
      "def respond(conn, {:error, {:not_found, detail}}),",
    );
  });

  it("emits none of it for a project whose value objects declare no invariant", async () => {
    const src = corpusSourceFor("vo-invariant-in-body", "node")
      .replace('invariant value > 0 message "Quantity must be positive"', "")
      .replace("invariant text.length > 0", "");
    for (const backend of ["node", "dotnet", "java", "python", "elixir"] as const) {
      const fs = await generateSystemFiles(src.replace("platform: node", `platform: ${backend}`));
      const all = [...fs.values()].join("\n");
      expect(all, backend).not.toMatch(
        /ValueObjectInvariant|valueObjectProblem|validate_body_value_objects|body_value_object_error/,
      );
    }
  });
});
