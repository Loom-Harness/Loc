// Auto-generated.  Do not edit by hand.
import type { Page, Locator } from "@playwright/test";
import { expect } from "@playwright/test";
import type { CreateTechnicianRequest, UpdateTechnicianRequest, TechnicianResponse } from "../../src/api/technician";

export class TechnicianListPage {
  static readonly url = "/technicians";
  readonly page: Page;
  constructor(page: Page) {
    this.page = page;
  }

  async goto(): Promise<this> {
    await this.page.goto(TechnicianListPage.url);
    await this.page.getByTestId("technicians-list").waitFor();
    return this;
  }

  async create(): Promise<TechnicianNewPage> {
    await this.page.getByTestId("technicians-list-create").click();
    return new TechnicianNewPage(this.page);
  }

  row(id: string): Locator {
    return this.page.getByTestId(`technicians-row-${id}`);
  }

  async open(id: string): Promise<TechnicianDetailPage> {
    await this.page.getByTestId(`technicians-row-${id}-link`).click();
    await this.page.waitForURL(new RegExp(`/technicians/${id}$`));
    return new TechnicianDetailPage(this.page, id);
  }

  async expectRow(id: string): Promise<void> {
    await expect(this.row(id)).toBeVisible();
  }
}

export class TechnicianNewPage {
  static readonly url = "/technicians/new";
  readonly page: Page;
  constructor(page: Page) {
    this.page = page;
  }

  async goto(): Promise<this> {
    await this.page.goto(TechnicianNewPage.url);
    await this.page.getByTestId("technicians-new").waitFor();
    return this;
  }

  async fill(input: Partial<CreateTechnicianRequest>): Promise<this> {
    if (input.userId !== undefined) {
      {
        const __f = this.page.getByTestId("technicians-new-input-userId");
        const __i = __f.locator("input, textarea");
        await ((await __i.count()) ? __i.first() : __f).fill(input.userId!);
      }
    }
    if (input.name !== undefined) {
      {
        const __f = this.page.getByTestId("technicians-new-input-name");
        const __i = __f.locator("input, textarea");
        await ((await __i.count()) ? __i.first() : __f).fill(input.name!);
      }
    }
    if (input.skills !== undefined) {
      await this.page.getByTestId("technicians-new-input-skills").fill(String(input.skills));
    }
    if (input.costRatePerHour !== undefined) {
      {
        const __f = this.page.getByTestId("technicians-new-input-costRatePerHour");
        const __i = __f.locator("input, textarea");
        await ((await __i.count()) ? __i.first() : __f).fill(String(input.costRatePerHour));
      }
    }
    return this;
  }

  async submit(): Promise<TechnicianDetailPage> {
    await this.page.getByTestId("technicians-new-submit").click();
    // Wait for the detail page to render rather than matching
    // the URL — `/technicians/new` itself matches a naive regex.
    await this.page.getByTestId("technicians-detail").waitFor();
    const id = this.page.url().split("/").pop()!;
    return new TechnicianDetailPage(this.page, id);
  }
}

export class TechnicianDetailPage {
  readonly page: Page;
  readonly id: string;
  constructor(page: Page, id: string) {
    this.page = page;
    this.id = id;
  }

  async goto(): Promise<this> {
    await this.page.goto(`/technicians/${this.id}`);
    await this.page.getByTestId("technicians-detail").waitFor();
    return this;
  }

  /** Locator for a primitive / enum field's value cell. */
  field<K extends keyof TechnicianResponse>(name: K): Locator {
    return this.page.getByTestId(`technicians-detail-${String(name)}`);
  }

  /** update — opens the modal, fills the form, submits. */
  async update(input: UpdateTechnicianRequest): Promise<this> {
    await this.page.getByTestId("technicians-op-update").click();
    await this.page.getByTestId("technicians-op-update-form").waitFor();
    if (input.userId !== undefined) {
      {
        const __f = this.page.getByTestId("technicians-op-update-input-userId");
        const __i = __f.locator("input, textarea");
        await ((await __i.count()) ? __i.first() : __f).fill(input.userId!);
      }
    }
    if (input.name !== undefined) {
      {
        const __f = this.page.getByTestId("technicians-op-update-input-name");
        const __i = __f.locator("input, textarea");
        await ((await __i.count()) ? __i.first() : __f).fill(input.name!);
      }
    }
    if (input.skills !== undefined) {
      await this.page.getByTestId("technicians-op-update-input-skills").fill(String(input.skills));
    }
    if (input.costRatePerHour !== undefined) {
      {
        const __f = this.page.getByTestId("technicians-op-update-input-costRatePerHour");
        const __i = __f.locator("input, textarea");
        await ((await __i.count()) ? __i.first() : __f).fill(String(input.costRatePerHour));
      }
    }
    await this.page.getByTestId("technicians-op-update-submit").click();
    await this.page.getByTestId("technicians-op-update-form").waitFor({ state: "detached" });
    await this.page.waitForLoadState("networkidle");
    return this;
  }

}
