import { Alert, Box, Button, Code, Group, Stack, Table, Text } from "@mantine/core";
import type { CacheServerInfo } from "../runtime/infra/cache";
import { EmulatedNotes } from "./EmulatedNotes";
import { formatRemaining, type InfraCall, usePoll } from "./infra-call";

interface CacheKeys {
  servers: CacheServerInfo[];
  emulated: string[];
}

// The Cache tab: the keyspace of every redis server a `kind: cache` resource
// dialled — each key with its remaining TTL and a preview of its value.
// Evict one key or flush a server; both go to the cache service, so the
// deployable's next read misses exactly as it would after a `redis-cli DEL`.
export function CacheTab({ call }: { call: InfraCall }): JSX.Element {
  const { data, error, refresh } = usePoll(() => call<CacheKeys>("cache", "keys"), 1000);
  const act = (op: string, params: unknown) => () => void call("cache", op, params).then(refresh, refresh);
  const servers = data?.servers ?? [];

  return (
    <Box p="sm" style={{ overflow: "auto", height: "100%" }} data-testid="infra-cache">
      <Stack gap="sm">
        {error && (
          <Alert color="red" p="xs" data-testid="infra-cache-error">
            {error}
          </Alert>
        )}
        {data && <EmulatedNotes notes={data.emulated} testId="infra-cache-emulated" />}
        {data && servers.length === 0 && (
          <Text size="sm" c="dimmed" data-testid="infra-cache-empty">
            No cache traffic yet. A deployable with a <Code>kind: cache</Code> resource fills this the first time it
            reads or writes.
          </Text>
        )}
        {servers.length > 0 && (
          <Group justify="flex-end">
            <Button size="compact-xs" variant="light" color="red" onClick={act("flush", {})} data-testid="infra-cache-flush-all">
              Flush all
            </Button>
          </Group>
        )}
        {servers.map((s) => (
          <Stack key={s.server} gap={4} data-testid="infra-cache-server" data-server={s.server}>
            <Group justify="space-between">
              <Group gap="xs">
                <Code>{s.server}</Code>
                <Text size="xs" c="dimmed" data-testid="infra-cache-stats">
                  {s.keys.length} keys · {s.hits} hits · {s.misses} misses · {s.evictions} evicted
                </Text>
              </Group>
              <Button
                size="compact-xs"
                variant="subtle"
                color="red"
                onClick={act("flush", { server: s.server })}
                data-testid="infra-cache-flush"
              >
                Flush
              </Button>
            </Group>
            <Table.ScrollContainer minWidth={420}>
            <Table striped withTableBorder fz="xs" verticalSpacing={2}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Key</Table.Th>
                  <Table.Th>TTL</Table.Th>
                  <Table.Th>Size</Table.Th>
                  <Table.Th>Value</Table.Th>
                  <Table.Th />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {s.keys.map((k) => (
                  <Table.Tr key={k.key} data-testid="infra-cache-key" data-key={k.key}>
                    <Table.Td style={{ fontFamily: "monospace", wordBreak: "break-all" }}>{k.key}</Table.Td>
                    <Table.Td data-testid="infra-cache-ttl">{k.ttlMs === null ? "∞" : formatRemaining(k.ttlMs)}</Table.Td>
                    <Table.Td>{k.size}</Table.Td>
                    <Table.Td
                      style={{ fontFamily: "monospace", maxWidth: 320, wordBreak: "break-all" }}
                      data-testid="infra-cache-value"
                    >
                      {k.preview}
                    </Table.Td>
                    <Table.Td>
                      <Button
                        size="compact-xs"
                        variant="subtle"
                        onClick={act("evict", { server: s.server, key: k.key })}
                        data-testid="infra-cache-evict"
                      >
                        Evict
                      </Button>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
            </Table.ScrollContainer>
          </Stack>
        ))}
      </Stack>
    </Box>
  );
}

export default CacheTab;
