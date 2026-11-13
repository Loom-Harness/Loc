// REST mocks: every request the deployables made to a `restApi` storage,
// answered by the infra worker's `httpMock` service, and the per-operation
// response overrides that replace the spec sample (or the echo).

import {
  Badge,
  Box,
  Button,
  Code,
  Group,
  NumberInput,
  ScrollArea,
  Select,
  Stack,
  Table,
  Text,
  Textarea,
} from "@mantine/core";
import { Fragment, useMemo, useState } from "react";
import { InfraError, InfraHeader } from "./chrome";
import { declaredOf, type InfraTabProps } from "./types";
import { useInfra, useInfraAction } from "./use-infra";

/** The httpMock service's `log` row. */
export interface ServedRequest {
  at: string;
  method: string;
  url: string;
  body?: string;
  operation: string;
  status: number;
  response: unknown;
  overridden: boolean;
}

export interface MockOverride {
  origin: string;
  operation: string;
  status: number;
  body: unknown;
}

export const REST_NOTES = [
  "No request leaves the browser: the mock answers with sample data for the operation's 2xx schema in `spec:`, or an echo of the request without one.",
  "Request bodies, headers and parameters are not validated against the spec; there is no latency, rate limit or auth.",
  "An override answers every call to its operation until cleared; a re-boot clears overrides.",
];

const originOf = (url: string): string => {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
};

const pretty = (v: unknown): string => (v === undefined ? "" : JSON.stringify(v, null, 2));

export default function RestApiTab({ env, active }: InfraTabProps): JSX.Element {
  const log = useInfra<ServedRequest[]>("httpMock", "log", {}, { enabled: active });
  const ops = useInfra<{ origin: string; operation: string }[]>("httpMock", "operations", {}, { enabled: active, poll: 0 });
  const overrides = useInfra<MockOverride[]>("httpMock", "overrides", {}, { enabled: active, poll: 0 });
  const { run } = useInfraAction();
  const [actionError, setActionError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);

  const apis = declaredOf(env, ["restApi"]);
  const rows = log.data ?? [];

  // Every operation the user can override: the specs' operations, plus any
  // operation a request hit (an API without a spec is keyed by its path).
  const choices = useMemo(() => {
    const seen = new Map<string, { origin: string; operation: string }>();
    for (const o of ops.data ?? []) seen.set(`${o.origin} ${o.operation}`, o);
    for (const r of rows) {
      const o = { origin: originOf(r.url), operation: r.operation };
      seen.set(`${o.origin} ${o.operation}`, o);
    }
    return [...seen.entries()].map(([value, o]) => ({ value, label: `${o.operation} — ${o.origin}`, ...o }));
  }, [ops.data, rows]);

  const fail = (e: unknown): void => setActionError(e instanceof Error ? e.message : String(e));

  return (
    <Stack gap={0} style={{ flex: 1, minHeight: 0 }}>
      <InfraHeader
        title={`REST mocks — ${apis.map((a) => `${a.name} (${a.config.baseUrl ?? "?"})`).join(", ")}`}
        notes={REST_NOTES}
      >
        <Button
          size="compact-xs"
          variant="subtle"
          color="red"
          disabled={rows.length === 0}
          data-testid="rest-clear-log"
          onClick={() => run("httpMock", "clearLog").catch(fail)}
        >
          Clear log
        </Button>
      </InfraHeader>
      <InfraError message={log.error ?? actionError} />
      <ScrollArea style={{ flex: 1, minHeight: 0 }}>
        <Stack gap="sm" p="sm">
          <OverrideEditor
            choices={choices}
            overrides={overrides.data ?? []}
            onSet={(o) => {
              setActionError(null);
              run("httpMock", "setOverride", o).then(overrides.refresh, fail);
            }}
            onClear={(o) => {
              setActionError(null);
              run("httpMock", "clearOverride", { origin: o.origin, operation: o.operation }).then(overrides.refresh, fail);
            }}
          />
          <Text size="xs" fw={600}>
            Requests ({rows.length})
          </Text>
          {rows.length === 0 ? (
            <Text size="xs" c="dimmed" data-testid="rest-empty">
              No requests yet. Call an operation that reaches the API.
            </Text>
          ) : (
            <Table fz="xs" verticalSpacing={2} data-testid="rest-log">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Method</Table.Th>
                  <Table.Th>URL</Table.Th>
                  <Table.Th>Status</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {rows
                  .map((r, i) => ({ r, i }))
                  .reverse()
                  .map(({ r, i }) => (
                    <Fragment key={i}>
                      <Table.Tr
                        data-testid="rest-row"
                        data-operation={r.operation}
                        onClick={() => setExpanded(expanded === i ? null : i)}
                        style={{ cursor: "pointer" }}
                      >
                        <Table.Td data-testid="rest-row-method">{r.method}</Table.Td>
                        <Table.Td style={{ wordBreak: "break-all" }} data-testid="rest-row-url">
                          {r.url}
                        </Table.Td>
                        <Table.Td style={{ whiteSpace: "nowrap" }}>
                          <span data-testid="rest-row-status">{r.status}</span>
                          {r.overridden && (
                            <Badge size="xs" ml={4} variant="light" color="orange" data-testid="rest-row-overridden">
                              override
                            </Badge>
                          )}
                        </Table.Td>
                      </Table.Tr>
                      {expanded === i && (
                        <Table.Tr data-testid="rest-row-detail">
                          <Table.Td colSpan={3}>
                            <Text size="xs" c="dimmed">
                              {r.operation} · {new Date(r.at).toLocaleTimeString()}
                            </Text>
                            {r.body !== undefined && (
                              <>
                                <Text size="xs" fw={600} mt={4}>
                                  Request body
                                </Text>
                                <Code block data-testid="rest-row-request">
                                  {r.body}
                                </Code>
                              </>
                            )}
                            <Text size="xs" fw={600} mt={4}>
                              Response
                            </Text>
                            <Code block data-testid="rest-row-response">
                              {pretty(r.response)}
                            </Code>
                          </Table.Td>
                        </Table.Tr>
                      )}
                    </Fragment>
                  ))}
              </Table.Tbody>
            </Table>
          )}
        </Stack>
      </ScrollArea>
    </Stack>
  );
}

