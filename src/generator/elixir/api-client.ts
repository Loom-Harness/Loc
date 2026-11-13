// ---------------------------------------------------------------------------
// Typed in-system api client (M-T4.8) — the Phoenix/Elixir caller
// half, and the last one: every backend now emits a typed in-system client.
//
// Same contract as the four siblings; Elixir idiom.  One
// `<resource>_<operation_id>/N` per operation the CALLEE exposes, replacing the
// untyped `get(path)` / `post(path, body)` verbs the `storage restApi` binding
// carries.  Paths come from `contextOperations`, the response shape from
// the callee's declared response record — the same two derivations every
// other client reads, so none of them can drift from the callee.
//
// The boundary check is a PROJECTION, not a schema parse.  `Req` decodes JSON
// into a STRING-keyed map, and `o.code` in domain code is Elixir map-dot, which
// only works on ATOM keys — so the client rebuilds the response as an
// atom-keyed map naming exactly the callee's wire fields.  That is what makes
// the field list load-bearing here: an unknown field is dropped and a missing
// one lands as `nil` under its proper name, rather than the whole call
// succeeding with a shape the caller cannot read at all.
//
// Atom keys are safe because every key is a COMPILE-TIME literal from the wire
// shape — no `String.to_atom` on remote input, so no atom-table exhaustion.
//
// `req` is declared as a hex dep HERE.  An api-bound resource has no `storage`,
// so it never reaches the `restApi` ResourceAdapter that normally declares it —
// exactly the defect that shipped a `httpx`-importing Python client into a
// project with no `httpx` dependency.
// ---------------------------------------------------------------------------

import { apiCallPrincipal } from "../../ir/enrich/hosting-facts.js";
import { contextOperations } from "../../ir/plan/index.js";
import type { AggregateIR, SystemIR } from "../../ir/types/loom-ir.js";
import { type ApiResourceBinding, servedContextsFor } from "../../ir/util/api-resource-binding.js";
import {
  type ApiOperationIR,
  absenceUnionSuccess,
  collectionSuccess,
} from "../../ir/util/api-surface.js";
import { responseWireIn } from "../../ir/util/response-wire.js";
import { escapeElixirIdent, snake } from "../../util/naming.js";
import { resourceEnvUrlVar } from "../../util/resource-env.js";
import { type PolymorphicRow, polymorphicRowOf } from "../_api/polymorphic-row.js";

/** The module the render layer calls into. */
export function apiClientModuleName(appModule: string): string {
  return `${appModule}.Resources.ApiClients`;
}

function aggregateNamed(sys: SystemIR, name: string): AggregateIR | undefined {
  for (const sd of sys.subdomains) {
    for (const ctx of sd.contexts) {
      const agg = ctx.aggregates.find((a) => a.name === name);
      if (agg) return agg;
    }
  }
  return undefined;
}

/** `/api/orders/{id}` → an Elixir string expression with path params encoded. */
function pathExpr(op: ApiOperationIR): string {
  const parts: string[] = [];
  let rest = op.path;
  for (const p of op.params) {
    if (p.location !== "path") continue;
    const token = `{${p.name}}`;
    const at = rest.indexOf(token);
    if (at < 0) continue;
    parts.push(JSON.stringify(rest.slice(0, at)));
    parts.push(`URI.encode_www_form(to_string(${escapeElixirIdent(snake(p.name))}))`);
    rest = rest.slice(at + token.length);
  }
  parts.push(JSON.stringify(rest));
  return parts.filter((s) => s !== '""').join(" <> ") || '""';
}

/** The atom-keyed projection of the decoded map bound to `src`: exactly the
 *  callee's wire fields of `agg`.  No trailing comma on the last entry —
 *  Elixir map literals reject one, and it is a parse error the emitter cannot
 *  see. */
function fieldProjection(
  sys: SystemIR,
  agg: AggregateIR,
  src: string,
  lead: string[] = [],
): string[] {
  const entries = [
    ...lead,
    ...responseWireIn(sys, agg).map(
      (wf) => `  ${snake(wf.name)}: Map.get(${src}, ${JSON.stringify(wf.name)})`,
    ),
  ];
  return ["%{", ...entries.map((e, i) => (i === entries.length - 1 ? e : `${e},`)), "}"];
}

