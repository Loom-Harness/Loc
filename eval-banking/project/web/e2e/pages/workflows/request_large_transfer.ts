// Auto-generated.  Do not edit by hand.
import type { Page } from "@playwright/test";
import type { RequestLargeTransferRequest } from "../../../src/api/workflows";

export class RequestLargeTransferWorkflowPage {
  static readonly url = "/workflows/request_large_transfer";
  readonly page: Page;
  constructor(page: Page) {
    this.page = page;
  }

  async goto(): Promise<this> {
    await this.page.goto(RequestLargeTransferWorkflowPage.url);
    await this.page.getByTestId("workflow-request_large_transfer").waitFor();
    return this;
  }

  async fill(input: Partial<RequestLargeTransferRequest>): Promise<this> {
    if (input.sourceAccount !== undefined) {
      {
        await this.page.getByTestId("workflow-request_large_transfer-input-sourceAccount").click();
        const __opt = this.page.getByTestId(`workflow-request_large_transfer-input-sourceAccount-option-${input.sourceAccount!}`);
        await __opt.waitFor({ state: "visible" });
        await __opt.click();
      }
    }
    if (input.targetAccount !== undefined) {
      {
        await this.page.getByTestId("workflow-request_large_transfer-input-targetAccount").click();
        const __opt = this.page.getByTestId(`workflow-request_large_transfer-input-targetAccount-option-${input.targetAccount!}`);
        await __opt.waitFor({ state: "visible" });
        await __opt.click();
      }
    }
    if (input.amount !== undefined) {
      {
        const __f = this.page.getByTestId("workflow-request_large_transfer-input-amount");
        const __i = __f.locator("input, textarea");
        await ((await __i.count()) ? __i.first() : __f).fill(String(input.amount));
      }
    }
    if (input.reference !== undefined) {
      {
        const __f = this.page.getByTestId("workflow-request_large_transfer-input-reference");
        const __i = __f.locator("input, textarea");
        await ((await __i.count()) ? __i.first() : __f).fill(input.reference!);
      }
    }
    return this;
  }

  async submit(): Promise<void> {
    await this.page.getByTestId("workflow-request_large_transfer-submit").click();
    await this.page.waitForURL(/\/workflows$/);
  }

  async run(input: RequestLargeTransferRequest): Promise<void> {
    await this.goto();
    await this.fill(input);
    await this.submit();
  }
}
