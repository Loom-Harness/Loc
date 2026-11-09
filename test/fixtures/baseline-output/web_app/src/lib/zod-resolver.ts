// Auto-generated.  Do not edit by hand.
import { zodResolver as baseZodResolver } from "@hookform/resolvers/zod";

interface LoomIssue {
  path: PropertyKey[];
  params?: { loomCode?: string; loomValues?: Record<string, unknown> };
}

/** The stock zodResolver, plus each Loom issue's catalog code (`loomCode`)
 *  and a field limit's bound (`loomValues`) on its field error, so the
 *  error localizes when the form RENDERS
 *  (`fieldErrorText`) rather than when the schema was built. */
export const zodResolver = ((schema: any, schemaOptions?: any, resolverOptions?: any) => {
  const resolve = baseZodResolver(schema, schemaOptions, resolverOptions);
  return async (values: any, context: any, options: any) => {
    const result = await resolve(values, context, options);
    if (Object.keys(result.errors).length === 0) return result;
    const parsed = await schema.safeParseAsync(values);
    for (const issue of (parsed.error?.issues ?? []) as LoomIssue[]) {
      const code = issue.params?.loomCode;
      if (!code) continue;
      let node: any = result.errors;
      for (const seg of issue.path) node = node?.[seg as string];
      if (node && typeof node === "object" && node.loomCode === undefined) {
        node.loomCode = code;
        if (issue.params?.loomValues) node.loomValues = issue.params.loomValues;
      }
    }
    return result;
  };
}) as typeof baseZodResolver;
