import type { BoundedContextIR, TypeIR } from "../../../ir/types/loom-ir.js";
import { lines } from "../../../util/code-builder.js";
import { provenancedTypeMembers } from "../../_payload/provenanced-wire.js";
import {
  MONEY_INTEGER_DIGITS,
  MONEY_PRECISION,
  MONEY_RANGE_MESSAGE,
  MONEY_WIRE_SCALE,
} from "../../money-scale.js";
import {
  createFieldConstraints,
  createModelValidator,
  withFieldConstraint,
} from "./wire-constraints.js";

// ---------------------------------------------------------------------------
// `app/http/wire_models.py` — one Pydantic model per value object,
// shared by request and response DTOs.  Field names are the wire keys
// verbatim (DSL camelCase): the generated DTO layer is wire-shaped, so
// no alias machinery — conversion to snake_case domain happens in the
// route handlers.  Class names are the VO names, so FastAPI's OpenAPI
// components match the other backends'.
// ---------------------------------------------------------------------------

/** Name of the shared uuid-constrained string alias emitted into
 *  `app/http/wire_models.py`.  Referenced by every request-side reference
 *  (`X id`) annotation — request DTO fields, find query parameters and
 *  explicit-handler parameters alike — so the constraint and the published
 *  `format: uuid` are declared in exactly one place. */
export const PY_UUID_STR = "UuidStr";

/** Python source of the `UuidStr` alias.  `StringConstraints` supplies the
 *  VALIDATION (a failed pattern is an ordinary pydantic error, so FastAPI
 *  answers its standard 422 — the same envelope every other bad field gets),
 *  `WithJsonSchema` supplies the published SCHEMA (`{type: string, format:
 *  uuid}`) instead of the `pattern` pydantic would otherwise emit, so the
 *  spec reads identically to the other four backends'. */
const PY_UUID_STR_DEF = [
  `${PY_UUID_STR} = Annotated[`,
  "    str,",
  '    StringConstraints(pattern=r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"),',
  '    WithJsonSchema({"type": "string", "format": "uuid"}),',
  "]",
];

/** Name of the shared money-format string alias emitted into
 *  `app/http/wire_models.py`.  Referenced by every REQUEST-side `money`
 *  annotation, so the wire grammar is declared in exactly one place. */
export const PY_MONEY_STR = "MoneyStr";

/** Python source of the `MoneyStr` alias — the python arm of M-T6.48.
 *
 *  A `money` request field is a STRING on the wire and the route re-parses it
 *  with `Decimal(...)` (`pyWireToDomain`).  That parse was bare, so
 *  `{"price": "12,50"}` raised `decimal.InvalidOperation` out of the handler
 *  and FastAPI answered **500** — a client error reported as a server fault,
 *  where node answers a typed 4xx and .NET (whose arm landed first) answers
 *  422 with `{pointer, message}`.  Validating at the MODEL puts the refusal
 *  where pydantic already builds that envelope: the error carries the field's
 *  own `loc`, so `errors[].pointer` is `/price` — and `/best/offer` for a
 *  value-object field — with no pointer plumbing at the raise site.
 *
 *  `AfterValidator` rather than `StringConstraints(pattern=…)` (which is what
 *  `UuidStr` above uses) for ONE reason: the message.  A pattern failure reads
 *  "String should match pattern '…'", while node's `moneySchema` and .NET's
 *  `WireFormatException` both say `Invalid decimal: "12,50"`.  The wire-golden
 *  differential compares bodies across backends, so a divergent message is a
 *  real divergence — and as of M-T9.37 that gate can finally see the numbers
 *  it compares.  `PydanticCustomError` carries the text verbatim; a bare
 *  `ValueError` would prefix it with "Value error, ".
 *
 *  The regex is node's, character for character (`^-?\d+(\.\d+)?$`) — no
 *  exponent, no grouping, no leading `+`, which is exactly the grammar the
 *  `NUMERIC(19,4)` column and every other backend's parser accept. */
