// The Infrastructure panel: one tab per emulated service (`tabs.ts`), each
// reading the infra worker's state through the `{ service, op, params }`
// protocol.  Reached from the desktop dock and the mobile shell's More sheet.

import { Box, Loader, Stack, Tabs, Text } from "@mantine/core";
import { Suspense, useCallback, useMemo, useState } from "react";
import type { LayoutCtx } from "../layout/ctx";
import { PaneErrorBoundary } from "../PaneErrorBoundary";
import { InfraEmpty } from "./chrome";
import { INFRA_TABS } from "./tabs";
import { type InfraCall, type InfraEnv, isDeclared } from "./types";
import { InfraContext, type InfraContextValue } from "./use-infra";

const TAB_KEY = "loom.infraTab";

function readTab(): string | null {
  try {
    return localStorage.getItem(TAB_KEY);
  } catch {
    return null;
  }
}

function writeTab(id: string): void {
  try {
    localStorage.setItem(TAB_KEY, id);
  } catch {
    /* per-viewer convenience only */
  }
}

export function InfraPanel({ ctx, active = true }: { ctx: LayoutCtx; active?: boolean }): JSX.Element {
  const engine = ctx.engine;
  const booted = ctx.ddl !== null;
  const [epoch, setEpoch] = useState(0);
  const touch = useCallback(() => setEpoch((e) => e + 1), []);
  const call = useMemo<InfraCall | null>(() => {
    if (!booted || !engine?.infraService) return null;
    const svc = engine.infraService.bind(engine);
    return <T,>(service: Parameters<InfraCall>[0], op: string, params?: unknown) => svc<T>(service, op, params ?? {});
  }, [engine, booted]);
  const value = useMemo<InfraContextValue>(() => ({ call, epoch, touch }), [call, epoch, touch]);
  const env = useMemo<InfraEnv>(
    () => ({ resources: ctx.infraResources, oidc: ctx.oidc.setup !== null }),
    [ctx.infraResources, ctx.oidc.setup],
  );

  // The remembered tab when the system uses it, else the first one it uses.
  // A tab picked in this session sticks, declared or not (its empty state
  // says why it is empty).
  const [picked, setPicked] = useState<string | null>(null);
  const remembered = INFRA_TABS.find((t) => t.id === readTab() && isDeclared(t, env))?.id;
  const firstDeclared = INFRA_TABS.find((t) => isDeclared(t, env))?.id ?? INFRA_TABS[0]?.id ?? "";
  const current = INFRA_TABS.some((t) => t.id === picked) ? (picked as string) : (remembered ?? firstDeclared);

  if (!booted || !call) {
    return (
      <Stack p="md" gap={4} data-testid="infra-panel" data-booted="false">
        <Text size="sm" fw={600}>
          Nothing is running
        </Text>
        <Text size="xs" c="dimmed" data-testid="infra-not-booted">
          Boot the system (Runtime → Boot) to see its emulated mail, object stores, disk, broker, REST mocks and identity
          provider here.
        </Text>
      </Stack>
    );
  }

  return (
    <InfraContext.Provider value={value}>
      <Tabs
        value={current}
        onChange={(v) => {
          if (!v) return;
          setPicked(v);
          writeTab(v);
        }}
        variant="outline"
        keepMounted={false}
        data-testid="infra-panel"
        data-booted="true"
        styles={{
          root: { height: "100%", minHeight: 0, display: "flex", flexDirection: "column" },
          list: { flexWrap: "nowrap", overflowX: "auto", flexShrink: 0, paddingLeft: 6 },
          tab: { padding: "4px 10px", fontSize: 12 },
          panel: { flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "auto" },
        }}
      >
        <Tabs.List aria-label="Emulated services">
          {INFRA_TABS.map((t) => {
            const declared = isDeclared(t, env);
            return (
              <Tabs.Tab
                key={t.id}
                value={t.id}
                data-testid={`infra-tab-${t.id}`}
                data-declared={declared}
                c={declared ? undefined : "dimmed"}
              >
                {t.label}
              </Tabs.Tab>
            );
          })}
        </Tabs.List>
        {INFRA_TABS.map((t) => {
          const Body = t.component;
          return (
            <Tabs.Panel key={t.id} value={t.id} data-testid={`infra-panel-${t.id}`}>
              {isDeclared(t, env) ? (
                <PaneErrorBoundary name={`Infrastructure: ${t.label}`}>
                  <Suspense
                    fallback={
                      <Box p="md">
                        <Loader size="xs" />
                      </Box>
                    }
                  >
                    <Body env={env} active={active && current === t.id} />
                  </Suspense>
                </PaneErrorBoundary>
              ) : (
                <InfraEmpty id={t.id} label={t.label} types={t.types} />
              )}
            </Tabs.Panel>
          );
        })}
      </Tabs>
    </InfraContext.Provider>
  );
}

export default InfraPanel;
