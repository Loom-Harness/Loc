// ---------------------------------------------------------------------------
// Item 3 (d) / ruling D1 (docs/decisions.md D-REACTOR-SYSTEM-PRINCIPAL): a
// reactor runs as the system principal OF THE TRIGGERING EVENT'S TENANT — also
// when the event reaches it through the outbox relay or across a broker.
//
// Before: the system principal copied its tenant from the dispatching
// request's principal.  The outbox relay and the channel consumer run with no
// request, so a durable or broker-delivered event's reactor ran TENANT-LESS
// (every tenant-scoped read matched nothing): the envelope carried no tenant
// and the outbox row only the bare event.
//
// Now every backend snapshots the raising frame's EVENT ORIGIN
// (`{tenant, orgPath, causedBy}`) onto the outbox row (reserved payload key
// `__loomOrigin`) and the envelope (`tenantid` / `loomorgpath` /
// `loomcausedby`), and the relay / consumer deliver the event inside a frame
// whose ambient principal is the system principal of that origin.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { honoProjectDirs, unboundSymbols } from "../_helpers/emitted-binding.js";
import { generateSystemFiles } from "../_helpers/index.js";

const fixture = (platform: string, auth = true): string => `
system Acme {
  user { id: guid  tenantId: string  permissions: string[] }
  tenancy by user.tenantId of Organization
  subdomain Sales {
    context Orders {
      aggregate Order with tenantOwned, crudish {
        status: string
        operation place() {
          status := "Placed"
          emit OrderPlaced { order: id, at: now() }
        }
      }
      repository Orders for Order {}
      event OrderPlaced { order: Order id, at: datetime }
      channel Lifecycle {
        carries: OrderPlaced
        delivery: queue
        retention: work
      }
    }
    context Accounts {
      aggregate Organization with crudish { name: string }
    }
  }
  subdomain Fulfilment {
    context Shipping {
      aggregate Shipment with tenantOwned, crudish {
        orderRef: Order id
        status: string
        operation dispatch() {
          requires currentUser.isSystem
          status := "Dispatched"
        }
      }
      repository Shipments for Shipment {}
      workflow Fulfil {
        orderId: Order id
        create(p: OrderPlaced) by p.order {
          let s = Shipment.create({ orderRef: p.order, status: "Pending" })
          s.dispatch()
        }
      }
    }
  }
  storage primary { type: postgres }
  storage bus { type: rabbitmq }
  resource ordersState { for: Orders, kind: state, use: primary }
  resource accountsState { for: Accounts, kind: state, use: primary }
  resource shippingState { for: Shipping, kind: state, use: primary }
  channelSource lifecycleBus { for: Lifecycle, use: bus }
  deployable salesApi { platform: ${platform} contexts: [Orders, Accounts] dataSources: [ordersState, accountsState] channels: [lifecycleBus] port: 3000${auth ? " auth: required" : ""} }
  deployable shipApi  { platform: ${platform} contexts: [Shipping] dataSources: [shippingState] channels: [lifecycleBus] port: 3001${auth ? " auth: required" : ""} }
}
`;

/** The same two deployables with no auth: no principal, so no tenancy, no
 *  tenant-owned aggregates and no principal gate either. */
const authless = (platform: string): string =>
  fixture(platform, false)
    .replace("  user { id: guid  tenantId: string  permissions: string[] }\n", "")
    .replace("  tenancy by user.tenantId of Organization\n", "")
    .replaceAll("with tenantOwned, crudish", "with crudish")
    .replace("          requires currentUser.isSystem\n", "");

async function gen(platform: string, auth = true): Promise<Map<string, string>> {
  return generateSystemFiles(auth ? fixture(platform) : authless(platform));
}

function get(files: Map<string, string>, suffix: string): string {
  const hit = [...files.entries()].find(([k]) => k.endsWith(suffix));
  expect(hit, `${suffix} not emitted; got:\n${[...files.keys()].join("\n")}`).toBeDefined();
  return hit![1];
}

