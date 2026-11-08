// ---------------------------------------------------------------------------
// Pack-DECLARED chrome (M-T1.11, i18n.md "pack-chrome catalogs").
//
// The design packs bake user-visible English into their `.hbs` templates — an
// array field's "Remove"/"Add <item>", an op dialog's "This operation has no
// parameters.", a bool cell's "Yes"/"No", a picker's "Select…".  The
// content-hash extraction pass (`_walker/i18n-extract.ts`) cannot see any of
// it: that pass walks the IR, and these strings exist only in a template.
//
// The `chrome.<name>` catalog (`_walker/i18n-chrome.ts`) covers the OTHER half
// of this problem — chrome an EMITTER builds and hands to a template as a
// ready-made token.  That works when the walker knows the string exists.  It
// does not scale to strings a pack invents on its own: a pack author would have
// to add a curated key in the toolchain, a token in the emitter's view model,
// and a threading argument at every call site — for a word only their pack
// renders.  Two of the fifteen packs spell the empty picker option "— select —"
// rather than "Select…"; one spells a breadcrumb landmark; the shadcn dialogs
// carry a visually-hidden "Close".  None of those belong in a shared table.
//
// So a pack DECLARES its own strings, in `pack.json`:
//
//     "chrome": {
//       "removeItem": "Remove",
//       "paginationAria": "Pagination"
//     }
//
// A declared message is a whole sentence: a hole is for DATA only (a number, an
// id), never for a word a generator fills in.  A message that varies by
// aggregate, operation or item type ("Add line", "Ship succeeded") is instead
// generated per subject by the walker and handed to the template as a token
// (`{{{addItemLabel}}}`, `{{{successMessage}}}`), and the pack lists the bases
// it reads in `sentenceChrome`.
//
// and its templates spell them through four Handlebars helpers this module
// binds into every `pack.render(...)` (see `loader.ts`):
//
//     {{{chrome "removeItem"}}}                  markup TEXT position
//     {{{chrome "countOf" count=rowCount}}}      … with ICU data-hole values
//     {{{chromeAttr "aria-label" "paginationAria"}}}  a whole ATTRIBUTE
//     {{{chromeValue "boolTrue"}}}               a target VALUE
//     {{{chromeImport "../i18n"}}}               the runtime import, whole-FILE
//                                                templates only
//
// WHY A MANIFEST BLOCK RATHER THAN SCRAPING THE `.hbs`.  Scraping cannot tell a
// user-visible word from a component name, an `@doc` string or a CSS class, and
// a pack author would have no way to opt a string out.  Worse, the extracted
// text would have no ROLE — and a role is what makes two occurrences of "Close"
// in one pack distinguishable to a translator.  A declaration is also the only
// form that can be VALIDATED (see `assertDeclaredChromeIsSane`) and gated: a
// template naming an undeclared role fails the render, loudly, at the pack that
// owns it.
//
// KEYS — `pack.<family>.<role>.<hash>`, consistent with D-I18N-KEY.
//   - `pack.` namespace: cannot collide with `page.*` / `component.*` / `menu.*`
//     (authored strings) or `chrome.*` (the curated emitter-side table).
//   - `<family>` not `<family>@<version>`: mantine v7 and v9 spell "Remove"
//     identically, and a translator should translate it ONCE.  When two
//     versions diverge the content hash separates them automatically — which is
//     the whole point of hashing the message rather than versioning the key.
//   - `<hash>` of the message: a pack REPHRASING its chrome re-keys, so `ddd
//     i18n sync` sees a delete-old + add-new instead of silently keeping a
//     translation of the previous wording.
//
// i18n-OFF IS BYTE-IDENTICAL BY CONSTRUCTION, not by reconstruction: the
// binding starts OFF, and OFF each helper returns exactly the bytes the
// template spells inline (`chromeImport` returns nothing at all).  A
// frontend opts in only for a UI that is already i18n-enabled by its authored
// strings — the same gate `APP_SHELL_CHROME` / `FORM_CHROME` use, so pack
// chrome never flips the translation runtime on for a string-less app.
// ---------------------------------------------------------------------------

import Handlebars from "handlebars";
import { diagMessage } from "../../diagnostics/messages.js";
import type { PackFormat } from "../../util/builtin-formats.js";
import { contentHash } from "../../util/content-hash.js";
import { sourceText } from "../_i18n/source-text.js";
import { WIRE_ERROR_MESSAGES } from "../_i18n/wire-error-text.js";
import { chromeKey, chromeMessage } from "../_walker/i18n-chrome.js";
import {
  chromeDeclarationDefects,
  describePackDefects,
  CHROME_HOLE as HOLE,
} from "./pack-defects.js";

