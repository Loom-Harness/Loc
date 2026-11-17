// Per-workflow Playwright page object — framework-neutral (testids +
// routes only); shared by every frontend.

import type { FrontendContract } from "../../ir/contract/frontend-contract.js";
import type { TypeIR } from "../../ir/types/loom-ir.js";
import type { AnyTypeScope } from "../../ir/util/reachable-types.js";
import { snake, upperFirst } from "../../util/naming.js";
import { contractHomes } from "../_walker/walker-model.js";
import { fillBlock, type SelectStyle } from "./page-objects-builder.js";

/** What a workflow's page object renders from: the start form's params, the
 *  type scope they resolve in, and the identifier base of its request type.
 *  The base is minted against the deployable's whole universe
 *  (`request-names.ts`): the imported request type must be the one
 *  `api/workflows.ts` actually exported. */
export interface WorkflowPageObjectInput {
  readonly name: string;
  readonly params: readonly { readonly name: string; readonly type: TypeIR }[];
  readonly scope: AnyTypeScope;
  readonly requestBase: string;
}

/** The input of workflow `name`, looked up first in `context`. */
export type WorkflowPageObjectResolver = (
  name: string,
  context: string,
) => WorkflowPageObjectInput | undefined;

/** The resolver over the Frontend Contract, for a frontend serving
 *  `contextNames`. */
export function workflowPageObjectsOfContract(
  contract: FrontendContract,
  contextNames: readonly string[],
): WorkflowPageObjectResolver {
  const served = contract.wire.workflows.filter((w) => contextNames.includes(w.context));
  const homes = contractHomes(contract, contextNames);
  return (name, context) => {
    const wf =
      served.find((w) => w.name === name && w.context === context) ??
      served.find((w) => w.name === name);
    const scope = wf && homes.get(wf.context);
    if (!wf || !scope) return undefined;
    return {
      name: wf.name,
      params: wf.params ?? [],
      scope,
      requestBase: wf.requestBase ?? upperFirst(wf.name),
    };
  };
}

export function buildWorkflowPageObject(
  wf: WorkflowPageObjectInput,
  /** Root of the generated api modules as seen from
   *  `e2e/pages/workflows/` — `src/api` on react, `src/lib/api` on
   *  SvelteKit. */
  apiImportRoot = "../../../src/api",
  selectStyle: SelectStyle = "combobox",
): string {
  const slug = snake(wf.name);
  const className = `${upperFirst(wf.name)}WorkflowPage`;
  const requestType = `${wf.requestBase}Request`;
  const lines: string[] = [];
  lines.push("// Auto-generated.  Do not edit by hand.");
  lines.push(`import type { Page } from "@playwright/test";`);
  lines.push(`import type { ${requestType} } from "${apiImportRoot}/workflows";`);
  lines.push("");
  lines.push(`export class ${className} {`);
  lines.push(`  static readonly url = "/workflows/${slug}";`);
  // Explicit field declaration + constructor assignment, not a
  // parameter property — see emit/value-objects.ts's renderValueObject.
  lines.push(`  readonly page: Page;`);
  lines.push(`  constructor(page: Page) {`);
  lines.push(`    this.page = page;`);
  lines.push(`  }`);
  lines.push("");
  lines.push(`  async goto(): Promise<this> {`);
  lines.push(`    await this.page.goto(${className}.url);`);
  lines.push(`    await this.page.getByTestId("workflow-${slug}").waitFor();`);
  lines.push(`    return this;`);
  lines.push(`  }`);
  lines.push("");
  lines.push(`  async fill(input: Partial<${requestType}>): Promise<this> {`);
  for (const p of wf.params) {
    const fillLines = fillBlock(
      "input",
      p.name,
      p.type,
      wf.scope,
      `workflow-${slug}-input-${p.name}`,
      selectStyle,
    );
    for (const l of fillLines) lines.push(`    ${l}`);
  }
  lines.push(`    return this;`);
  lines.push(`  }`);
  lines.push("");
  lines.push(`  async submit(): Promise<void> {`);
  lines.push(`    await this.page.getByTestId("workflow-${slug}-submit").click();`);
  lines.push(`    await this.page.waitForURL(/\\/workflows$/);`);
  lines.push(`  }`);
  lines.push("");
  lines.push(`  async run(input: ${requestType}): Promise<void> {`);
  lines.push(`    await this.goto();`);
  lines.push(`    await this.fill(input);`);
  lines.push(`    await this.submit();`);
  lines.push(`  }`);
  lines.push(`}`);
  return lines.join("\n") + "\n";
}
