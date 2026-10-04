// Auto-generated.  Do not edit by hand.
import type { Page } from "@playwright/test";
import type { OpenAccountRequest } from "../../../src/api/workflows";

export class OpenAccountWorkflowPage {
  static readonly url = "/workflows/open_account";
  readonly page: Page;
  constructor(page: Page) {
    this.page = page;
  }

  async goto(): Promise<this> {
    await this.page.goto(OpenAccountWorkflowPage.url);
    await this.page.getByTestId("workflow-open_account").waitFor();
    return this;
  }

  async fill(input: Partial<OpenAccountRequest>): Promise<this> {
    if (input.owner !== undefined) {
      {
        await this.page.getByTestId("workflow-open_account-input-owner").click();
        const __opt = this.page.getByTestId(`workflow-open_account-input-owner-option-${input.owner!}`);
        await __opt.waitFor({ state: "visible" });
        await __opt.click();
      }
    }
    if (input.number !== undefined) {
      {
        const __f = this.page.getByTestId("workflow-open_account-input-number");
        const __i = __f.locator("input, textarea");
        await ((await __i.count()) ? __i.first() : __f).fill(input.number!);
      }
    }
    if (input.accountType !== undefined) {
      {
        const __sel = this.page.getByTestId("workflow-open_account-input-accountType");
        await __sel.click();
        const __listbox = this.page.locator('[role="listbox"]').filter({ has: this.page.getByRole("option", { name: input.accountType!, exact: true }) });
        await __listbox.waitFor({ state: "visible" });
        await __listbox.getByRole("option", { name: input.accountType!, exact: true }).click();
      }
    }
    if (input.currency !== undefined) {
      {
        const __f = this.page.getByTestId("workflow-open_account-input-currency");
        const __i = __f.locator("input, textarea");
        await ((await __i.count()) ? __i.first() : __f).fill(input.currency!);
      }
    }
    return this;
  }

  async submit(): Promise<void> {
    await this.page.getByTestId("workflow-open_account-submit").click();
    await this.page.waitForURL(/\/workflows$/);
  }

  async run(input: OpenAccountRequest): Promise<void> {
    await this.goto();
    await this.fill(input);
    await this.submit();
  }
}
