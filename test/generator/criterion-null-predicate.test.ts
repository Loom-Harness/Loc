// F-039 — `== null` / `!= null` in a criterion is a null TEST, not a comparison.
//
//     criterion OpenSteps()   of Step = answeredAt == null
//     criterion ClosedSteps() of Step = answeredAt != null
//
// is the canonical "still open" / "already answered" filter.  The node backend
// lowered it through the ordinary comparison arm — `eq(col, null)` /
// `ne(col, null)` — which is wrong twice:
//
//   1. drizzle types `eq` as `(column, value)` with no `null` in the value
//      union, so the emitted repository does not compile (TS2769, "Argument of
//      type 'null' is not assignable to parameter of type 'SQLWrapper | Date'").
//   2. more seriously, SQL `col = NULL` evaluates to UNKNOWN, never TRUE.  On a
//      driver that accepts the bind, the criterion silently matches NOTHING —
//      a filter that quietly returns the empty set, which is worse than a
//      build error because nothing reports it.
//
// The other four backends were already right, each in its own spelling, and
// this suite pins all five together so the node fix cannot regress alone.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/generate.js";

const SOURCE = (platform: string) => `
  system NullFilter {
    subdomain S {
      context C {
        aggregate Step with crudish {
          label: string
          answeredAt: datetime?
          derived display: string = label
        }
        repository Steps for Step { }
        criterion OpenSteps() of Step = answeredAt == null
        criterion ClosedSteps() of Step = answeredAt != null
        retrieval PendingSteps() of Step { where: OpenSteps() sort: [label asc] }
        retrieval DoneSteps() of Step { where: ClosedSteps() sort: [label asc] }
      }
    }
    storage primary { type: postgres }
    resource st { for: C, kind: state, use: primary }
    deployable api { platform: ${platform} contexts: [C] dataSources: [st] port: 3000 }
  }
`;

describe("F-039 — a null test in a criterion", () => {
  it("node: emits drizzle `isNull` / `isNotNull`, never `eq(col, null)`", async () => {
    const files = await generateSystemFiles(SOURCE("node"));
    const repo = files.get("api/db/repositories/step-repository.ts")!;

    expect(repo).toContain("const openStepsCriterion = () => isNull(schema.steps.answeredAt);");
    expect(repo).toContain(
      "const closedStepsCriterion = () => isNotNull(schema.steps.answeredAt);",
    );
    // The TS2769 / silent-empty-set spellings.
    expect(repo).not.toContain("eq(schema.steps.answeredAt, null)");
    expect(repo).not.toContain("ne(schema.steps.answeredAt, null)");
    // The operators have to be imported, or the fix trades one compile error
    // for another.
    expect(repo).toMatch(/import \{[^}]*\bisNull\b[^}]*\} from "drizzle-orm";/);
    expect(repo).toMatch(/import \{[^}]*\bisNotNull\b[^}]*\} from "drizzle-orm";/);
  });

  it("node: an ordinary comparison against a VALUE still lowers to `eq`", async () => {
    const files = await generateSystemFiles(`
      system Ord {
        subdomain S {
          context C {
            aggregate Step with crudish {
              label: string
              derived display: string = label
            }
            repository Steps for Step { }
            criterion Named() of Step = label == "x"
            retrieval NamedSteps() of Step { where: Named() sort: [label asc] }
          }
        }
        storage primary { type: postgres }
        resource st { for: C, kind: state, use: primary }
        deployable api { platform: node contexts: [C] dataSources: [st] port: 3000 }
      }
    `);
    const repo = files.get("api/db/repositories/step-repository.ts")!;
    expect(repo).toContain('eq(schema.steps.label, "x")');
  });

  it("java: JPA `cb.isNull` / `cb.isNotNull`", async () => {
    const files = await generateSystemFiles(SOURCE("java"));
    const criteria = files.get(
      "api/src/main/java/com/loom/api/domain/criteria/StepCriteria.java",
    )!;
    expect(criteria).toContain('cb.isNull(root.<Instant>get("answeredAt"))');
    expect(criteria).toContain('cb.isNotNull(root.<Instant>get("answeredAt"))');
  });

  it("elixir: Ecto `is_nil` / `not is_nil`", async () => {
    const files = await generateSystemFiles(SOURCE("elixir"));
    const open = files.get("api/lib/api/c/retrievals/pending_steps.ex")!;
    const closed = files.get("api/lib/api/c/retrievals/done_steps.ex")!;
    expect(open).toContain("where: is_nil(record.answered_at)");
    expect(closed).toContain("where: not is_nil(record.answered_at)");
  });

  it("python: SQLAlchemy's `== None` overload (which renders IS NULL)", async () => {
    const files = await generateSystemFiles(SOURCE("python"));
    const repo = files.get("api/app/db/repositories/step_repository.py")!;
    // `== None` is deliberate, not a lint slip: SQLAlchemy overloads `__eq__`
    // on a column to build `IS NULL`.  `is None` would compare the COLUMN
    // OBJECT and produce a constant `False`.  `pyproject.toml` ignores E711
    // with that rationale.
    expect(repo).toContain("StepRow.answered_at == None");
    expect(repo).toContain("StepRow.answered_at != None");
  });

  it("dotnet: `== null` inside the EF expression tree (translated to IS NULL)", async () => {
    const files = await generateSystemFiles(SOURCE("dotnet"));
    const open = files.get("api/Domain/Criteria/OpenStepsCriterion.cs")!;
    const closed = files.get("api/Domain/Criteria/ClosedStepsCriterion.cs")!;
    expect(open).toContain("candidate => candidate.AnsweredAt == null");
    expect(closed).toContain("candidate => candidate.AnsweredAt != null");
  });
});
