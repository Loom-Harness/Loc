// Auto-generated.  Do not edit by hand.
import { useParams, Link as RouterLink } from "react-router";
import { useAllCustomers } from "../../api/customer";
import { IssueInvoiceRequest, UpdateInvoiceRequest, useIssueInvoice, useUpdateInvoice } from "../../api/invoice";
import { useAllWorkOrders } from "../../api/workOrder";
import { t } from "../../i18n";
import { applyServerErrors } from "../../lib/apply-server-errors";
import { DateTimeValue, IdValue, KeyValueRow } from "../../lib/format";
import { zodResolver } from "@hookform/resolvers/zod";
import { Alert, Anchor, Breadcrumbs, Button, Card, Group, NumberInput, Select, Skeleton, Stack, Switch, Text, TextInput, Title } from "@mantine/core";
import { modals } from "@mantine/modals";
import { notifications } from "@mantine/notifications";
import { Controller, useForm } from "react-hook-form";
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
function openUpdateModal(mut: ReturnType<typeof useUpdateInvoice>): void {
  modals.open({
    title: t("page.Detail.modalTitle.uk4kus", "Update"),
    children: <UpdateForm mut={mut} onClose={() => modals.closeAll()} />,
  });
}

function UpdateForm({ mut, onClose }: { mut: ReturnType<typeof useUpdateInvoice>; onClose: () => void }) {
  const __workOrders = useAllWorkOrders();
  const __customers = useAllCustomers();
  const { register, handleSubmit, setError, control, formState: { errors } } = useForm<UpdateInvoiceRequest>({
    resolver: zodResolver(UpdateInvoiceRequest),
    defaultValues: { workOrderId: "", customerId: "", currency: "", amount: 0, issued: false },
  });
  return (
    <form
      data-testid="invoices-op-update-form"
      onSubmit={handleSubmit(async (vals) => {
        try {
          await mut.mutateAsync(vals);
          notifications.show({ color: "green", message: t("pack.mantine.operationSucceeded.tpnozz", "{operation} succeeded", { operation: "Update" }) });
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
        <Controller
          control={control}
          name="workOrderId"
          render={({ field, fieldState }) => (
            <Select label="Work Order Id" data-testid="invoices-op-update-input-workOrderId" placeholder={t("chrome.selectPlaceholder", "Select…")} searchable data={(__workOrders.data?.items ?? []).map((__o) => ({ value: __o.id, label: __o.display }))} renderOption={({ option }) => <div data-testid={`invoices-op-update-input-workOrderId-option-${option.value}`}>{option.label}</div>} allowDeselect={false} value={field.value as string} onChange={(v) => field.onChange(v ?? "")} error={fieldState.error?.message} />
          )}
        />

        <Controller
          control={control}
          name="customerId"
          render={({ field, fieldState }) => (
            <Select label="Customer Id" data-testid="invoices-op-update-input-customerId" placeholder={t("chrome.selectPlaceholder", "Select…")} searchable data={(__customers.data?.items ?? []).map((__o) => ({ value: __o.id, label: __o.display }))} renderOption={({ option }) => <div data-testid={`invoices-op-update-input-customerId-option-${option.value}`}>{option.label}</div>} allowDeselect={false} value={field.value as string} onChange={(v) => field.onChange(v ?? "")} error={fieldState.error?.message} />
          )}
        />

        <TextInput label="Currency" {...register("currency")} data-testid="invoices-op-update-input-currency" error={errors.currency?.message} />

        <Controller
          control={control}
          name="amount"
          render={({ field, fieldState }) => (
            <NumberInput label="Amount" data-testid="invoices-op-update-input-amount" decimalScale={2} fixedDecimalScale value={field.value as number | "" | undefined} onChange={(v) => field.onChange(typeof v === "number" ? v : Number(v) || 0)} error={fieldState.error?.message} />
          )}
        />

        <Controller
          control={control}
          name="issued"
          render={({ field, fieldState }) => (
            <Switch label="Issued" data-testid="invoices-op-update-input-issued" checked={!!field.value} onChange={(e) => field.onChange(e.currentTarget.checked)} error={fieldState.error?.message} />
          )}
        />

        <Group justify="flex-end" gap="xs" mt="md">
          <Button variant="default" onClick={onClose}>{t("chrome.cancel", "Cancel")}</Button>
          <Button type="submit" loading={mut.isPending} data-testid="invoices-op-update-submit">Update</Button>
        </Group>
      </Stack>
    </form>
  );
}

export default function InvoiceDetail() {
  const { id } = useParams<{ id: string }>();
  const invoiceById = useInvoiceById(id);
  const issue = useIssueInvoice(id ?? "");
  const update = useUpdateInvoice(id ?? "");
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
                <KeyValueRow label={t("page.Detail.keyValue.0ysfxy", "Customer Id")} data-testid="invoices-detail-customerId"><RouterLink to={`/customers/${ invoiceById.data.customerId }`}><IdValue id={ invoiceById.data.customerId } /></RouterLink></KeyValueRow>
                <KeyValueRow label={t("page.Detail.keyValue.5o3zh2", "Currency")} data-testid="invoices-detail-currency"><Text>{invoiceById.data.currency}</Text></KeyValueRow>
                <KeyValueRow label={t("page.Detail.keyValue.a2ky21", "Amount")} data-testid="invoices-detail-amount"><Text>{invoiceById.data.amount}</Text></KeyValueRow>
                <KeyValueRow label={t("page.Detail.keyValue.d94nv0", "Issued")} data-testid="invoices-detail-issued"><Text>{(invoiceById.data.issued ? "Yes" : "No")}</Text></KeyValueRow>
                <KeyValueRow label={t("page.Detail.keyValue.1byjss", "Created At")} data-testid="invoices-detail-createdAt"><DateTimeValue iso={ invoiceById.data.createdAt } /></KeyValueRow>
                <KeyValueRow label={t("page.Detail.keyValue.wy0gb9", "Updated At")} data-testid="invoices-detail-updatedAt"><DateTimeValue iso={ invoiceById.data.updatedAt } /></KeyValueRow>
                <KeyValueRow label={t("page.Detail.keyValue.2q60rk", "Created By")} data-testid="invoices-detail-createdBy"><RouterLink to={`/users/${ invoiceById.data.createdBy }`}><IdValue id={ invoiceById.data.createdBy } /></RouterLink></KeyValueRow>
                <KeyValueRow label={t("page.Detail.keyValue.0yv6gt", "Updated By")} data-testid="invoices-detail-updatedBy"><RouterLink to={`/users/${ invoiceById.data.updatedBy }`}><IdValue id={ invoiceById.data.updatedBy } /></RouterLink></KeyValueRow>
                <KeyValueRow label={t("page.Detail.keyValue.q0zd4n", "Version")} data-testid="invoices-detail-version"><Text>{invoiceById.data.version}</Text></KeyValueRow>
              </Stack>
            </Card>
            <Group gap="xs">
              <Button variant="filled" onClick={() => openIssueModal(issue)} data-testid="invoices-op-issue">{t("page.Detail.button.qn92w0", "Issue")}</Button>
    
              <Button variant="light" onClick={() => openUpdateModal(update)} data-testid="invoices-op-update">{t("page.Detail.button.uk4kus", "Update")}</Button>
    
            </Group>
          </Stack>
        ) }
      </>
    </Stack>
  );
}