/** The literal prefix of every pack-chrome binding the JS frontends emit.
 *
 *  A fragment template (a form field, an op dialog) renders INTO a page file
 *  whose import block is owned by the walker, so the walker greps its rendered
 *  output for this marker and wires `t` itself — the same honest question the
 *  hoisted-`DataGrid`-child renderers ask with `CHROME_T_CALL`, and for the
 *  same reason: whether the chrome appears at all is the active pack's call.
 *
 *  Precise on purpose — a looser `"t("` test matches `format(`, `getContext(`
 *  and friends. */
export const PACK_CHROME_T_CALL = 't("pack.';

/** The catalog key for one pack-declared chrome string: `pack.<family>.<role>.<hash>`. */
export function packChromeKey(family: string, role: string, message: string): string {
  return `pack.${family}.${role}.${contentHash(message)}`;
}

/** The full `{ key: message }` catalog a pack declares.  Every declared role,
 *  not the used-only subset: a template's use of a role is decided by the
 *  Handlebars conditionals around it (a `{{#if rowFields}}` branch), which is
 *  not statically knowable here.  That is the trade `FORM_CHROME` already
 *  documents — an unused key costs a translator one phrase, a missing one is a
 *  binding no locale can ever reach — and it is bounded by construction,
 *  because a pack only declares chrome it renders. */
export function packChromeCatalog(manifest: {
  name: string;
  chrome?: Record<string, string>;
}): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [role, message] of Object.entries(manifest.chrome ?? {})) {
    out[packChromeKey(manifest.name, role, message)] = message;
  }
  return out;
}

/** Reject a chrome declaration that cannot be rendered safely — the
 *  `chromeDeclarationDefects` half of the pack defect list (`pack-defects.ts`),
 *  as a throw for a caller holding a bare manifest. */
export function assertDeclaredChromeIsSane(manifest: {
  name: string;
  chrome?: Record<string, string>;
}): void {
  const defects = chromeDeclarationDefects(manifest);
  if (defects.length > 0) {
    throw new Error(
      diagMessage("loom.design-pack-invalid#load", {
        pack: manifest.name,
        defects: describePackDefects(defects),
      }),
    );
  }
}

/** How one frontend spells a translated chrome binding.  Three positions, and
 *  they genuinely differ per format — a Vue attribute grows a `:` prefix, an
 *  Angular one grows brackets, HEEx text rides an EEx tag. */
interface ChromeSpelling {
  /** The runtime CALL — `t(key, msg, values)` / `pgettext(key, msg)`. */
  call(key: string, message: string, holes: ReadonlyArray<[string, string]>): string;
  /** A target-language string literal (the i18n-OFF value position). */
  literal(text: string): string;
  /** Wrap a call for markup TEXT position. */
  text(expr: string): string;
  /** A whole bound attribute: `name={expr}` / `:name='expr'` / `[name]='expr'`. */
  attr(name: string, expr: string): string;
  /** The runtime import line for a whole-FILE template — a JS `import { t }`,
   *  or on HEEx the `use Gettext, backend: …` that defines `pgettext/2`. */
  importLine(specifier: string): string;
}

/** `t(key, default, { hole: "value" })` — the shared JS/TS spelling every
 *  frontend's generated `i18n` shim exposes.  Identical to the call
 *  `i18n-emit.ts` builds for authored strings, deliberately: a chrome call and
 *  a page-string call must be indistinguishable to the runtime. */
function jsCall(key: string, message: string, holes: ReadonlyArray<[string, string]>): string {
  const args = [JSON.stringify(key), JSON.stringify(message)];
  if (holes.length > 0) {
    args.push(`{ ${holes.map(([n, v]) => `${n}: ${JSON.stringify(v)}`).join(", ")} }`);
  }
  return `t(${args.join(", ")})`;
}

/** Elixir double-quoted literal.  A declared message cannot contain `"`, `\`,
 *  `<` or `>` (rejected at load), so only `#` — which would open an Elixir
 *  interpolation — and the HEEx-significant braces need escaping here.  `\xHH`
 *  produces the identical runtime string, so the emitted msgid still matches
 *  the `.po` entry byte for byte. */
