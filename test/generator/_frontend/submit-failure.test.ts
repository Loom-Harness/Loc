// The submit-failure rule (`src/generator/_frontend/submit-failure.ts`): its
// case table agrees with the rule, and every code it names is a catalog key,
// so the form message a target renders always has catalog text.

import { describe, expect, it } from "vitest";
import {
  FALLBACK_PROBLEM_CODE,
  STATUS_PROBLEM_CODE,
  SUBMIT_FAILURE_CASES,
  submitFailure,
  UNREACHABLE_CHROME,
} from "../../../src/generator/_frontend/submit-failure.js";
import { WIRE_ERROR_MESSAGES } from "../../../src/generator/_i18n/wire-error-text.js";
import { FORM_CHROME } from "../../../src/generator/_walker/i18n-chrome.js";

describe("submit failure rule", () => {
  it.each(SUBMIT_FAILURE_CASES.map((c) => [JSON.stringify(c), c] as const))("%s", (_n, c) => {
    expect(submitFailure(c)).toEqual(c.expect);
  });

  it("every code it can answer has catalog text", () => {
    for (const code of [...Object.values(STATUS_PROBLEM_CODE), FALLBACK_PROBLEM_CODE]) {
      expect(WIRE_ERROR_MESSAGES[code], code).toBeDefined();
    }
    expect(FORM_CHROME[`chrome.${UNREACHABLE_CHROME}`]).toBeDefined();
  });

  it("the table reaches every outcome", () => {
    const kinds = new Set(SUBMIT_FAILURE_CASES.map((c) => c.expect.kind));
    expect([...kinds].sort()).toEqual(["fields", "form", "unreachable"]);
  });
});
