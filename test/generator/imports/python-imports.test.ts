import { describe, expect, it } from "vitest";
import {
  finalizePyModule,
  PY_IMPORTS,
  pyFrom,
  pyModule,
  pyRef,
} from "../../../src/generator/_imports/python.js";
import {
  assertNoMarkers,
  hasMarkers,
  ref,
  spellMarkers,
} from "../../../src/generator/_imports/symbol.js";
import { generateCorpusCase } from "../../fixtures/corpus/harness.js";

// M-T9.84 — imports derived from use, python finalizer.  The canonical order
// below was read off `ruff check --select I --fix` (ruff 0.15, isort
// defaults) on the same inputs; the corpus-wide oracle is `ruff --select I`
// over every generated python project.

const doc = '"""Doc."""';

describe("ref() markers", () => {
  it("spell to the handle's name / alias / module, and nothing else", () => {
    const text = `${ref(pyFrom("decimal", "Decimal"))}(1) ${ref(pyModule("re"))}.x ${pyRef("app.http.wire_models", "Money", "MoneyModel")}`;
    expect(hasMarkers(text)).toBe(true);
    expect(spellMarkers(text)).toBe("Decimal(1) re.x MoneyModel");
  });

  it("reject a malformed handle at the reference site", () => {
    expect(() => ref(pyFrom("decimal", "Dec imal"))).toThrow(/bad name/);
    expect(() => ref(pyModule("re-x"))).toThrow(/bad module/);
  });

  it("assertNoMarkers fails closed on an unfinalized module", () => {
    expect(() => assertNoMarkers("app/x.py", `a\nb = ${pyRef("decimal", "Decimal")}`)).toThrow(
      /app\/x\.py:2: unresolved import marker/,
    );
    expect(() => assertNoMarkers("app/x.py", "plain")).not.toThrow();
  });
});

describe("finalizePyModule — derivation", () => {
  it("derives the block from the markers that survived into the text", () => {
    const out = finalizePyModule(
      [
        doc,
        "",
        PY_IMPORTS,
        "",
        "",
        `x: ${pyRef("decimal", "Decimal")} = ${pyRef("decimal", "Decimal")}("1")`,
        "",
      ].join("\n"),
    );
    expect(out).toBe(
      [doc, "", "from decimal import Decimal", "", 'x: Decimal = Decimal("1")', ""].join("\n"),
    );
  });

  it("text that was rendered and then dropped leaves no import behind", () => {
    const dropped = `${pyRef("decimal", "Decimal")}(0)`;
    void dropped;
    const out = finalizePyModule([doc, "", PY_IMPORTS, "", "", "x = 1", ""].join("\n"));
    expect(out).toBe([doc, "", "", "", "x = 1", ""].join("\n"));
  });

  it("merges not-yet-migrated hand-written imports, de-duplicated", () => {
    const out = finalizePyModule(
      [
        doc,
        "",
        "from decimal import Decimal",
        "from app.obs.log import log",
        "",
        "",
        `def f() -> ${pyRef("decimal", "Decimal")}:`,
        `    ${ref(pyModule("re"))}.compile("x")`,
        "",
      ].join("\n"),
    );
    expect(out.split("\n").slice(0, 7)).toEqual([
      doc,
      "",
      "import re",
      "from decimal import Decimal",
      "",
      "from app.obs.log import log",
      "",
    ]);
  });

  it("a module with no imports and no markers is returned unchanged", () => {
    const text = [doc, "", "", "x = 1", ""].join("\n");
    expect(finalizePyModule(text)).toBe(text);
  });

  it("is idempotent", () => {
    const once = finalizePyModule(
      [doc, "", "from typing import cast, Any", "import math", "", "", "def f(): pass", ""].join(
        "\n",
      ),
    );
    expect(finalizePyModule(once)).toBe(once);
  });

  it("fails closed when a referencing module has no import region", () => {
    expect(() =>
      finalizePyModule([doc, "", "x = 1", `y = ${pyRef("decimal", "Decimal")}`].join("\n"), {
        path: "app/y.py",
      }),
    ).toThrow(/app\/y\.py: references Decimal but has no import region/);
  });

  it("fails closed on two imports binding one name", () => {
    expect(() =>
      finalizePyModule(
        [
          doc,
          "",
          PY_IMPORTS,
          "",
          `${pyRef("app.domain.value_objects", "Money")} ${pyRef("app.http.wire_models", "Money")}`,
        ].join("\n"),
      ),
    ).toThrow(/two imports bind 'Money'/);
    // An alias resolves it.
    expect(() =>
      finalizePyModule(
        [
          doc,
          "",
          PY_IMPORTS,
          "",
          `${pyRef("app.domain.value_objects", "Money")} ${pyRef("app.http.wire_models", "Money", "MoneyModel")}`,
        ].join("\n"),
      ),
    ).not.toThrow();
  });

  it("fails closed when an import collides with a module-level definition", () => {
    expect(() =>
      finalizePyModule([doc, "", PY_IMPORTS, "", `x = ${pyRef("app.x", "Order")}`].join("\n"), {
        declares: ["Order"],
      }),
    ).toThrow(/collides with a module-level definition/);
  });
});

