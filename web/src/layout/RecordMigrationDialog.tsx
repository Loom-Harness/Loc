import { Box, Button, Group, Loader, Modal, ScrollArea, Stack, Text } from "@mantine/core";
import { useEffect, useMemo, useState } from "react";
import type { EvolutionResult } from "../build/protocol";
import type { LayoutCtx } from "./ctx";
import { MigrationCard, RecordMigrationForm, recordableOf, SchemaDiagram, TintLegend } from "./MigrationsPanel";
import { tintTables } from "./migration-tint";
import { MIGRATIONS, PENDING_MIGRATION } from "./vocabulary";
import { trackedCtx } from "./ctx-store";

// The Record migration dialog — `ddd migrate add` from the pipeline strip.
//
// It previews exactly what recording writes (the live tree against the
// chain's heads, no baseline source: every table's Initial when nothing is
// recorded, the next entry otherwise), with the Migrations tab's own diagram,
// SQL cards and destructive gate, and records through the same form and the
// same `ctx.recordMigration` the tab uses — so the chain entry is the same
// whichever surface wrote it.  An initial migration lists every table, so
// the diagram and the SQL each scroll on their own and the summary line says
// how much it creates up front.

function RecordMigrationDialogView({ ctx }: { ctx: LayoutCtx }): JSX.Element {
  const opened = ctx.recordMigrationOpen;
  const [preview, setPreview] = useState<EvolutionResult | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!opened) return;
    let live = true;
    setPreview(null);
    setLoading(true);
    void ctx
      .previewRecordMigration()
      .then((r) => {
        if (live) setPreview(r);
      })
      .catch((err: unknown) => {
        if (live) {
          setPreview({
            ok: false,
            diagnostics: [
              {
                severity: "error",
                message: err instanceof Error ? err.message : String(err),
                source: "loom-evolve",
              },
            ],
          });
        }
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened]);

  const close = (): void => ctx.setRecordMigrationOpen(false);
  const initial = preview?.ok === true && preview.chain === null;

  return (
    <Modal
      opened={opened}
      onClose={close}
      title={initial ? PENDING_MIGRATION.dialogTitleInitial : PENDING_MIGRATION.dialogTitle}
      size="xl"
      data-testid="record-migration-dialog"
    >
      {loading || preview == null ? (
        <Group gap="xs" py="sm" data-testid="record-migration-loading">
          <Loader size="xs" />
          <Text size="sm" c="dimmed">
            {PENDING_MIGRATION.dialogLoading}
          </Text>
        </Group>
      ) : !preview.ok ? (
        <Stack gap={4} data-testid="record-migration-failed">
          <Text size="sm" c="red" fw={600}>
            {MIGRATIONS.diffFailed}
          </Text>
          {preview.diagnostics.map((d, i) => (
            <Text key={i} size="xs" c="dimmed" ff="monospace">
              {d.message}
            </Text>
          ))}
        </Stack>
      ) : (
        <RecordPreview ctx={ctx} e={preview} onRecorded={close} />
      )}
      <Group justify="flex-end" mt="md">
        <Button size="xs" variant="default" onClick={close} data-testid="record-migration-close">
          {PENDING_MIGRATION.cancel}
        </Button>
      </Group>
    </Modal>
  );
}

function RecordPreview({
  ctx,
  e,
  onRecorded,
}: {
  ctx: LayoutCtx;
  e: Extract<EvolutionResult, { ok: true }>;
  onRecorded: () => void;
}): JSX.Element {
  const tinted = useMemo(() => tintTables(e), [e]);
  const summary = useMemo(() => {
    if (!recordableOf(e)) {
      return e.chain?.forkHeads
        ? MIGRATIONS.twoHeads(e.chain.forkHeads[0], e.chain.forkHeads[1])
        : PENDING_MIGRATION.dialogNothing;
    }
    if (e.chain === null) {
      const modules = [...new Set(e.tables.map((t) => t.module))];
      return PENDING_MIGRATION.dialogInitialSummary(e.tables.length, modules);
    }
    const steps = e.migrations.reduce((n, m) => n + m.steps.length, 0);
    return PENDING_MIGRATION.dialogSummary(steps, [...new Set(e.migrations.map((m) => m.module))]);
  }, [e]);

  return (
    <Stack gap="sm" data-testid="record-migration-preview">
      <Text size="sm" data-testid="record-migration-summary">
        {summary}
      </Text>
      {tinted.length > 0 && (
        <Stack gap={4}>
          <Group gap={8}>
            <Text size="xs" fw={600}>
              {PENDING_MIGRATION.dialogTablesHeading}
            </Text>
            <TintLegend tables={tinted} />
          </Group>
          <ScrollArea.Autosize mah={200} type="auto">
            <SchemaDiagram tables={tinted} />
          </ScrollArea.Autosize>
        </Stack>
      )}
      {e.migrations.length > 0 && (
        <Stack gap={4}>
          <Text size="xs" fw={600}>
            {MIGRATIONS.sqlHeading}
          </Text>
          <ScrollArea.Autosize mah={280} type="auto">
            <Stack gap={6} data-testid="record-migration-sql">
              {e.migrations.map((m) => (
                <MigrationCard key={`${m.module}/${m.name}`} m={m} />
              ))}
            </Stack>
          </ScrollArea.Autosize>
        </Stack>
      )}
      <Box>
        <RecordMigrationForm ctx={ctx} e={e} testid="record-migration" onRecorded={onRecorded} />
      </Box>
    </Stack>
  );
}

export const RecordMigrationDialog = trackedCtx("RecordMigrationDialog", RecordMigrationDialogView);
