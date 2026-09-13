// Auto-generated.  Do not edit by hand.
import type { Page, Locator } from "@playwright/test";
import { expect } from "@playwright/test";
import type { CreateTaskRequest, UpdateTaskRequest, TaskResponse } from "../../src/api/task";

export class TaskListPage {
  static readonly url = "/tasks";
  readonly page: Page;
  constructor(page: Page) {
    this.page = page;
  }

  async goto(): Promise<this> {
    await this.page.goto(TaskListPage.url);
    await this.page.getByTestId("tasks-list").waitFor();
    return this;
  }

  async create(): Promise<TaskNewPage> {
    await this.page.getByTestId("tasks-list-create").click();
    return new TaskNewPage(this.page);
  }

  row(id: string): Locator {
    return this.page.getByTestId(`tasks-row-${id}`);
  }

  async open(id: string): Promise<TaskDetailPage> {
    await this.page.getByTestId(`tasks-row-${id}-link`).click();
    await this.page.waitForURL(new RegExp(`/tasks/${id}$`));
    return new TaskDetailPage(this.page, id);
  }

  async expectRow(id: string): Promise<void> {
    await expect(this.row(id)).toBeVisible();
  }
}

export class TaskNewPage {
  static readonly url = "/tasks/new";
  readonly page: Page;
  constructor(page: Page) {
    this.page = page;
  }

  async goto(): Promise<this> {
    await this.page.goto(TaskNewPage.url);
    await this.page.getByTestId("tasks-new").waitFor();
    return this;
  }

  async fill(input: Partial<CreateTaskRequest>): Promise<this> {
    if (input.title !== undefined) {
      {
        const __f = this.page.getByTestId("tasks-new-input-title");
        const __i = __f.locator("input, textarea");
        await ((await __i.count()) ? __i.first() : __f).fill(input.title!);
      }
    }
    if (input.done !== undefined) {
      const __cur = await this.page.getByTestId("tasks-new-input-done").isChecked();
      if (__cur !== input.done) {
        await this.page.getByTestId("tasks-new-input-done").click();
      }
    }
    if (input.project !== undefined) {
      {
        await this.page.getByTestId("tasks-new-input-project").click();
        const __opt = this.page.getByTestId(`tasks-new-input-project-option-${input.project!}`);
        await __opt.waitFor({ state: "visible" });
        await __opt.click();
      }
    }
    return this;
  }

  async submit(): Promise<TaskDetailPage> {
    await this.page.getByTestId("tasks-new-submit").click();
    // Wait for the detail page to render rather than matching
    // the URL — `/tasks/new` itself matches a naive regex.
    await this.page.getByTestId("tasks-detail").waitFor();
    const id = this.page.url().split("/").pop()!;
    return new TaskDetailPage(this.page, id);
  }
}

export class TaskDetailPage {
  readonly page: Page;
  readonly id: string;
  constructor(page: Page, id: string) {
    this.page = page;
    this.id = id;
  }

  async goto(): Promise<this> {
    await this.page.goto(`/tasks/${this.id}`);
    await this.page.getByTestId("tasks-detail").waitFor();
    return this;
  }

  /** Locator for a primitive / enum field's value cell. */
  field<K extends keyof TaskResponse>(name: K): Locator {
    return this.page.getByTestId(`tasks-detail-${String(name)}`);
  }

  /** update — opens the modal, fills the form, submits. */
  async update(input: UpdateTaskRequest): Promise<this> {
    await this.page.getByTestId("tasks-op-update").click();
    await this.page.getByTestId("tasks-op-update-form").waitFor();
    if (input.title !== undefined) {
      {
        const __f = this.page.getByTestId("tasks-op-update-input-title");
        const __i = __f.locator("input, textarea");
        await ((await __i.count()) ? __i.first() : __f).fill(input.title!);
      }
    }
    if (input.done !== undefined) {
      const __cur = await this.page.getByTestId("tasks-op-update-input-done").isChecked();
      if (__cur !== input.done) {
        await this.page.getByTestId("tasks-op-update-input-done").click();
      }
    }
    if (input.project !== undefined) {
      {
        await this.page.getByTestId("tasks-op-update-input-project").click();
        const __opt = this.page.getByTestId(`tasks-op-update-input-project-option-${input.project!}`);
        await __opt.waitFor({ state: "visible" });
        await __opt.click();
      }
    }
    await this.page.getByTestId("tasks-op-update-submit").click();
    await this.page.getByTestId("tasks-op-update-form").waitFor({ state: "detached" });
    await this.page.waitForLoadState("networkidle");
    return this;
  }

}