const PY_MONEY_STR_DEF = [
  "",
  '_MONEY_RE = re.compile(r"^-?\\d+(\\.\\d+)?$")',
  "",
  "",
  "def _money_str(value: str) -> str:",
  "    if _MONEY_RE.match(value) is None:",
  "        # The context form, not an f-string: the message is a TEMPLATE, and a",
  "        # value containing braces would otherwise be re-interpreted as one.",
  "        raise PydanticCustomError(",
  '            "money_format", "Invalid decimal: {value}", {"value": json.dumps(value)}',
  "        )",
  "    # RANGE, not format: the grammar above already passed, and what is left is",
  "    # a magnitude question the COLUMN answers.  Without this a 40-digit price",
  "    # is a well-formed decimal string a str passthrough happily forwards, so it",
  `    # reached NUMERIC(${MONEY_PRECISION},${MONEY_WIRE_SCALE}) and the DATABASE refused it — a 500 for a`,
  "    # client fault (M-T6.60 divergence 3).  Counted on the digits rather than",
  "    # computed, so a value too large to hold is never constructed.",
  `    if len(value.lstrip("-").split(".")[0].lstrip("0") or "0") > ${MONEY_INTEGER_DIGITS}:`,
  "        raise PydanticCustomError(",
  `            "money_range", ${JSON.stringify(`${MONEY_RANGE_MESSAGE}: {value}`)}, {"value": json.dumps(value)}`,
  "        )",
  "    return value",
  "",
  "",
  `${PY_MONEY_STR} = Annotated[`,
  "    str,",
  "    AfterValidator(_money_str),",
  '    WithJsonSchema({"type": "string", "format": "decimal"}),',
  "]",
];

/** Name of the shared "this is a JSON number" guard emitted into
 *  `app/http/wire_models.py`, and the aliases that carry it. */
export const PY_WIRE_NUM = "WireNum";
export const PY_WIRE_INT = "WireInt";

/** Python source of the numeric-type guard + its two aliases.
 *
 *  pydantic's default LAX mode coerces across JSON types, so a body the
 *  published contract rejects was accepted: `{"amount": false}` for a field
 *  declared `{"type": "number"}` answered **201** — python's `bool` is an `int`
 *  subclass — and `{"amount": "1.5"}` went through for the same reason
 *  (schemathesis F17, F7's python half). The other four backends refuse both:
 *  zod, System.Text.Json, Jackson and Ecto all read the JSON type. Measured on a
 *  booted app before and after.
 *
 *  A `BeforeValidator` over the two offending python types, NOT
 *  `ConfigDict(strict=True)`. Strict mode is the obvious fix and it is wrong
 *  here — measured, not reasoned. Against `model_validate_json` it does exactly
 *  the right thing (refusing bool/str → number while still accepting an integer
 *  literal for a `number` and an ISO string for a `datetime`), but FastAPI does
 *  not validate the JSON: it parses the body first and validates the resulting
 *  DICT, i.e. in pydantic's PYTHON mode, where strict also refuses
 *  `str → datetime` and `str → Enum`. Turning it on made every create carrying a
 *  date-time or an enum answer 422 — `"Input should be an instance of
 *  OrderStatus"` — on input that is perfectly valid JSON.
 *
 *  The guard publishes NOTHING, exactly like `WireStr`: it tightens the server
 *  onto the schema it already emits rather than changing the schema.
 *
 *  `bool` is checked before `str` only for readability — the two are disjoint.
 *  `Decimal` and `int` pass straight through, which is what keeps this safe on
 *  the RESPONSE side of the shared value-object models: `to_wire` yields those,
 *  never a bool or a string, for a field the schema calls a number. */
const PY_WIRE_NUM_DEF = [
  "def _reject_non_number(value: object) -> object:",
  "    if isinstance(value, (bool, str)):",
  `        raise ValueError("Input should be a valid number")`,
  "    return value",
  "",
  "",
  `${PY_WIRE_NUM} = Annotated[float, BeforeValidator(_reject_non_number)]`,
  `${PY_WIRE_INT} = Annotated[int, BeforeValidator(_reject_non_number)]`,
];

