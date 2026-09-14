// "Does the emitted code reference a name it never brought into scope?"
//
// This is the single most common way the generated-frontend build gates go
// red.  Of the 16 `main`-red events tracked on #2469, THIRTEEN were one
// instance of it: a paged `Table`'s pager chrome emitted `t("chrome.prev", …)`
// into a page that never imported `t`, so every generated project with a paged
// list and i18n on shipped a TS2304 (#2507).
//
// The reason it survived ten consecutive red sweeps is the shape worth
// remembering: it is a STATIC defect that only a COMPILER was looking for.
// `generated-react-build` compiles a 2-cell slice at PR time
// (`examples/showcase.ddd` × 2 packs) and the full 160-cell matrix only on
// `push: main`, so the introducing PR was green and the sweep was red
// afterwards — the workflow's own header calls this out ("Misses per-example
// drift").  No amount of merging `main` into the branch would have caught it:
// the failing cell is simply not in the PR gate's input set.
//
// But finding an unbound identifier never needed a type-checker.  Generating
// all 160 cells takes ~47s in-process (~294ms each); COMPILING them takes
// 60-90s per cell.  So the detection moves off the compiler and into the fast
// suite, where it runs per-PR over the whole matrix instead of post-merge over
// a slice.
//
// WHAT THIS DOES NOT DO.  It is a scope check, not a type check.  A prop-type
// mismatch, a DTO shape divergence, an arity error — none of those are visible
// here, and the `push: main` compile sweep remains the net for them.  This
// converts the most frequent failure mode into a per-PR check; it does not
// make the sweep redundant.
//
// ---------------------------------------------------------------------------
// THE BACKEND HALF (added for F-013).
//
// The same question — "does the emitted code reference a name it never brought
// into scope?" — has the same answer on the backends, and on ONE of them there
// is no compiler behind it at all:
//
//   node / .NET / Java   `tsc` / `dotnet build` / `gradle testClasses` reject an
//                        unbound name outright.  The per-PR build gate IS the check.
//   Elixir               `mix compile` errors on an undefined variable.
//   PYTHON               `python -m compileall` PASSES.  Python binds names at
//                        EXECUTION, so an unbound name is a perfectly valid
//                        module that raises `NameError` on the first request.
//
// So this half is Python-only, and deliberately so: it exists exactly where a
// compiler does not.  F-013 is the motivating instance — a `criterion` reading
// `currentUser` inside a `retrieval` emitted
//
//     query = select(WorkOrderRow).where((WorkOrderRow.technician_user_id == current_user.id))
//
// into `async def run_my_work_orders(self, offset, limit)`, which declares no
// such parameter.  Every gate the PR ran was green; `ruff check` (which the
// generated project's own `pyproject.toml` declares) reported `F821 Undefined
// name 'current_user'`, and a request would have raised `NameError`.
//
// THE UNIT IS THE FUNCTION, NOT THE FILE — and that is the load-bearing part.
// A file-level check (what the frontend half does, correctly, because a page IS
// one unit) would have MISSED F-013 in any system that also declares a
// `find … where … currentUser…`: that find's method signature binds
// `current_user: User`, so the file contains a binding, and a file-level check
// reads green while the retrieval two methods down is still broken.  So the
// python spec splits each file into `def` units and gives each unit only its
// own bindings plus the module-level ones.
//
// WHAT THE BACKEND HALF DOES NOT DO, beyond the caveat above: it tracks ONE
// name per spec, not every name — it is a targeted ratchet on the principal, in
// the shape of the frontend's targeted ratchet on `t`, not a Python scope
// analyser.  Running real `ruff` over the generated tree is the general answer,
// and it belongs in the python build gate where a pip install is affordable.

/** How each frontend names its page files, and the forms in which a page may
 *  legitimately bind the translate function.
 *
 *  The binding list is the load-bearing part: a check that only looked for
 *  `import { t }` would report every Angular page as broken, since Angular
 *  pages expose it as a class member instead. */
export interface FrontendScopeSpec {
  readonly framework: string;
  /** Files to inspect — the pages that render walker output. */
  readonly pages: RegExp;
}

export const FRONTEND_SCOPES: readonly FrontendScopeSpec[] = [
  { framework: "react", pages: /\/src\/pages\/.*\.tsx$/ },
  { framework: "vue", pages: /\/src\/pages\/.*\.vue$/ },
  { framework: "svelte", pages: /\+page\.svelte$/ },
  { framework: "angular", pages: /\/src\/app\/pages\/.*\.component\.ts$/ },
];

