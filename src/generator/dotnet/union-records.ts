// The wire record family of a discriminated union (`A or B`).
//
// The base is `[JsonPolymorphic]` with one `[JsonDerivedType]` per arm, so
// System.Text.Json writes the `type` tag and Swashbuckle (UseOneOfForPolymorphism,
// Program.cs) publishes the base as `oneOf` over the arms.
//
// A union whose `error` arms answer as RFC 7807 problems (`T or NotFound`) is
// split on the wire: the route answers its success arms at 200 and each error
// arm as a problem at the arm's status.  Its success arms therefore also derive
// from `<Union>Success`, an abstract record declaring only them, which the
// route's 200 names.  The runtime still serializes through the union base, so
// the intermediate record changes nothing on the wire; it exists so the 200 is
// documented as exactly the success arms.

import type { BoundedContextIR, TypeIR } from "../../ir/types/loom-ir.js";
import { opUnionResponses } from "../_payload/union-wire.js";

/** The success-arm tags of a split union, or `undefined` when the union is not
 *  split (no error arm, or no success arm) and its 200 is the whole union. */
export function splitUnionSuccessTags(
  variants: readonly TypeIR[],
  ctx: BoundedContextIR,
): readonly string[] | undefined {
  const s = opUnionResponses([...variants], ctx);
  return s.errors.length > 0 ? s.success.map((m) => m.tag) : undefined;
}

/** The base, the `<Union>Success` intermediate when `successTags` is given, and
 *  one sealed record per arm.  `params` renders an arm's positional members. */
export function renderUnionRecordFamily(
  name: string,
  tags: readonly string[],
  params: (tag: string) => string,
  successTags: readonly string[] | undefined,
): string[] {
  const arm = (tag: string): string => `${name}_${tag}`;
  const derived = (ts: readonly string[]): string[] =>
    ts.map((tag) => `[JsonDerivedType(typeof(${arm(tag)}), "${tag}")]`);
  const success = successTags ? new Set(successTags) : undefined;
  return [
    '[JsonPolymorphic(TypeDiscriminatorPropertyName = "type")]',
    ...derived(tags),
    `public abstract record ${name};`,
    "",
    ...(successTags
      ? [
          '[JsonPolymorphic(TypeDiscriminatorPropertyName = "type")]',
          ...derived(successTags),
          `public abstract record ${name}Success : ${name};`,
          "",
        ]
      : []),
    ...tags.map(
      (tag) =>
        `public sealed record ${arm(tag)}(${params(tag)}) : ${success?.has(tag) ? `${name}Success` : name};`,
    ),
  ];
}
