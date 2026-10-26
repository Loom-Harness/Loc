// A `scaffoldGet` route is the wire a declared repository find's route had.
//
// `scaffold-get-find` reads two rows through `find byCode` / `find bySku`
// routes; `scaffold-get` is the same system with the finds replaced by
// `scaffoldGet` (a criterion's first match, a unique key) and the same
// requests.  The booted behavioural legs hold every backend to each case's
// golden (node captures them); this test holds the two goldens to EACH OTHER,
// request for request — method, path + query string, status and body, the 404
// problem document included.  Together that is "a client of the find keeps its
// URL and its answers on all five backends".

import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

const GOLDEN = path.join(__dirname, "wire-golden");
const entries = (name: string): unknown[] =>
  JSON.parse(fs.readFileSync(path.join(GOLDEN, `${name}.json`), "utf8")).entries;

describe("scaffoldGet keeps a declared find's wire", () => {
  it("answers every request of the find's route identically", () => {
    const find = entries("scaffold-get-find");
    const get = entries("scaffold-get");
    // Non-vacuity: the drive reads hits and misses through both read shapes.
    const reads = find.filter((e) => /by_(code|sku)\?/.test((e as { path: string }).path));
    expect(reads.map((e) => (e as { status: number }).status).sort()).toEqual([
      200, 200, 200, 200, 404, 404, 404, 404, 404, 404,
    ]);
    expect(get).toEqual(find);
  });
});
