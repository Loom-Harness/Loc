// Auto-generated.  Do not edit by hand.
import type { Page } from "@playwright/test";
import type { ScheduleWorkOrderRequest } from "../../../src/api/workflows";

export class ScheduleWorkOrderWorkflowPage {
  static readonly url = "/workflows/schedule_work_order";
  readonly page: Page;
  constructor(page: Page) {
    this.page = page;
  }

  async goto(): Promise<this> {
    await this.page.goto(ScheduleWorkOrderWorkflowPage.url);
    await this.page.getByTestId("workflow-schedule_work_order").waitFor();
    return this;
  }

  async fill(input: Partial<ScheduleWorkOrderRequest>): Promise<this> {
    if (input.workOrder !== undefined) {
      {
        await this.page.getByTestId("workflow-schedule_work_order-input-workOrder").click();
        const __opt = this.page.getByTestId(`workflow-schedule_work_order-input-workOrder-option-${input.workOrder!}`);
        await __opt.waitFor({ state: "visible" });
        await __opt.click();
      }
    }
    if (input.technician !== undefined) {
      {
        await this.page.getByTestId("workflow-schedule_work_order-input-technician").click();
        const __opt = this.page.getByTestId(`workflow-schedule_work_order-input-technician-option-${input.technician!}`);
        await __opt.waitFor({ state: "visible" });
        await __opt.click();
      }
    }
    if (input.at !== undefined) {
      {
        const __f = this.page.getByTestId("workflow-schedule_work_order-input-at");
        const __i = __f.locator("input, textarea");
        await ((await __i.count()) ? __i.first() : __f).fill(input.at!.slice(0, 16));
      }
    }
    return this;
  }

  async submit(): Promise<void> {
    await this.page.getByTestId("workflow-schedule_work_order-submit").click();
    await this.page.waitForURL(/\/workflows$/);
  }

  async run(input: ScheduleWorkOrderRequest): Promise<void> {
    await this.goto();
    await this.fill(input);
    await this.submit();
  }
}