/** The projection of one tagged row of a polymorphic base read: dispatched on
 *  its `type` tag to that concrete's wire fields, keeping the tag as `:type`
 *  so a caller reads the subtype off it.  A tag the callee's hierarchy does
 *  not name is a contract violation, raised at the boundary. */
function taggedRowProjection(sys: SystemIR, poly: PolymorphicRow, src: string): string[] {
  return [
    `case Map.get(${src}, "type") do`,
    ...poly.variants.flatMap((v) => [
      `  ${JSON.stringify(v.tag)} ->`,
      ...fieldProjection(sys, v.aggregate, src, [`  type: ${JSON.stringify(v.tag)}`]).map(
        (l) => `    ${l}`,
      ),
    ]),
    "  other ->",
    `    raise ArgumentError, "unexpected ${poly.base.name} row type: #{inspect(other)}"`,
    "end",
  ];
}

/** Emit the client module, or nothing when this deployable binds no in-system
 *  api (the gate that keeps existing projects byte-identical). */
export function emitElixirApiClients(
  bindings: readonly ApiResourceBinding[],
  sys: SystemIR,
  appModule: string,
): string | undefined {
  if (bindings.length === 0) return undefined;

  const out: string[] = [
    "# Auto-generated by Loom.  Typed in-system api clients.",
    `defmodule ${apiClientModuleName(appModule)} do`,
    "  defmodule RemoteCallError do",
    '    @moduledoc """',
    "    Raised when an in-system call answers with a status the callee's contract",
    "    does not describe as a success.  Carries the status so a caller can branch",
    "    on it rather than string-matching a message.",
    '    """',
    "    defexception [:resource, :operation_id, :status]",
    "",
    "    @impl true",
    "    def message(e) do",
    '      "in-system call #{e.resource}.#{e.operation_id} failed with status #{e.status}"',
    "    end",
    "  end",
    "",
  ];

  for (const b of bindings) {
    const res = snake(b.resource.name);
    out.push(
      `  # ---- ${b.resource.name} -> api '${b.apiName}' (served by '${b.server.name}')`,
      "  #",
      "  # A FUNCTION, not a `@module_attribute`.  An attribute is evaluated at",
      "  # COMPILE time, and a release is compiled in the Docker image build —",
      "  # long before compose sets the variable — so the attribute form would",
      "  # bake in the localhost fallback and never see the real address.  No",
      "  # compiler can see that; it is a silent wrong-URL at runtime.",
      `  defp ${res}_base_url do`,
      `    System.get_env("${resourceEnvUrlVar(b.resource.name)}") || "http://localhost:3000"`,
      "  end",
      "",
    );

    for (const ctx of servedContextsFor(b, sys)) {
      for (const op of contextOperations(ctx)) {
        // A polymorphic base read answers tagged rows, never the abstract
        // base's own field list.
        const poly = polymorphicRowOf(op, ctx);
        // An ABSENCE union projects the same fields as a plain entity
        // response; only the absent status differs (nil, not a raise).
        const absentAgg = absenceUnionSuccess(op.responseType);
        // A COLLECTION response projects the same per-row atom map, wrapped:
        // the auto-`findAll` answers with the paged envelope, a declared `T[]`
        // find with a bare array.  Without this arm both returned `:ok` — the
        // call was made and every row discarded.
        const coll = collectionSuccess(op.responseType);
        const respAgg =
          op.responseType?.kind === "entity" ? op.responseType.name : (absentAgg ?? coll?.agg);
        const agg = respAgg ? aggregateNamed(sys, respAgg) : undefined;

        const bodyParams = op.params.filter((p) => p.location === "body");
        // Two body shapes, both derived (api-surface.ts): `create` carries ONE
        // whole-shape param, while a domain operation carries one per declared
        // argument, which the callee reads as a flat JSON object.  Sending only
        // the first silently drops every argument after it.
        const wholeShapeBody = bodyParams.length === 1 && bodyParams[0]?.type.kind === "entity";
        const query = op.params.filter((p) => p.location === "query");
        const params = op.params.map((p) => escapeElixirIdent(snake(p.name)));

        out.push(
          `  def ${res}_${snake(op.id)}(${params.join(", ")}) do`,
          `    path = ${pathExpr(op)}`,
        );
        if (query.length > 0) {
          out.push(
            "    path =",
            "      path <>",
            '        "?" <>',
            "        URI.encode_query(%{",
            ...query.map(
              (q) => `          ${JSON.stringify(q.name)} => ${escapeElixirIdent(snake(q.name))},`,
            ),
            "        })",
          );
        }
        const reqOpts = [`url: ${res}_base_url() <> path`, `method: :${op.method.toLowerCase()}`];
        // A callee that requires auth authenticates the caller's own
        // principal: its credential, kept by the auth plug (or the LiveView
        // mount) in the process dictionary.
        if (apiCallPrincipal(b.server) === "forward-caller") {
          reqOpts.push("headers: Process.get(:loom_caller_credential, [])");
        }
        if (bodyParams.length > 0) {
          const payload = wholeShapeBody
            ? escapeElixirIdent(snake(bodyParams[0]?.name ?? "body"))
            : `%{${bodyParams.map((p) => `${JSON.stringify(p.name)} => ${escapeElixirIdent(snake(p.name))}`).join(", ")}}`;
          reqOpts.push(`json: ${payload}`);
        }
        out.push(
          "",
          "    res =",
          "      Req.request!(",
          ...reqOpts.map((o) => `        ${o},`),
          // No `decode_body:` — Req decodes JSON from the content-type by
          // default, and naming an option this emitter has not verified is how
          // a plausible-looking client fails at runtime rather than at compile.
          "        retry: false",
          "      )",
          "",
        );

        // The status ladder and the success projection, built as ONE block so
        // the absence arm can indent it as a unit.  Absence is a VALUE the
        // caller matches on (`match o { Order x => …, else => … }`), so a 404
        // yields `nil`; every other non-2xx is still a real failure.
        const tail: string[] = [
          "if res.status >= 400 do",
          "  raise RemoteCallError,",
          `    resource: ${JSON.stringify(b.resource.name)},`,
          `    operation_id: ${JSON.stringify(op.id)},`,
          "    status: res.status",
          "end",
          "",
        ];
        // The SHIPPED create route answers `201 {id}` — not the whole entity
        // its declared responseType names.  Projecting the full field list
        // against that body lands `nil` in every other key, at RUNTIME.
        const isCreate = agg !== undefined && op.kind === "create";
        if (isCreate) {
          tail.push("payload = res.body || %{}", "", "%{", '  id: Map.get(payload, "id")', "}");
        } else if (agg) {
          // Project the STRING-keyed decoded body onto atom keys naming the
          // callee's wire fields — `o.code` in domain code is map-dot, which
          // only resolves atom keys.  Every key here is a compile-time literal.
          const project = (src: string): string[] =>
            poly ? taggedRowProjection(sys, poly, src) : fieldProjection(sys, agg, src);
          // A collection projects EACH row through the same atom-key map, so
          // the row projection is built once and mapped.  `payload` is the
          // decoded body: the envelope for `paged`, the array itself otherwise.
          if (coll) {
            const rowMap = project("row");
            tail.push(
              "payload = res.body || %{}",
              "",
              ...(coll.carrier === "paged"
                ? [
                    'rows = Map.get(payload, "items") || []',
                    "",
                    "%{",
                    "  items:",
                    "    Enum.map(rows, fn row ->",
                    ...rowMap.map((l) => `      ${l}`),
                    "    end),",
                    '  page: Map.get(payload, "page"),',
                    '  page_size: Map.get(payload, "pageSize"),',
                    '  total: Map.get(payload, "total"),',
                    '  total_pages: Map.get(payload, "totalPages")',
                    "}",
                  ]
                : ["Enum.map(payload, fn row ->", ...rowMap.map((l) => `  ${l}`), "end)"]),
            );
          } else
            tail.push(
              // `payload`, not `body`: a whole-shape create takes a PARAMETER
              // named `body`, and rebinding it here reads as a bug even though
              // Elixir permits it.
              "payload = res.body || %{}",
              "",
              ...project("payload"),
            );
        } else {
          tail.push(":ok");
        }

        const indent = absentAgg ? "      " : "    ";
        if (absentAgg) out.push("    if res.status == 404 do", "      nil", "    else");
        out.push(...tail.map((l) => (l === "" ? "" : indent + l)));
        if (absentAgg) out.push("    end");
        out.push("  end", "");
      }
    }
  }

  out.push("end", "");
  return out.join("\n");
}
