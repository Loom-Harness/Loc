// The hand-built forms (Flutter, Feliz, Angular) spell their chrome as whole
// catalog sentences: the dynamic-row "Add <item>" / "Remove" buttons, the
// scalar-array "Add", a required file's guard, the workflow run button
// (`<Ctx>.<Workflow>.op.run`, the key HEEx and the JSX targets read) and the
// create button.  With no translation runtime the same text is literal English.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/index.js";

const SYS = (platform: string, framework: string, literals: boolean) => `
system Shop {
  api ShopApi from S
  subdomain S {
    context Ctx {
      valueobject LineItem { sku: string  qty: int }
      aggregate Order {
        name: string
        doc: File
        tags: string[]
        lines: LineItem[]
      }
      repository Orders for Order { }
      workflow placeOrder transactional {
        create(customer: string, lines: LineItem[]) {
          let n = customer
        }
      }
    }
  }
  storage db { type: postgres }
  storage blobs { type: localDisk }
  resource st { for: Ctx, kind: state, use: db }
  resource fs { for: Ctx, kind: objectStore, use: blobs }
  ui App {
    framework: ${framework}
    api Shop: ShopApi
    page NewOrder {
      route: "/orders/new"
      body: Stack { ${literals ? 'Heading { "New order", level: 1 },' : ""} CreateForm(of: Order), WorkflowForm { runs: placeOrder } }
    }
    page Blank { route: "/blank" }
  }
  deployable api { platform: node contexts: [Ctx] dataSources: [st, fs] serves: ShopApi port: 3000 }
  deployable app { platform: ${platform} targets: api ui: App { Shop: api } port: 3006 }
}`;

const find = (files: Map<string, string>, suffix: string): string => {
  const hit = [...files].find(([p]) => p.endsWith(suffix));
  expect(hit, `missing ${suffix} (have ${[...files.keys()].join(", ")})`).toBeDefined();
  return hit![1];
};

const catalog = (files: Map<string, string>): Record<string, string> =>
  JSON.parse(find(files, ".loom/messages.en.json"));

describe("flutter forms", () => {
  it("read the catalog sentences under i18n", async () => {
    const files = await generateSystemFiles(SYS("flutter", "flutter", true));
    const forms = find(files, "lib/forms.dart");
    expect(forms).toContain("Text(t('chrome.addItem.LineItem', 'Add Line Item'))");
    expect(forms).toContain("Text(t('chrome.addValue.tags', 'Add'))");
    expect(forms).toContain("ServerIssue.plain(t('chrome.fieldRequired.doc', 'Doc is required'))");
    expect(forms).toContain("Text(t('Ctx.placeOrder.op.run', 'Run'))");
    expect(forms).toContain("Text(t('Ctx.Order.op.create', 'Create'))");
    expect(forms).not.toContain("const Text('Add')");
    expect(forms).not.toContain("is required'));");
    expect(find(files, "blank_page.dart")).toContain("Text(t('chrome.emptyPage', 'Empty page'))");
    const cat = catalog(files);
    expect(cat["chrome.addItem.LineItem"]).toBe("Add Line Item");
    expect(cat["chrome.addValue.tags"]).toBe("Add");
    expect(cat["chrome.fieldRequired.doc"]).toBe("Doc is required");
    expect(cat["chrome.emptyPage"]).toBe("Empty page");
    expect(cat["Ctx.placeOrder.op.run"]).toBe("Run");
    // Flutter's row removal is an icon, so it reads no Remove sentence.
    expect(cat["chrome.removeItem.LineItem"]).toBeUndefined();
  });

  it("stay literal English without a translation runtime", async () => {
    const files = await generateSystemFiles(SYS("flutter", "flutter", false));
    const forms = find(files, "lib/forms.dart");
    expect(forms).toContain("const Text('Add Line Item')");
    expect(forms).toContain("const Text('Add')");
    expect(forms).toContain("ServerIssue.plain('Doc is required')");
    expect(forms).toContain("const Text('Run')");
    expect(forms).not.toContain("chrome.");
  });
});

describe("feliz forms", () => {
  it("read the catalog sentences under i18n", async () => {
    const files = await generateSystemFiles(SYS("feliz", "feliz", true));
    const app = find(files, "src/App.fs");
    expect(app).toContain('prop.text (I18n.t "chrome.removeItem.LineItem" "Remove")');
    expect(app).toContain('prop.text (I18n.t "chrome.addItem.LineItem" "Add Line Item")');
    expect(app).toContain('prop.text (I18n.t "Ctx.placeOrder.op.run" "Run")');
    expect(app).toContain('prop.text (I18n.t "Ctx.Order.op.create" "Create")');
    expect(app).not.toContain('prop.text "Remove"');
    const cat = catalog(files);
    expect(cat["chrome.removeItem.LineItem"]).toBe("Remove");
    expect(cat["Ctx.placeOrder.op.run"]).toBe("Run");
  });

  it("stay literal English without a translation runtime", async () => {
    const files = await generateSystemFiles(SYS("feliz", "feliz", false));
    const app = find(files, "src/App.fs");
    expect(app).toContain('prop.text "Remove"');
    expect(app).toContain('prop.text "Add Line Item"');
    expect(app).toContain('prop.text "Run"');
    expect(app).toContain('prop.text "Create"');
    expect(app).not.toContain("I18n.t");
  });
});

describe("angular forms", () => {
  it("read the Remove sentence under i18n", async () => {
    const files = await generateSystemFiles(SYS("angular", "angular", true));
    const forms = [...files]
      .filter(([p]) => p.endsWith(".ts") && p.includes("/app/"))
      .map(([, c]) => c)
      .join("\n");
    expect(forms).toContain('t("chrome.removeItem.LineItem", "Remove")');
    expect(catalog(files)["chrome.removeItem.LineItem"]).toBe("Remove");
  });
});
