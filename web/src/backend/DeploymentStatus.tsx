import { Badge, Group, Select, Stack, Text, Tooltip } from "@mantine/core";
import type { DeployableRow, DeployableState } from "./deployable-rows";

// What the playground emulates, named once so every surface says the same
// thing.  Extend it as a new emulated layer (brokers, resource fakes) lands.
export const EMULATED_LAYERS: readonly string[] = [
  "Postgres runs as PGlite in a browser worker",
  "channels run on an in-process transport",
  "presigned S3 URLs work from the preview's fetch, not <img src> or download links",
];

const STATE_COLOUR: Record<DeployableState, string> = {
  booted: "green",
  error: "red",
  "not-booted": "gray",
  unavailable: "orange",
};

const STATE_LABEL: Record<DeployableState, string> = {
  booted: "booted",
  error: "error",
  "not-booted": "not booted",
  unavailable: "not runnable in the playground",
};

/** Per-deployable boot state, replacing the single-backend status line when
 *  the system has several.  Every deployable here runs emulated. */
export function DeploymentStatus({ rows }: { rows: readonly DeployableRow[] }): JSX.Element {
  return (
    <Stack gap={4} data-testid="deployable-status">
      {rows.map((r) => (
        <Group key={r.slug} gap={6} wrap="wrap" data-testid={`deployable-row-${r.slug}`}>
          <Text size="xs" ff="monospace" fw={500}>
            {r.slug}
          </Text>
          <Badge
            size="xs"
            variant="light"
            color={STATE_COLOUR[r.state]}
            data-testid={`deployable-state-${r.slug}`}
          >
            {STATE_LABEL[r.state]}
          </Badge>
          {r.state === "unavailable" ? (
            <Text size="xs" c="dimmed" data-testid={`deployable-reason-${r.slug}`}>
              {r.reason}
            </Text>
          ) : (
            <Tooltip label={EMULATED_LAYERS.join("; ")} multiline w={260} withArrow>
              <Badge size="xs" variant="outline" color="grape" data-testid={`deployable-emulated-${r.slug}`}>
                emulated
              </Badge>
            </Tooltip>
          )}
          {r.storage && (
            <Text size="xs" c="dimmed" data-testid={`deployable-storage-${r.slug}`}>
              storage {r.storage}
            </Text>
          )}
        </Group>
      ))}
    </Stack>
  );
}

/** The storage choice shared by the SQL console and Reset; renders nothing
 *  for a system with one. */
export function StorageSelect({
  storages,
  value,
  onChange,
  width,
}: {
  storages: readonly string[];
  value: string | null;
  onChange: (v: string | null) => void;
  width?: number | string;
}): JSX.Element | null {
  if (storages.length < 2) return null;
  return (
    <Select
      size="xs"
      label="Storage"
      value={value ?? storages[0] ?? null}
      onChange={onChange}
      data={[...storages]}
      allowDeselect={false}
      w={width ?? 200}
      data-testid="db-target"
    />
  );
}
