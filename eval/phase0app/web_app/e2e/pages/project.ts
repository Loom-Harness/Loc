// Auto-generated.  Do not edit by hand.
import type { Page, Locator } from "@playwright/test";
import { expect } from "@playwright/test";
import type { CreateProjectRequest, UpdateProjectRequest, ProjectResponse } from "../../src/api/project";

export class ProjectListPage {
  static readonly url = "/projects";
  readonly page: Page;
  constructor(page: Page) {
    this.page = page;
  }

  async goto(): Promise<this> {
    await this.page.goto(ProjectListPage.url);
    await this.page.getByTestId("projects-list").waitFor();
    return this;
  }

  async create(): Promise<ProjectNewPage> {
    await this.page.getByTestId("projects-list-create").click();
    return new ProjectNewPage(this.page);
  }

  row(id: string): Locator {
    return this.page.getByTestId(`projects-row-${id}`);
  }

  async open(id: string): Promise<ProjectDetailPage> {
    await this.page.getByTestId(`projects-row-${id}-link`).click();
    await this.page.waitForURL(new RegExp(`/projects/${id}$`));
    return new ProjectDetailPage(this.page, id);
  }

  async expectRow(id: string): Promise<void> {
    await expect(this.row(id)).toBeVisible();
  }
}

export class ProjectNewPage {
  static readonly url = "/projects/new";
  readonly page: Page;
  constructor(page: Page) {
    this.page = page;
  }

  async goto(): Promise<this> {
    await this.page.goto(ProjectNewPage.url);
    await this.page.getByTestId("projects-new").waitFor();
    return this;
  }

  async fill(input: Partial<CreateProjectRequest>): Promise<this> {
    if (input.name !== undefined) {
      {
        const __f = this.page.getByTestId("projects-new-input-name");
        const __i = __f.locator("input, textarea");
        await ((await __i.count()) ? __i.first() : __f).fill(input.name!);
      }
    }
    return this;
  }

  async submit(): Promise<ProjectDetailPage> {
    await this.page.getByTestId("projects-new-submit").click();
    // Wait for the detail page to render rather than matching
    // the URL — `/projects/new` itself matches a naive regex.
    await this.page.getByTestId("projects-detail").waitFor();
    const id = this.page.url().split("/").pop()!;
    return new ProjectDetailPage(this.page, id);
  }
}

export class ProjectDetailPage {
  readonly page: Page;
  readonly id: string;
  constructor(page: Page, id: string) {
    this.page = page;
    this.id = id;
  }

  async goto(): Promise<this> {
    await this.page.goto(`/projects/${this.id}`);
    await this.page.getByTestId("projects-detail").waitFor();
    return this;
  }

  /** Locator for a primitive / enum field's value cell. */
  field<K extends keyof ProjectResponse>(name: K): Locator {
    return this.page.getByTestId(`projects-detail-${String(name)}`);
  }

  /** update — opens the modal, fills the form, submits. */
  async update(input: UpdateProjectRequest): Promise<this> {
    await this.page.getByTestId("projects-op-update").click();
    await this.page.getByTestId("projects-op-update-form").waitFor();
    if (input.name !== undefined) {
      {
        const __f = this.page.getByTestId("projects-op-update-input-name");
        const __i = __f.locator("input, textarea");
        await ((await __i.count()) ? __i.first() : __f).fill(input.name!);
      }
    }
    await this.page.getByTestId("projects-op-update-submit").click();
    await this.page.getByTestId("projects-op-update-form").waitFor({ state: "detached" });
    await this.page.waitForLoadState("networkidle");
    return this;
  }

}