// A user's type name is never refused for how a backend spells its imports:
// the framework side of a collision takes a deterministic alias.
describe("finalizePyModule — framework names alias, model names stay bare", () => {
  const model = pyRef("app.domain.value_objects", "Request");

  it("aliases a hand-written framework import and its bare uses", () => {
    const out = finalizePyModule(
      [
        doc,
        "",
        "from fastapi import APIRouter, Request",
        "",
        "",
        "def handler(req: Request, m: " + `${model}) -> None:`,
        '    """Request docs: Request."""',
        "    req.Request = Request.state",
        "    f(Request=1)",
      ].join("\n"),
    );
    expect(out).toContain("from fastapi import APIRouter");
    expect(out).toContain("from fastapi import Request as _fastapi_Request");
    expect(out).toContain("from app.domain.value_objects import Request");
    expect(out).toContain("def handler(req: _fastapi_Request, m: Request) -> None:");
    // docstring, attribute access and keyword names are not references
    expect(out).toContain('"""Request docs: Request."""');
    expect(out).toContain("req.Request = _fastapi_Request.state");
    expect(out).toContain("f(Request=1)");
  });

  it("aliases a framework marker and keeps the model marker bare", () => {
    const out = finalizePyModule(
      [
        doc,
        "",
        PY_IMPORTS,
        "",
        `a: ${pyRef("decimal", "Decimal")}`,
        `b: ${pyRef("app.domain.value_objects", "Decimal")}`,
      ].join("\n"),
    );
    expect(out).toContain("from decimal import Decimal as _decimal_Decimal");
    expect(out).toContain("a: _decimal_Decimal");
    expect(out).toContain("b: Decimal");
  });

  it("aliases a framework import whose name the module defines itself", () => {
    const out = finalizePyModule(
      [
        doc,
        "",
        "from pydantic import BaseModel",
        "",
        "",
        "class BaseModel(BaseModel):",
        "    pass",
      ].join("\n"),
    );
    expect(out).toContain("from pydantic import BaseModel as _pydantic_BaseModel");
    expect(out).toContain("class BaseModel(_pydantic_BaseModel):");
  });

  it("re-aliases an already aliased framework member by its binding", () => {
    const out = finalizePyModule(
      [
        doc,
        "",
        "from datetime import date as CalendarDate",
        "",
        "",
        "class CalendarDate:",
        "    d: CalendarDate",
      ].join("\n"),
    );
    expect(out).toContain("from datetime import date as _datetime_CalendarDate");
    expect(out).toContain("class CalendarDate:");
    expect(out).toContain("d: _datetime_CalendarDate");
  });

  it("spells a shadowed builtin through the builtins module", () => {
    const out = finalizePyModule(
      [
        doc,
        "",
        PY_IMPORTS,
        "",
        "def f():",
        "    raise ValueError('x')",
        "",
        "",
        `class Holder:\n    v: ${pyRef("app.domain.value_objects", "ValueError")}`,
      ].join("\n"),
    );
    expect(out).toContain("import builtins");
    expect(out).toContain("raise builtins.ValueError('x')");
    expect(out).toContain("v: ValueError");
  });

  it("leaves a module without a collision untouched", () => {
    const src = [
      doc,
      "",
      "from fastapi import Request",
      "",
      "",
      "def f(r: Request): pass",
      "",
    ].join("\n");
    expect(finalizePyModule(src)).toBe(src);
  });

  it("still refuses two model-side imports (neither may move)", () => {
    expect(() =>
      finalizePyModule(
        [
          doc,
          "",
          PY_IMPORTS,
          "",
          `${pyRef("app.domain.a", "Money")} ${pyRef("app.domain.b", "Money")}`,
        ].join("\n"),
      ),
    ).toThrow(/two imports bind 'Money'/);
  });
});