/** Name of the shared int32-constrained alias emitted into
 *  `app/http/wire_models.py`.  The twin of `UuidStr`, for the same reason: a
 *  declared `int` is an `int4` COLUMN, and both the bound and the published
 *  `format: int32` should be stated in exactly one place. */
export const PY_INT32 = "Int32";

/** Python source of the `Int32` alias.
 *
 *  A declared `int` lands in a Postgres `int4`. python published
 *  `{"type": "integer"}` with no bound and enforced none, so a value the
 *  contract permitted — measured, `qty: 9543751572142` — reached the column
 *  and answered **500** (schemathesis F11). .NET and java have always
 *  published `format: int32` and rejected the overflow at the binder; this is
 *  python catching up to them, not a new rule.
 *
 *  `Field(ge=…, le=…)` supplies the VALIDATION (an out-of-range value is an
 *  ordinary pydantic error, so FastAPI answers its standard 422 — the same
 *  envelope every other bad field gets), `WithJsonSchema` supplies the
 *  published SCHEMA, so the spec reads `{"type": "integer", "format":
 *  "int32"}` exactly as .NET's and java's do instead of pydantic's
 *  `exclusiveMinimum`/`maximum` pair.
 *
 *  `long` is deliberately NOT given a twin: it is a `bigint` column, and the
 *  int64 range it would declare is wider than the JSON numbers either python
 *  or node can carry exactly — a bound nothing enforces is the F21 mistake. */
const PY_INT32_DEF = [
  `${PY_INT32} = Annotated[`,
  "    int,",
  // The F17 guard rides here too: a declared `int` publishes
  // `{"type": "integer"}`, and `true` is not an integer however python spells
  // it.  Placed FIRST so it runs before the int coercion that would have
  // silently turned the bool into 0/1.
  `    BeforeValidator(_reject_non_number),`,
  "    Field(ge=-2147483648, le=2147483647),",
  '    WithJsonSchema({"type": "integer", "format": "int32"}),',
  "]",
];

/** Name of the query/path-parameter twin of `Int32`.
 *
 *  A QUERY PARAMETER is not JSON. It reaches FastAPI as a string off the URL
 *  (`?min=6` is `"6"`, never `6`), so the F17 numeric-type guard — which
 *  refuses a `str` for a field the contract calls a number — is exactly wrong
 *  here: it turned every `find popular(min: int)` read into a 422 saying
 *  *"Input should be a valid number"* for a perfectly well-formed request.
 *  Measured on the booted behavioral app, not reasoned from the emitter.
 *
 *  The BOUND and the published `format: int32` still apply — an `int4` column
 *  is an `int4` column however the value arrives — so this alias is `Int32`
 *  minus the guard, and nothing about the published schema moves. */
export const PY_INT32_PARAM = "Int32Param";

const PY_INT32_PARAM_DEF = [
  `${PY_INT32_PARAM} = Annotated[`,
  "    int,",
  "    Field(ge=-2147483648, le=2147483647),",
  '    WithJsonSchema({"type": "integer", "format": "int32"}),',
  "]",
];

/** Name of the shared NUL-rejecting string alias emitted into
 *  `app/http/wire_models.py`. */
export const PY_WIRE_STR = "WireStr";

/** Python source of the `WireStr` alias.
 *
 *  A declared `string` lands in a Postgres `text` column, which cannot hold
 *  U+0000: asyncpg raises `CharacterNotInRepertoireError` (22021) and the error
 *  escapes as a **500** (schemathesis F20). NUL is a legal JSON string
 *  character, so nothing upstream refuses it.
 *
 *  `AfterValidator` over an explicit predicate rather than
 *  `StringConstraints(pattern=…)`: a failed validator is an ordinary pydantic
 *  error (FastAPI's standard 422, with the field's own `loc`), and — unlike a
 *  pattern — it publishes NOTHING. That is deliberate: putting
 *  `pattern: "^[^\u0000]*$"` on every string in every schema would be a large,
 *  noisy contract change for a character no real client sends, and a server
 *  stricter than its contract is safe where the reverse (F21) is not.
 *
 *  REQUEST direction only. A response string came out of the very column that
 *  cannot hold a NUL, so re-checking it buys nothing. */
