// ---------------------------------------------------------------------------
// ICU MessageFormat — the subset the generated `t()` runtime (intl-messageformat)
// accepts, parsed purely so `ddd i18n check` can judge a translation without a
// runtime: syntax, the placeholder set against the source, and the plural forms
// the translation's locale requires.
//
// Grammar handled:
//   literal text, with ICU apostrophe quoting ('' = ', '{ … }' = literal)
//   {name}  {name, number|date|time|…[, style]}
//   {name, plural|selectordinal, [offset:N] =N {…} one {…} … other {…}}  and `#`
//   {name, select, a {…} … other {…}}
// Pure: no fs; `Intl.PluralRules` supplies the CLDR categories.
// ---------------------------------------------------------------------------

export type IcuChoice = {
  kind: "choice";
  name: string;
  type: "plural" | "selectordinal" | "select";
  offset?: number;
  options: { selector: string; body: IcuNode[] }[];
};

export type IcuNode =
  | { kind: "text"; value: string }
  | { kind: "pound" }
  | { kind: "arg"; name: string; type?: string; style?: string }
  | IcuChoice;

export class IcuSyntaxError extends Error {
  constructor(
    message: string,
    readonly offset: number,
  ) {
    super(message);
    this.name = "IcuSyntaxError";
  }
}