describe("finalizePyModule — canonical order (ruff isort defaults)", () => {
  const block = (...imports: string[]): string[] =>
    finalizePyModule([doc, "", ...imports, "", "x = 1", ""].join("\n"))
      .split("\n")
      .slice(2, -3);

  it("sections: __future__ · stdlib · third-party · first-party; `import` before `from`", () => {
    expect(
      block(
        "from app.domain.ids import OrderId",
        "from sqlalchemy import select",
        "import redis.asyncio as aioredis",
        "from __future__ import annotations",
        "from uuid import uuid4",
        "import uuid",
        "import re",
      ),
    ).toEqual([
      "from __future__ import annotations",
      "",
      "import re",
      "import uuid",
      "from uuid import uuid4",
      "",
      "import redis.asyncio as aioredis",
      "from sqlalchemy import select",
      "",
      "from app.domain.ids import OrderId",
    ]);
  });

  it("names: order-by-type (CONSTANTS, Classes, rest), case-insensitive within a type", () => {
    expect(block("from m import beta, Beta, BETA, B2, b_x, bX, Zed")).toEqual([
      "from m import B2, BETA, Beta, Zed, b_x, beta, bX",
    ]);
    expect(block("from typing import cast, TYPE_CHECKING, Any, Annotated")).toEqual([
      "from typing import TYPE_CHECKING, Annotated, Any, cast",
    ]);
  });

  it("modules compare case-insensitively", () => {
    expect(block("from app.Zeta import z", "from app.http.x import y")).toEqual([
      "from app.http.x import y",
      "from app.Zeta import z",
    ]);
  });

  it("aliased members get their own line, ordered by first member (unaliased first on a tie)", () => {
    expect(
      block(
        "from m import Money as MM",
        "from m import Money, Zed",
        "from m import Abc as B",
        "from m import Abc as A",
      ),
    ).toEqual([
      "from m import Abc as A",
      "from m import Abc as B",
      "from m import Money, Zed",
      "from m import Money as MM",
    ]);
  });

  it("wraps a line longer than 100 columns, and only then", () => {
    const at100 = `from app.abc import ${"x".repeat(80)}`;
    expect(at100.length).toBe(100);
    expect(block(at100)).toEqual([at100]);
    expect(block(`from app.abd import ${"y".repeat(81)}`)).toEqual([
      "from app.abd import (",
      `    ${"y".repeat(81)},`,
      ")",
    ]);
  });

  it("reads a parenthesized hand-written import", () => {
    expect(
      block(
        "from app.domain.errors import (",
        "    DomainError,",
        "    AggregateNotFoundError,",
        ")",
      ),
    ).toEqual(["from app.domain.errors import AggregateNotFoundError, DomainError"]);
  });

  it("blank lines after the block: two before def/class/decorator (through comments), else one", () => {
    const tail = (next: string[]): string[] =>
      finalizePyModule([doc, "", "import re", ...next].join("\n"))
        .split("\n")
        .slice(3);
    expect(tail(["x = 1"])).toEqual(["", "x = 1"]);
    expect(tail(["", "", "", "x = 1"])).toEqual(["", "x = 1"]);
    expect(tail(["", "def f(): pass"])).toEqual(["", "", "def f(): pass"]);
    expect(tail(["", "# note", "class A: pass"])).toEqual(["", "", "# note", "class A: pass"]);
    expect(tail(["", "@dataclass", "class A: pass"])).toEqual([
      "",
      "",
      "@dataclass",
      "class A: pass",
    ]);
  });
});

describe("the python backend finalizes every module it emits", () => {
  // The wiring gate: `PyOutputMap` must route every `.py` through the
  // finalizer, so each emitted module is a FIXED POINT of it (canonical block,
  // no marker left).  A module that bypassed the finalizer keeps its
  // hand-written order and is not.
  it.each([
    "core-domain",
    "auth-oidc",
    "channels-broker",
    "vo-regex-invariant",
    "projection-join",
  ])("%s: every .py is canonical and marker-free", async (feature) => {
    const files = await generateCorpusCase(feature, "python");
    const py = [...files].filter(([p]) => p.endsWith(".py"));
    expect(py.length).toBeGreaterThan(10);
    const off = py
      .filter(
        ([path, content]) => hasMarkers(content) || finalizePyModule(content, { path }) !== content,
      )
      .map(([p]) => p);
    expect(off).toEqual([]);
  });
});
