// Auto-generated.  Do not edit by hand.
import type { Page, Locator } from "@playwright/test";
import { expect } from "@playwright/test";
import type { DepositAccountRequest, WithdrawAccountRequest, DebitForTransferAccountRequest, CreditForTransferAccountRequest, AccrueInterestAccountRequest, AccountResponse } from "../../src/api/account";

export class AccountListPage {
  static readonly url = "/accounts";
  readonly page: Page;
  constructor(page: Page) {
    this.page = page;
  }

  async goto(): Promise<this> {
    await this.page.goto(AccountListPage.url);
    await this.page.getByTestId("accounts-list").waitFor();
    return this;
  }

  row(id: string): Locator {
    return this.page.getByTestId(`accounts-row-${id}`);
  }

  async open(id: string): Promise<AccountDetailPage> {
    await this.page.getByTestId(`accounts-row-${id}-link`).click();
    await this.page.waitForURL(new RegExp(`/accounts/${id}$`));
    return new AccountDetailPage(this.page, id);
  }

  async expectRow(id: string): Promise<void> {
    await expect(this.row(id)).toBeVisible();
  }
}

export class AccountDetailPage {
  readonly page: Page;
  readonly id: string;
  constructor(page: Page, id: string) {
    this.page = page;
    this.id = id;
  }

  async goto(): Promise<this> {
    await this.page.goto(`/accounts/${this.id}`);
    await this.page.getByTestId("accounts-detail").waitFor();
    return this;
  }

  /** Locator for a primitive / enum field's value cell. */
  field<K extends keyof AccountResponse>(name: K): Locator {
    return this.page.getByTestId(`accounts-detail-${String(name)}`);
  }

  /** Locator for the row of the contained `entries` collection. */
  entriesRow(id: string): Locator {
    return this.page.getByTestId(`accounts-detail-entries-row-${id}`);
  }

  /** Locator for the rows of the contained `entries` table — assert with toHaveCount. */
  entriesRows(): Locator {
    return this.page.getByTestId("accounts-detail-entries").locator("tbody tr");
  }

  /** deposit — opens the modal, fills the form, submits. */
  async deposit(input: DepositAccountRequest): Promise<this> {
    await this.page.getByTestId("accounts-op-deposit").click();
    await this.page.getByTestId("accounts-op-deposit-form").waitFor();
    if (input.amount !== undefined) {
      {
        const __f = this.page.getByTestId("accounts-op-deposit-input-amount");
        const __i = __f.locator("input, textarea");
        await ((await __i.count()) ? __i.first() : __f).fill(String(input.amount));
      }
    }
    if (input.memo !== undefined) {
      {
        const __f = this.page.getByTestId("accounts-op-deposit-input-memo");
        const __i = __f.locator("input, textarea");
        await ((await __i.count()) ? __i.first() : __f).fill(input.memo!);
      }
    }
    await this.page.getByTestId("accounts-op-deposit-submit").click();
    await this.page.getByTestId("accounts-op-deposit-form").waitFor({ state: "detached" });
    await this.page.waitForLoadState("networkidle");
    return this;
  }

  /** withdraw — opens the modal, fills the form, submits. */
  async withdraw(input: WithdrawAccountRequest): Promise<this> {
    await this.page.getByTestId("accounts-op-withdraw").click();
    await this.page.getByTestId("accounts-op-withdraw-form").waitFor();
    if (input.amount !== undefined) {
      {
        const __f = this.page.getByTestId("accounts-op-withdraw-input-amount");
        const __i = __f.locator("input, textarea");
        await ((await __i.count()) ? __i.first() : __f).fill(String(input.amount));
      }
    }
    if (input.memo !== undefined) {
      {
        const __f = this.page.getByTestId("accounts-op-withdraw-input-memo");
        const __i = __f.locator("input, textarea");
        await ((await __i.count()) ? __i.first() : __f).fill(input.memo!);
      }
    }
    await this.page.getByTestId("accounts-op-withdraw-submit").click();
    await this.page.getByTestId("accounts-op-withdraw-form").waitFor({ state: "detached" });
    await this.page.waitForLoadState("networkidle");
    return this;
  }