const PY_WIRE_STR_DEF = [
  "def _reject_nul(value: str) -> str:",
  '    if "\\x00" in value:',
  `        raise ValueError("must not contain a NUL character")`,
  "    return value",
  "",
  "",
  `${PY_WIRE_STR} = Annotated[str, AfterValidator(_reject_nul)]`,
];

/** The `from app.http.wire_models import …` line a routes-shaped module needs:
 *  its aliased value-object models plus `UuidStr` when the module annotates a
 *  reference-typed request field.  One import line (ruff F401 forbids the
 *  unused half, so both sides stay demand-driven). */
export function wireModelImport(
  voModelNames: readonly string[],
  refersTo: (n: string) => boolean,
): string | null {
  const names = [
    ...voModelNames.map((n) => `${n} as ${n}Model`),
    // The `Provenanced[T]` wire carrier, when this module annotates a
    // provenanced response field (M-T6.12).
    ...(refersTo(PY_PROVENANCED) ? [PY_PROVENANCED] : []),
    ...(refersTo(PY_UUID_STR) ? [PY_UUID_STR] : []),
    ...(refersTo(PY_MONEY_STR) ? [PY_MONEY_STR] : []),
    ...(refersTo(PY_INT32) ? [PY_INT32] : []),
    ...(refersTo(PY_INT32_PARAM) ? [PY_INT32_PARAM] : []),
    ...(refersTo(PY_WIRE_STR) ? [PY_WIRE_STR] : []),
    ...(refersTo(PY_WIRE_NUM) ? [PY_WIRE_NUM] : []),
    ...(refersTo(PY_WIRE_INT) ? [PY_WIRE_INT] : []),
  ];
  return names.length > 0 ? `from app.http.wire_models import ${names.join(", ")}` : null;
}

/** Pydantic field type for one wire-side value (REQUEST direction —
 *  money stays Decimal so the domain receives precise values). */
export function requestPyType(t: TypeIR, ctx: BoundedContextIR): string {
  return wireFieldType(t, ctx, "request", "Model");
}

/** Pydantic field type for the RESPONSE direction — `to_wire` already
 *  converted datetimes to ISO strings and the JSON layer serializes
 *  money as a number, so the model types match the projected dict. */
export function responsePyType(t: TypeIR, ctx: BoundedContextIR): string {
  return wireFieldType(t, ctx, "response", "Model");
}

/** Pydantic field type for a PATH or QUERY parameter.
 *
 *  A request BODY is JSON, so the value already carries a type and the F17
 *  guard can hold the server to the contract's `number`. A path/query
 *  parameter carries none: it is a substring of the URL, so `?min=6` arrives
 *  as `"6"` and the same guard refuses every well-formed read. Everything
 *  except the numeric arms is the request spelling — a `MoneyStr`, a
 *  `UuidStr` and a `WireStr` all constrain a string that arrives as a string.
 */
export function paramPyType(t: TypeIR, ctx: BoundedContextIR): string {
  return wireFieldType(t, ctx, "param", "Model");
}

