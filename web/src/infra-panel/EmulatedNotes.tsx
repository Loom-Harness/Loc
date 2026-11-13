import { Badge, Group, List, Text } from "@mantine/core";

// Where a tab's service knowingly differs from the production one — always
// shown, so nothing in the tab reads as the real broker / issuer / cache.
export function EmulatedNotes({ notes, testId }: { notes: readonly string[]; testId: string }): JSX.Element {
  return (
    <div data-testid={testId}>
      <Group gap={6} mb={2}>
        <Badge size="xs" color="yellow" variant="light">
          emulated
        </Badge>
        <Text size="xs" c="dimmed">
          differs from production in:
        </Text>
      </Group>
      <List size="xs" c="dimmed" spacing={0}>
        {notes.map((n) => (
          <List.Item key={n}>{n}</List.Item>
        ))}
      </List>
    </div>
  );
}
