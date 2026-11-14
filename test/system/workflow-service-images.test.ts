import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Every container image a CI workflow pulls — a job's `services:` sidecars
// (postgres, rabbitmq, valkey, s3mock, mailpit, …) — comes through
// `mirror.gcr.io`, never Docker Hub directly.  Docker Hub rate-limits
// anonymous pulls and has outages; a services image that cannot be pulled
// fails the job before a single step runs, and reads as a red gate that has
// nothing to do with the change under test.  The mirror serves the same
// images (library images under `mirror.gcr.io/library/<name>`, others under
// `mirror.gcr.io/<owner>/<name>`) with no pull limit.

const WORKFLOWS = join(__dirname, "..", "..", ".github", "workflows");

/** Every `image:` value in a workflow file, with where it is. */
function workflowImages(dir: string): { file: string; line: number; image: string }[] {
  return readdirSync(dir)
    .filter((f) => /\.ya?ml$/.test(f))
    .flatMap((file) =>
      readFileSync(join(dir, file), "utf8")
        .split("\n")
        .flatMap((text, i) => {
          const m = /^\s*image:\s*["']?([^"'\s#]+)/.exec(text);
          return m ? [{ file, line: i + 1, image: m[1] as string }] : [];
        }),
    );
}

describe("workflow container images", () => {
  it("come through mirror.gcr.io, not Docker Hub", () => {
    const images = workflowImages(WORKFLOWS);
    // Guards the reader: a parser that found nothing would pass vacuously.
    expect(images.length).toBeGreaterThan(20);
    const direct = images
      .filter((i) => !i.image.startsWith("mirror.gcr.io/"))
      .map((i) => `${i.file}:${i.line} ${i.image}`);
    expect(direct).toEqual([]);
  });
});
