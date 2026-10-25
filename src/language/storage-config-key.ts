// ---------------------------------------------------------------------------
// Phase ① parse-error rewrite — a vendor setting written straight into a
// `storage` block instead of under its `config: { … }` map.
//
//     storage mailServer { type: smtp, from: "no-reply@shop.test" }
//
// A `storage` block admits a fixed clause set (`type`, `instance`,
// `connection`, `config`); every vendor parameter is a `config` entry.  A key
// written beside `type:` makes the block's clause sequence end early, so
// chevrotain reports it against the closing brace — "Expecting token of type
// '}' but found `bucket`" — or, when the key happens to be a Loom keyword
// (`from`), the reserved-name rewrite calls it a keyword to rename.  Neither
// names the fix, which is to move the key under `config:`.
//
// `storageConfigKey` recognises the shape — a word followed by `:` as the
// failing token, directly inside a `storage <name> { … }` block, that is not
// one of the block's own clauses — and says where the key belongs.  The
// clause set is read off the grammar's `Storage` rule, so a new clause is
// excluded the moment it parses.  Anything else returns `undefined` and the
// caller keeps the other rewrites' text.
//
// Layering: `src/language/` (phase ①), called by `ddd-document-validator.ts`
// beside the rewrites in `parse-errors.ts`.  Node-free.
// ---------------------------------------------------------------------------

import type { IRecognitionException } from "chevrotain";
import { AstUtils, GrammarAST } from "langium";
import { diagMessage } from "../diagnostics/messages.js";
import { DddGrammar } from "./generated/grammar.js";
import { openBlocksAt } from "./misplaced-declaration.js";

/** The word-shaped keywords of the grammar's `Storage` rule other than its
 *  head — the block's own clause names. */
let clauses: Set<string> | undefined;
function storageClauses(): Set<string> {
  if (clauses) return clauses;
  const rule = DddGrammar().rules.find(
    (r): r is GrammarAST.ParserRule => GrammarAST.isParserRule(r) && r.name === "Storage",
  );
  const out = new Set<string>();
  if (rule) {
    for (const node of AstUtils.streamAllContents(rule)) {
      if (GrammarAST.isKeyword(node) && /^[A-Za-z]+$/.test(node.value)) out.add(node.value);
    }
  }
  out.delete("storage");
  clauses = out;
  return out;
}

const STORAGE_HEADER = /(?:^|\s)storage\s+([A-Za-z_][A-Za-z0-9_]*)$/;

export interface StorageConfigKey {
  offset: number;
  length: number;
  message: string;
}

/** A `key: value` written directly in a `storage` block that is not one of its
 *  clauses — say it goes under `config: { … }`.  `undefined` otherwise. */
export function storageConfigKey(
  err: IRecognitionException,
  text: string,
): StorageConfigKey | undefined {
  const token = err.token;
  if (!token || Number.isNaN(token.startOffset)) return undefined;
  const key = token.image;
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return undefined;
  if (!/^\s*:(?![:=])/.test(text.slice(token.startOffset + key.length))) return undefined;
  if (storageClauses().has(key)) return undefined;
  const open = openBlocksAt(text, token.startOffset);
  const innermost = open[open.length - 1];
  const m = innermost ? STORAGE_HEADER.exec(innermost.header) : null;
  if (!m?.[1]) return undefined;
  return {
    offset: token.startOffset,
    length: key.length,
    message: diagMessage("loom.parse-error#storage-config-key", {
      key,
      storage: m[1],
      clauses: [...storageClauses()].map((c) => `'${c}'`).join(", "),
    }),
  };
}
