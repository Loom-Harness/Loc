// REST mocks: every request the deployables made to a `restApi` storage,
// answered by the infra worker's `httpMock` service.

import { Stack, Table, Text } from "@mantine/core";
import { InfraError, InfraHeader } from "./chrome";
import type { InfraTabProps } from "./types";
import { useInfra } from "./use-infra";

export const REST_NOTES = [
  "No request leaves the browser: the mock answers with sample data for the operation's 2xx schema (from `spec:`), or an echo without one.",
];

export default function RestApiTab({ active }: InfraTabProps): JSX.Element {
  const log = useInfra<{ method: string; url: string }[]>("httpMock", "log", {}, { enabled: active });
  const rows = [...(log.data ?? [])].reverse();
  return (
    <Stack gap={0}>
      <InfraHeader title="REST mocks" notes={REST_NOTES} />
      <InfraError message={log.error} />
      {rows.length === 0 ? (
        <Text size="xs" c="dimmed" p="sm" data-testid="rest-empty">
          No requests yet.
        </Text>
      ) : (
        <Table fz="xs" data-testid="rest-log">
          <Table.Tbody>
            {rows.map((r, i) => (
              <Table.Tr key={i} data-testid="rest-row">
                <Table.Td>{r.method}</Table.Td>
                <Table.Td>{r.url}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
    </Stack>
  );
}
