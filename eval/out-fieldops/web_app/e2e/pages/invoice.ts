// Auto-generated.  Do not edit by hand.
import type { Page, Locator } from "@playwright/test";
import { expect } from "@playwright/test";
import type { CreateInvoiceRequest, UpdateInvoiceRequest, InvoiceResponse } from "../../src/api/invoice";

export class InvoiceListPage {
  static readonly url = "/invoices";
  readonly page: Page;
  constructor(page: Page) {
    this.page = page;
  }

  async goto(): Promise<this> {
    await this.page.goto(InvoiceListPage.url);
    await this.page.getByTestId("invoices-list").waitFor();
    return this;
  }

  async create(): Promise<InvoiceNewPage> {
    await this.page.getByTestId("invoices-list-create").click();
    return new InvoiceNewPage(this.page);
  }

  row(id: string): Locator {
    return this.page.getByTestId(`invoices-row-${id}`);
  }

  async open(id: string): Promise<InvoiceDetailPage> {
    await this.page.getByTestId(`invoices-row-${id}-link`).click();
    await this.page.waitForURL(new RegExp(`/invoices/${id}$`));
    return new InvoiceDetailPage(this.page, id);
  }

  async expectRow(id: string): Promise<void> {
    await expect(this.row(id)).toBeVisible();
  }
}

export class InvoiceNewPage {
  static readonly url = "/invoices/new";
  readonly page: Page;
  constructor(page: Page) {
    this.page = page;
  }

  async goto(): Promise<this> {
    await this.page.goto(InvoiceNewPage.url);
    await this.page.getByTestId("invoices-new").waitFor();
    return this;
  }

  async fill(input: Partial<CreateInvoiceRequest>): Promise<this> {
    if (input.workOrderId !== undefined) {
      {
        await this.page.getByTestId("invoices-new-input-workOrderId").click();
        const __opt = this.page.getByTestId(`invoices-new-input-workOrderId-option-${input.workOrderId!}`);
        await __opt.waitFor({ state: "visible" });
        await __opt.click();
      }
    }
    if (input.customerId !== undefined) {
      {
        await this.page.getByTestId("invoices-new-input-customerId").click();
        const __opt = this.page.getByTestId(`invoices-new-input-customerId-option-${input.customerId!}`);
        await __opt.waitFor({ state: "visible" });
        await __opt.click();
      }
    }
    if (input.currency !== undefined) {
      {
        const __f = this.page.getByTestId("invoices-new-input-currency");
        const __i = __f.locator("input, textarea");
        await ((await __i.count()) ? __i.first() : __f).fill(input.currency!);
      }
    }
    if (input.amount !== undefined) {
      {
        const __f = this.page.getByTestId("invoices-new-input-amount");
        const __i = __f.locator("input, textarea");
        await ((await __i.count()) ? __i.first() : __f).fill(String(input.amount));
      }
    }
    if (input.issued !== undefined) {
      const __cur = await this.page.getByTestId("invoices-new-input-issued").isChecked();
      if (__cur !== input.issued) {
        await this.page.getByTestId("invoices-new-input-issued").click();
      }
    }
    return this;
  }

  async submit(): Promise<InvoiceDetailPage> {
    await this.page.getByTestId("invoices-new-submit").click();
    // Wait for the detail page to render rather than matching
    // the URL — `/invoices/new` itself matches a naive regex.
    await this.page.getByTestId("invoices-detail").waitFor();
    const id = this.page.url().split("/").pop()!;
    return new InvoiceDetailPage(this.page, id);
  }
}

export class InvoiceDetailPage {
  readonly page: Page;
  readonly id: string;
  constructor(page: Page, id: string) {
    this.page = page;
    this.id = id;
  }

  async goto(): Promise<this> {
    await this.page.goto(`/invoices/${this.id}`);
    await this.page.getByTestId("invoices-detail").waitFor();
    return this;
  }

  /** Locator for a primitive / enum field's value cell. */
  field<K extends keyof InvoiceResponse>(name: K): Locator {
    return this.page.getByTestId(`invoices-detail-${String(name)}`);
  }

  /** issue (no parameters). */
  async issue(): Promise<this> {
    await this.page.getByTestId("invoices-op-issue").click();
    await this.page.getByTestId("invoices-op-issue-submit").click();
    await this.page.getByTestId("invoices-op-issue-form").waitFor({ state: "detached" });
    await this.page.waitForLoadState("networkidle");
    return this;
  }

  /** update — opens the modal, fills the form, submits. */
  async update(input: UpdateInvoiceRequest): Promise<this> {
    await this.page.getByTestId("invoices-op-update").click();
    await this.page.getByTestId("invoices-op-update-form").waitFor();
    if (input.workOrderId !== undefined) {
      {
        await this.page.getByTestId("invoices-op-update-input-workOrderId").click();
        const __opt = this.page.getByTestId(`invoices-op-update-input-workOrderId-option-${input.workOrderId!}`);
        await __opt.waitFor({ state: "visible" });
        await __opt.click();
      }
    }
    if (input.customerId !== undefined) {
      {
        await this.page.getByTestId("invoices-op-update-input-customerId").click();
        const __opt = this.page.getByTestId(`invoices-op-update-input-customerId-option-${input.customerId!}`);
        await __opt.waitFor({ state: "visible" });
        await __opt.click();
      }
    }
    if (input.currency !== undefined) {
      {
        const __f = this.page.getByTestId("invoices-op-update-input-currency");
        const __i = __f.locator("input, textarea");
        await ((await __i.count()) ? __i.first() : __f).fill(input.currency!);
      }
    }
    if (input.amount !== undefined) {
      {
        const __f = this.page.getByTestId("invoices-op-update-input-amount");
        const __i = __f.locator("input, textarea");
        await ((await __i.count()) ? __i.first() : __f).fill(String(input.amount));
      }
    }
    if (input.issued !== undefined) {
      const __cur = await this.page.getByTestId("invoices-op-update-input-issued").isChecked();
      if (__cur !== input.issued) {
        await this.page.getByTestId("invoices-op-update-input-issued").click();
      }
    }
    await this.page.getByTestId("invoices-op-update-submit").click();
    await this.page.getByTestId("invoices-op-update-form").waitFor({ state: "detached" });
    await this.page.waitForLoadState("networkidle");
    return this;
  }

}
