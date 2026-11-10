// The Flutter app localizes by catalog code (#4473).  Dart cannot be run under
// vitest, so these pin the emitted wiring (the generated app is analyzed by
// `flutter analyze` in the heavy gates): `ServerErrors.fromResponse` keeps each
// entry's `code` / `params` in a `ServerIssue`, the form renders
// `issue.text` — `t(code, message, params)` — when it BUILDS, and a validator
// message is a `t('<code>', '<english>')` call evaluated whenever the
// validator runs.

import { describe, expect, it } from "vitest";
import { fileOf, generateFor } from "../_frontend/error-codes-fixture.js";

const formsDart = async (scaffold = true) =>
  fileOf(await generateFor("flutter", scaffold), "lib/forms.dart");

describe("Flutter — server errors and client rules localize by catalog code", () => {
  it("keeps a server field error's and a refusal's code and params", async () => {
    const dart = await formsDart();
    expect(dart).toContain("class ServerIssue {");
    expect(dart).toContain("final Map<String, ServerIssue> fields;");
    // Per-entry code + params.
    expect(dart).toContain("final code = entry['code'];");
    expect(dart).toContain("ServerIssue.paramsOf(entry['params'])");
    // A refusal with no errors[]: the problem's own code, `problem.internal` by default.
    expect(dart).toContain("code is String ? code : 'problem.internal'");
  });

  it("renders them through t by code when the form builds", async () => {
    const dart = await formsDart();
    expect(dart).toContain("import 'i18n.dart';");
    expect(dart).toContain("return t(key, message, params);");
    expect(dart).toContain("String get key {");
    expect(dart).toContain("child: Text(_server!.fields[");
    expect(dart).toMatch(/_server!\.fields\[[^\]]+\]!\.text/);
    expect(dart).toContain("child: Text(_error!.text,");
  });

  it("translates validator messages by their code each time the validator runs", async () => {
    const dart = await formsDart();
    expect(dart).toContain("return t('field.missing', 'Required');");
    expect(dart).toContain("return t('field.type-mismatch', 'Enter a number');");
    expect(dart).toMatch(/return t\('Sales\.Order\.rule\.qtyPositive', '[^']*'\);/);
    expect(dart).toMatch(/return t\('Sales\.Order\.rule\.skuShape', '[^']*'\);/);
  });

  it("an app without a catalog shows the English as written", async () => {
    const dart = await formsDart(false);
    expect(dart).not.toContain("import 'i18n.dart';");
    expect(dart).not.toContain("t(code, message, params)");
    expect(dart).toContain("return message;");
  });
});