const NAME = /[^\s{},#<>'"]+/y;

class Parser {
  private i = 0;
  constructor(private readonly s: string) {}

  parse(): IcuNode[] {
    const nodes = this.nodes(0, false);
    if (this.i < this.s.length) throw new IcuSyntaxError("unmatched '}'", this.i);
    return nodes;
  }

  private fail(message: string): never {
    throw new IcuSyntaxError(message, this.i);
  }

  /** Parse until the `}` closing the enclosing branch (depth > 0) or the end. */
  private nodes(depth: number, inPlural: boolean): IcuNode[] {
    const out: IcuNode[] = [];
    let text = "";
    const flush = () => {
      if (text) out.push({ kind: "text", value: text });
      text = "";
    };
    while (this.i < this.s.length) {
      const c = this.s[this.i]!;
      if (c === "'") {
        const next = this.s[this.i + 1];
        if (next === "'") {
          text += "'";
          this.i += 2;
        } else if (next === "{" || next === "}" || (next === "#" && inPlural)) {
          // A quoted run: up to the next lone apostrophe.
          this.i += 1;
          while (this.i < this.s.length) {
            const q = this.s[this.i]!;
            if (q === "'") {
              if (this.s[this.i + 1] === "'") {
                text += "'";
                this.i += 2;
                continue;
              }
              this.i += 1;
              break;
            }
            text += q;
            this.i += 1;
          }
        } else {
          text += c;
          this.i += 1;
        }
      } else if (c === "{") {
        flush();
        this.i += 1;
        out.push(this.argument(depth, inPlural));
      } else if (c === "}") {
        flush();
        return out;
      } else if (c === "#" && inPlural) {
        flush();
        out.push({ kind: "pound" });
        this.i += 1;
      } else {
        text += c;
        this.i += 1;
      }
    }
    if (depth > 0) this.fail("unclosed '{'");
    flush();
    return out;
  }

  private ws(): void {
    while (this.i < this.s.length && /\s/.test(this.s[this.i]!)) this.i += 1;
  }

  private name(what: string): string {
    NAME.lastIndex = this.i;
    const m = NAME.exec(this.s);
    if (!m) this.fail(`expected ${what}`);
    this.i += m[0].length;
    return m[0];
  }

  private argument(depth: number, inPlural: boolean): IcuNode {
    this.ws();
    const name = this.name("an argument name");
    this.ws();
    if (this.s[this.i] === "}") {
      this.i += 1;
      return { kind: "arg", name };
    }
    if (this.s[this.i] !== ",") this.fail(`expected ',' or '}' after {${name}`);
    this.i += 1;
    this.ws();
    const type = this.name("an argument type");
    this.ws();
    if (type === "plural" || type === "selectordinal" || type === "select") {
      if (this.s[this.i] !== ",") this.fail(`expected ',' after "${type}"`);
      this.i += 1;
      return this.choice(name, type, depth);
    }
    let style: string | undefined;
    if (this.s[this.i] === ",") {
      this.i += 1;
      const start = this.i;
      while (this.i < this.s.length && this.s[this.i] !== "}") this.i += 1;
      style = this.s.slice(start, this.i).trim();
    }
    if (this.s[this.i] !== "}") this.fail(`unclosed {${name}, ${type}`);
    this.i += 1;
    void inPlural;
    return { kind: "arg", name, type, style };
  }

  private choice(name: string, type: IcuChoice["type"], depth: number): IcuNode {
    const options: IcuChoice["options"] = [];
    let offset: number | undefined;
    this.ws();
    if (type !== "select" && this.s.startsWith("offset:", this.i)) {
      this.i += "offset:".length;
      this.ws();
      const digits = /\d+/y;
      digits.lastIndex = this.i;
      const m = digits.exec(this.s);
      if (!m) this.fail("expected a number after 'offset:'");
      offset = Number(m[0]);
      this.i += m[0].length;
      this.ws();
    }
    while (this.i < this.s.length && this.s[this.i] !== "}") {
      const selector = this.name("a selector");
      this.ws();
      if (this.s[this.i] !== "{") this.fail(`expected '{' after selector "${selector}"`);
      this.i += 1;
      const body = this.nodes(depth + 1, type !== "select");
      if (this.s[this.i] !== "}") this.fail(`unclosed branch "${selector}"`);
      this.i += 1;
      if (options.some((o) => o.selector === selector)) {
        this.fail(`duplicate selector "${selector}"`);
      }
      options.push({ selector, body });
      this.ws();
    }
    if (this.s[this.i] !== "}") this.fail(`unclosed {${name}, ${type}`);
    this.i += 1;
    if (!options.some((o) => o.selector === "other")) {
      this.fail(`{${name}, ${type}} is missing the required "other" branch`);
    }
    if (type !== "select") {
      for (const o of options) {
        if (!/^(=\d+|zero|one|two|few|many|other)$/.test(o.selector)) {
          this.fail(`"${o.selector}" is not a plural selector`);
        }
      }
    }
    return { kind: "choice", name, type, offset, options };
  }
}

/** Parse `message`; throws {@link IcuSyntaxError}. */
export function parseIcu(message: string): IcuNode[] {
  return new Parser(message).parse();
}

/** Every argument name a parsed message references, branches included. */
export function placeholdersOf(nodes: readonly IcuNode[], into = new Set<string>()): Set<string> {
  for (const n of nodes) {
    if (n.kind === "arg") into.add(n.name);
    else if (n.kind === "choice") {
      into.add(n.name);
      for (const o of n.options) placeholdersOf(o.body, into);
    }
  }
  return into;
}

/** Every plural / selectordinal node, nested ones included. */
function collectPlurals(nodes: readonly IcuNode[], into: IcuChoice[] = []): IcuChoice[] {
  for (const n of nodes) {
    if (n.kind !== "choice") continue;
    if (n.type !== "select") into.push(n);
    for (const o of n.options) collectPlurals(o.body, into);
  }
  return into;
}

const CLDR_ORDER: readonly string[] = ["zero", "one", "two", "few", "many", "other"];

/** The CLDR plural categories `locale` uses, or undefined for a locale the
 *  runtime does not know. */
function categoriesFor(locale: string, type: "cardinal" | "ordinal"): string[] | undefined {
  try {
    if (Intl.PluralRules.supportedLocalesOf([locale]).length === 0) return undefined;
    return [...(new Intl.PluralRules(locale, { type }).resolvedOptions().pluralCategories ?? [])];
  } catch {
    return undefined;
  }
}

export type IcuIssue =
  | { kind: "syntax"; detail: string }
  | { kind: "missing-placeholder"; name: string }
  | { kind: "unexpected-placeholder"; name: string }
  | { kind: "plural-missing-form"; arg: string; form: string; valid: readonly string[] }
  | { kind: "plural-extra-form"; arg: string; form: string; valid: readonly string[] }
  | { kind: "tag-missing"; tag: string }
  | { kind: "tag-unexpected"; tag: string }
  | { kind: "tag-unbalanced"; detail: string }
  | { kind: "tag-unknown"; tag: string };

/** The inline-emphasis tags the rich-text runtime renders; any other tag is
 *  escaped to literal text. */
const RICH_TAGS: ReadonlySet<string> = new Set(["b", "i", "code"]);
const TAG = /<(\/?)([A-Za-z][\w-]*)\s*>/g;

type TagToken = { close: boolean; name: string };

function tagsIn(text: string): TagToken[] {
  return [...text.matchAll(TAG)].map((m) => ({ close: m[1] === "/", name: m[2]! }));
}

/** Balance problems of the tags in one scope (a message body or one plural /
 *  select branch), each judged on its own: a tag opened in a branch closes in it. */
function balanceIssues(nodes: readonly IcuNode[], out: IcuIssue[]): void {
  const stack: string[] = [];
  const problem = (detail: string) => out.push({ kind: "tag-unbalanced", detail });
  for (const n of nodes) {
    if (n.kind === "text") {
      for (const t of tagsIn(n.value)) {
        if (!RICH_TAGS.has(t.name)) continue;
        if (!t.close) stack.push(t.name);
        else if (stack[stack.length - 1] === t.name) stack.pop();
        else problem(`</${t.name}> does not close the open <${stack[stack.length - 1] ?? "…"}>`);
      }
    } else if (n.kind === "choice") {
      for (const o of n.options) balanceIssues(o.body, out);
    }
  }
  for (const open of stack) problem(`<${open}> is never closed`);
}

function collectTags(nodes: readonly IcuNode[], into: TagToken[] = []): TagToken[] {
  for (const n of nodes) {
    if (n.kind === "text") into.push(...tagsIn(n.value));
    else if (n.kind === "choice") for (const o of n.options) collectTags(o.body, into);
  }
  return into;
}

function hasChoice(nodes: readonly IcuNode[]): boolean {
  return nodes.some((n) => n.kind === "choice");
}

function tagIssues(source: readonly IcuNode[] | undefined, parsed: readonly IcuNode[]): IcuIssue[] {
  const issues: IcuIssue[] = [];
  balanceIssues(parsed, issues);
  const have = collectTags(parsed);
  const known = (ts: TagToken[]) => ts.filter((t) => RICH_TAGS.has(t.name));
  const sourceNames = new Set((source ? collectTags(source) : []).map((t) => t.name));
  for (const name of new Set(have.map((t) => t.name))) {
    if (!RICH_TAGS.has(name) && !sourceNames.has(name)) {
      issues.push({ kind: "tag-unknown", tag: name });
    }
  }
  if (!source) return issues;
  const want = known(collectTags(source));
  const got = known(have);
  // A plural branch repeats its tags once per form, and a locale has its own
  // form count, so a message with branches compares tag NAMES; a flat message
  // compares how many of each are used.
  const exact = !hasChoice(source) && !hasChoice(parsed);
  const count = (ts: TagToken[], n: string) => ts.filter((t) => !t.close && t.name === n).length;
  for (const name of [...RICH_TAGS].sort()) {
    const w = count(want, name);
    const g = count(got, name);
    if (g < w && (exact || g === 0)) issues.push({ kind: "tag-missing", tag: name });
    else if (g > w && (exact || w === 0)) issues.push({ kind: "tag-unexpected", tag: name });
  }
  return issues;
}

/** Human-readable one-liner for an issue. */
export function describeIssue(issue: IcuIssue): string {
  switch (issue.kind) {
    case "syntax":
      return `invalid ICU: ${issue.detail}`;
    case "missing-placeholder":
      return `placeholder {${issue.name}} from the source is missing`;
    case "unexpected-placeholder":
      return `placeholder {${issue.name}} is not in the source`;
    case "plural-missing-form":
      return `plural {${issue.arg}} lacks the "${issue.form}" form this locale requires (it uses ${issue.valid.join(", ")})`;
    case "plural-extra-form":
      return `plural {${issue.arg}} has a "${issue.form}" form this locale does not use (it uses ${issue.valid.join(", ")})`;
    case "tag-missing":
      return `rich-text tag <${issue.tag}> from the source is missing`;
    case "tag-unexpected":
      return `rich-text tag <${issue.tag}> is not in the source`;
    case "tag-unbalanced":
      return `unbalanced rich-text tags: ${issue.detail}`;
    case "tag-unknown":
      return `unknown tag <${issue.tag}> (only <b>, <i> and <code> are rendered)`;
    default: {
      const never: never = issue;
      return never;
    }
  }
}

/** Judge one translation against its source message for `locale`.  An empty
 *  list means it is sound.  A source that itself fails to parse is treated as
 *  opaque (nothing to compare), so only the translation's own syntax and plural
 *  forms are checked. */
export function validateTranslation(
  source: string,
  translation: string,
  locale: string,
): IcuIssue[] {
  let parsed: IcuNode[];
  try {
    parsed = parseIcu(translation);
  } catch (e) {
    if (e instanceof IcuSyntaxError) return [{ kind: "syntax", detail: e.message }];
    throw e;
  }
  const issues: IcuIssue[] = [];
  let sourceNames: Set<string> | undefined;
  let sourceNodes: IcuNode[] | undefined;
  try {
    sourceNodes = parseIcu(source);
    sourceNames = placeholdersOf(sourceNodes);
  } catch {
    sourceNames = undefined;
  }
  issues.push(...tagIssues(sourceNodes, parsed));
  if (sourceNames) {
    const have = placeholdersOf(parsed);
    for (const name of [...sourceNames].sort()) {
      if (!have.has(name)) issues.push({ kind: "missing-placeholder", name });
    }
    for (const name of [...have].sort()) {
      if (!sourceNames.has(name)) issues.push({ kind: "unexpected-placeholder", name });
    }
  }
  for (const p of collectPlurals(parsed)) {
    const required = categoriesFor(locale, p.type === "plural" ? "cardinal" : "ordinal");
    if (!required) continue;
    const forms = new Set(p.options.map((o) => o.selector).filter((s) => !s.startsWith("=")));
    // CLDR order (zero one two few many other), so the valid set reads the
    // way plural rules are written.
    const valid = CLDR_ORDER.filter((c) => required.includes(c));
    for (const form of valid) {
      if (!forms.has(form)) issues.push({ kind: "plural-missing-form", arg: p.name, form, valid });
    }
    for (const form of forms) {
      if (!valid.includes(form)) {
        issues.push({ kind: "plural-extra-form", arg: p.name, form, valid });
      }
    }
  }
  return issues;
}

// ---------------------------------------------------------------------------
// Printing (the pseudo-locale rewrites literal text and prints back).
// ---------------------------------------------------------------------------

function quoteText(text: string, inPlural: boolean): string {
  let out = "";
  for (const ch of text) {
    if (ch === "'") out += "''";
    else if (ch === "{" || ch === "}" || (ch === "#" && inPlural)) out += `'${ch}'`;
    else out += ch;
  }
  return out;
}

/** Print nodes back to ICU source, apostrophe-quoting literals. */
export function printIcu(nodes: readonly IcuNode[], inPlural = false): string {
  const one = (n: IcuNode): string => {
    switch (n.kind) {
      case "text":
        return quoteText(n.value, inPlural);
      case "pound":
        return "#";
      case "arg":
        return n.type
          ? `{${n.name}, ${n.type}${n.style !== undefined ? `, ${n.style}` : ""}}`
          : `{${n.name}}`;
      case "choice": {
        const nested = n.type !== "select";
        const off = n.offset !== undefined ? ` offset:${n.offset}` : "";
        const opts = n.options.map((o) => `${o.selector} {${printIcu(o.body, nested)}}`);
        return `{${n.name}, ${n.type},${off} ${opts.join(" ")}}`;
      }
      default: {
        const never: never = n;
        return never;
      }
    }
  };
  return nodes.map(one).join("");
}