function wireFieldType(
  t: TypeIR,
  ctx: BoundedContextIR,
  dir: "request" | "response" | "param",
  voSuffix: string,
): string {
  // A parameter is an INPUT, so every request-side narrowing applies to it —
  // only the numeric arms below distinguish the two.
  const inbound = dir !== "response";
  switch (t.kind) {
    case "primitive":
      switch (t.name) {
        // The declared `int` carries its int4 bound + `format: int32` through
        // the shared alias, in BOTH directions: the request needs the
        // validation, and the response needs the same published shape .NET and
        // java emit. `long` is a bigint and stays a bare `int` (see PY_INT32).
        case "int":
          return dir === "param" ? PY_INT32_PARAM : PY_INT32;
        case "long":
          // No `WireInt` on a parameter: the guard it carries rejects the very
          // string a query parameter always is (see PY_INT32_PARAM). A bare
          // `int` is what this annotated before F17, and it published the same
          // `{"type": "integer"}` then as now.
          return dir === "param" ? "int" : PY_WIRE_INT;
        case "decimal":
          return dir === "param" ? "float" : PY_WIRE_NUM;
        case "money":
          // Money crosses the wire as its canonical decimal STRING in both
          // directions on every backend (Hono/.NET/Java/Phoenix) — the route
          // handler re-parses it into Decimal for the domain
          // (`pyWireToDomain`), and `to_wire` stringifies on the way out.
          //
          // The REQUEST side carries the format constraint (M-T6.48): the
          // downstream `Decimal(...)` is total only for strings this alias
          // admits, so validating here is what turns a 500 into a 422.  The
          // RESPONSE side stays a bare `str` — it is OUR digits going out, the
          // constraint would never fire, and narrowing it would only publish a
          // needless schema restriction on a field clients read.
          return inbound ? PY_MONEY_STR : "str";
        // REQUEST only: the alias rejects a NUL the `text` column cannot hold
        // (F20). A response string came out of that same column.
        case "string":
          return inbound ? PY_WIRE_STR : "str";
        case "guid":
          return "str";
        case "bool":
          return "bool";
        case "datetime":
          return inbound ? "datetime" : "str";
        case "json":
          return "object";
        case "File":
          // A `File` field crosses the wire as the shared `FileRef`
          // ({url,key,contentType,size}) on every other backend — .NET's
          // `FileRef` record, java's `FileRef`, hono's zod object. Python fell
          // through to the `str` default below, so the DTO was typed `str`
          // while the DOMAIN attribute is `FileRef`: `mypy --strict` rejected
          // the handoff (`Argument "doc" … has incompatible type "str"`), and
          // the published schema said `string` where the other four said
          // object. No corpus fixture declared a `File` field until
          // `file-download.ddd` (M-T6.39), so no compile tier ever saw it.
          return "FileRef";
        default:
          return "str";
      }
    case "id":
      // A REFERENCE (`Customer id`) is a uuid on the wire and a `UUID` column
      // in Postgres.  A bare `str` let a non-uuid reach asyncpg, whose
      // `invalid input syntax for type uuid` escaped as a 500 (schemathesis
      // F2, and F3 through the query string — find parameters are annotated by
      // this same function).  `UuidStr` constrains the string AND publishes
      // `format: uuid`, so the answer is FastAPI's standard 422 and the spec
      // matches .NET's `Guid` / Java's `UUID` / Phoenix's `format: :uuid`.
      //
      // RESPONSE stays a bare `str`: the constraint is an INPUT gate, and the
      // response models are also fed by `to_wire` (which already yields the
      // stored uuid), so re-validating outbound buys nothing.
      return t.valueType === "guid" && inbound ? PY_UUID_STR : "str";
    case "enum":
      return t.name;
    case "valueobject":
      // Wire models share one shape across directions; the request/
      // response difference only bites on top-level scalars (datetime /
      // money), which VOs carry as their declared field types — the
      // VO model uses the response spelling (plain JSON numbers /
      // parsed datetimes accept both directions via coercion).
      return `${t.name}${voSuffix}`;
    case "entity":
      return `${t.name}Response`;
    case "array":
      return `list[${wireFieldType(t.element, ctx, dir, voSuffix)}]`;
    case "optional":
      return `${wireFieldType(t.inner, ctx, dir, voSuffix)} | None`;
    case "genericInstance":
      // `Provenanced[int]` (M-T6.12) — the value + lineage wire carrier as a
      // real generic model, NOT the `object` the default arm below would have
      // silently produced: a freeform `object` would erase the value's type
      // from the published OpenAPI schema, which is exactly the divergence the
      // carrier exists to remove.
      if (t.ctor === "provenanced") {
        return `${PY_PROVENANCED}[${wireFieldType(t.arg, ctx, dir, voSuffix)}]`;
      }
      return "object";
    default:
      return "object";
  }
}

