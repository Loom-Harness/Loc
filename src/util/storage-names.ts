// The one spelling of a declaration's SQL table name and URL route segment.
//
// A table or route named after a declaration is the snake_case plural of its
// name, and there are two ways to compose that — `plural(snake(n))` and
// `snake(plural(n))`.  They agree for most names and DISAGREE for a name that
// ends in an acronym, because `snake` splits an upper-case run before its last
// capital when a lower-case letter follows it:
//
//   ProductSKU   plural(snake(n)) = product_skus   snake(plural(n)) = product_sk_us
//
// A backend that mapped its ORM to one spelling while the migration created
// the other failed its first read.  So the spelling is decided here, once, and
// every consumer — the shared migrations builder, every backend's ORM mapping
// and router, every frontend's API client and route table, the scaffold macros
// — routes through these two functions.  `test/system/storage-names-census.test.ts`
// forbids composing the two by hand anywhere else.
//
// The spelling is `plural(snake(n))`: the one `MigrationsIR` has always given
// the tables, so a database that already exists keeps its table names.  The
// route segment uses the same spelling, so a resource's URL and its table
// name always read alike.
//
// These take a NAME, not an IR node: the macro layer (phase ②) needs them
// before any IR exists, and so does every emitter that only holds a part's or
// an association target's name.  The IR-node accessors that decide WHICH name
// a node's table is spelled from (a TPH concrete's rows live in its base's
// table) are in `src/ir/enrich/storage-names.ts`.

import { plural, snake } from "./naming.js";

/** The snake_case plural every table and route segment is spelled with. */
function snakePlural(name: string): string {
  return plural(snake(name));
}

/** The SQL table of the declaration named `name` — an aggregate root, an
 *  entity part, a folded projection's read model: `ProductSKU` → `product_skus`.
 *  A TPH concrete has no table of its own; pass its table owner's name (see
 *  `aggregateTableName` in `src/ir/enrich/storage-names.ts`). */
export function tableNameFor(name: string): string {
  return snakePlural(name);
}

/** The URL segment an aggregate's routes mount under, and the slug its
 *  scaffolded pages, query keys and test ids are built from:
 *  `ProductSKU` → `product_skus`. */
export function routeSegmentFor(name: string): string {
  return snakePlural(name);
}
