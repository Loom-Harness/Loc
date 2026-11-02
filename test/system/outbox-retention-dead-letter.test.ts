import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/index.js";

// Every outbox relay — each backend, each persistence adapter, the standalone
// and the broker-publishing shape — must agree on three behaviours:
//   - the poll reads only PENDING rows (`dispatched_at IS NULL AND dead_at IS
//     NULL`, the partial index's predicate), never the old `attempts < max`;
//   - a row whose attempts run out is stamped `dead_at` and logs
//     `event_dead_lettered` once, with the row id;
//   - dispatched rows older than `LOOM_OUTBOX_RETENTION_DAYS` (default 7) are
//     purged periodically.
// See docs/channels.md § "Outbox retention and dead letters".

const standalone = (deployable: string) => `
system Acme {
  subdomain Sales {
    context Orders {
      aggregate Order with crudish {
        customerId: string
        status: string
        operation place() { precondition status == "Draft"  status := "Placed"  emit OrderPlaced { order: id } }
      }
      repository Orders for Order {}
      event OrderPlaced { order: Order id }
      channel Lifecycle { carries: OrderPlaced  delivery: broadcast  retention: log }
      workflow Fulfil {
        orderId: Order id
        status: string
        create(p: OrderPlaced) by p.order { status := "Pending" }
      }
    }
  }
  storage primary { type: postgres }
  resource ordersState { for: Orders, kind: state, use: primary }
  deployable api { platform: ${deployable} contexts: [Orders] dataSources: [ordersState] port: 3000 }
}
`;

// A durable `work` channel bound to rabbitmq: the producer's relay publishes
// drained rows to the broker instead of redelivering locally.
const broker = (platform: string) => `
system Acme {
  subdomain Sales {
    context Orders {
      aggregate Order with crudish {
        customerId: string
        status: string
        operation place() { precondition status == "Draft"  status := "Placed"  emit OrderPlaced { order: id } }
      }
      repository Orders for Order {}
      event OrderPlaced { order: Order id }
      channel Lifecycle { carries: OrderPlaced  delivery: queue  retention: work }
    }
  }
  subdomain Fulfilment {
    context Shipping {
      aggregate Shipment with crudish {
        orderRef: Order id
        status: string
      }
      repository Shipments for Shipment {}
      workflow Fulfil {
        orderId: Order id
        create(p: OrderPlaced) by p.order {
          let s = Shipment.create(orderRef: p.order, status: "Pending")
        }
      }
    }
  }
  storage primary { type: postgres }
  storage bus { type: rabbitmq }
  resource ordersState { for: Orders, kind: state, use: primary }
  resource shippingState { for: Shipping, kind: state, use: primary }
  channelSource lifecycleBus { for: Lifecycle, use: bus }
  deployable salesApi { platform: ${platform} contexts: [Orders] dataSources: [ordersState] channels: [lifecycleBus] port: 3000 }
  deployable shipApi  { platform: ${platform} contexts: [Shipping] dataSources: [shippingState] channels: [lifecycleBus] port: 3001 }
}
`;

interface RelayShape {
  /** The poll's pending-row filter. */
  poll: string;
  /** Any fragment that would mean the poll still filters on attempts. */
  stalePoll: string;
  /** The retention purge's DELETE. */
  purge: string;
  /** Stamping `dead_at` on the exhausted row. */
  dead: string;
  /** The dead-letter warning, carrying the row id. */
  deadLog: string;
}

const SHAPES: Record<string, RelayShape> = {
  node: {
    poll: "and(isNull(schema.loomOutbox.dispatchedAt), isNull(schema.loomOutbox.deadAt))",
    stalePoll: "lt(schema.loomOutbox.attempts",
    purge: "db.delete(schema.loomOutbox).where(lt(schema.loomOutbox.dispatchedAt, cutoff))",
    dead: "deadAt: dead ? new Date() : null",
    deadLog: 'event: "event_dead_lettered", id: row.id',
  },
  mikroorm: {
    poll: "{ dispatchedAt: null, deadAt: null }",
    stalePoll: "attempts: { $lt",
    purge: "em.nativeDelete(LoomOutboxRow, { dispatchedAt: { $lt: cutoff } })",
    dead: "deadAt: dead ? new Date() : null",
    deadLog: 'event: "event_dead_lettered", id: row.id',
  },
  python: {
    poll: ".where(LoomOutboxRow.dead_at.is_(None))",
    stalePoll: "LoomOutboxRow.attempts < max_attempts",
    purge: "delete(LoomOutboxRow).where(LoomOutboxRow.id.in_(expired))",
    dead: "dead_at=datetime.now(UTC) if dead else None",
    deadLog: '"event_dead_lettered", id=event_id',
  },
  java: {
    poll: "findTop50ByDispatchedAtIsNullAndDeadAtIsNullOrderByOccurredAtAsc()",
    stalePoll: "AttemptsLessThan",
    purge:
      "DELETE FROM __loom_outbox WHERE id IN (SELECT id FROM __loom_outbox WHERE dispatched_at < :cutoff LIMIT 1000)",
    dead: "row.setDeadAt(Instant.now());",
    deadLog: '"event_dead_lettered", "warn", "id", row.getId().toString()',
  },
  elixir: {
    poll: "where: is_nil(o.dispatched_at) and is_nil(o.dead_at)",
    stalePoll: "o.attempts < @max_attempts",
    purge: "where: o.dispatched_at < ^cutoff",
    dead: "set: [attempts: attempts, dead_at: dead_at]",
    deadLog: 'event: "event_dead_lettered", id: row.id',
  },
  dotnet: {
    poll: ".Where(m => m.DispatchedAt == null && m.DeadAt == null)",
    stalePoll: "m.Attempts < MaxAttempts",
    purge: ".Where(m => m.DispatchedAt < cutoff).ExecuteDeleteAsync(cancellationToken)",
    dead: "row.DeadAt = DateTime.UtcNow;",
    deadLog:
      '"{Event} id={Id} type={Type} attempts={Attempts} error={Error}", "event_dead_lettered", row.Id',
  },
  dapper: {
    poll: "WHERE dispatched_at IS NULL AND dead_at IS NULL ORDER BY occurred_at",
    stalePoll: "attempts < @max",
    purge:
      "DELETE FROM __loom_outbox WHERE id IN (SELECT id FROM __loom_outbox WHERE dispatched_at < @cutoff LIMIT 1000)",
    dead: "dead_at = CASE WHEN @dead THEN now() END",
    deadLog:
      '"{Event} id={Id} type={Type} attempts={Attempts} error={Error}", "event_dead_lettered", row.id',
  },
};

