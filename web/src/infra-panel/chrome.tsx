// Shared pieces of every Infrastructure tab: the "emulated" badge (with what
// differs from production), the empty state for a resource the system does
// not declare, and a tab header row.

import { Badge, Box, Group, HoverCard, List, Stack, Text } from "@mantine/core";
import type { ReactNode } from "react";

/** Marks a view whose semantics differ from production; `notes` says how. */
export function EmulatedBadge({ notes, testid }: { notes: readonly string[]; testid?: string }): JSX.Element {
  const badge = (
    <Badge
      size="xs"
      variant="light"
      color="grape"
      data-testid={testid ?? "infra-emulated"}
      style={{ cursor: notes.length > 0 ? "help" : undefined, flexShrink: 0 }}
    >
      emulated
    </Badge>
  );
  if (notes.length === 0) return badge;
  return (
    <HoverCard width={360} shadow="md" withArrow openDelay={150} position="bottom-start">
      <HoverCard.Target>{badge}</HoverCard.Target>
      <HoverCard.Dropdown>
        <Text size="xs" fw={600} mb={4}>
          Emulated in the browser — how it differs from production
        </Text>
        <List size="xs" spacing={2} data-testid="infra-emulated-notes">
          {notes.map((n) => (
            <List.Item key={n}>{n}</List.Item>
          ))}
        </List>
      </HoverCard.Dropdown>
    </HoverCard>
  );
}

/** A tab whose resource the booted system does not declare. */
export function InfraEmpty({ id, label, types }: { id: string; label: string; types: readonly string[] }): JSX.Element {
  return (
    <Stack p="md" gap={4} data-testid={`infra-empty-${id}`}>
      <Text size="sm" fw={600}>
        No {label.toLowerCase()} in this system
      </Text>
      <Text size="xs" c="dimmed">
        {types.length > 0
          ? `Declare a storage of type ${types.map((t) => `\`${t}\``).join(", ")} and boot, and what the deployables do with it shows here.`
          : "The booted system does not use this service."}
      </Text>
    </Stack>
  );
}

/** A tab's title row: what it is, the emulated badge, and its actions. */
export function InfraHeader({
  title,
  notes,
  children,
}: {
  title: ReactNode;
  notes: readonly string[];
  children?: ReactNode;
}): JSX.Element {
  return (
    <Group
      px="sm"
      py={4}
      gap="xs"
      justify="space-between"
      wrap="nowrap"
      style={{ flexShrink: 0, borderBottom: "1px solid var(--loom-border)" }}
    >
      <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
        <Text size="xs" fw={600} truncate>
          {title}
        </Text>
        <EmulatedBadge notes={notes} />
      </Group>
      <Group gap={4} wrap="nowrap">
        {children}
      </Group>
    </Group>
  );
}

/** An error line from a failed infra read or action. */
export function InfraError({ message }: { message: string | null }): JSX.Element | null {
  if (!message) return null;
  return (
    <Box px="sm" py={4} data-testid="infra-error">
      <Text size="xs" c="red">
        {message}
      </Text>
    </Box>
  );
}
