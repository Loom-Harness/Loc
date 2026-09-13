// Auto-generated.  Do not edit by hand.
import type { Page, Locator } from "@playwright/test";
import { expect } from "@playwright/test";
import type { CreateWorkOrderRequest, AssignTechnicianWorkOrderRequest, AddLineWorkOrderRequest, CompleteWorkOrderRequest, AttachPhotoWorkOrderRequest, UpdateWorkOrderRequest, WorkOrderResponse } from "../../src/api/workOrder";

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

  /** Locator for the row of the contained `photos` collection. */
  photosRow(id: string): Locator {
    return this.page.getByTestId(`work_orders-detail-photos-row-${id}`);
  }

  /** Locator for the rows of the contained `photos` table — assert with toHaveCount. */
  photosRows(): Locator {
    return this.page.getByTestId("work_orders-detail-photos").locator("tbody tr");
  }

  /** assignTechnician — opens the modal, fills the form, submits. */
  async assignTechnician(input: AssignTechnicianWorkOrderRequest): Promise<this> {
    await this.page.getByTestId("work_orders-op-assignTechnician").click();
    await this.page.getByTestId("work_orders-op-assignTechnician-form").waitFor();
    if (input.assignTo !== undefined) {
      {
        await this.page.getByTestId("work_orders-op-assignTechnician-input-assignTo").click();
        const __opt = this.page.getByTestId(`work_orders-op-assignTechnician-input-assignTo-option-${input.assignTo!}`);
        await __opt.waitFor({ state: "visible" });
        await __opt.click();
      }
    }
    if (input.assignedUserId !== undefined) {
      {
        const __f = this.page.getByTestId("work_orders-op-assignTechnician-input-assignedUserId");
        const __i = __f.locator("input, textarea");
        await ((await __i.count()) ? __i.first() : __f).fill(input.assignedUserId!);
      }
    }
    if (input.at !== undefined) {
      {
        const __f = this.page.getByTestId("work_orders-op-assignTechnician-input-at");
        const __i = __f.locator("input, textarea");
        await ((await __i.count()) ? __i.first() : __f).fill(input.at!.slice(0, 16));
      }
    }
    await this.page.getByTestId("work_orders-op-assignTechnician-submit").click();
    await this.page.getByTestId("work_orders-op-assignTechnician-form").waitFor({ state: "detached" });
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

  /** addLine — opens the modal, fills the form, submits. */
  async addLine(input: AddLineWorkOrderRequest): Promise<this> {
    await this.page.getByTestId("work_orders-op-addLine").click();
    await this.page.getByTestId("work_orders-op-addLine-form").waitFor();
    if (input.kind !== undefined) {
      {
        const __sel = this.page.getByTestId("work_orders-op-addLine-input-kind");
        await __sel.click();
        const __listbox = this.page.locator('[role="listbox"]').filter({ has: this.page.getByRole("option", { name: input.kind!, exact: true }) });
        await __listbox.waitFor({ state: "visible" });
        await __listbox.getByRole("option", { name: input.kind!, exact: true }).click();
      }
    }
    if (input.description !== undefined) {
      {
        const __f = this.page.getByTestId("work_orders-op-addLine-input-description");
        const __i = __f.locator("input, textarea");
        await ((await __i.count()) ? __i.first() : __f).fill(input.description!);
      }
    }
    if (input.partId !== undefined) {
      {
        await this.page.getByTestId("work_orders-op-addLine-input-partId").click();
        const __opt = this.page.getByTestId(`work_orders-op-addLine-input-partId-option-${input.partId!}`);
        await __opt.waitFor({ state: "visible" });
        await __opt.click();
      }
    }
    if (input.quantity !== undefined) {
      {
        const __f = this.page.getByTestId("work_orders-op-addLine-input-quantity");
        const __i = __f.locator("input, textarea");
        await ((await __i.count()) ? __i.first() : __f).fill(String(input.quantity));
      }
    }
    if (input.unitPrice !== undefined) {
      if (input.unitPrice!.amount !== undefined) {
        {
          const __f = this.page.getByTestId("work_orders-op-addLine-input-unitPrice-amount");
          const __i = __f.locator("input, textarea");
          await ((await __i.count()) ? __i.first() : __f).fill(String(input.unitPrice!.amount));
        }
      }
      if (input.unitPrice!.currency !== undefined) {
        {
          const __f = this.page.getByTestId("work_orders-op-addLine-input-unitPrice-currency");
          const __i = __f.locator("input, textarea");
          await ((await __i.count()) ? __i.first() : __f).fill(input.unitPrice!.currency!);
        }
      }
    }
    await this.page.getByTestId("work_orders-op-addLine-submit").click();
    await this.page.getByTestId("work_orders-op-addLine-form").waitFor({ state: "detached" });
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

  /** cancel (no parameters). */
  async cancel(): Promise<this> {
    await this.page.getByTestId("work_orders-op-cancel").click();
    await this.page.getByTestId("work_orders-op-cancel-submit").click();
    await this.page.getByTestId("work_orders-op-cancel-form").waitFor({ state: "detached" });
    await this.page.waitForLoadState("networkidle");
    return this;
  }

  /** notifyCustomer (no parameters). */
  async notifyCustomer(): Promise<this> {
    await this.page.getByTestId("work_orders-op-notifyCustomer").click();
    await this.page.getByTestId("work_orders-op-notifyCustomer-submit").click();
    await this.page.getByTestId("work_orders-op-notifyCustomer-form").waitFor({ state: "detached" });
    await this.page.waitForLoadState("networkidle");
    return this;
  }

  /** attachPhoto — opens the modal, fills the form, submits. */
  async attachPhoto(input: AttachPhotoWorkOrderRequest): Promise<this> {
    await this.page.getByTestId("work_orders-op-attachPhoto").click();
    await this.page.getByTestId("work_orders-op-attachPhoto-form").waitFor();
    if (input.file !== undefined) {
      {
        const __f = this.page.getByTestId("work_orders-op-attachPhoto-input-file");
        const __i = __f.locator("input, textarea");
        await ((await __i.count()) ? __i.first() : __f).fill(input.file!);
      }
    }
    if (input.caption !== undefined) {
      {
        const __f = this.page.getByTestId("work_orders-op-attachPhoto-input-caption");
        const __i = __f.locator("input, textarea");
        await ((await __i.count()) ? __i.first() : __f).fill(input.caption!);
      }
    }
    await this.page.getByTestId("work_orders-op-attachPhoto-submit").click();
    await this.page.getByTestId("work_orders-op-attachPhoto-form").waitFor({ state: "detached" });
    await this.page.waitForLoadState("networkidle");
    return this;
  }

  /** update — opens the modal, fills the form, submits. */
  async update(input: UpdateWorkOrderRequest): Promise<this> {
    await this.page.getByTestId("work_orders-op-update").click();
    await this.page.getByTestId("work_orders-op-update-form").waitFor();
    if (input.customerId !== undefined) {
      {
        await this.page.getByTestId("work_orders-op-update-input-customerId").click();
        const __opt = this.page.getByTestId(`work_orders-op-update-input-customerId-option-${input.customerId!}`);
        await __opt.waitFor({ state: "visible" });
        await __opt.click();
      }
    }
    if (input.siteId !== undefined) {
      {
        await this.page.getByTestId("work_orders-op-update-input-siteId").click();
        const __opt = this.page.getByTestId(`work_orders-op-update-input-siteId-option-${input.siteId!}`);
        await __opt.waitFor({ state: "visible" });
        await __opt.click();
      }
    }
    if (input.assetId !== undefined) {
      {
        await this.page.getByTestId("work_orders-op-update-input-assetId").click();
        const __opt = this.page.getByTestId(`work_orders-op-update-input-assetId-option-${input.assetId!}`);
        await __opt.waitFor({ state: "visible" });
        await __opt.click();
      }
    }
    if (input.technicianId !== undefined) {
      {
        await this.page.getByTestId("work_orders-op-update-input-technicianId").click();
        const __opt = this.page.getByTestId(`work_orders-op-update-input-technicianId-option-${input.technicianId!}`);
        await __opt.waitFor({ state: "visible" });
        await __opt.click();
      }
    }
    if (input.technicianUserId !== undefined) {
      {
        const __f = this.page.getByTestId("work_orders-op-update-input-technicianUserId");
        const __i = __f.locator("input, textarea");
        await ((await __i.count()) ? __i.first() : __f).fill(input.technicianUserId!);
      }
    }
    if (input.status !== undefined) {
      {
        const __sel = this.page.getByTestId("work_orders-op-update-input-status");
        await __sel.click();
        const __listbox = this.page.locator('[role="listbox"]').filter({ has: this.page.getByRole("option", { name: input.status!, exact: true }) });
        await __listbox.waitFor({ state: "visible" });
        await __listbox.getByRole("option", { name: input.status!, exact: true }).click();
      }
    }
    if (input.priority !== undefined) {
      {
        const __sel = this.page.getByTestId("work_orders-op-update-input-priority");
        await __sel.click();
        const __listbox = this.page.locator('[role="listbox"]').filter({ has: this.page.getByRole("option", { name: input.priority!, exact: true }) });
        await __listbox.waitFor({ state: "visible" });
        await __listbox.getByRole("option", { name: input.priority!, exact: true }).click();
      }
    }
    if (input.currency !== undefined) {
      {
        const __f = this.page.getByTestId("work_orders-op-update-input-currency");
        const __i = __f.locator("input, textarea");
        await ((await __i.count()) ? __i.first() : __f).fill(input.currency!);
      }
    }
    if (input.scheduledAt !== undefined) {
      {
        const __f = this.page.getByTestId("work_orders-op-update-input-scheduledAt");
        const __i = __f.locator("input, textarea");
        await ((await __i.count()) ? __i.first() : __f).fill(input.scheduledAt!.slice(0, 16));
      }
    }
    if (input.startedAt !== undefined) {
      {
        const __f = this.page.getByTestId("work_orders-op-update-input-startedAt");
        const __i = __f.locator("input, textarea");
        await ((await __i.count()) ? __i.first() : __f).fill(input.startedAt!.slice(0, 16));
      }
    }
    if (input.completedAt !== undefined) {
      {
        const __f = this.page.getByTestId("work_orders-op-update-input-completedAt");
        const __i = __f.locator("input, textarea");
        await ((await __i.count()) ? __i.first() : __f).fill(input.completedAt!.slice(0, 16));
      }
    }
    if (input.resolutionNote !== undefined) {
      {
        const __f = this.page.getByTestId("work_orders-op-update-input-resolutionNote");
        const __i = __f.locator("input, textarea");
        await ((await __i.count()) ? __i.first() : __f).fill(input.resolutionNote!);
      }
    }
    await this.page.getByTestId("work_orders-op-update-submit").click();
    await this.page.getByTestId("work_orders-op-update-form").waitFor({ state: "detached" });
    await this.page.waitForLoadState("networkidle");
    return this;
  }

}
