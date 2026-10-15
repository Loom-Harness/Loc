// Auto-generated.  Do not edit by hand.
import type { Page, Locator } from "@playwright/test";
import { expect } from "@playwright/test";
import type { RejectTransferRequest, TransferResponse } from "../../src/api/transfer";

export class TransferListPage {
  static readonly url = "/transfers";
  readonly page: Page;
  constructor(page: Page) {
    this.page = page;
  }

  async goto(): Promise<this> {
    await this.page.goto(TransferListPage.url);
    await this.page.getByTestId("transfers-list").waitFor();
    return this;
  }

  row(id: string): Locator {
    return this.page.getByTestId(`transfers-row-${id}`);
  }

  async open(id: string): Promise<TransferDetailPage> {
    await this.page.getByTestId(`transfers-row-${id}-link`).click();
    await this.page.waitForURL(new RegExp(`/transfers/${id}$`));
    return new TransferDetailPage(this.page, id);
  }

  async expectRow(id: string): Promise<void> {
    await expect(this.row(id)).toBeVisible();
  }
}

export class TransferDetailPage {
  readonly page: Page;
  readonly id: string;
  constructor(page: Page, id: string) {
    this.page = page;
    this.id = id;
  }

  async goto(): Promise<this> {
    await this.page.goto(`/transfers/${this.id}`);
    await this.page.getByTestId("transfers-detail").waitFor();
    return this;
  }

  /** Locator for a primitive / enum field's value cell. */
  field<K extends keyof TransferResponse>(name: K): Locator {
    return this.page.getByTestId(`transfers-detail-${String(name)}`);
  }

  /** markCompleted (no parameters). */
  async markCompleted(): Promise<this> {
    await this.page.getByTestId("transfers-op-markCompleted").click();
    await this.page.getByTestId("transfers-op-markCompleted-submit").click();
    await this.page.getByTestId("transfers-op-markCompleted-form").waitFor({ state: "detached" });
    await this.page.waitForLoadState("networkidle");
    return this;
  }

  /** reject — opens the modal, fills the form, submits. */
  async reject(input: RejectTransferRequest): Promise<this> {
    await this.page.getByTestId("transfers-op-reject").click();
    await this.page.getByTestId("transfers-op-reject-form").waitFor();
    if (input.reason !== undefined) {
      {
        const __f = this.page.getByTestId("transfers-op-reject-input-reason");
        const __i = __f.locator("input, textarea");
        await ((await __i.count()) ? __i.first() : __f).fill(input.reason!);
      }
    }
    await this.page.getByTestId("transfers-op-reject-submit").click();
    await this.page.getByTestId("transfers-op-reject-form").waitFor({ state: "detached" });
    await this.page.waitForLoadState("networkidle");
    return this;
  }

}
