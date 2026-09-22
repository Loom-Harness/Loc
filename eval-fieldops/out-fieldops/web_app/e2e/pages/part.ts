// Auto-generated.  Do not edit by hand.
import type { Page, Locator } from "@playwright/test";
import { expect } from "@playwright/test";
import type { CreatePartRequest, ConsumePartRequest, UpdatePartRequest, PartResponse } from "../../src/api/part";

export class PartListPage {
  static readonly url = "/parts";
  readonly page: Page;
  constructor(page: Page) {
    this.page = page;
  }

  async goto(): Promise<this> {
    await this.page.goto(PartListPage.url);
    await this.page.getByTestId("parts-list").waitFor();
    return this;
  }

  async create(): Promise<PartNewPage> {
    await this.page.getByTestId("parts-list-create").click();
    return new PartNewPage(this.page);
  }

  row(id: string): Locator {
    return this.page.getByTestId(`parts-row-${id}`);
  }

  async open(id: string): Promise<PartDetailPage> {
    await this.page.getByTestId(`parts-row-${id}-link`).click();
    await this.page.waitForURL(new RegExp(`/parts/${id}$`));
    return new PartDetailPage(this.page, id);
  }

  async expectRow(id: string): Promise<void> {
    await expect(this.row(id)).toBeVisible();
  }
}

export class PartNewPage {
  static readonly url = "/parts/new";
  readonly page: Page;
  constructor(page: Page) {
    this.page = page;
  }

  async goto(): Promise<this> {
    await this.page.goto(PartNewPage.url);
    await this.page.getByTestId("parts-new").waitFor();
    return this;
  }

  async fill(input: Partial<CreatePartRequest>): Promise<this> {
    if (input.sku !== undefined) {
      {
        const __f = this.page.getByTestId("parts-new-input-sku");
        const __i = __f.locator("input, textarea");
        await ((await __i.count()) ? __i.first() : __f).fill(input.sku!);
      }
    }
    if (input.binCode !== undefined) {
      {
        const __f = this.page.getByTestId("parts-new-input-binCode");
        const __i = __f.locator("input, textarea");
        await ((await __i.count()) ? __i.first() : __f).fill(input.binCode!);
      }
    }
    if (input.onHand !== undefined) {
      {
        const __f = this.page.getByTestId("parts-new-input-onHand");
        const __i = __f.locator("input, textarea");
        await ((await __i.count()) ? __i.first() : __f).fill(String(input.onHand));
      }
    }
    if (input.unitPrice !== undefined) {
      {
        const __f = this.page.getByTestId("parts-new-input-unitPrice");
        const __i = __f.locator("input, textarea");
        await ((await __i.count()) ? __i.first() : __f).fill(String(input.unitPrice));
      }
    }
    if (input.currency !== undefined) {
      {
        const __f = this.page.getByTestId("parts-new-input-currency");
        const __i = __f.locator("input, textarea");
        await ((await __i.count()) ? __i.first() : __f).fill(input.currency!);
      }
    }
    return this;
  }

  async submit(): Promise<PartDetailPage> {
    await this.page.getByTestId("parts-new-submit").click();
    // Wait for the detail page to render rather than matching
    // the URL — `/parts/new` itself matches a naive regex.
    await this.page.getByTestId("parts-detail").waitFor();
    const id = this.page.url().split("/").pop()!;
    return new PartDetailPage(this.page, id);
  }
}

export class PartDetailPage {
  readonly page: Page;
  readonly id: string;
  constructor(page: Page, id: string) {
    this.page = page;
    this.id = id;
  }

  async goto(): Promise<this> {
    await this.page.goto(`/parts/${this.id}`);
    await this.page.getByTestId("parts-detail").waitFor();
    return this;
  }

  /** Locator for a primitive / enum field's value cell. */
  field<K extends keyof PartResponse>(name: K): Locator {
    return this.page.getByTestId(`parts-detail-${String(name)}`);
  }

  /** consume — opens the modal, fills the form, submits. */
  async consume(input: ConsumePartRequest): Promise<this> {
    await this.page.getByTestId("parts-op-consume").click();
    await this.page.getByTestId("parts-op-consume-form").waitFor();
    if (input.qty !== undefined) {
      {
        const __f = this.page.getByTestId("parts-op-consume-input-qty");
        const __i = __f.locator("input, textarea");
        await ((await __i.count()) ? __i.first() : __f).fill(String(input.qty));
      }
    }
    await this.page.getByTestId("parts-op-consume-submit").click();
    await this.page.getByTestId("parts-op-consume-form").waitFor({ state: "detached" });
    await this.page.waitForLoadState("networkidle");
    return this;
  }

  /** update — opens the modal, fills the form, submits. */
  async update(input: UpdatePartRequest): Promise<this> {
    await this.page.getByTestId("parts-op-update").click();
    await this.page.getByTestId("parts-op-update-form").waitFor();
    if (input.sku !== undefined) {
      {
        const __f = this.page.getByTestId("parts-op-update-input-sku");
        const __i = __f.locator("input, textarea");
        await ((await __i.count()) ? __i.first() : __f).fill(input.sku!);
      }
    }
    if (input.binCode !== undefined) {
      {
        const __f = this.page.getByTestId("parts-op-update-input-binCode");
        const __i = __f.locator("input, textarea");
        await ((await __i.count()) ? __i.first() : __f).fill(input.binCode!);
      }
    }
    if (input.onHand !== undefined) {
      {
        const __f = this.page.getByTestId("parts-op-update-input-onHand");
        const __i = __f.locator("input, textarea");
        await ((await __i.count()) ? __i.first() : __f).fill(String(input.onHand));
      }
    }
    if (input.unitPrice !== undefined) {
      {
        const __f = this.page.getByTestId("parts-op-update-input-unitPrice");
        const __i = __f.locator("input, textarea");
        await ((await __i.count()) ? __i.first() : __f).fill(String(input.unitPrice));
      }
    }
    if (input.currency !== undefined) {
      {
        const __f = this.page.getByTestId("parts-op-update-input-currency");
        const __i = __f.locator("input, textarea");
        await ((await __i.count()) ? __i.first() : __f).fill(input.currency!);
      }
    }
    await this.page.getByTestId("parts-op-update-submit").click();
    await this.page.getByTestId("parts-op-update-form").waitFor({ state: "detached" });
    await this.page.waitForLoadState("networkidle");
    return this;
  }

}
