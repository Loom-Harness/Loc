// Auto-generated.  Do not edit by hand.
import { useParams, Link as RouterLink } from "react-router";
import { IssueInvoiceRequest, useIssueInvoice } from "../../api/invoice";
import { t } from "../../i18n";
import { applyServerErrors } from "../../lib/apply-server-errors";
import { DateTimeValue, IdValue, KeyValueRow, MoneyValue } from "../../lib/format";
import { zodResolver } from "@hookform/resolvers/zod";
import { Alert, Anchor, Breadcrumbs, Button, Card, Group, Skeleton, Stack, Text, Title } from "@mantine/core";
import { modals } from "@mantine/modals";
import { notifications } from "@mantine/notifications";
import { useForm } from "react-hook-form";
import { useInvoiceById } from "../../api/invoice";
function openIssueModal(mut: ReturnType<typeof useIssueInvoice>): void {
  modals.open({
    title: t("page.Detail.modalTitle.qn92w0", "Issue"),
    children: <IssueForm mut={mut} onClose={() => modals.closeAll()} />,
  });
}

function IssueForm({ mut, onClose }: { mut: ReturnType<typeof useIssueInvoice>; onClose: () => void }) {
  const { handleSubmit, setError } = useForm<IssueInvoiceRequest>({
    resolver: zodResolver(IssueInvoiceRequest),
    defaultValues: {  },
  });
  return (
    <form
      data-testid="invoices-op-issue-form"
      onSubmit={handleSubmit(async (vals) => {
        try {
          await mut.mutateAsync(vals);
          notifications.show({ color: "green", message: t("pack.mantine.operationSucceeded.tpnozz", "{operation} succeeded", { operation: "Issue" }) });
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
          <Button type="submit" loading={mut.isPending} data-testid="invoices-op-issue-submit">Issue</Button>
        </Group>
      </Stack>
    </form>
  );
}

export default function InvoiceDetail() {
  const { id } = useParams<{ id: string }>();
  const invoiceById = useInvoiceById(id);
  const issue = useIssueInvoice(id ?? "");
  return (
    <Stack gap="md" data-testid="invoices-detail">
      <Breadcrumbs>
        <Anchor component={RouterLink} to="/">{t("page.Detail.anchor.n0mxf2", "Home")}</Anchor>
        <Anchor component={RouterLink} to="/invoices">{t("page.Detail.anchor.7b7gu1", "Invoices")}</Anchor>
        <Text>{t("page.Detail.text.ei31dg", "Detail")}</Text>
      </Breadcrumbs>
      <Title order={2}>{t("page.Detail.heading.ow4h69", "Invoice detail")}</Title>
      <>
        { invoiceById.isLoading && (
          <Stack gap="xs" aria-hidden="true">
    { Array.from({ length: 3 }).map((_, i) => (
    <Skeleton key={i} height={ 28 } radius="sm" />
    )) }
    </Stack>
        ) }
        { invoiceById.isError && (
          <Alert color="red" variant="light">{t("page.Detail.alert.jf8yv2", "Couldn't load invoice")}</Alert>
        ) }
        { !invoiceById.isLoading && !invoiceById.isError && !invoiceById.data && (
          <Alert color="yellow" variant="light">{t("page.Detail.alert.crqrss", "No invoice matches that id.")}</Alert>
        ) }
        { invoiceById.data && (
          <Stack gap="md">
            <Card withBorder padding="md">
              <Stack gap="md">
                <KeyValueRow label={t("page.Detail.keyValue.cyjwdx", "Work Order Id")} data-testid="invoices-detail-workOrderId"><RouterLink to={`/work_orders/${ invoiceById.data.workOrderId }`}><IdValue id={ invoiceById.data.workOrderId } /></RouterLink></KeyValueRow>
                <KeyValueRow label={t("page.Detail.keyValue.hmhrht", "Issued At")} data-testid="invoices-detail-issuedAt"><DateTimeValue iso={ invoiceById.data.issuedAt } /></KeyValueRow>
                <KeyValueRow label={t("page.Detail.keyValue.a2ky21", "Amount")} data-testid="invoices-detail-amount"><MoneyValue value={ invoiceById.data.amount } /></KeyValueRow>
                <KeyValueRow label={t("page.Detail.keyValue.5o3zh2", "Currency")} data-testid="invoices-detail-currency"><Text>{invoiceById.data.currency}</Text></KeyValueRow>
                <KeyValueRow label={t("page.Detail.keyValue.1byjss", "Created At")} data-testid="invoices-detail-createdAt"><DateTimeValue iso={ invoiceById.data.createdAt } /></KeyValueRow>
                <KeyValueRow label={t("page.Detail.keyValue.wy0gb9", "Updated At")} data-testid="invoices-detail-updatedAt"><DateTimeValue iso={ invoiceById.data.updatedAt } /></KeyValueRow>
                <KeyValueRow label={t("page.Detail.keyValue.2q60rk", "Created By")} data-testid="invoices-detail-createdBy"><RouterLink to={`/users/${ invoiceById.data.createdBy }`}><IdValue id={ invoiceById.data.createdBy } /></RouterLink></KeyValueRow>
                <KeyValueRow label={t("page.Detail.keyValue.0yv6gt", "Updated By")} data-testid="invoices-detail-updatedBy"><RouterLink to={`/users/${ invoiceById.data.updatedBy }`}><IdValue id={ invoiceById.data.updatedBy } /></RouterLink></KeyValueRow>
                <KeyValueRow label={t("page.Detail.keyValue.q0zd4n", "Version")} data-testid="invoices-detail-version"><Text>{invoiceById.data.version}</Text></KeyValueRow>
              </Stack>
            </Card>
            <Group gap="xs">
              <Button variant="filled" onClick={() => openIssueModal(issue)} data-testid="invoices-op-issue">{t("page.Detail.button.qn92w0", "Issue")}</Button>
    
            </Group>
          </Stack>
        ) }
      </>
    </Stack>
  );
}
//# sourceMappingURL=detail.tsx.map
