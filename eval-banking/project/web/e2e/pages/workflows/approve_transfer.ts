// Auto-generated.  Do not edit by hand.
import type { Page } from "@playwright/test";
import type { ApproveTransferRequest } from "../../../src/api/workflows";

export class ApproveTransferWorkflowPage {
  static readonly url = "/workflows/approve_transfer";
  readonly page: Page;
  constructor(page: Page) {
    this.page = page;
  }

  async goto(): Promise<this> {
    await this.page.goto(ApproveTransferWorkflowPage.url);
    await this.page.getByTestId("workflow-approve_transfer").waitFor();
    return this;
  }

  async fill(input: Partial<ApproveTransferRequest>): Promise<this> {
    if (input.transferId !== undefined) {
      {
        await this.page.getByTestId("workflow-approve_transfer-input-transferId").click();
        const __opt = this.page.getByTestId(`workflow-approve_transfer-input-transferId-option-${input.transferId!}`);
        await __opt.waitFor({ state: "visible" });
        await __opt.click();
      }
    }
    return this;
  }

  async submit(): Promise<void> {
    await this.page.getByTestId("workflow-approve_transfer-submit").click();
    await this.page.waitForURL(/\/workflows$/);
  }

  async run(input: ApproveTransferRequest): Promise<void> {
    await this.goto();
    await this.fill(input);
    await this.submit();
  }
}
