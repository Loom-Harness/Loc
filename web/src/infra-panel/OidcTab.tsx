import { Alert, Badge, Box, Button, Code, Group, Stack, Table, Text } from "@mantine/core";
import { useState } from "react";
import type { IssuedToken, OidcPersona, OidcRealm } from "../runtime/infra/oidc";
import { EmulatedNotes } from "./EmulatedNotes";
import { formatRemaining, type InfraCall, usePoll } from "./infra-call";
import { decodeJwt } from "./jwt";

interface OidcState {
  realms: OidcRealm[];
  personas: OidcPersona[];
  tokens: IssuedToken[];
  emulated: readonly string[];
}

const pretty = (v: unknown): string => JSON.stringify(v, null, 2);

// The OIDC tab: the fake identity provider's realms and personas (the dev
// Keycloak realm's users), and every token set it issued — minted here or by
// the Auth panel, or served by its token endpoint to a deployable's login —
// with the decoded header and claims.  "Mint" issues a token for a persona
// through the same provider the generated verifier trusts.
export function OidcTab({ call }: { call: InfraCall }): JSX.Element {
  const { data, error, refresh } = usePoll(async (): Promise<OidcState> => {
    const [realms, personas, log] = await Promise.all([
      call<OidcRealm[]>("oidc", "realms"),
      call<OidcPersona[]>("oidc", "personas"),
      call<{ tokens: IssuedToken[]; emulated: readonly string[] }>("oidc", "tokens"),
    ]);
    return { realms, personas, tokens: log.tokens, emulated: log.emulated };
  }, 1000);
  const [open, setOpen] = useState<number | null>(null);
  const [mintError, setMintError] = useState<string | null>(null);

  const mint = (persona: string) => () => {
    setMintError(null);
    call("oidc", "mint", { persona }).then(
      () => refresh(),
      (err: unknown) => setMintError(err instanceof Error ? err.message : String(err)),
    );
  };

  const now = Date.now();
  const tokens = [...(data?.tokens ?? [])].reverse();

  return (
    <Box p="sm" style={{ overflow: "auto", height: "100%" }} data-testid="infra-oidc">
      <Stack gap="sm">
        {(error || mintError) && (
          <Alert color="red" p="xs" data-testid="infra-oidc-error">
            {error ?? mintError}
          </Alert>
        )}
        {data && <EmulatedNotes notes={data.emulated} testId="infra-oidc-emulated" />}
        {data && data.realms.length === 0 && (
          <Text size="sm" c="dimmed" data-testid="infra-oidc-empty">
            No identity provider is configured. Boot a system with <Code>auth {"{ oidc }"}</Code>.
          </Text>
        )}
        {data?.realms.map((r) => (
          <Group key={r.issuer} gap="xs" data-testid="infra-oidc-realm">
            <Text size="xs" fw={600}>
              Issuer
            </Text>
            <Code>{r.issuer}</Code>
            <Text size="xs" c="dimmed">
              client <Code>{r.clientId}</Code> · audience <Code>{r.audience}</Code>
            </Text>
          </Group>
        ))}
        {data && data.personas.length > 0 && (
          <Stack gap={4}>
            <Text size="sm" fw={600}>
              Personas
            </Text>
            <Table.ScrollContainer minWidth={360}>
              <Table striped withTableBorder fz="xs" verticalSpacing={2}>
                <Table.Tbody>
                  {data.personas.map((p) => (
                    <Table.Tr key={p.username} data-testid="infra-oidc-persona" data-persona={p.username}>
                      <Table.Td fw={600}>{p.username}</Table.Td>
                      <Table.Td style={{ fontFamily: "monospace", wordBreak: "break-all" }}>
                        {Object.entries(p.claims)
                          .filter(([k]) => k !== "sub")
                          .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
                          .join("  ")}
                      </Table.Td>
                      <Table.Td>
                        <Button size="compact-xs" variant="light" onClick={mint(p.username)} data-testid="infra-oidc-mint">
                          Mint
                        </Button>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          </Stack>
        )}
        {data && data.realms.length > 0 && (
          <Stack gap={4}>
            <Text size="sm" fw={600}>
              Issued tokens
            </Text>
            {tokens.length === 0 && (
              <Text size="xs" c="dimmed" data-testid="infra-oidc-no-tokens">
                None yet. Sign in through the preview, or mint one above.
              </Text>
            )}
            {tokens.map((t) => {
              const left = t.expiresAt * 1000 - now;
              const isOpen = open === t.seq;
              return (
                <Stack key={t.seq} gap={2} data-testid="infra-oidc-token" data-persona={t.persona} data-source={t.source}>
                  <Group gap="xs">
                    <Button
                      size="compact-xs"
                      variant="subtle"
                      onClick={() => setOpen(isOpen ? null : t.seq)}
                      data-testid="infra-oidc-token-toggle"
                    >
                      {isOpen ? "▾" : "▸"} #{t.seq}
                    </Button>
                    <Badge size="xs" variant="light">
                      {t.source === "mint" ? "minted" : t.source.replace("_", " ")}
                    </Badge>
                    <Text size="xs" fw={600}>
                      {t.persona}
                    </Text>
                    <Text size="xs" c={left > 0 ? "dimmed" : "red"} data-testid="infra-oidc-token-expiry">
                      {left > 0 ? `expires in ${formatRemaining(left)}` : "expired"}
                    </Text>
                  </Group>
                  {isOpen && <DecodedToken label="Access token" token={t.access_token} />}
                  {isOpen && <DecodedToken label="ID token" token={t.id_token} />}
                </Stack>
              );
            })}
          </Stack>
        )}
      </Stack>
    </Box>
  );
}

function DecodedToken({ label, token }: { label: string; token: string }): JSX.Element {
  const decoded = decodeJwt(token);
  return (
    <Stack gap={2} pl="md" data-testid="infra-oidc-decoded" data-label={label}>
      <Text size="xs" fw={600}>
        {label}
      </Text>
      {decoded ? (
        <Group align="flex-start" gap="xs" wrap="wrap">
          <Code block data-testid="infra-oidc-header" style={{ fontSize: 11 }}>
            {pretty(decoded.header)}
          </Code>
          <Code block data-testid="infra-oidc-claims" style={{ fontSize: 11, flex: 1, minWidth: 220 }}>
            {pretty(decoded.claims)}
          </Code>
        </Group>
      ) : (
        <Text size="xs" c="red">
          Not a decodable JWT.
        </Text>
      )}
      <Code style={{ fontSize: 10, wordBreak: "break-all" }}>{token}</Code>
    </Stack>
  );
}

export default OidcTab;