/** The generic wire-carrier model's Python name. */
export const PY_PROVENANCED = "Provenanced";
/** The carrier model's type variable. */
const PY_PROV_TYPEVAR = "_ProvT";

/** `class Provenanced(BaseModel, Generic[_ProvT])` — the value + lineage
 *  carrier a `provenanced` field ships as (M-T6.12).  A classic `TypeVar` +
 *  `Generic[T]` rather than PEP-695 `class Provenanced[T]`, so the model does
 *  not depend on pydantic's newer generic-syntax support.  `lineage` is the
 *  opaque `ProvLineage` audit blob (`json` in the IR — Loom does not model its
 *  interior), nullable for a field that has never been written. */
function provenancedModel(): string[] {
  return [
    "",
    "",
    `${PY_PROV_TYPEVAR} = TypeVar("${PY_PROV_TYPEVAR}")`,
    "",
    "",
    `class ${PY_PROVENANCED}(BaseModel, Generic[${PY_PROV_TYPEVAR}]):`,
    `    """A provenanced field's value together with the lineage of the write`,
    "    that produced it — the same { value, lineage } object every other Loom",
    "    backend serves.  Storage keeps the two apart (a typed value column plus a",
    '    jsonb lineage column); only the wire folds them."""',
    "",
    ...provenancedTypeMembers({ kind: "none" }).map((m) =>
      m.type
        ? `    ${m.name}: ${PY_PROV_TYPEVAR}`
        : `    ${m.name}: dict[str, object] | None${m.optional ? " = None" : ""}`,
    ),
  ];
}

/** Does anything this context puts on the REQUEST side carry a `money`?
 *
 *  Decides whether `MoneyStr` (and its `json` / `re` / `PydanticCustomError`
 *  imports) is emitted at all.  Demand-driven on purpose: a context with no
 *  money keeps byte-identical wire models, and ruff's F401 would flag the dead
 *  imports otherwise.  Scans the three request-side surfaces — an aggregate's
 *  own fields (create/update bodies), its operation parameters, and value-object
 *  fields (nested in either) — through the optional/array wrappers. */
function typeHasMoney(t: TypeIR): boolean {
  switch (t.kind) {
    case "primitive":
      return t.name === "money";
    case "optional":
      return typeHasMoney(t.inner);
    case "array":
      return typeHasMoney(t.element);
    default:
      return false;
  }
}

function contextHasRequestMoney(ctx: BoundedContextIR): boolean {
  const inVo = ctx.valueObjects.some((vo) => vo.fields.some((f) => typeHasMoney(f.type)));
  const inAgg = ctx.aggregates.some(
    (a) =>
      a.fields.some((f) => typeHasMoney(f.type)) ||
      (a.operations ?? []).some((op) => (op.params ?? []).some((p) => typeHasMoney(p.type))),
  );
  // Repository FINDS too — a `find cheaperThan(limit: money)` renders a query
  // parameter annotated `MoneyStr`, and it is the one surface that can carry
  // money with none on the aggregate itself.  Omitting it here would emit a
  // routes module referencing an alias its wire_models never defined.
  const inFind = ctx.repositories.some((r) =>
    (r.finds ?? []).some((f) => (f.params ?? []).some((p) => typeHasMoney(p.type))),
  );
  return inVo || inAgg || inFind;
}

