// Repository read facts: the order a read takes its rows in.
//
// Every backend renders these terms in its own ORM or SQL spelling; none
// decides them.  Two backends ordering one read differently answer a
// different first row, or a page that repeats or skips a row.

import { type ReadOrderTerm, readOrderFor } from "../enrich/read-scope.js";
import type { FindIR } from "../types/loom-ir.js";

/** The order a single-row find takes its row in, or `undefined` for a key
 *  read.  A first-match read (`Repo.find(C) ignoring …`) may match many rows
 *  and answers the first in `id` order, as the same read without `ignoring`
 *  does through its retrieval.  A key read matches at most one row, so it
 *  carries no order. */
export function singleReadOrder(find: FindIR): ReadOrderTerm[] | undefined {
  return find.takeFirst ? readOrderFor() : undefined;
}
