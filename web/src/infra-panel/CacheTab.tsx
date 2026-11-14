import { Box, Button, Code, Group, Stack, Table, Text } from "@mantine/core";
import type { CacheServerInfo } from "../runtime/infra/cache";
import { InfraError, InfraHeader } from "./chrome";
import { formatRemaining } from "./format";
import type { InfraTabProps } from "./types";
import { useInfra, useInfraAction } from "./use-infra";

interface CacheKeys {
  servers: CacheServerInfo[];
  emulated: string[];
}

// The Cache tab: the keyspace of every redis server a `kind: cache` resource
// dialled — each key with its remaining TTL and a preview of its value.
// Evict one key or flush a server; both go to the cache service, so the
// deployable's next read misses exactly as it would after a `redis-cli DEL`.
export default function CacheTab({ active }: InfraTabProps): JSX.Element {
  const { data, error } = useInfra<CacheKeys>("cache", "keys", {}, { enabled: active, poll: 1000 });
  const { run } = useInfraAction();
  const act = (op: string, params: unknown) => () => void run("cache", op, params).catch(() => undefined);
  const servers = data?.servers ?? [];

  return (
    <Stack gap={0} style={{ height: "100%", minHeight: 0 }} data-testid="infra-cache">
      <InfraHeader title="Cache (redis)" notes={data?.emulated ?? []}>
        {servers.length > 0 && (
          <Button size="compact-xs" variant="light" color="red" onClick={act("flush", {})} data-testid="infra-cache-flush-all">
            Flush all
          </Button>
        )}
      </InfraHeader>
      <InfraError message={error} />
      <Box p="sm" style={{ overflow: "auto", flex: 1, minHeight: 0 }}>
        <Stack gap="sm">
          {data && servers.length === 0 && (
            <Text size="sm" c="dimmed" data-testid="infra-cache-empty">
              No cache traffic yet. A deployable with a <Code>kind: cache</Code> resource fills this the first time it
              reads or writes.
            </Text>
          )}
          {servers.map((s) => (
            <Stack key={s.server} gap={4} data-testid="infra-cache-server" data-server={s.server}>
              <Group justify="space-between" wrap="nowrap">
                <Group gap="xs" style={{ minWidth: 0 }}>
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
                        <Table.Td data-testid="infra-cache-ttl">
                          {k.ttlMs === null ? "∞" : formatRemaining(k.ttlMs)}
                        </Table.Td>
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
    </Stack>
  );
}
