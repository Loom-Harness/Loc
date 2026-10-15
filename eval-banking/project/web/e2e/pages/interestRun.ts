// Auto-generated.  Do not edit by hand.
import type { Page, Locator } from "@playwright/test";
import { expect } from "@playwright/test";
import type { InterestRunResponse } from "../../src/api/interestRun";

export class InterestRunListPage {
  static readonly url = "/interest_runs";
  readonly page: Page;
  constructor(page: Page) {
    this.page = page;
  }

  async goto(): Promise<this> {
    await this.page.goto(InterestRunListPage.url);
    await this.page.getByTestId("interest_runs-list").waitFor();
    return this;
  }

  row(id: string): Locator {
    return this.page.getByTestId(`interest_runs-row-${id}`);
  }

  async open(id: string): Promise<InterestRunDetailPage> {
    await this.page.getByTestId(`interest_runs-row-${id}-link`).click();
    await this.page.waitForURL(new RegExp(`/interest_runs/${id}$`));
    return new InterestRunDetailPage(this.page, id);
  }

  async expectRow(id: string): Promise<void> {
    await expect(this.row(id)).toBeVisible();
  }
}

export class InterestRunDetailPage {
  readonly page: Page;
  readonly id: string;
  constructor(page: Page, id: string) {
    this.page = page;
    this.id = id;
  }

  async goto(): Promise<this> {
    await this.page.goto(`/interest_runs/${this.id}`);
    await this.page.getByTestId("interest_runs-detail").waitFor();
    return this;
  }

  /** Locator for a primitive / enum field's value cell. */
  field<K extends keyof InterestRunResponse>(name: K): Locator {
    return this.page.getByTestId(`interest_runs-detail-${String(name)}`);
  }

}