describe("event origin rides the outbox row and the envelope (ruling D1, item 3d)", () => {
  describe("node", () => {
    it("auth/middleware.ts: origin snapshot, origin → system principal, and the delivery frame", async () => {
      const mw = get(await gen("node"), "ship_api/auth/middleware.ts");
      expect(mw).toContain("export function currentEventOrigin(): EventOrigin | null {");
      expect(mw).toContain(
        '    tenant: user.tenantId == null || String(user.tenantId) === "" ? null : String(user.tenantId),',
      );
      expect(mw).toContain(
        "    causedBy: user.isSystem ? (user.causedBy ?? null) : String(user.id),",
      );
      expect(mw).toContain(
        "export function systemPrincipalFor(origin: EventOrigin | null): User {",
      );
      expect(mw).toContain(
        '    tenantId: (origin?.tenant ?? "") as unknown as UserClaims["tenantId"],',
      );
      expect(mw).toContain("export function runAsEventOrigin<T>(");
      expect(mw).toContain("      currentUser: systemPrincipalFor(origin),");
    });

    it("producer: the outbox row records the origin; the relay re-opens it before publishing", async () => {
      const wf = get(await gen("node"), "sales_api/http/workflows.ts");
      expect(wf).toContain("payload: { ...event, __loomOrigin: currentEventOrigin() }");
      expect(wf).toContain("const { __loomOrigin: origin, ...payload } = row.payload");
      expect(wf).toContain("await runAsEventOrigin(origin, () =>");
      expect(wf).toContain(
        'import { currentEventOrigin, type EventOrigin, runAsEventOrigin } from "../auth/middleware";',
      );
    });

    it("envelope carries tenantid / loomorgpath / loomcausedby; the consumer delivers inside the origin", async () => {
      const ch = get(await gen("node"), "ship_api/http/channels.ts");
      expect(ch).toContain("  tenantid?: string;");
      expect(ch).toContain("    ...originAttributes(currentEventOrigin()),");
      expect(ch).toContain(
        "        await runAsEventOrigin(originOf(envelope), () => dispatcher.dispatch(event));",
      );
      expect(ch).toContain(
        "  return { tenant: tenantid ?? null, orgPath: loomorgpath ?? null, causedBy: loomcausedby ?? null };",
      );
    });

    it("every emitted symbol is bound (both deployables)", async () => {
      const files = await gen("node");
      const dirs = honoProjectDirs(files);
      expect(dirs.length).toBe(2);
      for (const dir of dirs) expect(unboundSymbols(files, dir)).toEqual([]);
    });

    it("an auth-less deployable keeps the bare row and envelope", async () => {
      const files = await gen("node", false);
      expect(get(files, "sales_api/http/workflows.ts")).not.toContain("__loomOrigin");
      expect(get(files, "ship_api/http/channels.ts")).not.toContain("tenantid");
      expect(get(files, "ship_api/http/channels.ts")).toContain(
        "        await dispatcher.dispatch(event);",
      );
    });
  });

  describe("python", () => {
    it("app/auth/user.py: origin snapshot, origin → system principal, the delivery frame", async () => {
      const u = get(await gen("python"), "ship_api/app/auth/user.py");
      expect(u).toContain("def current_event_origin() -> dict[str, str | None] | None:");
      expect(u).toContain(
        '        "causedBy": user.caused_by if user.is_system else str(user.id),',
      );
      expect(u).toContain("def system_principal_for(origin: Mapping[str, object] | None) -> User:");
      expect(u).toContain('        tenant_id="" if tenant is None else tenant,');
      expect(u).toContain("    return system_principal_for(current_event_origin())");
      expect(u).toContain("    token = current_user_var.set(system_principal_for(origin))");
    });

    it("producer: the outbox row records the origin; the relay publishes inside it", async () => {
      const d = get(await gen("python"), "sales_api/app/dispatch.py");
      expect(d).toContain(
        'payload={**_event_to_payload(event), "__loomOrigin": current_event_origin()}',
      );
      expect(d).toContain('            with event_origin_frame(payload.get("__loomOrigin")):');
      expect(d).toContain("from app.auth.user import current_event_origin, event_origin_frame");
    });

    it("envelope carries the origin attributes; the consumer dispatches inside it", async () => {
      const ch = get(await gen("python"), "ship_api/app/channels.py");
      expect(ch).toContain('    ("tenantid", "tenant"),');
      expect(ch).toContain("    origin = current_event_origin()");
      expect(ch).toContain("                envelope[attr] = value");
      expect(ch).toContain("        with event_origin_frame(_origin_of(envelope)):");
    });

    it("an auth-less deployable keeps the bare row and envelope", async () => {
      const files = await gen("python", false);
      expect(get(files, "sales_api/app/dispatch.py")).not.toContain("__loomOrigin");
      expect(get(files, "ship_api/app/channels.py")).not.toContain("tenantid");
    });
  });

  describe("java", () => {
    it("auth: EventOrigin record + payload codec; User origin snapshot/factory; accessor frame", async () => {
      const files = await gen("java");
      const origin = get(files, "ship_api/src/main/java/com/loom/shipapi/auth/EventOrigin.java");
      expect(origin).toContain('    public static final String KEY = "__loomOrigin";');
      expect(origin).toContain("        var origin = User.currentEventOrigin();");
      const user = get(files, "ship_api/src/main/java/com/loom/shipapi/auth/User.java");
      expect(user).toContain("    public static EventOrigin originOf(User user) {");
      expect(user).toContain("    public static User systemPrincipalFor(EventOrigin origin) {");
      expect(user).toContain('t == null ? "" : t');
      const acc = get(
        files,
        "ship_api/src/main/java/com/loom/shipapi/auth/CurrentUserAccessor.java",
      );
      expect(acc).toContain("        HOLDER.set(User.systemPrincipalFor(origin));");
    });

    it("producer: the tee records the origin; the relay publishes inside it", async () => {
      const files = await gen("java");
      expect(
        get(files, "sales_api/src/main/java/com/loom/salesapi/config/ChannelPublishTee.java"),
      ).toContain(
        "outbox.save(new LoomOutboxMessage(type, EventOrigin.capture(ChannelCodec.toData(event))));",
      );
      const relay = get(
        files,
        "sales_api/src/main/java/com/loom/salesapi/config/OutboxRelayService.java",
      );
      expect(relay).toContain(
        "CurrentUserAccessor.runAsEventOrigin(EventOrigin.of(row.getPayload()),",
      );
      expect(relay).toContain("EventOrigin.strip(row.getPayload()), row.getId().toString()));");
    });

    it("envelope carries the origin attributes; the consumer dispatches inside it", async () => {
      const files = await gen("java");
      const env = get(
        files,
        "ship_api/src/main/java/com/loom/shipapi/config/LoomEventEnvelope.java",
      );
      expect(env).toContain('            m.put("tenantid", tenantId);');
      expect(env).toContain('                (String) m.get("tenantid"),');
      expect(
        get(files, "ship_api/src/main/java/com/loom/shipapi/config/ChannelConsumerService.java"),
      ).toContain(
        "        CurrentUserAccessor.runAsEventOrigin(envelope.origin(), () -> dispatchAsOrigin(envelope));",
      );
    });

    it("an auth-less deployable keeps the bare row and envelope", async () => {
      const files = await gen("java", false);
      expect(
        get(files, "sales_api/src/main/java/com/loom/salesapi/config/ChannelPublishTee.java"),
      ).toContain("outbox.save(new LoomOutboxMessage(type, ChannelCodec.toData(event)));");
      expect(
        get(files, "ship_api/src/main/java/com/loom/shipapi/config/LoomEventEnvelope.java"),
      ).not.toContain("tenantid");
    });
  });

  describe("elixir", () => {
    it("auth.ex: origin snapshot, origin → system principal, the delivery frame", async () => {
      const auth = get(await gen("elixir"), "ship_api/lib/ship_api_web/auth.ex");
      expect(auth).toContain("  def current_event_origin do");
      expect(auth).toContain('"tenant" => blank_to_nil(origin_claim(user, :tenant_id)),');
      expect(auth).toContain(
        "  def system_principal, do: system_principal_for(current_event_origin())",
      );
      expect(auth).toContain('      tenant_id: if(tenant in [nil, ""], do: "", else: tenant),');
      expect(auth).toContain("    Process.put(:loom_current_user, system_principal_for(origin))");
    });

    it("producer: the outbox row records the origin; the relay publishes inside it", async () => {
      const ch = get(await gen("elixir"), "sales_api/lib/sales_api/channels.ex");
      expect(ch).toContain("      payload: with_origin(encode_data(ev)),");
      expect(ch).toContain(
        "    SalesApiWeb.Auth.with_event_origin(origin, fn -> publish_relayed(type, data, event_id) end)",
      );
      expect(ch).toContain(
        "        envelope = envelope_for(address, context, type, event_id, data) |> put_origin()",
      );
    });

    it("envelope carries the origin attributes; the consumer routes inside it", async () => {
      const files = await gen("elixir");
      expect(get(files, "ship_api/lib/ship_api/channels.ex")).toContain(
        '        |> put_present("tenantid", origin["tenant"])',
      );
      expect(get(files, "ship_api/lib/ship_api/channel_consumer.ex")).toContain(
        "ShipApi.Channels.as_envelope_origin(envelope, fn -> route(ev) end)",
      );
    });

    it("an auth-less deployable keeps the bare row and envelope", async () => {
      const files = await gen("elixir", false);
      expect(get(files, "sales_api/lib/sales_api/channels.ex")).toContain(
        "      payload: encode_data(ev),",
      );
      expect(get(files, "ship_api/lib/ship_api/channels.ex")).not.toContain("tenantid");
    });
  });

  describe("dotnet", () => {
    it("Auth: EventOrigin record + payload codec; User origin snapshot, factory and frame", async () => {
      const files = await gen("dotnet");
      const origin = get(files, "ship_api/Auth/EventOrigin.cs");
      expect(origin).toContain('public const string Key = "__loomOrigin";');
      expect(origin).toContain("var origin = User.CurrentEventOrigin();");
      const user = get(files, "ship_api/Auth/User.cs");
      expect(user).toContain(
        "        : new EventOrigin(NullIfEmpty(user.TenantId?.ToString()), NullIfEmpty(user.OrgPath), user.IsSystem ? user.CausedBy : user.Id.ToString());",
      );
      expect(user).toContain("origin?.Tenant is { Length: > 0 } t ? t : string.Empty");
      expect(user).toContain(
        "    public static System.IDisposable EnterEventOrigin(EventOrigin? origin)",
      );
      expect(user).toContain("        frame.CurrentUser = SystemPrincipalFor(origin);");
      // A reactor frame's audit actor is its originating user, not the zero id.
      expect(get(files, "ship_api/Domain/Common/RequestContext.cs")).toContain(
        "public string? ActorId => CurrentUser is { IsSystem: true } system",
      );
    });

    it("producer: the outbox row records the origin; the relay re-enters it per row", async () => {
      const files = await gen("dotnet");
      expect(
        get(files, "sales_api/Infrastructure/Events/OutboxDomainEventDispatcher.cs"),
      ).toContain("Payload = global::SalesApi.Auth.EventOriginPayload.Capture(ev),");
      expect(get(files, "sales_api/Infrastructure/Events/OutboxRelayService.cs")).toContain(
        "using var __origin = global::SalesApi.Auth.User.EnterEventOrigin(global::SalesApi.Auth.EventOriginPayload.Read(row.Payload));",
      );
    });

    it("envelope carries the origin attributes; the consumer delivers inside it", async () => {
      const ch = get(await gen("dotnet"), "ship_api/Infrastructure/Channels/ChannelTransport.cs");
      expect(ch).toContain(
        '    [JsonPropertyName("tenantid"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]',
      );
      expect(ch).toContain("        var origin = global::ShipApi.Auth.User.CurrentEventOrigin();");
      expect(ch).toContain("            TenantId = origin?.Tenant,");
      expect(ch).toContain(
        "        using var __origin = global::ShipApi.Auth.User.EnterEventOrigin(envelope.ToOrigin());",
      );
    });

    it("an auth-less deployable keeps the bare row and envelope", async () => {
      const files = await gen("dotnet", false);
      expect(
        get(files, "sales_api/Infrastructure/Events/OutboxDomainEventDispatcher.cs"),
      ).toContain("Payload = JsonSerializer.Serialize((object)ev),");
      expect(get(files, "ship_api/Infrastructure/Channels/ChannelTransport.cs")).not.toContain(
        "tenantid",
      );
    });
  });
});