const DEPLOYABLE: Record<string, string> = {
  node: "node",
  mikroorm: "node { persistence: mikroorm }",
  python: "python",
  java: "java",
  elixir: "elixir",
  dotnet: "dotnet",
  dapper: "dotnet { persistence: dapper }",
};

/** The emitted source of one deployable (migrations and the `.loom/` bundle
 *  excluded — this checks the relay, not the DDL). */
function relaySource(files: Map<string, string>, deployable: string): string {
  return [...files.entries()]
    .filter(([p]) => p.startsWith(`${deployable}/`) && !/migrat|\.loom\//i.test(p))
    .map(([, c]) => c)
    .join("\n");
}

function expectRelay(src: string, shape: RelayShape): void {
  expect(src, "poll filters on the pending predicate").toContain(shape.poll);
  expect(src, "poll no longer filters on attempts").not.toContain(shape.stalePoll);
  expect(src, "retention purge DELETE").toContain(shape.purge);
  expect(src, "retention reads the env var").toContain("LOOM_OUTBOX_RETENTION_DAYS");
  expect(src, "retention defaults to 7 days").toMatch(/\b7\b/);
  expect(src, "exhausted row is stamped dead_at").toContain(shape.dead);
  expect(src, "dead-letter warning with the row id").toContain(shape.deadLog);
}

describe("outbox relay retention + dead letters", () => {
  for (const [key, shape] of Object.entries(SHAPES)) {
    it(`${key}: standalone relay polls pending rows, dead-letters, purges`, async () => {
      const files = await generateSystemFiles(standalone(DEPLOYABLE[key] as string));
      expectRelay(relaySource(files, "api"), shape);
    });
  }

  for (const key of ["node", "python", "java", "elixir", "dotnet"]) {
    it(`${key}: broker-publishing relay polls pending rows, dead-letters, purges`, async () => {
      const files = await generateSystemFiles(broker(key));
      const dep = [...files.keys()]
        .map((p) => p.split("/")[0] as string)
        .find((d) => /^sales/i.test(d));
      expect(dep, "sales deployable emitted").toBeDefined();
      expectRelay(relaySource(files, dep as string), SHAPES[key] as RelayShape);
    });
  }

  for (const platform of ["node", "python", "java", "elixir", "dotnet"]) {
    it(`${platform} migrations add the nullable dead_at column`, async () => {
      const files = await generateSystemFiles(standalone(platform));
      const ddl = [...files.entries()]
        .filter(([p, c]) => /migrat/i.test(p) && c.includes("__loom_outbox"))
        .map(([, c]) => c)
        .join("\n");
      expect(ddl).toMatch(/"dead_at"|:dead_at/);
    });
  }

  // The node workflow file derives its imports by scanning the body with the
  // string literals stripped; a quote inside emitted relay text (a comment's
  // apostrophe) would open a phantom literal and hide later references.
  it("node: every runtime helper the outbox workflow file calls is imported", async () => {
    const src = readFileSync("test/fixtures/corpus/outbox.ddd", "utf8").replaceAll(
      "__PLATFORM__",
      "node",
    );
    const files = await generateSystemFiles(src);
    const workflows = [...files.entries()].filter(([p]) => p.endsWith("http/workflows.ts"));
    expect(workflows.length).toBeGreaterThan(0);
    for (const [path, content] of workflows) {
      if (/(?<!\.)\brandomUUID\(/.test(content)) {
        expect(content, `${path} calls randomUUID()`).toContain(
          'import { randomUUID } from "node:crypto";',
        );
      }
    }
  });
});