  /** debitForTransfer — opens the modal, fills the form, submits. */
  async debitForTransfer(input: DebitForTransferAccountRequest): Promise<this> {
    await this.page.getByTestId("accounts-op-debitForTransfer").click();
    await this.page.getByTestId("accounts-op-debitForTransfer-form").waitFor();
    if (input.amount !== undefined) {
      {
        const __f = this.page.getByTestId("accounts-op-debitForTransfer-input-amount");
        const __i = __f.locator("input, textarea");
        await ((await __i.count()) ? __i.first() : __f).fill(String(input.amount));
      }
    }
    if (input.ref !== undefined) {
      {
        const __f = this.page.getByTestId("accounts-op-debitForTransfer-input-ref");
        const __i = __f.locator("input, textarea");
        await ((await __i.count()) ? __i.first() : __f).fill(input.ref!);
      }
    }
    await this.page.getByTestId("accounts-op-debitForTransfer-submit").click();
    await this.page.getByTestId("accounts-op-debitForTransfer-form").waitFor({ state: "detached" });
    await this.page.waitForLoadState("networkidle");
    return this;
  }

  /** creditForTransfer — opens the modal, fills the form, submits. */
  async creditForTransfer(input: CreditForTransferAccountRequest): Promise<this> {
    await this.page.getByTestId("accounts-op-creditForTransfer").click();
    await this.page.getByTestId("accounts-op-creditForTransfer-form").waitFor();
    if (input.amount !== undefined) {
      {
        const __f = this.page.getByTestId("accounts-op-creditForTransfer-input-amount");
        const __i = __f.locator("input, textarea");
        await ((await __i.count()) ? __i.first() : __f).fill(String(input.amount));
      }
    }
    if (input.ref !== undefined) {
      {
        const __f = this.page.getByTestId("accounts-op-creditForTransfer-input-ref");
        const __i = __f.locator("input, textarea");
        await ((await __i.count()) ? __i.first() : __f).fill(input.ref!);
      }
    }
    await this.page.getByTestId("accounts-op-creditForTransfer-submit").click();
    await this.page.getByTestId("accounts-op-creditForTransfer-form").waitFor({ state: "detached" });
    await this.page.waitForLoadState("networkidle");
    return this;
  }

  /** accrueInterest — opens the modal, fills the form, submits. */
  async accrueInterest(input: AccrueInterestAccountRequest): Promise<this> {
    await this.page.getByTestId("accounts-op-accrueInterest").click();
    await this.page.getByTestId("accounts-op-accrueInterest-form").waitFor();
    if (input.asOf !== undefined) {
      {
        const __f = this.page.getByTestId("accounts-op-accrueInterest-input-asOf");
        const __i = __f.locator("input, textarea");
        await ((await __i.count()) ? __i.first() : __f).fill(input.asOf!.slice(0, 16));
      }
    }
    await this.page.getByTestId("accounts-op-accrueInterest-submit").click();
    await this.page.getByTestId("accounts-op-accrueInterest-form").waitFor({ state: "detached" });
    await this.page.waitForLoadState("networkidle");
    return this;
  }

  /** freeze (no parameters). */
  async freeze(): Promise<this> {
    await this.page.getByTestId("accounts-op-freeze").click();
    await this.page.getByTestId("accounts-op-freeze-submit").click();
    await this.page.getByTestId("accounts-op-freeze-form").waitFor({ state: "detached" });
    await this.page.waitForLoadState("networkidle");
    return this;
  }

  /** unfreeze (no parameters). */
  async unfreeze(): Promise<this> {
    await this.page.getByTestId("accounts-op-unfreeze").click();
    await this.page.getByTestId("accounts-op-unfreeze-submit").click();
    await this.page.getByTestId("accounts-op-unfreeze-form").waitFor({ state: "detached" });
    await this.page.waitForLoadState("networkidle");
    return this;
  }

  /** close (no parameters). */
  async close(): Promise<this> {
    await this.page.getByTestId("accounts-op-close").click();
    await this.page.getByTestId("accounts-op-close-submit").click();
    await this.page.getByTestId("accounts-op-close-form").waitFor({ state: "detached" });
    await this.page.waitForLoadState("networkidle");
    return this;
  }

}
