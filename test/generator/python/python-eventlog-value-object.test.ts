import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/index.js";

// ---------------------------------------------------------------------------
// Python backend — an event-sourced event that carries a value object.  The
// stream codec must encode the VO as its nested field map (the JSONB bind uses
// stdlib `json.dumps`, which cannot serialise a dataclass) and decode it back
// through the VO constructor — for a required VO, an optional VO and a VO[].
// ---------------------------------------------------------------------------

const FIXTURE = `
system S {
  subdomain D {
    context B {
      valueobject Addr { city: string  zip: string? }
      event Opened { booking: Booking id, origin: Addr, alt: Addr?, stops: Addr[] }
      aggregate Booking persistedAs: eventLog {
        origin: Addr
        create open(origin: Addr, alt: Addr?, stops: Addr[]) { emit Opened { booking: id, origin: origin, alt: alt, stops: stops } }
        apply(e: Opened) { origin := e.origin }
      }
      repository Bookings for Booking { }
    }
  }
  api A from D
  storage primary { type: postgres }
  resource bLog { for: B, kind: eventLog, use: primary }
  deployable api { platform: python  contexts: [B]  dataSources: [bLog]  serves: A port: 3000 }
}
`;

async function repo(): Promise<string> {
  const files = await generateSystemFiles(FIXTURE);
  return files.get("api/app/db/repositories/booking_repository.py")!;
}

describe("python event-sourced codec — value-object event fields", () => {
  it("encodes a VO, an optional VO and a VO[] as nested field maps", async () => {
    const src = await repo();
    expect(src).toContain('"origin": {"city": ev.origin.city, "zip": ev.origin.zip}');
    expect(src).toContain(
      '"alt": (None if ev.alt is None else {"city": ev.alt.city, "zip": ev.alt.zip})',
    );
    expect(src).toContain('"stops": [{"city": __e.city, "zip": __e.zip} for __e in ev.stops]');
    expect(src).not.toContain('"origin": ev.origin,');
  });

  it("decodes through the VO constructor, never as an opaque string", async () => {
    const src = await repo();
    expect(src).toContain(
      'origin=Addr(cast(str, cast(dict[str, object], data["origin"])["city"]), cast(str, cast(dict[str, object], data["origin"])["zip"]))',
    );
    expect(src).toContain('alt=(None if data["alt"] is None else Addr(');
    expect(src).toContain('for __e in cast(list[object], data["stops"])]');
    expect(src).not.toContain('origin=cast(str, data["origin"])');
  });
});
