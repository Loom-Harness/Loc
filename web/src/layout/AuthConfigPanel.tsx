import { Alert, Box, Button, Code, Group, NativeSelect, SegmentedControl, Stack, Switch, Text, Textarea } from "@mantine/core";
import { useEffect, useState } from "react";
import type { OidcSetup } from "../backend/oidc-personas";
import { type AuthStubConfig, type AuthVerifierChoice, type LayoutCtx, type OidcState } from "./ctx";
import { trackedCtx } from "./ctx-store";

interface Props {
  ctx: LayoutCtx;
}

// The Auth tab — which identity requests to the booted backend carry (the
// API console and the preview alike; see `authHeaders`).
//
// A system with `auth { oidc }` boots its generated OIDC verifier against the
// infra worker's fake identity provider: pick a persona of the generated dev
// realm, edit its claims if you like, and mint a real signed token — the
// verifier checks its signature, issuer, audience and expiry like a deployed
// one.  The verifier switch boots the dev stub instead (on the next boot).
// Without `auth { oidc }` the dev stub is the only verifier: it trusts the
// claims sent as `x-loom-dev-claims` and merges them over its built-in
// identity, so a `requires` gate flips 200 ↔ 403 with no token at all.
function AuthConfigPanelView({ ctx }: Props): JSX.Element {
  const { authStub, setAuthStub, oidc } = ctx;
  const choice: AuthVerifierChoice = authStub.verifier ?? "oidc";
  const booted: AuthVerifierChoice = oidc.active ? "oidc" : "stub";

  return (
    <Box p="md" style={{ overflow: "auto", height: "100%" }}>
      <Stack gap="sm">
        {oidc.setup && (
          <Stack gap={4}>
            <Text size="sm" fw={600}>
              Verifier
            </Text>
            <SegmentedControl
              size="xs"
              data={[
                { label: "OIDC (identity provider)", value: "oidc" },
                { label: "Dev stub", value: "stub" },
              ]}
              value={choice}
              onChange={(v) => setAuthStub((prev) => ({ ...prev, verifier: v as AuthVerifierChoice }))}
              data-testid="auth-verifier"
            />
            {choice !== booted && (
              <Text size="xs" c="yellow" data-testid="auth-verifier-pending">
                Boot again to switch the verifier — the running backend still uses the{" "}
                {booted === "oidc" ? "OIDC verifier" : "dev stub"}.
              </Text>
            )}
          </Stack>
        )}
        {oidc.active && oidc.setup ? (
          <OidcPersonas ctx={ctx} setup={oidc.setup} oidc={oidc} />
        ) : (
          <DevStub authStub={authStub} setAuthStub={setAuthStub} oidcSystem={oidc.setup !== null} />
        )}
      </Stack>
    </Box>
  );
}

