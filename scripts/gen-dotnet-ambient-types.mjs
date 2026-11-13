#!/usr/bin/env node
// Regenerates src/generator/_symbols/ambient-dotnet.ts.
//
// Restores the NuGet packages the generated csproj files pin (versions mirrored
// from src/generator/dotnet/emit/program.ts, dapper.ts and
// adapters/efcore-persistence.ts), then reads the public top-level type names
// of every namespace Loom's generated C# imports, straight from assembly
// metadata (System.Reflection.Metadata) over the .NET / ASP.NET Core reference
// packs plus the restored package assemblies. Runs inside the .NET SDK docker
// image; the proxy CA is installed into the container's system store because
// NuGet trusts only that store (docs/tools.md).
//
// Usage: node scripts/gen-dotnet-ambient-types.mjs
// Keep PACKAGES and NAMESPACES in sync with the dotnet emitters.

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const IMAGE = "mcr.microsoft.com/dotnet/sdk:10.0";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outFile = join(root, "src/generator/_symbols/ambient-dotnet.ts");

const PACKAGES = {
  "Microsoft.EntityFrameworkCore": "10.0.10",
  "Microsoft.EntityFrameworkCore.Relational": "10.0.10",
  "Npgsql.EntityFrameworkCore.PostgreSQL": "10.0.3",
  Dapper: "2.1.79",
  Npgsql: "10.0.3",
  "Mediator.Abstractions": "3.0.2",
  "Swashbuckle.AspNetCore": "10.2.3",
  "prometheus-net.AspNetCore": "8.2.1",
  "OpenTelemetry.Extensions.Hosting": "1.17.0",
  "OpenTelemetry.Instrumentation.AspNetCore": "1.17.0",
  "OpenTelemetry.Exporter.OpenTelemetryProtocol": "1.17.0",
  FluentValidation: "12.1.1",
  "FluentValidation.DependencyInjectionExtensions": "12.1.1",
  "Microsoft.IdentityModel.JsonWebTokens": "8.19.2",
  "Microsoft.IdentityModel.Protocols.OpenIdConnect": "8.19.2",
  "Microsoft.NET.Test.Sdk": "18.8.1",
  xunit: "2.9.3",
};

const NAMESPACES = [
  "Mediator",
  "Dapper",
  "FluentValidation",
  "Npgsql",
  "Prometheus",
  "Xunit",
  "Swashbuckle.AspNetCore.SwaggerGen",
  "Microsoft.OpenApi",
  "OpenTelemetry.Resources",
  "OpenTelemetry.Trace",
  "Microsoft.AspNetCore.Diagnostics",
  "Microsoft.AspNetCore.Http.Features",
  "Microsoft.AspNetCore.Mvc",
  "Microsoft.AspNetCore.Mvc.Filters",
  "Microsoft.AspNetCore.Mvc.ModelBinding",
  "Microsoft.AspNetCore.WebUtilities",
  "Microsoft.EntityFrameworkCore",
  "Microsoft.EntityFrameworkCore.ChangeTracking",
  "Microsoft.EntityFrameworkCore.Diagnostics",
  "Microsoft.EntityFrameworkCore.Infrastructure",
  "Microsoft.EntityFrameworkCore.Metadata.Builders",
  "Microsoft.EntityFrameworkCore.Migrations",
  "Microsoft.EntityFrameworkCore.Storage",
  "Microsoft.EntityFrameworkCore.ValueGeneration",
  "Microsoft.Extensions.Options",
  "Microsoft.IdentityModel.JsonWebTokens",
  "Microsoft.IdentityModel.Protocols",
  "Microsoft.IdentityModel.Protocols.OpenIdConnect",
  "Microsoft.IdentityModel.Tokens",
  "System.Buffers",
  "System.Collections.Concurrent",
  "System.ComponentModel.DataAnnotations",
  "System.Data",
  "System.Data.Common",
  "System.Diagnostics",
  "System.Globalization",
  "System.Linq.Expressions",
  "System.Reflection",
  "System.Security.Cryptography",
  "System.Text",
  "System.Text.Json",
  "System.Text.Json.Nodes",
  "System.Text.Json.Serialization",
  "System.Text.RegularExpressions",
  "System.Threading.Channels",
];

const csproj = `<Project Sdk="Microsoft.NET.Sdk.Web">
  <PropertyGroup>
    <TargetFramework>net10.0</TargetFramework>
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>
    <NuGetAudit>false</NuGetAudit>
  </PropertyGroup>
  <ItemGroup>
${Object.entries(PACKAGES)
  .map(([id, v]) => `    <PackageReference Include="${id}" Version="${v}" />`)
  .join("\n")}
  </ItemGroup>
</Project>
`;

const program = `using System.Reflection;
using System.Reflection.Metadata;
using System.Reflection.PortableExecutable;
using System.Text.Json;

var wanted = new HashSet<string>(args[1].Split(','));
var dirs = args[0].Split(':', StringSplitOptions.RemoveEmptyEntries);
var found = new Dictionary<string, SortedSet<string>>(StringComparer.Ordinal);
foreach (var dir in dirs)
foreach (var dll in Directory.EnumerateFiles(dir, "*.dll")) {
  try {
    using var fs = File.OpenRead(dll);
    using var pe = new PEReader(fs);
    if (!pe.HasMetadata) continue;
    var md = pe.GetMetadataReader();
    foreach (var h in md.TypeDefinitions) {
      var t = md.GetTypeDefinition(h);
      if ((t.Attributes & TypeAttributes.VisibilityMask) != TypeAttributes.Public) continue;
      var ns = md.GetString(t.Namespace);
      if (!wanted.Contains(ns)) continue;
      if ((t.Attributes & TypeAttributes.Interface) != 0) continue;
      var name = md.GetString(t.Name);
      // A generic type (Span\`1 in metadata) is a different name to C# lookup than a
      // non-generic domain type of the same spelling: no ambiguity.
      if (name.IndexOf('\`') >= 0) continue;
      if (!found.TryGetValue(ns, out var set)) found[ns] = set = new SortedSet<string>(StringComparer.Ordinal);
      set.Add(name);
    }
  } catch (BadImageFormatException) { }
}
Console.WriteLine(JsonSerializer.Serialize(found.ToDictionary(kv => kv.Key, kv => kv.Value.ToArray())));
`;

