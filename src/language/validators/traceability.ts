// Traceability artifact validators — `requirement` declarations.
// Validates allowed property keys / required props / enum values,
// and detects parent-chain cycles.

import type { ValidationAcceptor } from "langium";
import { diagMessage } from "../../diagnostics/messages.js";
import type { Model, Requirement } from "../generated/ast.js";

/** Validate `requirement` traceability artifacts: the `type`,
 *  `title`, `status` and `priority` keys, and that each declared
 *  `type`/`status` is one of the known enum values. */
export function checkTraceability(model: Model, accept: ValidationAcceptor): void {
  const ALLOWED_KEYS = new Set(["type", "title", "status", "priority"]);
  const TYPES = new Set(["UserStory", "UseCase", "AcceptanceCriteria", "BusinessReq"]);
  const STATUSES = new Set(["Draft", "Approved", "InProgress", "Done"]);

  const requirements = model.members.filter((m): m is Requirement => m.$type === "Requirement");

  for (const req of requirements) {
    const seen = new Set<string>();
    let hasType = false;
    let hasTitle = false;
    for (const p of req.props) {
      if (!ALLOWED_KEYS.has(p.name)) {
        accept(
          "error",
          diagMessage("loom.requirement-property-unknown", {
            name: p.name,
            known: [...ALLOWED_KEYS].join(", "),
          }),
          { node: p, property: "name", code: "loom.requirement-property-unknown" },
        );
        continue;
      }
      if (seen.has(p.name)) {
        accept("error", diagMessage("loom.requirement-property-duplicate", { name: p.name }), {
          node: p,
          property: "name",
          code: "loom.requirement-property-duplicate",
        });
      }
      seen.add(p.name);

      const v = p.value;
      if (p.name === "type") {
        hasType = true;
        const name = v?.$type === "NameRef" ? (v as { name: string }).name : undefined;
        if (!name || !TYPES.has(name)) {
          accept(
            "error",
            diagMessage("loom.requirement-type-invalid", { known: [...TYPES].join(", ") }),
            { node: p, property: "value", code: "loom.requirement-type-invalid" },
          );
        }
      } else if (p.name === "status") {
        const name = v?.$type === "NameRef" ? (v as { name: string }).name : undefined;
        if (!name || !STATUSES.has(name)) {
          accept(
            "error",
            diagMessage("loom.requirement-status-invalid", { known: [...STATUSES].join(", ") }),
            { node: p, property: "value", code: "loom.requirement-status-invalid" },
          );
        }
      } else if (p.name === "title") {
        hasTitle = true;
        if (v?.$type !== "StringLit") {
          accept("error", diagMessage("loom.requirement-title-not-string"), {
            node: p,
            property: "value",
            code: "loom.requirement-title-not-string",
          });
        }
      } else if (p.name === "priority") {
        if (v?.$type !== "IntLit") {
          accept("error", diagMessage("loom.requirement-priority-not-int"), {
            node: p,
            property: "value",
            code: "loom.requirement-priority-not-int",
          });
        }
      }
    }
    if (!hasType) {
      accept("error", diagMessage("loom.requirement-property-missing#type", { name: req.name }), {
        node: req,
        property: "name",
        code: "loom.requirement-property-missing",
      });
    }
    if (!hasTitle) {
      accept("error", diagMessage("loom.requirement-property-missing#title", { name: req.name }), {
        node: req,
        property: "name",
        code: "loom.requirement-property-missing",
      });
    }
  }

  // Parent acyclicity — walk the parent chain from each requirement
  // and flag the first node that re-enters a requirement already on
  // its own path.
  for (const req of requirements) {
    const path = new Set<string>([req.name]);
    let cur = req.parent?.ref;
    while (cur) {
      if (path.has(cur.name)) {
        accept("error", diagMessage("loom.requirement-parent-cycle", { name: req.name }), {
          node: req,
          property: "parent",
          code: "loom.requirement-parent-cycle",
        });
        break;
      }
      path.add(cur.name);
      cur = cur.parent?.ref;
    }
  }
}
