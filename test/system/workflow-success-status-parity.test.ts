// Sweep F-030 — the workflow POST's SUCCESS contract must be the same on all
// five backends.  For one `.ddd`, three answers shipped:
//
//   | backend                    | served               | declared |
//   |----------------------------|----------------------|----------|
//   | node, dotnet, java, python | 204, empty body      | 204      |
//   | elixir                     | 202, {status,result} | 200      |
//
// The work itself was correct everywhere — the order persisted on all five.
// Only the envelope diverged, which is worse than a crash: a client written
// against the documented "identical API contracts" claim, tested on Hono,
// breaks the moment the deployable is re-pointed at Phoenix, and Phoenix's own
// published spec agreed with neither side.
//
// WHY A NEW GATE.  The cross-backend OpenAPI parity diff never looked: its
// error dimension filters `^[45]\d\d$`, and its two body dimensions read
// `responses["200"] ?? responses["201"]` and compare the NAMED COMPONENT the
// body refs — Phoenix's inline `{type: object}` and Hono's absent 200 both
// normalised to `""`, so the ops compared EQUAL.  `successStatuses` in
// `test/_helpers/openapi-normalize.ts` closes that hole for the booted parity
// leg; this test is its per-PR twin, over source, needing no containers.
//
// The gate is both halves, because F-030 broke both: what the handler SERVES
// and what the spec DECLARES.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/index.js";

const source = (platform: string) => `
system WF {
  subdomain S {
    context C {
      aggregate Order with crudish {
        name: string
        qty: int
      }
      repository Orders for Order { }
      workflow placeOrder {
        create(name: string, qty: int) {
          let o = Order.create({ name: name, qty: qty })
        }
      }
    }
  }
  api CApi from S
  storage primary { type: postgres }
  resource cState { for: C, kind: state, use: primary }
  deployable api {
    platform: ${platform}
    contexts: [C]
    dataSources: [cState]
    serves: CApi
    port: 4000
  }
}
`;

/** Per backend: the file holding the workflow POST, what "answers 204" looks
 *  like there, and how to read the 2xx codes that backend DECLARES for this
 *  route out of the artifact it publishes its OpenAPI from.  Java derives the
 *  declaration from the controller's own `@ResponseStatus`, so both halves
 *  land in one file.
 *
 *  The declared set is read rather than pattern-matched for absence: "does not
 *  contain 202" over a whole emitted file is a check that passes for reasons
 *  having nothing to do with this route.  Reading the actual set and comparing
 *  it to `["204"]` fails for exactly one reason. */
const BACKENDS: {
  platform: string;
  handler: string;
  serves: RegExp;
  spec: string;
  declaredSuccess: (src: string) => string[];
}[] = [
  {
    platform: "node",
    handler: "http/workflows.ts",
    serves: /return httpCtx\.body\(null, 204\);/,
    spec: "http/workflows.ts",
    declaredSuccess: (src) => successOf(sliceAfter(src, /responses: \{/), /^\s*(\d{3}): /gm),
  },
  {
    platform: "dotnet",
    handler: "Api/CWorkflowsController.cs",
    serves: /return NoContent\(\);/,
    spec: "Api/CWorkflowsController.cs",
    // `[ProducesResponseType(204)]` — the bodied error rungs spell a `typeof`
    // first, so a bare numeric argument is the success declaration.
    declaredSuccess: (src) =>
      successOf(
        sliceAfter(src, /\[HttpPost\("place_order"\)\]/),
        /\[ProducesResponseType\((\d{3})\)\]/g,
      ),
  },
  {
    platform: "elixir",
    handler: "controllers/workflows_controller.ex",
    serves: /def respond\(conn, \{:ok, _result\}\), do: send_resp\(conn, 204, ""\)/,
    spec: "_api_spec.ex",
    declaredSuccess: (src) =>
      successOf(
        sliceAfter(src, /"\/workflows\/place_order"/),
        /(\d{3}) => %OpenApiSpex\.Response\{/g,
      ),
  },
  {
    platform: "python",
    handler: "app/http/workflows_routes.py",
    serves: /return Response\(status_code=204\)/,
    spec: "app/http/workflows_routes.py",
    declaredSuccess: (src) =>
      successOf(
        sliceAfter(src, /@router\.post\("\/place_order"/),
        /status_code=(\d{3})|\b(\d{3}): \{"model"/g,
      ),
  },
  {
    platform: "java",
    handler: "api/CWorkflowsController.java",
    serves: /@ResponseStatus\(HttpStatus\.NO_CONTENT\)\s*\n\s*public void placeOrder/,
    // springdoc derives the declared status from that annotation, and the
    // contract customizer leaves it alone (`retargetSuccess` no-ops on its 0).
    spec: "api/CWorkflowsController.java",
    declaredSuccess: (src) =>
      [
        ...sliceAfter(src, /@PostMapping\("\/place_order"\)/).matchAll(
          /@ResponseStatus\(HttpStatus\.(\w+)\)/g,
        ),
      ].map((m) => JAVA_STATUS[m[1] as string] ?? (m[1] as string)),
  },
];

const JAVA_STATUS: Record<string, string> = {
  OK: "200",
  CREATED: "201",
  ACCEPTED: "202",
  NO_CONTENT: "204",
};

/** The emitted file from the first occurrence of `marker` onward, truncated at
 *  the point the next route declaration starts — so a neighbouring route's
 *  statuses cannot be read as this one's. */
function sliceAfter(src: string, marker: RegExp): string {
  const m = marker.exec(src);
  if (!m) return "";
  const rest = src.slice(m.index);
  const next = rest
    .slice(1)
    .search(
      /@PostMapping|@router\.(post|get)|\[HttpPost|\[HttpGet|app\.openapi\(|"\/workflows\/\w+\/|"\/\w+" => %OpenApiSpex\.PathItem/,
    );
  return next === -1 ? rest : rest.slice(0, next + 1);
}

/** The 2xx/3xx codes `pattern` finds in `region`, de-duplicated and sorted. */
function successOf(region: string, pattern: RegExp): string[] {
  const codes = new Set<string>();
  for (const m of region.matchAll(pattern)) {
    const code = m.slice(1).find((g) => g !== undefined);
    if (code && /^[23]\d\d$/.test(code)) codes.add(code);
  }
  return [...codes].sort();
}

describe("workflow POST success contract is identical on all five backends (F-030)", () => {
  for (const b of BACKENDS) {
    it(`${b.platform} serves 204 with an empty body`, async () => {
      const files = await generateSystemFiles(source(b.platform));
      const path = [...files.keys()].find((k) => k.includes(b.handler));
      expect(path, `no workflow handler matching ${b.handler}`).toBeDefined();
      expect(files.get(path as string) as string).toMatch(b.serves);
    });

    it(`${b.platform} declares 204 and nothing else as its success status`, async () => {
      const files = await generateSystemFiles(source(b.platform));
      const path = [...files.keys()].find((k) => k.includes(b.spec));
      expect(path, `no spec artifact matching ${b.spec}`).toBeDefined();
      expect(b.declaredSuccess(files.get(path as string) as string)).toEqual(["204"]);
    });
  }
});