function elixirLiteral(text: string): string {
  return `"${text.replace(/#/g, "\\#").replace(/\{/g, "\\x7B").replace(/\}/g, "\\x7D")}"`;
}

const JSX_SPELLING: ChromeSpelling = {
  call: jsCall,
  literal: (text) => JSON.stringify(text),
  text: (expr) => `{${expr}}`,
  attr: (name, expr) => `${name}={${expr}}`,
  importLine: (specifier) => `import { t } from ${JSON.stringify(specifier)};\n`,
};

const SPELLINGS: Record<PackFormat, ChromeSpelling> = {
  tsx: JSX_SPELLING,
  // Svelte 5 markup uses the same `{expr}` interpolation and the same
  // `attr={expr}` binding as JSX.
  svelte: JSX_SPELLING,
  vue: {
    call: jsCall,
    literal: (text) => JSON.stringify(text),
    text: (expr) => `{{ ${expr} }}`,
    // Single-quoted: the expression carries double-quoted JS string literals
    // (the key and the default), which a `"` delimiter would terminate.  The
    // same choice `vueTarget.renderAttrBinding` makes for such expressions.
    attr: (name, expr) => `:${name}='${expr}'`,
    importLine: (specifier) => `import { t } from ${JSON.stringify(specifier)};\n`,
  },
  angular: {
    call: jsCall,
    literal: (text) => JSON.stringify(text),
    text: (expr) => `{{ ${expr} }}`,
    // A plain HTML attribute needs `[attr.…]`; a component input takes the bare
    // bracket form.  Hyphenated names (`aria-label`, `data-*`) are always the
    // former — a bare `[aria-label]` targets a non-existent element property
    // and fails `ng build`.
    attr: (name, expr) => `[${name.includes("-") ? `attr.${name}` : name}]='${expr}'`,
    importLine: (specifier) => `import { t } from ${JSON.stringify(specifier)};\n`,
  },
  heex: {
    // gettext keys by the source STRING, Loom by a content hash — `pgettext/2`
    // carries both (the Loom key is the msgctxt).  Holes are rejected for HEEx
    // packs (see `chromeHelpers`), so the call never needs `loom_icu`.
    call: (key, message) => `pgettext(${elixirLiteral(key)}, ${elixirLiteral(message)})`,
    literal: elixirLiteral,
    text: (expr) => `<%= ${expr} %>`,
    attr: (name, expr) => `${name}={${expr}}`,
    // `pgettext/2` resolves ambiently in a LAYOUT, through `html_helpers`'
    // `use Gettext, backend: …` — but NOT in `core_components.ex`, which is a
    // plain `use Phoenix.Component` module and imports nothing.  So the "import"
    // a HEEx pack asks for is the Gettext USE, and the specifier it passes is
    // its own web module (`{{{chromeImport webModule}}}`).
    //
    // Gettext ≥ 0.26 split the backend from the macros: `import <App>Web.Gettext`
    // brings in nothing, and only `use Gettext, backend: …` defines `pgettext/2`.
    importLine: (webModule) => `  use Gettext, backend: ${webModule}.Gettext\n`,
  },
};

/** `translate_error/1` with no translation runtime: Ecto's own English with its
 *  `%{key}` placeholders filled from the error's opts. */
const PLAIN_TRANSLATE_ERROR = `  defp translate_error({msg, opts}) do
    Enum.reduce(opts, msg, fn {key, value}, acc ->
      String.replace(acc, "%{#{key}}", fn _ -> to_string(value) end)
    end)
  end`;