export function renderPyWireModels(ctx: BoundedContextIR): string {
  const needsMoney = contextHasRequestMoney(ctx);
  const models = ctx.valueObjects.map((vo) => {
    // A VO's own `invariant`s ride the SAME wire carriers the aggregate
    // command DTOs use (`Field(...)` + `@model_validator`).  Pydantic
    // validates a nested VO model on request parse, so a malformed VO field
    // is rejected at the wire boundary with 422 — matching the node (Zod
    // `<VO>Schema`) and Elixir (VO changeset) backends, instead of falling
    // through to the domain constructor's `DomainError` → 400.
    const available = new Set(vo.fields.map((f) => f.name));
    const constraints = createFieldConstraints(vo.invariants, available);
    const validator = createModelValidator(vo.invariants, available, vo.name);
    return lines(
      "",
      "",
      `class ${vo.name}(BaseModel):`,
      vo.fields.map((f) =>
        withFieldConstraint(
          f.name,
          wireFieldType(f.type, ctx, "request", ""),
          constraints.get(f.name),
        ),
      ),
      validator,
    );
  });
  // The `Provenanced[T]` carrier model — emitted here (beside the VO models) so
  // every routes module imports one definition instead of re-declaring the
  // shape per aggregate.
  const hasProv = ctx.aggregates.some(
    (a) =>
      a.fields.some((f) => f.provenanced) ||
      a.parts.some((p) => p.fields.some((f) => f.provenanced)),
  );
  const body = models.join("") + (hasProv ? lines(...provenancedModel()) : "");
  const uses = (n: string): boolean => new RegExp(`\\b${n}\\b`).test(body);
  const enumNames = ctx.enums.map((e) => e.name).filter(uses);
  const pydanticNames = [
    ctx.valueObjects.length > 0 || hasProv ? "BaseModel" : null,
    // `Field` is unconditional because `Int32` uses it, and `Int32` — like
    // `UuidStr` and `WireStr` — is emitted unconditionally.
    "Field",
    // `AfterValidator` likewise: the always-emitted `WireStr` alias uses it.
    "AfterValidator",
    // `BeforeValidator` likewise: the always-emitted `WireNum`/`WireInt` aliases
    // and `Int32` all carry the F17 numeric-type guard.
    "BeforeValidator",
    // `UuidStr` is emitted unconditionally (every routes module imports it for
    // its reference-typed request annotations), so its two pydantic pieces are
    // always in the import list.
    "StringConstraints",
    // `MoneyStr` (M-T6.48) also needs `AfterValidator`, and used to add its own
    // conditional entry here — but the name became UNCONDITIONAL above when the
    // always-emitted `WireStr` alias started using it (F20), so a second entry
    // is now a duplicate import.  Removed rather than re-ordered: the position
    // that note was defending is the one the name already occupies.
    // A messaged single-field rule raises through `ValidationError.
    // from_exception_data` so the error carries the field's `loc` (M-T1.11).
    uses("ValidationError") ? "ValidationError" : null,
    "WithJsonSchema",
    uses("model_validator") ? "model_validator" : null,
  ].filter((n): n is string => n != null);
  return lines(
    `"""Pydantic wire models for value objects.  Auto-generated."""`,
    "",
    // Demand-driven, unlike `UuidStr` below: every routes module annotates a
    // reference id, but plenty of contexts carry no money at all, and ruff F401
    // would flag the dead `json` / `re` imports in those.  Keeping it
    // conditional also means a money-free project's wire models are
    // byte-identical to before this alias existed — which
    // `vo-invariant-422.test.ts` pins deliberately.
    needsMoney ? "import json" : null,
    needsMoney ? "import re" : null,
    needsMoney ? "" : null,
    uses("datetime") ? "from datetime import datetime" : null,
    uses("Decimal") ? "from decimal import Decimal" : null,
    hasProv ? "from typing import Annotated, Generic, TypeVar" : "from typing import Annotated",
    "",
    `from pydantic import ${pydanticNames.join(", ")}`,
    // `_money_str` raises one too, so the money alias pulls it in even when no
    // messaged invariant does.
    uses("PydanticCustomError") || needsMoney
      ? `from pydantic_core import ${uses("InitErrorDetails") ? "InitErrorDetails, PydanticCustomError" : "PydanticCustomError"}`
      : null,
    enumNames.length > 0 ? "" : null,
    enumNames.length > 0 ? `from app.domain.value_objects import ${enumNames.join(", ")}` : null,
    "",
    PY_UUID_STR_DEF,
    needsMoney ? PY_MONEY_STR_DEF : null,
    "",
    PY_WIRE_NUM_DEF,
    "",
    PY_INT32_DEF,
    "",
    PY_INT32_PARAM_DEF,
    "",
    PY_WIRE_STR_DEF,
    models.join(""),
    hasProv ? provenancedModel() : null,
    "",
  );
}
