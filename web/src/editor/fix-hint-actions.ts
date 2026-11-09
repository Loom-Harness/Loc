// ---------------------------------------------------------------------------
// Fix-hint quick fixes for the playground's Problems panel.
//
// Every fix-hint-carrying diagnostic (`src/language/fix-hints.ts`) resolves to
// an LSP `CodeAction` whose `WorkspaceEdit` is fully resolved against the
// source.  The editor's lightbulb gets them straight from the language-server
// worker (`DddCodeActionProvider`, registered by the language client); the
// Problems panel's **Fix** action gets the same actions through
// `loomQuickFixes` below.  This module is the boundary: LSP shapes in,
// editor-neutral shapes out.
//
// It imports NO monaco.  `monaco-editor` is a browser-only dep of `web/`, and
// the part worth unit-testing is exactly the part that doesn't need it — the
// position arithmetic.  LSP positions are **0-based** (`line`/`character`),
// Monaco's are **1-based** (`startLineNumber`/`startColumn`), and an off-by-one
// here silently rewrites the wrong span of the user's source, which is strictly
// worse than offering no quick fix at all.
// ---------------------------------------------------------------------------

// The toolkit is reached through `await import(...)`, NOT a static import.
// `src/api` value-imports `src/language` + `src/ir`, so a static edge here puts
// Langium, chevrotain and the whole grammar on the EAGER path — and this module
// is imported by `layout/ProblemsPanel.tsx`, which is part of the always-mounted
// dock.  That is the exact regression `web/scripts/check-eager-chunks.mjs`
// exists to catch (it took eager JS from 1.63 MB to 12.96 MB); see M-T8.15 for
// why it matters on iOS.  `loomQuickFixes` is already async, so the dynamic
// import costs it nothing.

/** The part of an LSP `CodeAction` this boundary actually consumes.
 *
 *  Declared STRUCTURALLY rather than imported from `vscode-languageserver-types`
 *  on purpose.  `web/` resolves its own copy of that package, and the two copies
 *  disagree about `Diagnostic.message` (`string` vs `string | MarkupContent`),
 *  so a nominal import makes the toolkit's `CodeAction[]` un-assignable to a
 *  parameter typed from web's copy — a dual-package identity clash, not a real
 *  shape mismatch.  Naming the four fields we read is both the smaller contract
 *  and the honest one: this module is a boundary, and a boundary should state
 *  what it needs. */
interface LspCodeActionLike {
  title: string;
  isPreferred?: boolean;
  diagnostics?: readonly { range: LspRange }[];
  edit?: { changes?: Record<string, readonly { range: LspRange; newText: string }[]> };
}

/** An LSP range — 0-based line/character, end-exclusive. */
export interface LspRange {
  start: { line: number; character: number };
  end: { line: number; character: number };
}

/** A Monaco `IRange` — 1-based line numbers AND columns. */
export interface EditorRange {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
}

export interface EditorTextEdit {
  range: EditorRange;
  text: string;
}

/** One applyable quick fix, in the shape `LoomEditor` hands to Monaco.
 *  `anchor` is where the fix belongs in the document (the diagnostic's own
 *  range when it has one) — the Problems row whose line it covers offers it,
 *  so a fix on line 90 doesn't show on a row for line 3. */
export interface LoomQuickFix {
  title: string;
  edits: EditorTextEdit[];
  anchor: EditorRange;
  /** Whether the editor should mark this the one obvious repair.  Carried from
   *  the `CodeAction`, never assumed: a `choose`-kind hint fans out one action
   *  per option precisely because there is NO single right answer, and marking
   *  them all preferred would let the editor auto-apply an arbitrary one. */
  preferred: boolean;
}

/** LSP range → Monaco range.  Both coordinates shift by one; `character` and
 *  `column` are otherwise the same "code units before this point" count, so
 *  end-exclusive stays end-exclusive. */
export function toEditorRange(range: LspRange): EditorRange {
  return {
    startLineNumber: range.start.line + 1,
    startColumn: range.start.character + 1,
    endLineNumber: range.end.line + 1,
    endColumn: range.end.character + 1,
  };
}

/** Every `CodeAction` from `fixHintCodeActions`, converted.
 *
 *  Deliberately shape-driven, not count-driven: it flattens whatever
 *  `edit.changes` buckets an action carries and maps every action it is given,
 *  so a provider that grows from one action per diagnostic to several (a
 *  `choose`-kind hint fanned out one action per option) needs no change here.
 *  An action with no resolved text edit is dropped — there is nothing to apply. */
export function toQuickFixes(actions: readonly LspCodeActionLike[]): LoomQuickFix[] {
  const fixes: LoomQuickFix[] = [];
  for (const action of actions) {
    const changes = action.edit?.changes;
    if (!changes) continue;
    const edits = Object.values(changes)
      .flat()
      .map((e) => ({ range: toEditorRange(e.range), text: e.newText }));
    if (edits.length === 0) continue;
    const diagRange = action.diagnostics?.[0]?.range;
    fixes.push({
      title: action.title,
      edits,
      anchor: diagRange ? toEditorRange(diagRange) : edits[0]!.range,
      preferred: action.isPreferred === true,
    });
  }
  return fixes;
}

/** Where quick fixes come from when a language server is running: the
 *  `LoomLspClient` surface, structurally, so this module keeps no static edge
 *  to the client (and through it to monaco). */
export interface QuickFixSource {
  quickFixes(uri: string): Promise<unknown[]>;
}

// Mobile-only memo for the toolkit fallback below: Problems re-asks whenever
// its diagnostics move, and those only move on generate there.  Keyed by
// (source, uri).
let cache: { key: string; fixes: Promise<LoomQuickFix[]> } | undefined;

/** Every fix-hint quick fix in the document at `uri`, editor-shaped.
 *  Never throws: a compiler-internal failure must not break the Fix action.
 *
 *  With a language client (desktop) the fixes come from the LSP worker, which
 *  has already parsed and validated the document — the main thread does no
 *  Langium work at all.  Calling the toolkit's `validate` here instead builds
 *  a fresh Loom service (parser self-analysis included) per distinct source:
 *  a 250 ms main-thread task per keystroke, since the source changes on every
 *  one.  Without a client (mobile: no Monaco, no worker) the toolkit is the
 *  only source, and there it runs per generate, not per keystroke. */
export async function loomQuickFixes(
  source: string,
  uri: string,
  lsp: QuickFixSource | null,
): Promise<LoomQuickFix[]> {
  try {
    if (lsp) return toQuickFixes((await lsp.quickFixes(uri)) as LspCodeActionLike[]);
  } catch {
    return [];
  }
  const key = `${uri}\n${source}`;
  if (cache?.key === key) return cache.fixes;
  const fixes = (async () => {
    try {
      const { fixHintCodeActions, validate } = await import("../../../src/api/index.js");
      const report = await validate(source);
      return toQuickFixes(await fixHintCodeActions(report, source, uri));
    } catch {
      return [];
    }
  })();
  cache = { key, fixes };
  return fixes;
}
