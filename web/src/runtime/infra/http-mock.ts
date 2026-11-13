// The playground's restApi mock: the infra worker's one `HttpMock`
// (src/emulation), sampling registered OpenAPI schemas with `openapi-sampler`.

import { createHttpMock, type OpenApiDoc } from "../../../../src/emulation/http-mock.js";
import type { ResourceOp } from "./resource-types.js";
import type { InfraService } from "./service.js";

const mock = createHttpMock({ sample: async () => (await import("openapi-sampler")).sample });

export const httpMockService: InfraService<ResourceOp> = {
  name: "httpMock",
  handle({ op, params }) {
    const p = params as { method: string; url: string; origin?: string; spec?: OpenApiDoc };
    if (op === "request") return mock.request({ method: p.method, url: p.url });
    if (op === "log") return mock.log();
    if (op === "registerSpec") {
      mock.registerSpec(p.origin as string, p.spec as OpenApiDoc);
      return { ok: true };
    }
    throw new Error(`httpMock: unknown op "${op}"`);
  },
  reset: () => mock.reset(),
};
