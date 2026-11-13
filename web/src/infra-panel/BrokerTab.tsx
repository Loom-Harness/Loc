import {
  Badge,
  Box,
  Button,
  Code,
  Group,
  NativeSelect,
  NumberInput,
  Stack,
  Table,
  Text,
  Textarea,
  TextInput,
} from "@mantine/core";
import { useState } from "react";
import type {
  BrokerBrowseMessage,
  BrokerInspectQueue,
  BrokerInspectResult,
  BrokerInspectTopic,
} from "../runtime/infra/broker-protocol";
import { brokerAddresses, deadLetterOf, groupLag, lastTypeOn, testPublish } from "./broker-view";
import { InfraError, InfraHeader } from "./chrome";
import type { InfraTabProps } from "./types";
import { useInfra, useInfraAction } from "./use-infra";

const JOURNAL_SHOWN = 100;

// The Broker tab: the one emulated broker every deployable's channels ride —
// redis channels, rabbitmq exchanges and queues, kafka topics with consumer
// groups and their committed offsets per partition, and the dead letters of
// each.  Publish a test message onto an address, browse what a queue or topic
// holds, re-drive dead letters, or move a kafka group's offset to replay.
export default function BrokerTab({ active }: InfraTabProps): JSX.Element {
  const { data, error } = useInfra<BrokerInspectResult>("broker", "inspect", {}, { enabled: active, poll: 1000 });
  const { run } = useInfraAction();
  const [actionError, setActionError] = useState<string | null>(null);
  const act = async (op: string, params: unknown): Promise<void> => {
    setActionError(null);
    await run("broker", op, params).catch((err: unknown) =>
      setActionError(err instanceof Error ? err.message : String(err)),
    );
  };

  const empty =
    data &&
    data.redis.channels.length === 0 &&
    data.rabbitmq.queues.length === 0 &&
    data.kafka.topics.length === 0 &&
    data.journal.length === 0;

  return (
    <Stack gap={0} style={{ height: "100%", minHeight: 0 }} data-testid="infra-broker">
      <InfraHeader
        title="Message broker (redis · rabbitmq · kafka)"
        notes={(data?.emulated ?? []).map((e) => `${e.transport}: ${e.note}`)}
      />
      <InfraError message={error ?? actionError} />
      <Box p="sm" style={{ overflow: "auto", flex: 1, minHeight: 0 }}>
      <Stack gap="sm">
        {empty && (
          <Text size="sm" c="dimmed" data-testid="infra-broker-empty">
            No broker traffic yet. A deployable with a <Code>channel</Code> on redis, rabbitmq or kafka subscribes at
            boot.
          </Text>
        )}
        {data && !empty && <PublishForm state={data} onPublish={(p) => act("publish", p)} />}
        {data && data.redis.channels.length > 0 && (
          <Section title="redis" subtitle="pub/sub channels">
            <Table striped withTableBorder fz="xs" verticalSpacing={2}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Channel</Table.Th>
                  <Table.Th>Subscribers</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {data.redis.channels.map((c) => (
                  <Table.Tr key={c.name} data-testid="infra-broker-redis-channel" data-name={c.name}>
                    <Table.Td style={{ fontFamily: "monospace" }}>{c.name}</Table.Td>
                    <Table.Td>{c.subscribers.join(", ") || "—"}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Section>
        )}
        {data && data.rabbitmq.queues.length > 0 && (
          <Section title="rabbitmq" subtitle="queues (one per consumer group) and dead-letter queues">
            {data.rabbitmq.queues.map((q) => (
              <RabbitQueue key={q.name} q={q} active={active} onRedrive={(address) => void act("redrive", { transport: "rabbitmq", address })} />
            ))}
          </Section>
        )}
        {data && data.kafka.topics.length > 0 && (
          <Section title="kafka" subtitle="topics, consumer groups and committed offsets">
            {data.kafka.topics.map((t) => (
              <KafkaTopic
                key={t.name}
                topic={t}
                active={active}
                onSeek={(group, partition, offset) => void act("seek", { topic: t.name, group, partition, offset })}
                onRedrive={(address) => void act("redrive", { transport: "kafka", address })}
              />
            ))}
          </Section>
        )}
        {data && data.journal.length > 0 && (
          <Section title="Journal" subtitle={`last ${Math.min(JOURNAL_SHOWN, data.journal.length)} broker events`}>
            <Table.ScrollContainer minWidth={480}>
              <Table striped withTableBorder fz="xs" verticalSpacing={1}>
                <Table.Tbody>
                  {data.journal
                    .slice(-JOURNAL_SHOWN)
                    .reverse()
                    .map((j) => (
                      <Table.Tr key={j.seq} data-testid="infra-broker-journal" data-kind={j.kind}>
                        <Table.Td>{new Date(j.at).toLocaleTimeString()}</Table.Td>
                        <Table.Td>{j.transport}</Table.Td>
                        <Table.Td>
                          <Badge size="xs" variant="light" color={kindColor(j.kind)}>
                            {j.kind}
                          </Badge>
                        </Table.Td>
                        <Table.Td style={{ fontFamily: "monospace" }}>{j.address}</Table.Td>
                        <Table.Td>{j.type}</Table.Td>
                        <Table.Td>{j.client ?? "playground"}</Table.Td>
                        <Table.Td c="red">{j.error ?? ""}</Table.Td>
                      </Table.Tr>
                    ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          </Section>
        )}
      </Stack>
      </Box>
    </Stack>
  );
}

function kindColor(kind: string): string {
  if (kind === "dead-lettered" || kind === "dropped") return "red";
  if (kind === "retried" || kind === "nacked") return "yellow";
  if (kind === "acked") return "green";
  if (kind === "seeked" || kind === "redriven") return "grape";
  return "gray";
}

function Section({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <Stack gap={4}>
      <Group gap="xs">
        <Text size="sm" fw={600}>
          {title}
        </Text>
        <Text size="xs" c="dimmed">
          {subtitle}
        </Text>
      </Group>
      {children}
    </Stack>
  );
}

function PublishForm({
  state,
  onPublish,
}: {
  state: BrokerInspectResult;
  onPublish: (p: ReturnType<typeof testPublish>) => Promise<void>;
}): JSX.Element {
  const addresses = brokerAddresses(state);
  const [target, setTarget] = useState("");
  const [type, setType] = useState("");
  const [key, setKey] = useState("");
  const [data, setData] = useState("{}");
  const [bad, setBad] = useState<string | null>(null);
  const picked = addresses.find((a) => `${a.transport} ${a.address}` === target) ?? addresses[0];
  const typeShown = type || (picked ? (lastTypeOn(state, picked.address) ?? "") : "");

  const publish = () => {
    if (!picked) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      setBad("data is not JSON");
      return;
    }
    setBad(null);
    void onPublish(testPublish(picked, typeShown, parsed, crypto.randomUUID(), new Date(), key || null));
  };

  return (
    <Stack gap={4} data-testid="infra-broker-publish">
      <Text size="sm" fw={600}>
        Publish a test message
      </Text>
      <Group gap="xs" align="flex-end" wrap="wrap">
        <NativeSelect
          size="xs"
          label="Address"
          data={addresses.map((a) => ({ value: `${a.transport} ${a.address}`, label: `${a.transport} · ${a.address}` }))}
          value={picked ? `${picked.transport} ${picked.address}` : ""}
          onChange={(e) => setTarget(e.currentTarget.value)}
          data-testid="infra-broker-publish-address"
        />
        <TextInput
          size="xs"
          label="Type"
          placeholder="Context.EventName"
          value={typeShown}
          onChange={(e) => setType(e.currentTarget.value)}
          data-testid="infra-broker-publish-type"
        />
        {picked?.transport === "kafka" && (
          <TextInput
            size="xs"
            label="Key"
            placeholder="partition key"
            value={key}
            onChange={(e) => setKey(e.currentTarget.value)}
            data-testid="infra-broker-publish-key"
          />
        )}
      </Group>
      <Textarea
        size="xs"
        label="data"
        autosize
        minRows={1}
        maxRows={6}
        value={data}
        onChange={(e) => setData(e.currentTarget.value)}
        styles={{ input: { fontFamily: "monospace" } }}
        data-testid="infra-broker-publish-data"
      />
      {bad && (
        <Text size="xs" c="red">
          {bad}
        </Text>
      )}
      <Group>
        <Button size="compact-xs" onClick={publish} disabled={!picked || !typeShown} data-testid="infra-broker-publish-send">
          Publish
        </Button>
      </Group>
    </Stack>
  );
}

function Messages({ active, transport, name }: { active: boolean; transport: "rabbitmq" | "kafka"; name: string }) {
  const { data } = useInfra<BrokerBrowseMessage[]>("broker", "browse", { transport, name }, { enabled: active, poll: 1000 });
  if (!data) return null;
  if (data.length === 0) {
    return (
      <Text size="xs" c="dimmed" pl="md">
        Empty.
      </Text>
    );
  }
  return (
    <Table.ScrollContainer minWidth={420}>
      <Table withTableBorder fz="xs" verticalSpacing={1} data-testid="infra-broker-messages" data-name={name}>
        <Table.Tbody>
          {data.map((m, i) => (
            <Table.Tr key={`${m.partition ?? ""}:${m.offset ?? i}`} data-testid="infra-broker-message" data-id={m.id}>
              {transport === "kafka" ? (
                <Table.Td>
                  p{m.partition}@{m.offset}
                </Table.Td>
              ) : (
                <Table.Td>{m.unacked ? "unacked" : "ready"}</Table.Td>
              )}
              <Table.Td>{m.type}</Table.Td>
              <Table.Td>{m.attempts > 1 ? `attempt ${m.attempts}` : ""}</Table.Td>
              <Table.Td style={{ fontFamily: "monospace", wordBreak: "break-all", maxWidth: 420 }}>{m.body}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  );
}

function RabbitQueue({
  q,
  active,
  onRedrive,
}: {
  q: BrokerInspectQueue;
  active: boolean;
  onRedrive: (address: string) => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const dlqFor = deadLetterOf("rabbitmq", q.name);
  return (
    <Stack gap={2} data-testid="infra-broker-queue" data-name={q.name}>
      <Group gap="xs" wrap="wrap">
        <Button size="compact-xs" variant="subtle" onClick={() => setOpen(!open)} data-testid="infra-broker-queue-toggle">
          {open ? "▾" : "▸"} <Code ml={4}>{q.name}</Code>
        </Button>
        {dlqFor !== null && (
          <Badge size="xs" color="red" variant="light">
            dead letters
          </Badge>
        )}
        <Text size="xs" c="dimmed" data-testid="infra-broker-queue-counts">
          {q.ready} ready · {q.unacked} unacked · {q.consumers} consumers
        </Text>
        {dlqFor !== null && q.ready > 0 && (
          <Button size="compact-xs" variant="light" onClick={() => onRedrive(dlqFor)} data-testid="infra-broker-redrive">
            Re-drive to {dlqFor}
          </Button>
        )}
      </Group>
      {open && <Messages active={active} transport="rabbitmq" name={q.name} />}
    </Stack>
  );
}

function KafkaTopic({
  topic,
  active,
  onSeek,
  onRedrive,
}: {
  topic: BrokerInspectTopic;
  active: boolean;
  onSeek: (group: string, partition: number | undefined, offset: number | "earliest" | "latest") => void;
  onRedrive: (address: string) => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const dlqFor = deadLetterOf("kafka", topic.name);
  const retained = topic.partitions.reduce((n, p) => n + p.end - p.start, 0);
  return (
    <Stack gap={2} data-testid="infra-broker-topic" data-name={topic.name}>
      <Group gap="xs" wrap="wrap">
        <Button size="compact-xs" variant="subtle" onClick={() => setOpen(!open)} data-testid="infra-broker-topic-toggle">
          {open ? "▾" : "▸"} <Code ml={4}>{topic.name}</Code>
        </Button>
        {dlqFor !== null && (
          <Badge size="xs" color="red" variant="light">
            dead letters
          </Badge>
        )}
        <Text size="xs" c="dimmed" data-testid="infra-broker-topic-partitions">
          {retained} retained ·{" "}
          {topic.partitions.map((p, i) => `p${i} ${p.start}…${p.end}`).join(" · ")}
        </Text>
        {dlqFor !== null && retained > 0 && (
          <Button size="compact-xs" variant="light" onClick={() => onRedrive(dlqFor)} data-testid="infra-broker-redrive">
            Re-drive to {dlqFor}
          </Button>
        )}
      </Group>
      {topic.groups.length > 0 && (
        <Table.ScrollContainer minWidth={420}>
          <Table withTableBorder fz="xs" verticalSpacing={1}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Group</Table.Th>
                <Table.Th>Members</Table.Th>
                {topic.partitions.map((_, i) => (
                  <Table.Th key={i}>p{i} offset / lag</Table.Th>
                ))}
                <Table.Th>Replay</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {topic.groups.map((g) => {
                const lag = groupLag(topic, g.offsets);
                return (
                  <Table.Tr key={g.group} data-testid="infra-broker-group" data-group={g.group}>
                    <Table.Td style={{ fontFamily: "monospace" }}>{g.group}</Table.Td>
                    <Table.Td>{g.members.join(", ") || "—"}</Table.Td>
                    {g.offsets.map((o, i) => (
                      <Table.Td key={i} data-testid="infra-broker-offset" data-partition={i}>
                        {o} / {lag[i]}
                      </Table.Td>
                    ))}
                    <Table.Td>
                      <SeekControl partitions={topic.partitions.length} onSeek={(p, o) => onSeek(g.group, p, o)} />
                    </Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}
      {open && <Messages active={active} transport="kafka" name={topic.name} />}
    </Stack>
  );
}

function SeekControl({
  partitions,
  onSeek,
}: {
  partitions: number;
  onSeek: (partition: number | undefined, offset: number | "earliest" | "latest") => void;
}): JSX.Element {
  const [partition, setPartition] = useState("all");
  const [offset, setOffset] = useState<number | string>("");
  const p = partition === "all" ? undefined : Number(partition);
  return (
    <Group gap={4} wrap="nowrap" data-testid="infra-broker-seek">
      <NativeSelect
        size="xs"
        data={[{ value: "all", label: "all" }, ...Array.from({ length: partitions }, (_, i) => ({ value: String(i), label: `p${i}` }))]}
        value={partition}
        onChange={(e) => setPartition(e.currentTarget.value)}
        data-testid="infra-broker-seek-partition"
      />
      <NumberInput
        size="xs"
        w={70}
        min={0}
        placeholder="offset"
        value={offset}
        onChange={setOffset}
        data-testid="infra-broker-seek-offset"
      />
      <Button
        size="compact-xs"
        variant="light"
        disabled={typeof offset !== "number"}
        onClick={() => typeof offset === "number" && onSeek(p, offset)}
        data-testid="infra-broker-seek-go"
      >
        Seek
      </Button>
      <Button size="compact-xs" variant="subtle" onClick={() => onSeek(p, "earliest")} data-testid="infra-broker-seek-earliest">
        From start
      </Button>
    </Group>
  );
}