/** `translate_error/1` under gettext (see the `translateError` helper). */
function localizedTranslateError(webModule: string): string {
  // The codes a form field can carry beside a rule's own key: the field reasons,
  // plus the two persistence refusals a changeset surfaces.  Each clause is the
  // `pgettext/2` MACRO over literals — the catalog key and its English — so
  // `mix gettext.extract` sees it and the process locale resolves it.
  const codes = Object.keys(WIRE_ERROR_MESSAGES)
    .filter(
      (code) =>
        code.startsWith("field.") ||
        code === "problem.unique-conflict" ||
        code === "problem.dangling-reference",
    )
    .sort();
  const clauses = codes
    .map(
      (code) =>
        `  defp localized_error(${elixirLiteral(code)}, _msg), do: pgettext(${elixirLiteral(code)}, ${elixirLiteral(WIRE_ERROR_MESSAGES[code]!)})`,
    )
    .join("\n");
  return `  # A server-originated field error is localized HERE, in the LiveView process,
  # by the catalog code the JSON wire carries for the same refusal: a named rule's
  # identity key (\`loom_code\`), a rule's generic key (\`loom_rule_code\`), else
  # the field reason the validation names.  The values the rule read
  # (\`loom_params\`) fill the catalog text's \`{name}\` holes.
  defp translate_error({msg, opts}) do
    code = loom_error_code(opts)
    params = Keyword.get(opts, :loom_params) || %{}

    text =
      Enum.reduce(params, localized_error(code, msg), fn {key, value}, acc ->
        String.replace(acc, "{#{key}}", fn _ -> to_string(value) end)
      end)

    Enum.reduce(opts, text, fn {key, value}, acc ->
      String.replace(acc, "%{#{key}}", fn _ -> to_string(value) end)
    end)
  end

${clauses}
  # A named rule's msgid is its own text, which is the error's message; its code
  # is only known at run time, so this is the runtime \`pgettext/4\`.
  defp localized_error(code, msg), do: Gettext.pgettext(${webModule}.Gettext, code, msg)

  defp loom_error_code(opts) do
    Keyword.get(opts, :loom_code) || Keyword.get(opts, :loom_rule_code) ||
      case {Keyword.get(opts, :validation), Keyword.get(opts, :constraint)} do
        {:required, _} -> "field.missing"
        {:cast, _} -> "field.type-mismatch"
        {_, :unique} -> "problem.unique-conflict"
        {_, :foreign} -> "problem.dangling-reference"
        _ -> "field.rule"
      end
  end`;
}

/** Substitute a message's ICU holes with their literal values — the i18n-OFF
 *  rendering, which must reproduce the bytes the template spells inline. */
function fillHoles(message: string, holes: ReadonlyArray<[string, string]>): string {
  const byName = new Map(holes);
  return message.replace(HOLE, (whole, name: string) => byName.get(name) ?? whole);
}

/** The hole values passed as Handlebars hash args, as ordered pairs.  Values
 *  are STRINGS by construction: a pack supplies them from template data
 *  (`elementLabel`, `humanOp`) — compile-time text, not a runtime expression,
 *  which is what lets the i18n-OFF path splice them in verbatim. */
function holesOf(options: Handlebars.HelperOptions): Array<[string, string]> {
  return Object.entries(options.hash ?? {}).map(([name, value]) => [name, String(value)]);
}

/** Every `.hbs` helper this module binds, for one pack in one i18n state.
 *  `i18n: false` (the default a pack loads in) yields the raw bytes the
 *  template spells inline. */
