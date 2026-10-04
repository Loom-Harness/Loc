// Auto-generated.  Do not edit by hand.
import { useParams, Link as RouterLink } from "react-router";
import { MarkCompletedTransferRequest, RejectTransferRequest, useMarkCompletedTransfer, useRejectTransfer } from "../../api/transfer";
import { t } from "../../i18n";
import { applyServerErrors } from "../../lib/apply-server-errors";
import { DateTimeValue, IdValue, KeyValueRow, MoneyValue } from "../../lib/format";
import { zodResolver } from "@hookform/resolvers/zod";
import { Alert, Anchor, Badge, Breadcrumbs, Button, Card, Group, Skeleton, Stack, Text, TextInput, Title } from "@mantine/core";
import { modals } from "@mantine/modals";
import { notifications } from "@mantine/notifications";
import { useForm } from "react-hook-form";
import { useTransferById } from "../../api/transfer";
function openMarkCompletedModal(mut: ReturnType<typeof useMarkCompletedTransfer>): void {
  modals.open({
    title: t("page.Detail.modalTitle.lnw2dl", "Mark Completed"),
    children: <MarkCompletedForm mut={mut} onClose={() => modals.closeAll()} />,
  });
}

function MarkCompletedForm({ mut, onClose }: { mut: ReturnType<typeof useMarkCompletedTransfer>; onClose: () => void }) {
  const { handleSubmit, setError } = useForm<MarkCompletedTransferRequest>({
    resolver: zodResolver(MarkCompletedTransferRequest),
    defaultValues: {  },
  });
  return (
    <form
      data-testid="transfers-op-markCompleted-form"
      onSubmit={handleSubmit(async (vals) => {
        try {
          await mut.mutateAsync(vals);
          notifications.show({ color: "green", message: t("pack.mantine.operationSucceeded.tpnozz", "{operation} succeeded", { operation: "Mark Completed" }) });
          onClose();
        } catch (e) {
          const outcome = applyServerErrors({ error: e, setError, fieldMap: {} as const });
          if (outcome.kind === "global") {
            notifications.show({ color: "red", message: outcome.title });
          } else if (outcome.kind === "unhandled") {
            notifications.show({ color: "red", message: (e as Error).message });
          }
        }
      })}
    >
      <Stack>
        <Text c="dimmed">{t("pack.mantine.noParameters.usdpad", "This operation has no parameters.")}</Text>
        <Group justify="flex-end" gap="xs" mt="md">
          <Button variant="default" onClick={onClose}>{t("chrome.cancel", "Cancel")}</Button>
          <Button type="submit" loading={mut.isPending} data-testid="transfers-op-markCompleted-submit">Mark Completed</Button>
        </Group>
      </Stack>
    </form>
  );
}
function openRejectModal(mut: ReturnType<typeof useRejectTransfer>): void {
  modals.open({
    title: t("page.Detail.modalTitle.kej36u", "Reject"),
    children: <RejectForm mut={mut} onClose={() => modals.closeAll()} />,
  });
}

function RejectForm({ mut, onClose }: { mut: ReturnType<typeof useRejectTransfer>; onClose: () => void }) {
  const { register, handleSubmit, setError, formState: { errors } } = useForm<RejectTransferRequest>({
    resolver: zodResolver(RejectTransferRequest),
    defaultValues: { reason: "" },
  });
  return (
    <form
      data-testid="transfers-op-reject-form"
      onSubmit={handleSubmit(async (vals) => {
        try {
          await mut.mutateAsync(vals);
          notifications.show({ color: "green", message: t("pack.mantine.operationSucceeded.tpnozz", "{operation} succeeded", { operation: "Reject" }) });
          onClose();
        } catch (e) {
          const outcome = applyServerErrors({ error: e, setError, fieldMap: {} as const });
          if (outcome.kind === "global") {
            notifications.show({ color: "red", message: outcome.title });
          } else if (outcome.kind === "unhandled") {
            notifications.show({ color: "red", message: (e as Error).message });
          }
        }
      })}
    >
      <Stack>
        <TextInput label="Reason" {...register("reason")} data-testid="transfers-op-reject-input-reason" error={errors.reason?.message} />

        <Group justify="flex-end" gap="xs" mt="md">
          <Button variant="default" onClick={onClose}>{t("chrome.cancel", "Cancel")}</Button>
          <Button type="submit" loading={mut.isPending} data-testid="transfers-op-reject-submit">Reject</Button>
        </Group>
      </Stack>
    </form>
  );
}

