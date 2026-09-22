// Auto-generated.  Do not edit by hand.
import type { Page, Locator } from "@playwright/test";
import { expect } from "@playwright/test";
import type { InvoiceResponse } from "../../src/api/invoice";

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

}
