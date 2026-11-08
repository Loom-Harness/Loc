/** The compose-safe service slug of a deployable name — also the folder its
 *  generated project lives in.  It is the exact suffix set an api-e2e vitest
 *  title can carry (` against <serviceSlug>`), which `ddd verify` undoes when
 *  joining results onto the requirements graph.  Note it is NOT
 *  `naming.snake`: that splits consecutive capitals too (`APIGateway` →
 *  `api_gateway`, where this gives `apigateway`). */
export function serviceSlug(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
}