function OidcPersonas({ ctx, setup, oidc }: { ctx: LayoutCtx; setup: OidcSetup; oidc: OidcState }): JSX.Element {
  const [persona, setPersona] = useState(oidc.token?.persona ?? setup.personas[0]?.username ?? "");
  const claimsOf = (name: string): string =>
    JSON.stringify(setup.personas.find((p) => p.username === name)?.claims ?? {}, null, 2);
  const [claimsJson, setClaimsJson] = useState(() => claimsOf(persona));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // A re-boot can bring a different realm: start from its first persona.
  useEffect(() => {
    if (!setup.personas.some((p) => p.username === persona)) {
      const first = setup.personas[0]?.username ?? "";
      setPersona(first);
      setClaimsJson(claimsOf(first));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setup]);
  const realm = setup.realms[0];

  const mint = async (): Promise<void> => {
    setError(null);
    let claims: unknown;
    try {
      claims = JSON.parse(claimsJson);
    } catch {
      setError("Claims must be valid JSON.");
      return;
    }
    if (claims === null || typeof claims !== "object" || Array.isArray(claims)) {
      setError('Claims must be a JSON object, e.g. { "tenantId": "…" }.');
      return;
    }
    setBusy(true);
    try {
      await ctx.mintOidcToken(persona, claims as Record<string, unknown>);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Stack gap="sm">
      <Text size="xs" c="dimmed">
        The backend runs its generated OIDC verifier against the playground's identity provider at{" "}
        <Code>{realm?.issuer}</Code> (audience <Code>{realm?.audience}</Code>). Personas are the users of the
        generated dev realm, <Code>keycloak/realm.json</Code>.
      </Text>
      {setup.personas.length === 0 ? (
        <Alert color="yellow" variant="light">
          The generated realm has no users to sign in as.
        </Alert>
      ) : (
        <>
          <NativeSelect
            label="Persona"
            data={setup.personas.map((p) => p.username)}
            value={persona}
            onChange={(e) => {
              setPersona(e.currentTarget.value);
              setClaimsJson(claimsOf(e.currentTarget.value));
            }}
            data-testid="auth-persona"
          />
          <Textarea
            label="Token claims (JSON)"
            description="What the realm's mappers put in this persona's access token. Edit to try another tenant or permission set."
            autosize
            minRows={4}
            maxRows={16}
            spellCheck={false}
            styles={{ input: { fontFamily: "var(--mantine-font-family-monospace)" } }}
            value={claimsJson}
            onChange={(e) => setClaimsJson(e.currentTarget.value)}
            data-testid="auth-persona-claims"
          />
          <Group gap="xs">
            <Button size="xs" onClick={() => void mint()} loading={busy} data-testid="auth-mint">
              Mint token
            </Button>
            {oidc.token && (
              <Button size="xs" variant="default" onClick={ctx.clearOidcToken} data-testid="auth-token-clear">
                Stop sending
              </Button>
            )}
          </Group>
        </>
      )}
      {error && (
        <Alert color="red" variant="light" data-testid="auth-mint-error">
          {error}
        </Alert>
      )}
      {oidc.token ? (
        <Stack gap={4} data-testid="auth-token">
          <Text size="xs">
            Sending <Code>Authorization: Bearer …</Code> as <b>{oidc.token.persona}</b>, valid until{" "}
            {new Date(oidc.token.expiresAt).toLocaleTimeString()}.
          </Text>
          <Code block style={{ fontSize: 11 }}>
            {JSON.stringify(oidc.token.claims, null, 2)}
          </Code>
        </Stack>
      ) : (
        <Text size="xs" c="dimmed" data-testid="auth-no-token">
          No token yet — requests carry none, so an <Code>auth: required</Code> route answers 401.
        </Text>
      )}
    </Stack>
  );
}

function DevStub({
  authStub,
  setAuthStub,
  oidcSystem,
}: {
  authStub: AuthStubConfig;
  setAuthStub: LayoutCtx["setAuthStub"];
  oidcSystem: boolean;
}): JSX.Element {
  // Parse state drives the inline validity hint.  An empty / disabled stub
  // is valid (no header injected); a non-object or malformed body is not.
  const parseState = validate(authStub);
  return (
    <Stack gap="sm">
      <Group justify="space-between" wrap="nowrap">
        <Box>
          <Text size="sm" fw={600}>
            Inject identity
          </Text>
          <Text size="xs" c="dimmed">
            Send these claims as <Code>x-loom-dev-claims</Code> on every request.
          </Text>
        </Box>
        <Switch
          checked={authStub.enabled}
          onChange={(e) => setAuthStub((prev) => ({ ...prev, enabled: e.currentTarget.checked }))}
          data-testid="auth-stub-enabled"
          label={authStub.enabled ? "On" : "Off"}
        />
      </Group>

      <Textarea
        label="Claims (JSON)"
        description="Overrides the dev-stub's built-in identity. e.g. flip role to test a requires gate."
        autosize
        minRows={4}
        maxRows={16}
        spellCheck={false}
        styles={{ input: { fontFamily: "var(--mantine-font-family-monospace)" } }}
        value={authStub.claimsJson}
        disabled={!authStub.enabled}
        onChange={(e) => setAuthStub((prev) => ({ ...prev, claimsJson: e.currentTarget.value }))}
        data-testid="auth-stub-claims"
      />

      {authStub.enabled && parseState.kind === "error" && (
        <Alert color="red" variant="light" data-testid="auth-stub-error">
          {parseState.message}
        </Alert>
      )}

      <Alert color="yellow" variant="light" title="Dev only">
        <Text size="xs">
          The generated dev-stub verifier trusts this header and accepts every request.
          {oidcSystem
            ? " This system declares auth { oidc }: switch the verifier to OIDC and boot again to sign in with real tokens."
            : " Declare auth { oidc } to run the generated OIDC verifier against the playground's identity provider instead."}
        </Text>
      </Alert>
    </Stack>
  );
}

type ParseState = { kind: "ok" } | { kind: "error"; message: string };

function validate(cfg: AuthStubConfig): ParseState {
  if (!cfg.enabled) return { kind: "ok" };
  let obj: unknown;
  try {
    obj = JSON.parse(cfg.claimsJson);
  } catch {
    return { kind: "error", message: "Claims must be valid JSON." };
  }
  if (obj === null || typeof obj !== "object" || Array.isArray(obj)) {
    return { kind: "error", message: "Claims must be a JSON object, e.g. { \"role\": \"agent\" }." };
  }
  return { kind: "ok" };
}

export const AuthConfigPanel = trackedCtx("AuthConfigPanel", AuthConfigPanelView);
