import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/index.js";

// An optional scalar event field is `None` when unset: the stream codec must
// guard BOTH directions (`.isoformat()` / `str()` on None crash on encode;
// `fromisoformat(cast(str, None))` / `Decimal(None)` crash on decode).

const FIXTURE = `
system S {
  subdomain D {
    context B {
      enum Kind { A, B }
      event Opened {
        booking: Booking id
        at: datetime?
        day: date?
        price: money?
        qty: int?
        big: long?
        ratio: decimal?
        flag: bool?
        note: string?
        kind: Kind?
        other: Booking id?
      }
      aggregate Booking persistedAs: eventLog {
        note: string
        create open(at: datetime?, day: date?, price: money?, qty: int?, big: long?, ratio: decimal?, flag: bool?, note: string?, kind: Kind?, other: Booking id?) {
          emit Opened { booking: id, at: at, day: day, price: price, qty: qty, big: big, ratio: ratio, flag: flag, note: note, kind: kind, other: other }
        }
        apply(e: Opened) { note := "x" }
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

describe("python event-sourced codec — optional scalar event fields", () => {
  it("guards every optional scalar on encode and decode", async () => {
    const files = await generateSystemFiles(FIXTURE);
    const src = files.get("api/app/db/repositories/booking_repository.py") ?? "";
    expect(src).toContain('"at": (None if ev.at is None else ev.at.isoformat())');
    expect(src).toContain('"day": (None if ev.day is None else ev.day.isoformat())');
    expect(src).toContain('"price": (None if ev.price is None else str(ev.price))');
    for (const f of [
      "at",
      "day",
      "price",
      "qty",
      "big",
      "ratio",
      "flag",
      "note",
      "kind",
      "other",
    ]) {
      expect(src, f).toContain(`${f}=(None if data["${f}"] is None else `);
    }
  });
});