export function chromeHelpers(
  manifest: { name: string; chrome?: Record<string, string>; format?: PackFormat },
  i18n: boolean,
): Record<string, Handlebars.HelperDelegate> {
  const family = manifest.name;
  const format = manifest.format ?? "tsx";
  const spelling = SPELLINGS[format];

  const declared = (role: unknown): string => {
    const message = manifest.chrome?.[String(role)];
    if (message === undefined) {
      // A literal role is checked at load (`pack-defects.ts`, kind
      // `chrome-role-undeclared`); only a computed one can reach here.
      throw new Error(
        diagMessage("loom.design-pack-invalid#load", {
          pack: family,
          defects: `no chrome string "${String(role)}" (declare it in pack.json's \`chrome\` map: { "chrome": { "${String(role)}": "<English>" } })`,
        }),
      );
    }
    return message;
  };

  const bind = (role: string, message: string, holes: Array<[string, string]>): string => {
    if (format === "heex" && holes.length > 0) {
      // Not a limitation worth hiding: gettext cannot substitute ICU holes on
      // its own (D-I18N-HEEX-ICU routes authored interpolation through
      // `loom_icu`), and no HEEx pack needs a holed chrome string.  Checked at
      // load for every literal role (`pack-defects.ts`, kind
      // `chrome-hole-heex`), so a `{page}` never reaches a user.
      throw new Error(
        diagMessage("loom.design-pack-invalid#load", {
          pack: family,
          defects: `chrome role "${role}" passes ICU hole values, which the heex format does not render (split the sentence or drop the hole)`,
        }),
      );
    }
    const key = packChromeKey(family, role, message);
    return spelling.call(key, sourceText(key, message), holes);
  };

  return {
    /** Markup TEXT position. */
    chrome(role: unknown, options: Handlebars.HelperOptions) {
      const message = declared(role);
      const holes = holesOf(options);
      const out = i18n
        ? spelling.text(bind(String(role), message, holes))
        : fillHoles(message, holes);
      return new Handlebars.SafeString(out);
    },
    /** A whole ATTRIBUTE, name included — the name itself changes shape under a
     *  binding on Vue (`:x`) and Angular (`[attr.x]`), so the template cannot
     *  spell it and take only the value. */
    chromeAttr(name: unknown, role: unknown, options: Handlebars.HelperOptions) {
      const message = declared(role);
      const holes = holesOf(options);
      const out = i18n
        ? spelling.attr(String(name), bind(String(role), message, holes))
        : `${String(name)}="${fillHoles(message, holes)}"`;
      return new Handlebars.SafeString(out);
    },
    /** A target-native VALUE — a JS expression slot (a toast argument, a `??`
     *  fallback), where the i18n-OFF form is a quoted string literal. */
    chromeValue(role: unknown, options: Handlebars.HelperOptions) {
      const message = declared(role);
      const holes = holesOf(options);
      const out = i18n
        ? bind(String(role), message, holes)
        : spelling.literal(fillHoles(message, holes));
      return new Handlebars.SafeString(out);
    },
    /** The translation-runtime import, for a template that emits a WHOLE FILE
     *  (`format-helpers`, a shadcn `components/ui/*`).  A fragment template
     *  must NOT use this — its output lands in a page file whose import block
     *  the walker owns; that path is wired by grepping for
     *  {@link PACK_CHROME_T_CALL}.
     *
     *  The specifier is the PACK's to give: only the pack knows where its file
     *  lands relative to the generated `i18n` module, and that differs per
     *  frontend (`../i18n` from `src/lib/format.ts` on React/Vue, `./i18n`
     *  where the runtime is a sibling under `src/lib/`). */
    chromeImport(specifier: unknown) {
      return new Handlebars.SafeString(i18n ? spelling.importLine(String(specifier)) : "");
    },
    /** A HEEx pack's `translate_error/1` (a HEEx-only template call) — the function that turns a
     *  `{message, opts}` form-field error into text.  Off i18n it interpolates
     *  `%{key}` placeholders into Ecto's own English.  On, a server-originated
     *  error is localized IN PROCESS through gettext by the same catalog `code`
     *  the JSON wire carries (`loom_code`, else the rule's generic key, else the
     *  field reason the validation names), with the values it read
     *  (`loom_params`) filled into `{name}` holes.  The argument is the pack's
     *  web module, whose `Gettext` backend resolves the code. */
    translateError(webModule: unknown) {
      if (format !== "heex") {
        throw new Error(
          `pack-chrome: {{translateError}} is a HEEx-pack helper; pack ${family} has format ${format}.`,
        );
      }
      return new Handlebars.SafeString(
        i18n ? localizedTranslateError(String(webModule)) : PLAIN_TRANSLATE_ERROR,
      );
    },
    /** A SHARED `chrome.<name>` string (`_walker/i18n-chrome.ts`) in markup
     *  TEXT position — for a pack template that renders a control every
     *  frontend spells, so it must read the same key (a list pager's "Prev" /
     *  "Next" / "Page {page} of {pages}").  HEEx only: the JS packs receive
     *  these as walker-built tokens.
     *
     *  Hole values are RUNTIME Elixir expressions (`page="@page"`).  Off i18n
     *  each hole renders as a HEEx `{expr}` interpolation inside the English;
     *  on, gettext resolves the message and each hole is substituted into the
     *  active locale's text — raw substitution, so `core_components.ex` needs
     *  no ICU runtime. */
    sharedChrome(name: unknown, options: Handlebars.HelperOptions) {
      if (format !== "heex") {
        throw new Error(
          `pack-chrome: {{sharedChrome}} is a HEEx-pack helper; pack ${family} (format ${format}) renders shared chrome through walker-built tokens.`,
        );
      }
      const message = chromeMessage(String(name));
      const holes = holesOf(options);
      if (!i18n) {
        const byName = new Map(holes);
        return new Handlebars.SafeString(
          message.replace(HOLE, (whole, hole: string) =>
            byName.has(hole) ? `{${byName.get(hole)}}` : whole,
          ),
        );
      }
      let call = `pgettext(${elixirLiteral(chromeKey(String(name)))}, ${elixirLiteral(message)})`;
      for (const [hole, expr] of holes) {
        call = `String.replace(${call}, ${elixirLiteral(`{${hole}}`)}, to_string(${expr}))`;
      }
      return new Handlebars.SafeString(spelling.text(call));
    },
  };
}
