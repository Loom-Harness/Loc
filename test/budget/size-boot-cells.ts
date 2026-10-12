// The cells the nightly size + cold-boot budget measures (M-T9.23).  Shared by
// the heavy measuring leg (`test/e2e/size-boot-budget.test.ts`), the workflow
// matrix (`.github/workflows/size-boot-budget.yml`, pinned against this list by
// `size-boot-ratchet.test.ts`) and the budget file's completeness check.

export type SizeBootCell =
  | {
      readonly key: string;
      readonly kind: "bundle";
      readonly framework: string;
      readonly pack: string;
    }
  | { readonly key: string; readonly kind: "boot"; readonly platform: string };

const BUNDLES = [
  ["react", "mantine"],
  ["vue", "vuetify"],
  ["svelte", "flowbite"],
  ["angular", "primeng"],
] as const;

const BOOTS = ["node", "python", "dotnet", "java", "elixir"] as const;

export const SIZE_BOOT_CELLS: readonly SizeBootCell[] = [
  ...BUNDLES.map(
    ([framework, pack]): SizeBootCell => ({
      key: `bundle:${framework}/${pack}`,
      kind: "bundle",
      framework,
      pack,
    }),
  ),
  ...BOOTS.map((platform): SizeBootCell => ({ key: `boot:${platform}`, kind: "boot", platform })),
];