/** True when `content` brings `t` into scope by any of the legitimate routes.
 *
 *  - a named import — `import { t } from "…"` (react/vue/svelte)
 *  - an Angular class member — `protected readonly t = t`
 *  - a local alias — `const t = …`
 *
 *  Deliberately permissive: a FALSE PASS here costs one missed defect, while a
 *  false FAIL would fire on every page of a frontend whose binding form we did
 *  not anticipate and would get the whole gate disabled. */
export function bindsTranslate(content: string): boolean {
  return (
    /\bimport\s*\{[^}]*\bt\b[^}]*\}/.test(content) ||
    /\breadonly t = t\b/.test(content) ||
    /\b(?:const|let|var)\s+t\s*=/.test(content)
  );
}

/** Every page file that CALLS `t(` without binding it.  Returns the offending
 *  paths so a failure names them rather than just counting. */
export function unboundTranslateCalls(files: ReadonlyMap<string, string>, pages: RegExp): string[] {
  const bad: string[] = [];
  for (const [path, content] of files) {
    if (!pages.test(path)) continue;
    if (!/\bt\(/.test(content)) continue;
    if (!bindsTranslate(content)) bad.push(path);
  }
  return bad;
}

/** Page files that actually reached the translate runtime.
 *
 *  The vacuity guard.  `unboundTranslateCalls` returns `[]` both when every
 *  page is correct AND when nothing emitted a `t(` call at all — including
 *  when generation silently produced no pages.  A sweep that cannot tell those
 *  apart reports a comforting green for a broken harness, which is the exact
 *  failure mode `experience_gathered.md` §59/§63 keeps recording. */
export function translatingPages(files: ReadonlyMap<string, string>, pages: RegExp): string[] {
  return [...files]
    .filter(([path, content]) => pages.test(path) && /\bt\(/.test(content))
    .map(([path]) => path);
}

// ---------------------------------------------------------------------------
// Backend (Python) — one NAME, scoped per `def`.  See the module header for why
// this half is Python-only and why the unit is the function.
// ---------------------------------------------------------------------------

/** One emitted-Python name whose scope is checked per function. */
export interface PyScopeSpec {
  /** What the failure message calls the name. */
  readonly label: string;
  /** Emitted paths to inspect. */
  readonly files: RegExp;
  /** A USE of the bare name.  Must exclude every spelling that is a DIFFERENT
   *  name containing it as a substring (`require_current_user`,
   *  `current_user_var`) and every ATTRIBUTE access (`request.state.current_user`). */
  readonly uses: RegExp;
  /** Forms that bring the name into scope: a parameter annotation, an
   *  assignment, a `for`/`with`/`except … as` binding.  Deliberately permissive,
   *  for the same reason `bindsTranslate` is — a false FAIL gets the gate
   *  disabled, a false PASS costs one missed defect. */
  readonly binds: readonly RegExp[];
}

/** The request principal.  `current_user` is the bare local a `find`'s
 *  `current_user: User` parameter binds; `require_current_user()` is the ambient
 *  accessor every read that takes NO parameter must use instead. */
export const PY_PRINCIPAL_SCOPE: PyScopeSpec = {
  label: "the request principal `current_user`",
  files: /\/app\/.*\.py$/,
  // Not preceded by a word char or `.` (excludes `require_current_user`,
  // `_current_user`, `request.state.current_user`), and not followed by a word
  // char or `(` (excludes `current_user_var` and the module-level
  // `current_user()` GETTER, which is a call, not a principal read).
  uses: /(?<![\w.])current_user(?![\w(])/,
  binds: [
    // `current_user: User` (parameter / annotated local) and `current_user = …`.
    /(?<![\w.])current_user\s*[:=]/,
    // `for current_user in …` / `with … as current_user` / `except … as current_user`.
    /(?:\bfor\s+|\bas\s+)current_user\b/,
  ],
};

/** One `def` block of an emitted Python file: the function's own text, plus the
 *  name the failure message uses. */
export interface PyDefUnit {
  readonly name: string;
  readonly text: string;
}

/** Split emitted Python into the `def` units a name must be bound in.
 *
 *  Only module-level (indent 0) and class-method (indent 4) `def`s are units; a
 *  closure nested deeper stays part of its enclosing unit, so a name the outer
 *  function bound still counts for it.  A unit runs to the next `def`/`class`/
 *  decorator at the same or shallower indent — which over-includes rather than
 *  under-includes, again erring towards a false PASS. */
export function pyDefUnits(content: string): PyDefUnit[] {
  const lines = content.split("\n");
  const starts: { i: number; indent: number; name: string }[] = [];
  for (const [i, line] of lines.entries()) {
    const m = /^(\s*)(?:async\s+)?def\s+(\w+)\s*\(/.exec(line);
    if (!m) continue;
    const indent = m[1]!.length;
    if (indent > 4) continue;
    starts.push({ i, indent, name: m[2]! });
  }
  return starts.map((s, k) => {
    let end = lines.length;
    for (let j = s.i + 1; j < lines.length; j++) {
      const line = lines[j]!;
      if (line.trim() === "") continue;
      const indent = line.length - line.trimStart().length;
      if (indent > s.indent) continue;
      if (/^\s*(?:@|(?:async\s+)?def\s|class\s)/.test(line)) {
        end = j;
        break;
      }
    }
    // A following sibling `def` always closes the unit even when the scan above
    // stopped earlier (a decorator line), so units never overlap.
    const nextSibling = starts.slice(k + 1).find((o) => o.indent <= s.indent);
    if (nextSibling && nextSibling.i < end) end = nextSibling.i;
    return { name: s.name, text: lines.slice(s.i, end).join("\n") };
  });
}

/** The module-level (indent-0) lines of a file — imports and module globals,
 *  which every unit in the file has in scope. */
function pyModuleScope(content: string): string {
  return content
    .split("\n")
    .filter((l) => l.length > 0 && !/^\s/.test(l))
    .join("\n");
}

/** Blank out docstrings, string literals and `#` comments, so a name that only
 *  appears as TEXT is not read as a reference.
 *
 *  This is not cosmetic — it is the difference between a usable gate and a
 *  disabled one.  The emitted `app/auth/routes.py` reads the principal off the
 *  request scope by NAME, `getattr(request.state, "current_user", None)`, and
 *  its module docstring says "echoes the verified current_user".  Both are text;
 *  neither is an unbound reference, and a gate that reported them would be
 *  turned off within the day.  Replacement preserves length so nothing else
 *  shifts. */
function pyStripLiterals(content: string): string {
  const blank = (m: string) => " ".repeat(m.length);
  return content
    .replace(/'''[\s\S]*?'''|"""[\s\S]*?"""/g, blank)
    .replace(/'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"/g, blank)
    .replace(/#[^\n]*/g, blank);
}

/** Every emitted `def` that USES the spec's name without any binding for it in
 *  its own body/signature or at module level.  Entries read `path :: def name`
 *  so a failure points at the exact function. */
export function unboundPyReferences(
  files: ReadonlyMap<string, string>,
  spec: PyScopeSpec,
): string[] {
  const bad: string[] = [];
  for (const [path, raw] of files) {
    if (!spec.files.test(path)) continue;
    const content = pyStripLiterals(raw);
    if (!spec.uses.test(content)) continue;
    const moduleScope = pyModuleScope(content);
    const boundAtModuleLevel = spec.binds.some((b) => b.test(moduleScope));
    for (const unit of pyDefUnits(content)) {
      if (!spec.uses.test(unit.text)) continue;
      if (boundAtModuleLevel) continue;
      if (spec.binds.some((b) => b.test(unit.text))) continue;
      bad.push(`${path} :: ${unit.name}`);
    }
  }
  return bad;
}

/** The `def`s that actually READ the name — the vacuity guard, exactly as
 *  `translatingPages` is for the frontend half.  `unboundPyReferences` returns
 *  `[]` both when every function is correct AND when nothing referenced the
 *  principal at all, including when generation silently emitted nothing. */
export function pyReferencingUnits(
  files: ReadonlyMap<string, string>,
  spec: PyScopeSpec,
): string[] {
  const out: string[] = [];
  for (const [path, raw] of files) {
    if (!spec.files.test(path)) continue;
    for (const unit of pyDefUnits(pyStripLiterals(raw))) {
      if (spec.uses.test(unit.text)) out.push(`${path} :: ${unit.name}`);
    }
  }
  return out;
}
