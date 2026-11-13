// Phoenix's listener must open on a kernel without IPv6 and serve IPv4 on one
// with it.  Wiring: a booted leg proves only the branch its host kernel takes
// (the lifecycle leg on an IPv6-less sandbox caught an einval on the IPv4
// branch; CI runners take the IPv6 one), so both branches are pinned here.
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
    // The v6only option rides only the IPv6 branch: on the IPv4 socket it is einval.
    expect(runtime).toMatch(
      /do: \{\{0, 0, 0, 0, 0, 0, 0, 0\}, \[ipv6_v6only: false\]\},\s+else: \{\{0, 0, 0, 0\}, \[\]\}/,
    );
    expect(runtime).toContain("ip: bind_ip,");
    expect(runtime).toContain("transport_options: bind_opts");
  });
});
