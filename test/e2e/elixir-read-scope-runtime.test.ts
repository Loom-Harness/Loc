import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { mixDepsGet, mixLocalInstall } from "./support/mix-retry.js";
import { startPostgres } from "./support/tenancy-isolation-harness.js";

// ---------------------------------------------------------------------------
// The Ecto read scope at runtime, on real Postgres (#3964).
//
// The generated Repo applies every bypassable restriction in
// `prepare_query/3`, reading the principal from the read's `current_user:`
// option or, failing that, the process's ambient principal
// (`default_options/1`, Ecto's multi-tenancy-with-foreign-keys guide), and
// RAISES when a principal-bound read has neither.  The HTTP legs prove the
// request paths; this one drives the Repo directly over the
// `inheritance-read-restrictions` fixture — a TPH concrete (`Car`) that is
// `tenantOwned` + `softDeletable` with a bare `seats > 0` filter, next to a
// sibling (`Truck`) on the same table — and checks the paths a request never
// takes:
//
//   * no principal at all → the read raises (fail closed, loudly);
//   * a bare `Task.async` does not inherit the caller's principal → raises;
//   * `Repo.async/1` carries it → the task reads the caller's tenant only;
//   * each `skip_filters:` drops exactly its own clause, never the discriminator
//     or the bare filter.
//
// Opt-in: LOOM_TENANCY_E2E_ELIXIR=1 (it rides the tenancy-e2e elixir cell).
// Needs `mix` on PATH + docker (postgres) or LOOM_TENANCY_PG_URL.
// ---------------------------------------------------------------------------

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const cli = path.join(repoRoot, "bin", "cli.js");

const ENABLED = process.env.LOOM_TENANCY_E2E_ELIXIR === "1";

const SCRIPT = `
{:ok, _} = Application.ensure_all_started(:ecto_sql)
{:ok, _} = Application.ensure_all_started(:postgrex)
{:ok, _} = D.Repo.start_link()

alias D.Fleet.{Car, CarRepository, TruckRepository}
alias D.Repo

user = fn tenant ->
  %{id: "u-" <> tenant, tenant_id: tenant, org_path: tenant, root_org: tenant, org_context_path: tenant, is_system: false}
end

acme = user.("acme")
globex = user.("globex")

{:ok, _} = CarRepository.insert(%{"plate" => "A-1", "seats" => 4}, acme)
{:ok, gone} = CarRepository.insert(%{"plate" => "A-2", "seats" => 2}, acme)
{:ok, _} = Repo.update(Ecto.Changeset.change(gone, is_deleted: true))
{:ok, _} = CarRepository.insert(%{"plate" => "A-0", "seats" => 0}, acme)
{:ok, _} = CarRepository.insert(%{"plate" => "G-1", "seats" => 5}, globex)
{:ok, _} = TruckRepository.insert(%{"plate" => "T-1"}, acme)

plates = fn rows -> rows |> Enum.map(& &1.plate) |> Enum.sort() end

attempt = fn read ->
  try do
    plates.(read.())
  rescue
    e in ArgumentError -> "raised: " <> Exception.message(e)
  end
end

checks = %{
  "unset" => attempt.(fn -> Repo.all(Car.base_query()) end),
  "explicit_acme" => attempt.(fn -> Repo.all(Car.base_query(), current_user: acme) end),
  "explicit_globex" => attempt.(fn -> Repo.all(Car.base_query(), current_user: globex) end),
  "repository_acme" => attempt.(fn -> elem(CarRepository.list(acme), 1) end),
  "skip_soft_deletable" =>
    attempt.(fn -> Repo.all(Car.base_query(), current_user: acme, skip_filters: [:soft_deletable]) end),
  "skip_tenant_owned" =>
    attempt.(fn -> Repo.all(Car.base_query(), skip_filters: [:tenant_owned]) end),
  "skip_all" => attempt.(fn -> Repo.all(Car.base_query(), skip_filters: :all) end)
}

Process.put(:loom_current_user, acme)

checks =
  Map.merge(checks, %{
    "ambient_acme" => attempt.(fn -> Repo.all(Car.base_query()) end),
    "ambient_repository_acme" => attempt.(fn -> elem(CarRepository.list(), 1) end),
    "bare_task" => Task.async(fn -> attempt.(fn -> Repo.all(Car.base_query()) end) end) |> Task.await(),
    "repo_async_acme" =>
      Repo.async(fn -> attempt.(fn -> elem(CarRepository.list(), 1) end) end) |> Task.await()
  })

poly = fn read ->
  case read.() do
    {:ok, %{items: items, total: total}} ->
      %{"total" => total, "items" => Enum.map(items, &[inspect(&1.__struct__), &1.plate])}

    other ->
      inspect(other)
  end
end

checks =
  Map.merge(checks, %{
    # The polymorphic base read: one query over the shared table, every
    # subtype's own restrictions applied kind-guarded, rows as their concretes.
    "vehicles_acme" => poly.(fn -> D.Fleet.VehicleRepository.list(1, 20, acme) end),
    "vehicles_acme_page2" => poly.(fn -> D.Fleet.VehicleRepository.list(2, 1, acme) end)
  })

Process.put(:loom_current_user, globex)

checks =
  Map.put(
    checks,
    "repo_async_globex",
    Repo.async(fn -> attempt.(fn -> Repo.all(Car.base_query()) end) end) |> Task.await()
  )

IO.puts("LOOMCHECK " <> Jason.encode!(checks))
`;

