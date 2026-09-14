// Auto-generated.  Do not edit by hand.
import type { Page, Locator } from "@playwright/test";
import { expect } from "@playwright/test";
import type { CreateWorkOrderRequest, AddLabourWorkOrderRequest, ScheduleWorkOrderRequest, CompleteWorkOrderRequest, CancelWorkOrderRequest, WorkOrderResponse } from "../../src/api/workOrder";

export class WorkOrderListPage {
  static readonly url = "/work_orders";
  readonly page: Page;
  constructor(page: Page) {
    this.page = page;
  }

  async goto(): Promise<this> {
    await this.page.goto(WorkOrderListPage.url);
    await this.page.getByTestId("work_orders-list").waitFor();
    return this;
  }

  async create(): Promise<WorkOrderNewPage> {
    await this.page.getByTestId("work_orders-list-create").click();
    return new WorkOrderNewPage(this.page);
  }

  row(id: string): Locator {
    return this.page.getByTestId(`work_orders-row-${id}`);
  }

  async open(id: string): Promise<WorkOrderDetailPage> {
    await this.page.getByTestId(`work_orders-row-${id}-link`).click();
    await this.page.waitForURL(new RegExp(`/work_orders/${id}$`));
    return new WorkOrderDetailPage(this.page, id);
  }

  async expectRow(id: string): Promise<void> {
    await expect(this.row(id)).toBeVisible();
  }
}

export class WorkOrderNewPage {
  static readonly url = "/work_orders/new";
  readonly page: Page;
  constructor(page: Page) {
    this.page = page;
  }

  async goto(): Promise<this> {
    await this.page.goto(WorkOrderNewPage.url);
    await this.page.getByTestId("work_orders-new").waitFor();
    return this;
  }

  async fill(input: Partial<CreateWorkOrderRequest>): Promise<this> {
    if (input.customerId !== undefined) {
      {
        await this.page.getByTestId("work_orders-new-input-customerId").click();
        const __opt = this.page.getByTestId(`work_orders-new-input-customerId-option-${input.customerId!}`);
        await __opt.waitFor({ state: "visible" });
        await __opt.click();
      }
    }
    if (input.siteId !== undefined) {
      {
        await this.page.getByTestId("work_orders-new-input-siteId").click();
        const __opt = this.page.getByTestId(`work_orders-new-input-siteId-option-${input.siteId!}`);
        await __opt.waitFor({ state: "visible" });
        await __opt.click();
      }
    }
    if (input.status !== undefined) {
      {
        const __sel = this.page.getByTestId("work_orders-new-input-status");
        await __sel.click();
        const __listbox = this.page.locator('[role="listbox"]').filter({ has: this.page.getByRole("option", { name: input.status!, exact: true }) });
        await __listbox.waitFor({ state: "visible" });
        await __listbox.getByRole("option", { name: input.status!, exact: true }).click();
      }
    }
    if (input.priority !== undefined) {
      {
        const __sel = this.page.getByTestId("work_orders-new-input-priority");
        await __sel.click();
        const __listbox = this.page.locator('[role="listbox"]').filter({ has: this.page.getByRole("option", { name: input.priority!, exact: true }) });
        await __listbox.waitFor({ state: "visible" });
        await __listbox.getByRole("option", { name: input.priority!, exact: true }).click();
      }
    }
    if (input.currency !== undefined) {
      {
        const __f = this.page.getByTestId("work_orders-new-input-currency");
        const __i = __f.locator("input, textarea");
        await ((await __i.count()) ? __i.first() : __f).fill(input.currency!);
      }
    }
    return this;
  }

  async submit(): Promise<WorkOrderDetailPage> {
    await this.page.getByTestId("work_orders-new-submit").click();
    // Wait for the detail page to render rather than matching
    // the URL — `/work_orders/new` itself matches a naive regex.
    await this.page.getByTestId("work_orders-detail").waitFor();
    const id = this.page.url().split("/").pop()!;
    return new WorkOrderDetailPage(this.page, id);
  }
}

export class WorkOrderDetailPage {
  readonly page: Page;
  readonly id: string;
  constructor(page: Page, id: string) {
    this.page = page;
    this.id = id;
  }

  async goto(): Promise<this> {
    await this.page.goto(`/work_orders/${this.id}`);
    await this.page.getByTestId("work_orders-detail").waitFor();
    return this;
  }

  /** Locator for a primitive / enum field's value cell. */
  field<K extends keyof WorkOrderResponse>(name: K): Locator {
    return this.page.getByTestId(`work_orders-detail-${String(name)}`);
  }

  /** Locator for the row of the contained `lines` collection. */
  linesRow(id: string): Locator {
    return this.page.getByTestId(`work_orders-detail-lines-row-${id}`);
  }