function OverrideEditor({
  choices,
  overrides,
  onSet,
  onClear,
}: {
  choices: { value: string; label: string; origin: string; operation: string }[];
  overrides: MockOverride[];
  onSet: (o: MockOverride) => void;
  onClear: (o: MockOverride) => void;
}): JSX.Element {
  const [pick, setPick] = useState<string | null>(null);
  const [status, setStatus] = useState<number | string>(503);
  const [body, setBody] = useState('{ "error": "unavailable" }');
  const [bodyError, setBodyError] = useState<string | null>(null);
  const chosen = choices.find((c) => c.value === pick) ?? null;

  return (
    <Box p="xs" style={{ border: "1px solid var(--loom-border)", borderRadius: 4 }} data-testid="rest-overrides">
      <Text size="xs" fw={600} mb={4}>
        Response overrides
      </Text>
      {overrides.length === 0 ? (
        <Text size="xs" c="dimmed" mb={4}>
          None — every operation answers its default.
        </Text>
      ) : (
        <Stack gap={2} mb={6}>
          {overrides.map((o) => (
            <Group key={`${o.origin} ${o.operation}`} gap={6} wrap="nowrap" data-testid="rest-override" data-operation={o.operation}>
              <Text size="xs" style={{ wordBreak: "break-all" }}>
                {o.operation} → <b>{o.status}</b> <Code>{JSON.stringify(o.body)}</Code>
              </Text>
              <Button size="compact-xs" variant="subtle" color="red" onClick={() => onClear(o)} data-testid="rest-override-clear">
                Clear
              </Button>
            </Group>
          ))}
        </Stack>
      )}
      <Stack gap={4}>
        <Select
          size="xs"
          placeholder={choices.length > 0 ? "Operation" : "No operations yet (no spec, no request)"}
          data={choices.map(({ value, label }) => ({ value, label }))}
          value={pick}
          onChange={setPick}
          disabled={choices.length === 0}
          data-testid="rest-override-operation"
          comboboxProps={{ withinPortal: true }}
        />
        <Group gap={6} align="flex-start" wrap="wrap">
          <NumberInput
            size="xs"
            label="Status"
            min={100}
            max={599}
            value={status}
            onChange={setStatus}
            w={90}
            data-testid="rest-override-status"
          />
          <Textarea
            size="xs"
            label="Body (JSON)"
            value={body}
            onChange={(e) => setBody(e.currentTarget.value)}
            autosize
            minRows={1}
            maxRows={6}
            error={bodyError}
            style={{ flex: 1, minWidth: 180 }}
            styles={{ input: { fontFamily: "var(--mantine-font-family-monospace)" } }}
            data-testid="rest-override-body"
          />
        </Group>
        <Button
          size="compact-xs"
          disabled={!chosen}
          style={{ alignSelf: "flex-start" }}
          data-testid="rest-override-set"
          onClick={() => {
            if (!chosen) return;
            let parsed: unknown;
            try {
              parsed = body.trim() === "" ? null : JSON.parse(body);
            } catch (e) {
              setBodyError(`Not JSON: ${e instanceof Error ? e.message : String(e)}`);
              return;
            }
            setBodyError(null);
            onSet({ origin: chosen.origin, operation: chosen.operation, status: Number(status), body: parsed });
          }}
        >
          Set override
        </Button>
      </Stack>
    </Box>
  );
}