describe.skipIf(!ENABLED)(
  "the Ecto read scope at runtime — prepare_query, the ambient principal and Repo.async (LOOM_TENANCY_E2E_ELIXIR=1)",
  () => {
    it("applies tenancy + soft-delete in prepare_query, raises with no principal, and carries it into Repo.async", async () => {
      const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "loom-read-scope-elixir-"));
      let pg: Awaited<ReturnType<typeof startPostgres>> | undefined;
      try {
        const fixture = fs.readFileSync(
          path.join(repoRoot, "test", "fixtures", "corpus", "inheritance-read-restrictions.ddd"),
          "utf8",
        );
        const dddPath = path.join(outDir, "read-scope.ddd");
        fs.writeFileSync(dddPath, fixture.replaceAll("__PLATFORM__", "elixir"));
        execSync(`node ${cli} generate system ${dddPath} -o ${outDir}`, {
          stdio: "pipe",
          cwd: repoRoot,
        });
        const appDir = path.join(outDir, "d");
        execSync(`${mixLocalInstall()} && ${mixDepsGet()}`, {
          cwd: appDir,
          stdio: "pipe",
          timeout: 600_000,
          shell: "/bin/bash",
        });
        pg = await startPostgres("read-scope-elixir");
        const env = {
          ...process.env,
          DATABASE_URL: `ecto://${pg.user}:${pg.password}@${pg.host}:${pg.port}/${pg.db}`,
          MIX_ENV: "dev",
        };
        execSync("mix ecto.create && mix ecto.migrate", {
          cwd: appDir,
          stdio: "pipe",
          env,
          timeout: 300_000,
          shell: "/bin/bash",
        });
        const script = path.join(appDir, "read_scope_check.exs");
        fs.writeFileSync(script, SCRIPT);
        // `--no-start`: the script starts only the Repo, so no endpoint binds a port.
        const out = execSync(`mix run --no-start ${script}`, {
          cwd: appDir,
          env,
          timeout: 300_000,
          encoding: "utf8",
        });
        const line = out.split("\n").find((l) => l.startsWith("LOOMCHECK "));
        expect(line, `no LOOMCHECK line in:\n${out}`).toBeDefined();
        const c = JSON.parse(line!.slice("LOOMCHECK ".length)) as Record<string, unknown>;

        // No principal anywhere: the tenant clause refuses to run.
        expect(c.unset).toMatch(/^raised: D\.Fleet\.Car is read under its :tenant_owned filter/);
        // Each tenant sees its own live rows: never the soft-deleted A-2, the
        // `seats > 0`-hidden A-0, the sibling Truck, or the other tenant's car.
        expect(c.explicit_acme).toEqual(["A-1"]);
        expect(c.explicit_globex).toEqual(["G-1"]);
        expect(c.repository_acme).toEqual(["A-1"]);
        expect(c.ambient_acme).toEqual(["A-1"]);
        expect(c.ambient_repository_acme).toEqual(["A-1"]);
        // A spawned process starts without the caller's principal…
        expect(c.bare_task).toMatch(/^raised: /);
        // …and `Repo.async/1` carries it, per caller.
        expect(c.repo_async_acme).toEqual(["A-1"]);
        expect(c.repo_async_globex).toEqual(["G-1"]);
        // Each skip drops exactly its own clause; the discriminator and the
        // bare `seats > 0` filter are never skippable.
        expect(c.skip_soft_deletable).toEqual(["A-1", "A-2"]);
        expect(c.skip_tenant_owned).toEqual(["A-1", "G-1"]);
        expect(c.skip_all).toEqual(["A-1", "A-2", "G-1"]);
        // The polymorphic base read: acme's live Car and its Truck, in `id`
        // (insertion) order, each loaded as its concrete, paged globally.
        expect(c.vehicles_acme).toEqual({
          total: 2,
          items: [
            ["D.Fleet.Car", "A-1"],
            ["D.Fleet.Truck", "T-1"],
          ],
        });
        expect(c.vehicles_acme_page2).toEqual({ total: 2, items: [["D.Fleet.Truck", "T-1"]] });
      } finally {
        pg?.stop();
        try {
          fs.rmSync(outDir, { recursive: true, force: true });
        } catch {
          /* best-effort */
        }
      }
    }, 900_000);
  },
);