export default function TransferDetail() {
  const { id } = useParams<{ id: string }>();
  const transferById = useTransferById(id);
  const markCompleted = useMarkCompletedTransfer(id ?? "");
  const reject = useRejectTransfer(id ?? "");
  return (
    <Stack gap="md" data-testid="transfers-detail">
      <Breadcrumbs>
        <Anchor component={RouterLink} to="/">{t("page.Detail.anchor.n0mxf2", "Home")}</Anchor>
        <Anchor component={RouterLink} to="/transfers">{t("page.Detail.anchor.oowe33", "Transfers")}</Anchor>
        <Text>{t("page.Detail.text.ei31dg", "Detail")}</Text>
      </Breadcrumbs>
      <Title order={2}>{t("page.Detail.heading.0jjvc3", "Transfer detail")}</Title>
      <>
        { transferById.isLoading && (
          <Stack gap="xs" aria-hidden="true">
    { Array.from({ length: 3 }).map((_, i) => (
    <Skeleton key={i} height={ 28 } radius="sm" />
    )) }
    </Stack>
        ) }
        { transferById.isError && (
          <Alert color="red" variant="light">{t("page.Detail.alert.ct3kx0", "Couldn't load transfer")}</Alert>
        ) }
        { !transferById.isLoading && !transferById.isError && !transferById.data && (
          <Alert color="yellow" variant="light">{t("page.Detail.alert.5qm7fg", "No transfer matches that id.")}</Alert>
        ) }
        { transferById.data && (
          <Stack gap="md">
            <Card withBorder padding="md">
              <Stack gap="md">
                <KeyValueRow label={t("page.Detail.keyValue.c7vrcq", "Reference")} data-testid="transfers-detail-reference"><Text>{transferById.data.reference}</Text></KeyValueRow>
                <KeyValueRow label={t("page.Detail.keyValue.r5qyuw", "Source")} data-testid="transfers-detail-source"><RouterLink to={`/accounts/${ transferById.data.source }`}><IdValue id={ transferById.data.source } /></RouterLink></KeyValueRow>
                <KeyValueRow label={t("page.Detail.keyValue.2ohkdk", "Target")} data-testid="transfers-detail-target"><RouterLink to={`/accounts/${ transferById.data.target }`}><IdValue id={ transferById.data.target } /></RouterLink></KeyValueRow>
                <KeyValueRow label={t("page.Detail.keyValue.a2ky21", "Amount")} data-testid="transfers-detail-amount"><MoneyValue value={ transferById.data.amount } /></KeyValueRow>
                <KeyValueRow label={t("page.Detail.keyValue.03pd73", "Status")} data-testid="transfers-detail-status"><Badge tt="none">{ transferById.data.status }</Badge></KeyValueRow>
                <KeyValueRow label={t("page.Detail.keyValue.xwf77s", "Requested By")} data-testid="transfers-detail-requestedBy"><Text>{transferById.data.requestedBy}</Text></KeyValueRow>
                <KeyValueRow label={t("page.Detail.keyValue.0y1dck", "Requested At")} data-testid="transfers-detail-requestedAt"><DateTimeValue iso={ transferById.data.requestedAt } /></KeyValueRow>
                <KeyValueRow label={t("page.Detail.keyValue.htnfcc", "Decided By")} data-testid="transfers-detail-decidedBy"><Text>{transferById.data.decidedBy}</Text></KeyValueRow>
                <KeyValueRow label={t("page.Detail.keyValue.q0zd4n", "Version")} data-testid="transfers-detail-version"><Text>{transferById.data.version}</Text></KeyValueRow>
              </Stack>
            </Card>
            <Group gap="xs">
              <Button variant="filled" onClick={() => openMarkCompletedModal(markCompleted)} data-testid="transfers-op-markCompleted">{t("page.Detail.button.lnw2dl", "Mark Completed")}</Button>
    
              <Button variant="light" onClick={() => openRejectModal(reject)} data-testid="transfers-op-reject">{t("page.Detail.button.kej36u", "Reject")}</Button>
    
            </Group>
          </Stack>
        ) }
      </>
    </Stack>
  );
}
