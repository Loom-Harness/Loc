// Mailbox: every mail the deployables sent through smtp, ses or sendgrid,
// captured by the infra worker's `mailbox` service instead of leaving the
// browser.  List, read (text, or the HTML body in a sandboxed frame), clear.

import { Box, Button, Group, ScrollArea, SegmentedControl, Stack, Text, UnstyledButton } from "@mantine/core";
import { useState } from "react";
import { InfraError, InfraHeader } from "./chrome";
import { declaredOf, type InfraTabProps } from "./types";
import { useInfra, useInfraAction } from "./use-infra";

/** The mailbox service's `list` row. */
export interface MailMessage {
  id: string;
  at: string;
  via: "smtp" | "ses" | "sendgrid";
  from: string;
  to: string[];
  subject: string;
  text: string;
  html?: string;
}

export const MAILBOX_NOTES = [
  "No mail leaves the browser: smtp, SES and SendGrid all deliver into this one box.",
  "Every address is accepted; there are no bounces, quotas, SPF/DKIM checks or delivery delay.",
  "SES request signatures are not verified.",
];

export default function MailboxTab({ env, active }: InfraTabProps): JSX.Element {
  const { data, error } = useInfra<MailMessage[]>("mailbox", "list", {}, { enabled: active });
  const { run } = useInfraAction();
  const [selected, setSelected] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const mail = [...(data ?? [])].reverse();
  const open = mail.find((m) => m.id === selected) ?? null;
  const servers = declaredOf(env, ["smtp", "ses", "sendgrid"])
    .map((r) => `${r.name} (${r.type})`)
    .join(", ");

  return (
    <Stack gap={0} style={{ flex: 1, minHeight: 0 }}>
      <InfraHeader title={`Mailbox — ${servers}`} notes={MAILBOX_NOTES}>
        <Text size="xs" c="dimmed" data-testid="mailbox-count">
          {mail.length} {mail.length === 1 ? "message" : "messages"}
        </Text>
        <Button
          size="compact-xs"
          variant="subtle"
          color="red"
          disabled={mail.length === 0}
          data-testid="mailbox-clear"
          onClick={() => {
            setActionError(null);
            setSelected(null);
            run("mailbox", "clear").catch((e: unknown) => setActionError(String(e)));
          }}
        >
          Clear
        </Button>
      </InfraHeader>
      <InfraError message={error ?? actionError} />
      {mail.length === 0 ? (
        <Text size="xs" c="dimmed" p="sm" data-testid="mailbox-empty">
          No mail yet. Call an operation that sends one.
        </Text>
      ) : (
        <Box
          style={{
            flex: 1,
            minHeight: 0,
            display: "grid",
            // Side by side in the dock; stacked on a phone.
            gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
          }}
        >
          <ScrollArea style={{ borderRight: "1px solid var(--loom-border)" }}>
            <Stack gap={0} data-testid="mailbox-list">
              {mail.map((m) => (
                <UnstyledButton
                  key={m.id}
                  onClick={() => setSelected(m.id)}
                  data-testid="mailbox-row"
                  data-mail-id={m.id}
                  px="sm"
                  py={6}
                  style={{
                    borderBottom: "1px solid var(--loom-border)",
                    background: m.id === open?.id ? "var(--loom-bg-raised)" : undefined,
                  }}
                >
                  <Group gap={6} wrap="nowrap" justify="space-between">
                    <Text size="xs" fw={600} truncate data-testid="mailbox-row-subject">
                      {m.subject || "(no subject)"}
                    </Text>
                    <Text size="10px" c="dimmed" style={{ flexShrink: 0 }}>
                      {m.via}
                    </Text>
                  </Group>
                  <Text size="xs" c="dimmed" truncate>
                    to {m.to.join(", ")}
                  </Text>
                </UnstyledButton>
              ))}
            </Stack>
          </ScrollArea>
          {open ? <MailView mail={open} /> : <Text size="xs" c="dimmed" p="sm">Pick a message to read it.</Text>}
        </Box>
      )}
    </Stack>
  );
}

function MailView({ mail }: { mail: MailMessage }): JSX.Element {
  const [view, setView] = useState<"text" | "html">(mail.html ? "html" : "text");
  const shown = mail.html ? view : "text";
  return (
    <Stack gap={4} p="sm" style={{ minWidth: 0, minHeight: 0 }} data-testid="mailbox-message">
      <Text size="sm" fw={600} data-testid="mailbox-subject">
        {mail.subject || "(no subject)"}
      </Text>
      <Text size="xs" data-testid="mailbox-from">
        From: {mail.from}
      </Text>
      <Text size="xs" data-testid="mailbox-to">
        To: {mail.to.join(", ")}
      </Text>
      <Text size="xs" c="dimmed" data-testid="mailbox-via">
        via {mail.via} · {new Date(mail.at).toLocaleString()}
      </Text>
      {mail.html && (
        <SegmentedControl
          size="xs"
          value={shown}
          onChange={(v) => setView(v as "text" | "html")}
          data={[
            { value: "html", label: "HTML" },
            { value: "text", label: "Text" },
          ]}
          style={{ alignSelf: "flex-start" }}
          data-testid="mailbox-view"
        />
      )}
      {shown === "html" ? (
        // No `allow-*` tokens: no script, no same-origin, no forms or navigation.
        <iframe
          title={`Mail: ${mail.subject}`}
          sandbox=""
          srcDoc={mail.html}
          data-testid="mailbox-html"
          style={{ flex: 1, minHeight: 200, border: "1px solid var(--loom-border)", background: "white" }}
        />
      ) : (
        <Box
          component="pre"
          data-testid="mailbox-text"
          m={0}
          p="xs"
          style={{
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            fontSize: 12,
            border: "1px solid var(--loom-border)",
            borderRadius: 4,
          }}
        >
          {mail.text}
        </Box>
      )}
    </Stack>
  );
}
