// ---------------------------------------------------------------------------
// Pseudo-locale `en-XA`: accented, padded, bracketed English.  A UI switched to
// it shows every string that went through `t()` as `[Ĥéļļö ~~~]`; anything still
// plain ASCII is a hardcoded string.  ICU structure (arguments, plural/select
// branches) is preserved; only literal text is rewritten.
// ---------------------------------------------------------------------------

import { type IcuNode, IcuSyntaxError, parseIcu, printIcu } from "./icu.js";

export const PSEUDO_LOCALE = "en-XA";

const FROM = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
const TO = [..."àƀçđéƒĝĥíĵķĺɱñóþqŕšťûṽŵxýžÀƁÇĐÉƑĜĤÍĴĶĹṀÑÓÞQŔŠŤÛṼŴXÝŽ"];
const MAP = new Map([...FROM].map((c, i) => [c, TO[i]!]));

function accent(text: string): string {
  return [...text].map((c) => MAP.get(c) ?? c).join("");
}

function mapText(nodes: readonly IcuNode[]): IcuNode[] {
  return nodes.map((n): IcuNode => {
    if (n.kind === "text") return { kind: "text", value: accent(n.value) };
    if (n.kind === "choice") {
      return { ...n, options: n.options.map((o) => ({ ...o, body: mapText(o.body) })) };
    }
    return n;
  });
}

function letterCount(nodes: readonly IcuNode[]): number {
  let n = 0;
  for (const node of nodes) {
    if (node.kind === "text") n += node.value.length;
    else if (node.kind === "choice") {
      for (const o of node.options) n = Math.max(n, letterCount(o.body));
    }
  }
  return n;
}

/** Pseudo-localize one message: accent literals, pad ~30%, wrap in brackets.
 *  A message that is not valid ICU is returned unchanged. */
export function pseudoLocalize(message: string): string {
  let nodes: IcuNode[];
  try {
    nodes = parseIcu(message);
  } catch (e) {
    if (e instanceof IcuSyntaxError) return message;
    throw e;
  }
  const pad = ` ${"~".repeat(Math.max(2, Math.ceil(letterCount(nodes) * 0.3)))}`;
  return `[${printIcu(mapText(nodes))}${pad}]`;
}

/** Pseudo-localize a whole catalog. */
export function pseudoCatalog(source: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of Object.keys(source)) out[k] = pseudoLocalize(source[k]!);
  return out;
}
