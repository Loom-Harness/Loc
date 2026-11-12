// Phoenix's listener must open on a kernel without IPv6.  Static: no boot tier
// here can run the generated release on an IPv6-less kernel (a container
// inherits the host kernel's address families), so this pins the runtime.exs
// wiring; the lifecycle leg proves the IPv4 half on a normal host.
import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

const SRC = `
system Ip {
  subdomain S { context Ship { aggregate Box with crudish { n: int } repository Boxes for Box { } } }
  api A from S
  storage pg { type: postgres }
  resource st { for: Ship, kind: state, use: pg }
  deployable box { platform: elixir contexts: [Ship] dataSources: [st] serves: A port: 4000 }
}`;

describe("elixir endpoint bind address", () => {
  it("binds the IPv6 wildcard only where the kernel has IPv6, and serves IPv4 on it", async () => {
    const runtime = (await generateSystemFiles(SRC)).get("box/config/runtime.exs")!;
    expect(runtime).toContain('if File.exists?("/proc/net/if_inet6")');
    expect(runtime).toMatch(/do: \{0, 0, 0, 0, 0, 0, 0, 0\},\s+else: \{0, 0, 0, 0\}/);
    expect(runtime).toContain("ip: bind_ip,");
    expect(runtime).toContain("transport_options: [ipv6_v6only: false]");
  });
});
