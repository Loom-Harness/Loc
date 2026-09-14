// Auto-generated.  Do not edit by hand.
import type { Page, Locator } from "@playwright/test";
import { expect } from "@playwright/test";
import type { CreateOrganizationRequest, UpdateOrganizationRequest, OrganizationResponse } from "../../src/api/organization";

export class OrganizationListPage {
  static readonly url = "/organizations";
  readonly page: Page;
  constructor(page: Page) {
    this.page = page;
  }

  async goto(): Promise<this> {
    await this.page.goto(OrganizationListPage.url);
    await this.page.getByTestId("organizations-list").waitFor();
    return this;
  }

  async create(): Promise<OrganizationNewPage> {
    await this.page.getByTestId("organizations-list-create").click();
    return new OrganizationNewPage(this.page);
  }

  row(id: string): Locator {
    return this.page.getByTestId(`organizations-row-${id}`);
  }

  async open(id: string): Promise<OrganizationDetailPage> {
    await this.page.getByTestId(`organizations-row-${id}-link`).click();
    await this.page.waitForURL(new RegExp(`/organizations/${id}$`));
    return new OrganizationDetailPage(this.page, id);
  }

  async expectRow(id: string): Promise<void> {
    await expect(this.row(id)).toBeVisible();
  }
}

export class OrganizationNewPage {
  static readonly url = "/organizations/new";
  readonly page: Page;
  constructor(page: Page) {
    this.page = page;
  }

  async goto(): Promise<this> {
    await this.page.goto(OrganizationNewPage.url);
    await this.page.getByTestId("organizations-new").waitFor();
    return this;
  }

  async fill(input: Partial<CreateOrganizationRequest>): Promise<this> {
    if (input.name !== undefined) {
      {
        const __f = this.page.getByTestId("organizations-new-input-name");
        const __i = __f.locator("input, textarea");
        await ((await __i.count()) ? __i.first() : __f).fill(input.name!);
      }
    }
    return this;
  }

  async submit(): Promise<OrganizationDetailPage> {
    await this.page.getByTestId("organizations-new-submit").click();
    // Wait for the detail page to render rather than matching
    // the URL — `/organizations/new` itself matches a naive regex.
    await this.page.getByTestId("organizations-detail").waitFor();
    const id = this.page.url().split("/").pop()!;
    return new OrganizationDetailPage(this.page, id);
  }
}

export class OrganizationDetailPage {
  readonly page: Page;
  readonly id: string;
  constructor(page: Page, id: string) {
    this.page = page;
    this.id = id;
  }

  async goto(): Promise<this> {
    await this.page.goto(`/organizations/${this.id}`);
    await this.page.getByTestId("organizations-detail").waitFor();
    return this;
  }

  /** Locator for a primitive / enum field's value cell. */
  field<K extends keyof OrganizationResponse>(name: K): Locator {
    return this.page.getByTestId(`organizations-detail-${String(name)}`);
  }

  /** update — opens the modal, fills the form, submits. */
  async update(input: UpdateOrganizationRequest): Promise<this> {
    await this.page.getByTestId("organizations-op-update").click();
    await this.page.getByTestId("organizations-op-update-form").waitFor();
    if (input.name !== undefined) {
      {
        const __f = this.page.getByTestId("organizations-op-update-input-name");
        const __i = __f.locator("input, textarea");
        await ((await __i.count()) ? __i.first() : __f).fill(input.name!);
      }
    }
    await this.page.getByTestId("organizations-op-update-submit").click();
    await this.page.getByTestId("organizations-op-update-form").waitFor({ state: "detached" });
    await this.page.waitForLoadState("networkidle");
    return this;
  }

}