  /** Locator for the rows of the contained `lines` table — assert with toHaveCount. */
  linesRows(): Locator {
    return this.page.getByTestId("work_orders-detail-lines").locator("tbody tr");
  }

  /** addLabour — opens the modal, fills the form, submits. */
  async addLabour(input: AddLabourWorkOrderRequest): Promise<this> {
    await this.page.getByTestId("work_orders-op-addLabour").click();
    await this.page.getByTestId("work_orders-op-addLabour-form").waitFor();
    if (input.description !== undefined) {
      {
        const __f = this.page.getByTestId("work_orders-op-addLabour-input-description");
        const __i = __f.locator("input, textarea");
        await ((await __i.count()) ? __i.first() : __f).fill(input.description!);
      }
    }
    if (input.hours !== undefined) {
      {
        const __f = this.page.getByTestId("work_orders-op-addLabour-input-hours");
        const __i = __f.locator("input, textarea");
        await ((await __i.count()) ? __i.first() : __f).fill(String(input.hours));
      }
    }
    if (input.rate !== undefined) {
      {
        const __f = this.page.getByTestId("work_orders-op-addLabour-input-rate");
        const __i = __f.locator("input, textarea");
        await ((await __i.count()) ? __i.first() : __f).fill(String(input.rate));
      }
    }
    if (input.lineCurrency !== undefined) {
      {
        const __f = this.page.getByTestId("work_orders-op-addLabour-input-lineCurrency");
        const __i = __f.locator("input, textarea");
        await ((await __i.count()) ? __i.first() : __f).fill(input.lineCurrency!);
      }
    }
    await this.page.getByTestId("work_orders-op-addLabour-submit").click();
    await this.page.getByTestId("work_orders-op-addLabour-form").waitFor({ state: "detached" });
    await this.page.waitForLoadState("networkidle");
    return this;
  }

  /** schedule — opens the modal, fills the form, submits. */
  async schedule(input: ScheduleWorkOrderRequest): Promise<this> {
    await this.page.getByTestId("work_orders-op-schedule").click();
    await this.page.getByTestId("work_orders-op-schedule-form").waitFor();
    if (input.tech !== undefined) {
      {
        await this.page.getByTestId("work_orders-op-schedule-input-tech").click();
        const __opt = this.page.getByTestId(`work_orders-op-schedule-input-tech-option-${input.tech!}`);
        await __opt.waitFor({ state: "visible" });
        await __opt.click();
      }
    }
    if (input.at !== undefined) {
      {
        const __f = this.page.getByTestId("work_orders-op-schedule-input-at");
        const __i = __f.locator("input, textarea");
        await ((await __i.count()) ? __i.first() : __f).fill(input.at!.slice(0, 16));
      }
    }
    await this.page.getByTestId("work_orders-op-schedule-submit").click();
    await this.page.getByTestId("work_orders-op-schedule-form").waitFor({ state: "detached" });
    await this.page.waitForLoadState("networkidle");
    return this;
  }

  /** start (no parameters). */
  async start(): Promise<this> {
    await this.page.getByTestId("work_orders-op-start").click();
    await this.page.getByTestId("work_orders-op-start-submit").click();
    await this.page.getByTestId("work_orders-op-start-form").waitFor({ state: "detached" });
    await this.page.waitForLoadState("networkidle");
    return this;
  }

  /** complete — opens the modal, fills the form, submits. */
  async complete(input: CompleteWorkOrderRequest): Promise<this> {
    await this.page.getByTestId("work_orders-op-complete").click();
    await this.page.getByTestId("work_orders-op-complete-form").waitFor();
    if (input.note !== undefined) {
      {
        const __f = this.page.getByTestId("work_orders-op-complete-input-note");
        const __i = __f.locator("input, textarea");
        await ((await __i.count()) ? __i.first() : __f).fill(input.note!);
      }
    }
    await this.page.getByTestId("work_orders-op-complete-submit").click();
    await this.page.getByTestId("work_orders-op-complete-form").waitFor({ state: "detached" });
    await this.page.waitForLoadState("networkidle");
    return this;
  }

  /** cancel — opens the modal, fills the form, submits. */
  async cancel(input: CancelWorkOrderRequest): Promise<this> {
    await this.page.getByTestId("work_orders-op-cancel").click();
    await this.page.getByTestId("work_orders-op-cancel-form").waitFor();
    if (input.reason !== undefined) {
      {
        const __f = this.page.getByTestId("work_orders-op-cancel-input-reason");
        const __i = __f.locator("input, textarea");
        await ((await __i.count()) ? __i.first() : __f).fill(input.reason!);
      }
    }
    await this.page.getByTestId("work_orders-op-cancel-submit").click();
    await this.page.getByTestId("work_orders-op-cancel-form").waitFor({ state: "detached" });
    await this.page.waitForLoadState("networkidle");
    return this;
  }

}
