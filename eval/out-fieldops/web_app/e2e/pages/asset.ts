// Auto-generated.  Do not edit by hand.
import type { Page, Locator } from "@playwright/test";
import { expect } from "@playwright/test";
import type { CreateAssetRequest, UpdateAssetRequest, AssetResponse } from "../../src/api/asset";

export class AssetListPage {
  static readonly url = "/assets";
  readonly page: Page;
  constructor(page: Page) {
    this.page = page;
  }

  async goto(): Promise<this> {
    await this.page.goto(AssetListPage.url);
    await this.page.getByTestId("assets-list").waitFor();
    return this;
  }

  async create(): Promise<AssetNewPage> {
    await this.page.getByTestId("assets-list-create").click();
    return new AssetNewPage(this.page);
  }

  row(id: string): Locator {
    return this.page.getByTestId(`assets-row-${id}`);
  }

  async open(id: string): Promise<AssetDetailPage> {
    await this.page.getByTestId(`assets-row-${id}-link`).click();
    await this.page.waitForURL(new RegExp(`/assets/${id}$`));
    return new AssetDetailPage(this.page, id);
  }

  async expectRow(id: string): Promise<void> {
    await expect(this.row(id)).toBeVisible();
  }
}

export class AssetNewPage {
  static readonly url = "/assets/new";
  readonly page: Page;
  constructor(page: Page) {
    this.page = page;
  }

  async goto(): Promise<this> {
    await this.page.goto(AssetNewPage.url);
    await this.page.getByTestId("assets-new").waitFor();
    return this;
  }

  async fill(input: Partial<CreateAssetRequest>): Promise<this> {
    if (input.siteId !== undefined) {
      {
        await this.page.getByTestId("assets-new-input-siteId").click();
        const __opt = this.page.getByTestId(`assets-new-input-siteId-option-${input.siteId!}`);
        await __opt.waitFor({ state: "visible" });
        await __opt.click();
      }
    }
    if (input.serialNumber !== undefined) {
      {
        const __f = this.page.getByTestId("assets-new-input-serialNumber");
        const __i = __f.locator("input, textarea");
        await ((await __i.count()) ? __i.first() : __f).fill(input.serialNumber!);
      }
    }
    if (input.model !== undefined) {
      {
        const __f = this.page.getByTestId("assets-new-input-model");
        const __i = __f.locator("input, textarea");
        await ((await __i.count()) ? __i.first() : __f).fill(input.model!);
      }
    }
    if (input.requiredSkill !== undefined) {
      {
        const __sel = this.page.getByTestId("assets-new-input-requiredSkill");
        await __sel.click();
        const __listbox = this.page.locator('[role="listbox"]').filter({ has: this.page.getByRole("option", { name: input.requiredSkill!, exact: true }) });
        await __listbox.waitFor({ state: "visible" });
        await __listbox.getByRole("option", { name: input.requiredSkill!, exact: true }).click();
      }
    }
    return this;
  }

  async submit(): Promise<AssetDetailPage> {
    await this.page.getByTestId("assets-new-submit").click();
    // Wait for the detail page to render rather than matching
    // the URL — `/assets/new` itself matches a naive regex.
    await this.page.getByTestId("assets-detail").waitFor();
    const id = this.page.url().split("/").pop()!;
    return new AssetDetailPage(this.page, id);
  }
}

export class AssetDetailPage {
  readonly page: Page;
  readonly id: string;
  constructor(page: Page, id: string) {
    this.page = page;
    this.id = id;
  }

  async goto(): Promise<this> {
    await this.page.goto(`/assets/${this.id}`);
    await this.page.getByTestId("assets-detail").waitFor();
    return this;
  }

  /** Locator for a primitive / enum field's value cell. */
  field<K extends keyof AssetResponse>(name: K): Locator {
    return this.page.getByTestId(`assets-detail-${String(name)}`);
  }

  /** update — opens the modal, fills the form, submits. */
  async update(input: UpdateAssetRequest): Promise<this> {
    await this.page.getByTestId("assets-op-update").click();
    await this.page.getByTestId("assets-op-update-form").waitFor();
    if (input.siteId !== undefined) {
      {
        await this.page.getByTestId("assets-op-update-input-siteId").click();
        const __opt = this.page.getByTestId(`assets-op-update-input-siteId-option-${input.siteId!}`);
        await __opt.waitFor({ state: "visible" });
        await __opt.click();
      }
    }
    if (input.serialNumber !== undefined) {
      {
        const __f = this.page.getByTestId("assets-op-update-input-serialNumber");
        const __i = __f.locator("input, textarea");
        await ((await __i.count()) ? __i.first() : __f).fill(input.serialNumber!);
      }
    }
    if (input.model !== undefined) {
      {
        const __f = this.page.getByTestId("assets-op-update-input-model");
        const __i = __f.locator("input, textarea");
        await ((await __i.count()) ? __i.first() : __f).fill(input.model!);
      }
    }
    if (input.warrantyExpiry !== undefined) {
      {
        const __f = this.page.getByTestId("assets-op-update-input-warrantyExpiry");
        const __i = __f.locator("input, textarea");
        await ((await __i.count()) ? __i.first() : __f).fill(input.warrantyExpiry!.slice(0, 16));
      }
    }
    if (input.requiredSkill !== undefined) {
      {
        const __sel = this.page.getByTestId("assets-op-update-input-requiredSkill");
        await __sel.click();
        const __listbox = this.page.locator('[role="listbox"]').filter({ has: this.page.getByRole("option", { name: input.requiredSkill!, exact: true }) });
        await __listbox.waitFor({ state: "visible" });
        await __listbox.getByRole("option", { name: input.requiredSkill!, exact: true }).click();
      }
    }
    await this.page.getByTestId("assets-op-update-submit").click();
    await this.page.getByTestId("assets-op-update-form").waitFor({ state: "detached" });
    await this.page.waitForLoadState("networkidle");
    return this;
  }

}