const work = mkdtempSync(join(tmpdir(), "loom-ambient-dotnet-"));
const proj = join(work, "probe");
mkdirSync(proj);
writeFileSync(join(proj, "probe.csproj"), csproj);
writeFileSync(join(proj, "Program.cs"), program);

const inner = `set -e
cp /root/.ccr/ca-bundle.crt /usr/local/share/ca-certificates/proxy.crt
update-ca-certificates >/dev/null
cd /work/probe
dotnet build -c Release -o /work/out >&2
ls /work/obj/Release 2>/dev/null >&2 || true
echo "SDK=$(dotnet --version)" >&2
echo "RUNTIME=$(ls /usr/share/dotnet/shared/Microsoft.NETCore.App)" >&2
NET=$(ls -d /usr/share/dotnet/packs/Microsoft.NETCore.App.Ref/*/ref/net10.0 | tail -1)
ASP=$(ls -d /usr/share/dotnet/packs/Microsoft.AspNetCore.App.Ref/*/ref/net10.0 | tail -1)
echo "NETREF=$NET ASPREF=$ASP" >&2
echo "---USINGS---"
cat obj/Release/net10.0/probe.GlobalUsings.g.cs
echo "---TYPES---"
IMPL=$(sed -n 's/^global using \\([A-Za-z0-9_.]*\\);$/\\1/p' obj/Release/net10.0/probe.GlobalUsings.g.cs | paste -sd,)
dotnet /work/out/probe.dll "$NET:$ASP:/work/out" "$IMPL,${NAMESPACES.join(",")}"
`;

const raw = execFileSync(
  "docker",
  [
    "run",
    "--rm",
    "--network",
    "host",
    "-v",
    `${work}:/work`,
    "-v",
    "/root/.ccr:/root/.ccr:ro",
    "-e",
    "DOTNET_CLI_TELEMETRY_OPTOUT=1",
    "-e",
    "DOTNET_NOLOGO=1",
    IMAGE,
    "bash",
    "-c",
    inner,
  ],
  { encoding: "utf8", maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "inherit"] },
);

const usingsText = raw.split("---USINGS---")[1].split("---TYPES---")[0];
const typesText = raw.split("---TYPES---")[1].trim();
const implicit = [...usingsText.matchAll(/global using ([\w.]+);/g)].map((m) => m[1]);
const types = JSON.parse(typesText.split("\n").pop());
const missing = NAMESPACES.filter((n) => !types[n]);
if (missing.length) console.error(`WARNING: no types found for: ${missing.join(", ")}`);

const sdkVersion = (() => {
  try {
    return execFileSync("docker", ["run", "--rm", IMAGE, "dotnet", "--version"], {
      encoding: "utf8",
    }).trim();
  } catch {
    return "unknown";
  }
})();

const all = types;

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const wrap = (names) => {
  const lines = [];
  let cur = "    ";
  for (const n of names) {
    const piece = `${JSON.stringify(n)},`;
    if (cur.length + piece.length + 1 > 100 && cur.trim()) {
      lines.push(cur.trimEnd());
      cur = "    ";
    }
    cur += `${piece} `;
  }
  if (cur.trim()) lines.push(cur.trimEnd());
  return lines.join("\n");
};

const nsKeys = Object.keys(all).sort(cmp);
const body = nsKeys
  .map((ns) => `  ${JSON.stringify(ns)}: [\n${wrap([...all[ns]].sort(cmp))}\n  ],`)
  .join("\n");
const pkgs = Object.entries(PACKAGES)
  .map(([id, v]) => `//   ${id} ${v}`)
  .join("\n");

const out = `// GENERATED by scripts/gen-dotnet-ambient-types.mjs — do not edit by hand.
//
// The C# namespaces Loom's generated code imports (the Microsoft.NET.Sdk.Web
// implicit usings plus the explicit \`using\`s the emitters write), and the public
// top-level type names each one brings into scope. A domain type that shares a
// simple name with one of these is ambiguous where both namespaces are imported
// (CS0104), so the generator checks against this table.
//
// Source: .NET SDK ${sdkVersion} (${IMAGE}) reference packs for
// Microsoft.NETCore.App and Microsoft.AspNetCore.App, plus the NuGet packages the
// generated csproj files pin:\n${pkgs}\n//
// Only NON-GENERIC classes, structs, enums and delegates are listed — a domain type
// is non-generic, and C# lookup tells \`Span\` from \`Span<T>\` by arity.  Interfaces
// are omitted: they carry the \`I<Upper>\` prefix a domain noun does not.  Sorted ordinally.

/** Namespaces the Web SDK imports into every generated file (\`ImplicitUsings\`). */
export const DOTNET_IMPLICIT_USING_NAMESPACES: readonly string[] = [
${implicit.map((n) => `  ${JSON.stringify(n)},`).join("\n")}
];

/** Namespace -> sorted public top-level type simple names. */
export const DOTNET_NAMESPACE_TYPES: Readonly<Record<string, readonly string[]>> = {
${body}
};
`;
writeFileSync(outFile, out);
console.log(
  `wrote ${outFile} (${nsKeys.length} namespaces; missing: ${missing.join(", ") || "none"})`,
);
