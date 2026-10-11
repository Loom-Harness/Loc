import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

// ---------------------------------------------------------------------------
// vanilla Phoenix — a request body the parser refuses CLOSES the connection.
//
// `BodyParser` rescues `Plug.Parsers`' faults and answers them itself.  The
// `conn` it answers with is the one from BEFORE the parser ran: the adapter
// state the parser advanced while reading the body went with the raise.  On a
// keep-alive connection Bandit then "drains" the body it believes is unread —
// reading the head of the client's NEXT request off the socket.  Schemathesis
// saw it as a valid `POST /api/customers` answered 405 (the request line arrived
// as `OST /api/customers`) and a 400 with no Content-Type (Bandit's own
// request-line refusal), on whichever request followed a malformed body.
//
// Runtime evidence: on one socket, a malformed-JSON POST whose body arrives in
// its own segment, then a valid GET — before: `400`, then `HTTP/1.0 400 Bad
// Request` for the GET; after: `400` + `connection: close`, and the server
// closes the socket instead of misreading the next request.
// ---------------------------------------------------------------------------

const SOURCE = `
system Shop {
  subdomain Sales {
    context Catalog {
      aggregate Item with crudish { name: string }
    }
  }
  storage pg { type: postgres }
  resource s { for: Catalog, kind: state, use: pg }
  deployable d { platform: elixir, contexts: [Catalog], dataSources: [s], port: 4000 }
}
`;

describe("vanilla Phoenix — BodyParser closes the connection after a refused body", () => {
  it("the rescue arm sets `connection: close` before sending the problem", async () => {
    const files = await generateSystemFiles(SOURCE);
    const parser = [...files.entries()].find(([p]) => p.endsWith("_web/body_parser.ex"))?.[1];
    expect(parser).toBeDefined();
    const rescue = parser!.slice(parser!.indexOf("rescue"));
    const close = rescue.indexOf('Plug.Conn.put_resp_header("connection", "close")');
    const send = rescue.indexOf("Plug.Conn.send_resp(status, body)");
    expect(close).toBeGreaterThan(-1);
    expect(send).toBeGreaterThan(close);
  });
});
