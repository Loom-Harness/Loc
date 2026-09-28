// Auto-generated.  Do not edit by hand.
import type { Page, Locator } from "@playwright/test";
import { expect } from "@playwright/test";
import type { CreateSiteRequest, UpdateSiteRequest, SiteResponse } from "../../src/api/site";

export class SiteListPage {
  static readonly url = "/sites";
  readonly page: Page;
  constructor(page: Page) {
    this.page = page;
  }

  async goto(): Promise<this> {
    await this.page.goto(SiteListPage.url);
    await this.page.getByTestId("sites-list").waitFor();
    return this;
  }

  async create(): Promise<SiteNewPage> {
    await this.page.getByTestId("sites-list-create").click();
    return new SiteNewPage(this.page);
  }

  row(id: string): Locator {
    return this.page.getByTestId(`sites-row-${id}`);
  }

  async open(id: string): Promise<SiteDetailPage> {
    await this.page.getByTestId(`sites-row-${id}-link`).click();
    await this.page.waitForURL(new RegExp(`/sites/${id}$`));
    return new SiteDetailPage(this.page, id);
  }

  async expectRow(id: string): Promise<void> {
    await expect(this.row(id)).toBeVisible();
  }
}

export class SiteNewPage {
  static readonly url = "/sites/new";
  readonly page: Page;
  constructor(page: Page) {
    this.page = page;
  }

  async goto(): Promise<this> {
    await this.page.goto(SiteNewPage.url);
    await this.page.getByTestId("sites-new").waitFor();
    return this;
  }

  async fill(input: Partial<CreateSiteRequest>): Promise<this> {
    if (input.customerId !== undefined) {
      {
        await this.page.getByTestId("sites-new-input-customerId").click();
        const __opt = this.page.getByTestId(`sites-new-input-customerId-option-${input.customerId!}`);
        await __opt.waitFor({ state: "visible" });
        await __opt.click();
      }
    }
    if (input.label !== undefined) {
      {
        const __f = this.page.getByTestId("sites-new-input-label");
        const __i = __f.locator("input, textarea");
        await ((await __i.count()) ? __i.first() : __f).fill(input.label!);
      }
    }
    if (input.addressLine !== undefined) {
      {
        const __f = this.page.getByTestId("sites-new-input-addressLine");
        const __i = __f.locator("input, textarea");
        await ((await __i.count()) ? __i.first() : __f).fill(input.addressLine!);
      }
    }
    return this;
  }

  async submit(): Promise<SiteDetailPage> {
    await this.page.getByTestId("sites-new-submit").click();
    // Wait for the detail page to render rather than matching
    // the URL — `/sites/new` itself matches a naive regex.
    await this.page.getByTestId("sites-detail").waitFor();
    const id = this.page.url().split("/").pop()!;
    return new SiteDetailPage(this.page, id);
  }
}

export class SiteDetailPage {
  readonly page: Page;
  readonly id: string;
  constructor(page: Page, id: string) {
    this.page = page;
    this.id = id;
  }

  async goto(): Promise<this> {
    await this.page.goto(`/sites/${this.id}`);
    await this.page.getByTestId("sites-detail").waitFor();
    return this;
  }

  /** Locator for a primitive / enum field's value cell. */
  field<K extends keyof SiteResponse>(name: K): Locator {
    return this.page.getByTestId(`sites-detail-${String(name)}`);
  }

  /** update — opens the modal, fills the form, submits. */
  async update(input: UpdateSiteRequest): Promise<this> {
    await this.page.getByTestId("sites-op-update").click();
    await this.page.getByTestId("sites-op-update-form").waitFor();
    if (input.customerId !== undefined) {
      {
        await this.page.getByTestId("sites-op-update-input-customerId").click();
        const __opt = this.page.getByTestId(`sites-op-update-input-customerId-option-${input.customerId!}`);
        await __opt.waitFor({ state: "visible" });
        await __opt.click();
      }
    }
    if (input.label !== undefined) {
      {
        const __f = this.page.getByTestId("sites-op-update-input-label");
        const __i = __f.locator("input, textarea");
        await ((await __i.count()) ? __i.first() : __f).fill(input.label!);
      }
    }
    if (input.addressLine !== undefined) {
      {
        const __f = this.page.getByTestId("sites-op-update-input-addressLine");
        const __i = __f.locator("input, textarea");
        await ((await __i.count()) ? __i.first() : __f).fill(input.addressLine!);
      }
    }
    await this.page.getByTestId("sites-op-update-submit").click();
    await this.page.getByTestId("sites-op-update-form").waitFor({ state: "detached" });
    await this.page.waitForLoadState("networkidle");
    return this;
  }

}
