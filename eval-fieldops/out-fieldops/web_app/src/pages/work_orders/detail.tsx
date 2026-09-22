// Auto-generated.  Do not edit by hand.
import Decimal from "decimal.js";
import { useParams, Link as RouterLink } from "react-router";
import { useAllTechnicians } from "../../api/technician";
import { AddLabourWorkOrderRequest, CancelWorkOrderRequest, CompleteWorkOrderRequest, ScheduleWorkOrderRequest, StartWorkOrderRequest, type AddLabourWorkOrderFormState, useAddLabourWorkOrder, useCancelWorkOrder, useCompleteWorkOrder, useScheduleWorkOrder, useStartWorkOrder } from "../../api/workOrder";
import { t } from "../../i18n";
import { applyServerErrors } from "../../lib/apply-server-errors";
import { DateTimeValue, IdValue, KeyValueRow, MoneyValue } from "../../lib/format";
import { zodResolver } from "@hookform/resolvers/zod";
import { Alert, Anchor, Badge, Breadcrumbs, Button, Card, Group, NumberInput, Select, Skeleton, Stack, Table, Text, TextInput, Title } from "@mantine/core";
import { modals } from "@mantine/modals";
import { notifications } from "@mantine/notifications";
import { Controller, useForm } from "react-hook-form";
import { useWorkOrderById } from "../../api/workOrder";
function openAddLabourModal(mut: ReturnType<typeof useAddLabourWorkOrder>): void {
  modals.open({
    title: t("page.Detail.modalTitle.idy0ib", "Add Labour"),
    children: <AddLabourForm mut={mut} onClose={() => modals.closeAll()} />,
  });
}

function AddLabourForm({ mut, onClose }: { mut: ReturnType<typeof useAddLabourWorkOrder>; onClose: () => void }) {
  const { register, handleSubmit, setError, control, formState: { errors } } = useForm<AddLabourWorkOrderFormState, unknown, AddLabourWorkOrderRequest>({
    resolver: zodResolver(AddLabourWorkOrderRequest),
    defaultValues: { description: "", hours: 0, rate: new Decimal("0"), lineCurrency: "" },
  });
  return (
    <form
      data-testid="work_orders-op-addLabour-form"
      onSubmit={handleSubmit(async (vals) => {
        try {
          await mut.mutateAsync(vals);
          notifications.show({ color: "green", message: t("pack.mantine.operationSucceeded.tpnozz", "{operation} succeeded", { operation: "Add Labour" }) });
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
        <TextInput label="Description" {...register("description")} data-testid="work_orders-op-addLabour-input-description" error={errors.description?.message} />

        <Controller
          control={control}
          name="hours"
          render={({ field, fieldState }) => (
            <NumberInput label="Hours" data-testid="work_orders-op-addLabour-input-hours" decimalScale={2} fixedDecimalScale value={field.value as number | "" | undefined} onChange={(v) => field.onChange(typeof v === "number" ? v : Number(v) || 0)} error={fieldState.error?.message} />
          )}
        />

        <Controller
          control={control}
          name="rate"
          render={({ field, fieldState }) => (
            <TextInput label="Rate" data-testid="work_orders-op-addLabour-input-rate" value={field.value instanceof Decimal ? field.value.toString() : String(field.value ?? "0")} onChange={(e) => { try { field.onChange(new Decimal(e.currentTarget.value || "0")); } catch { field.onChange(new Decimal("0")); } }} inputMode="decimal" error={fieldState.error?.message} />
          )}
        />

        <TextInput label="Line Currency" {...register("lineCurrency")} data-testid="work_orders-op-addLabour-input-lineCurrency" error={errors.lineCurrency?.message} />

        <Group justify="flex-end" gap="xs" mt="md">
          <Button variant="default" onClick={onClose}>{t("chrome.cancel", "Cancel")}</Button>
          <Button type="submit" loading={mut.isPending} data-testid="work_orders-op-addLabour-submit">Add Labour</Button>
        </Group>
      </Stack>
    </form>
  );
}
function openScheduleModal(mut: ReturnType<typeof useScheduleWorkOrder>): void {
  modals.open({
    title: t("page.Detail.modalTitle.9hwlpo", "Schedule"),
    children: <ScheduleForm mut={mut} onClose={() => modals.closeAll()} />,
  });
}

function ScheduleForm({ mut, onClose }: { mut: ReturnType<typeof useScheduleWorkOrder>; onClose: () => void }) {
  const __technicians = useAllTechnicians();
  const { register, handleSubmit, setError, control, formState: { errors } } = useForm<ScheduleWorkOrderRequest>({
    resolver: zodResolver(ScheduleWorkOrderRequest),
    defaultValues: { tech: "", at: "" },
  });
  return (
    <form
      data-testid="work_orders-op-schedule-form"
      onSubmit={handleSubmit(async (vals) => {
        try {
          await mut.mutateAsync(vals);
          notifications.show({ color: "green", message: t("pack.mantine.operationSucceeded.tpnozz", "{operation} succeeded", { operation: "Schedule" }) });
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
          name="tech"
          render={({ field, fieldState }) => (
            <Select label="Tech" data-testid="work_orders-op-schedule-input-tech" placeholder={t("chrome.selectPlaceholder", "Select…")} searchable data={(__technicians.data?.items ?? []).map((__o) => ({ value: __o.id, label: __o.display }))} renderOption={({ option }) => <div data-testid={`work_orders-op-schedule-input-tech-option-${option.value}`}>{option.label}</div>} allowDeselect={false} value={field.value as string} onChange={(v) => field.onChange(v ?? "")} error={fieldState.error?.message} />
          )}
        />

        <TextInput label="At" {...register("at")} data-testid="work_orders-op-schedule-input-at" type="datetime-local" error={errors.at?.message} />

        <Group justify="flex-end" gap="xs" mt="md">
          <Button variant="default" onClick={onClose}>{t("chrome.cancel", "Cancel")}</Button>
          <Button type="submit" loading={mut.isPending} data-testid="work_orders-op-schedule-submit">Schedule</Button>
        </Group>
      </Stack>
    </form>
  );
}
function openStartModal(mut: ReturnType<typeof useStartWorkOrder>): void {
  modals.open({
    title: t("page.Detail.modalTitle.30xvgf", "Start"),
    children: <StartForm mut={mut} onClose={() => modals.closeAll()} />,
  });
}

function StartForm({ mut, onClose }: { mut: ReturnType<typeof useStartWorkOrder>; onClose: () => void }) {
  const { handleSubmit, setError } = useForm<StartWorkOrderRequest>({
    resolver: zodResolver(StartWorkOrderRequest),
    defaultValues: {  },
  });
  return (
    <form
      data-testid="work_orders-op-start-form"
      onSubmit={handleSubmit(async (vals) => {
        try {
          await mut.mutateAsync(vals);
          notifications.show({ color: "green", message: t("pack.mantine.operationSucceeded.tpnozz", "{operation} succeeded", { operation: "Start" }) });
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
          <Button type="submit" loading={mut.isPending} data-testid="work_orders-op-start-submit">Start</Button>
        </Group>
      </Stack>
    </form>
  );
}
function openCompleteModal(mut: ReturnType<typeof useCompleteWorkOrder>): void {
  modals.open({
    title: t("page.Detail.modalTitle.rcgk2q", "Complete"),
    children: <CompleteForm mut={mut} onClose={() => modals.closeAll()} />,
  });
}

function CompleteForm({ mut, onClose }: { mut: ReturnType<typeof useCompleteWorkOrder>; onClose: () => void }) {
  const { register, handleSubmit, setError, formState: { errors } } = useForm<CompleteWorkOrderRequest>({
    resolver: zodResolver(CompleteWorkOrderRequest),
    defaultValues: { note: "" },
  });
  return (
    <form
      data-testid="work_orders-op-complete-form"
      onSubmit={handleSubmit(async (vals) => {
        try {
          await mut.mutateAsync(vals);
          notifications.show({ color: "green", message: t("pack.mantine.operationSucceeded.tpnozz", "{operation} succeeded", { operation: "Complete" }) });
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
        <TextInput label="Note" {...register("note")} data-testid="work_orders-op-complete-input-note" error={errors.note?.message} />

        <Group justify="flex-end" gap="xs" mt="md">
          <Button variant="default" onClick={onClose}>{t("chrome.cancel", "Cancel")}</Button>
          <Button type="submit" loading={mut.isPending} data-testid="work_orders-op-complete-submit">Complete</Button>
        </Group>
      </Stack>
    </form>
  );
}
function openCancelModal(mut: ReturnType<typeof useCancelWorkOrder>): void {
  modals.open({
    title: t("page.Detail.modalTitle.ew9em3", "Cancel"),
    children: <CancelForm mut={mut} onClose={() => modals.closeAll()} />,
  });
}

function CancelForm({ mut, onClose }: { mut: ReturnType<typeof useCancelWorkOrder>; onClose: () => void }) {
  const { register, handleSubmit, setError, formState: { errors } } = useForm<CancelWorkOrderRequest>({
    resolver: zodResolver(CancelWorkOrderRequest),
    defaultValues: { reason: "" },
  });
  return (
    <form
      data-testid="work_orders-op-cancel-form"
      onSubmit={handleSubmit(async (vals) => {
        try {
          await mut.mutateAsync(vals);
          notifications.show({ color: "green", message: t("pack.mantine.operationSucceeded.tpnozz", "{operation} succeeded", { operation: "Cancel" }) });
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
        <TextInput label="Reason" {...register("reason")} data-testid="work_orders-op-cancel-input-reason" error={errors.reason?.message} />

        <Group justify="flex-end" gap="xs" mt="md">
          <Button variant="default" onClick={onClose}>{t("chrome.cancel", "Cancel")}</Button>
          <Button type="submit" loading={mut.isPending} data-testid="work_orders-op-cancel-submit">Cancel</Button>
        </Group>
      </Stack>
    </form>
  );
}

export default function WorkOrderDetail() {
  const { id } = useParams<{ id: string }>();
  const workOrderById = useWorkOrderById(id);
  const addLabour = useAddLabourWorkOrder(id ?? "");
  const schedule = useScheduleWorkOrder(id ?? "");
  const start = useStartWorkOrder(id ?? "");
  const complete = useCompleteWorkOrder(id ?? "");
  const cancel = useCancelWorkOrder(id ?? "");
  return (
    <Stack gap="md" data-testid="work_orders-detail">
      <Breadcrumbs>
        <Anchor component={RouterLink} to="/">{t("page.Detail.anchor.n0mxf2", "Home")}</Anchor>
        <Anchor component={RouterLink} to="/work_orders">{t("page.Detail.anchor.dodp9t", "Work Orders")}</Anchor>
        <Text>{t("page.Detail.text.ei31dg", "Detail")}</Text>
      </Breadcrumbs>
      <Title order={2}>{t("page.Detail.heading.c1hap5", "Work Order detail")}</Title>
      <>
        { workOrderById.isLoading && (
          <Stack gap="xs" aria-hidden="true">
    { Array.from({ length: 3 }).map((_, i) => (
    <Skeleton key={i} height={ 28 } radius="sm" />
    )) }
    </Stack>
        ) }
        { workOrderById.isError && (
          <Alert color="red" variant="light">{t("page.Detail.alert.npol6e", "Couldn't load work order")}</Alert>
        ) }
        { !workOrderById.isLoading && !workOrderById.isError && !workOrderById.data && (
          <Alert color="yellow" variant="light">{t("page.Detail.alert.s3zqiy", "No work order matches that id.")}</Alert>
        ) }
        { workOrderById.data && (
          <Stack gap="md">
            <Card withBorder padding="md">
              <Stack gap="md">
                <KeyValueRow label={t("page.Detail.keyValue.0ysfxy", "Customer Id")} data-testid="work_orders-detail-customerId"><RouterLink to={`/customers/${ workOrderById.data.customerId }`}><IdValue id={ workOrderById.data.customerId } /></RouterLink></KeyValueRow>
                <KeyValueRow label={t("page.Detail.keyValue.q4n5gn", "Site Id")} data-testid="work_orders-detail-siteId"><RouterLink to={`/sites/${ workOrderById.data.siteId }`}><IdValue id={ workOrderById.data.siteId } /></RouterLink></KeyValueRow>
                <KeyValueRow label={t("page.Detail.keyValue.fxygok", "Asset Id")} data-testid="work_orders-detail-assetId">{workOrderById.data.assetId ? (
                      <RouterLink to={`/assets/${ workOrderById.data.assetId }`}><IdValue id={ workOrderById.data.assetId } /></RouterLink>
                    ) : (
                      <span>—</span>
                    )}</KeyValueRow>
                <KeyValueRow label={t("page.Detail.keyValue.ppl8uc", "Technician Id")} data-testid="work_orders-detail-technicianId">{workOrderById.data.technicianId ? (
                      <RouterLink to={`/technicians/${ workOrderById.data.technicianId }`}><IdValue id={ workOrderById.data.technicianId } /></RouterLink>
                    ) : (
                      <span>—</span>
                    )}</KeyValueRow>
                <KeyValueRow label={t("page.Detail.keyValue.ctm2gn", "Technician User Id")} data-testid="work_orders-detail-technicianUserId"><Text>{workOrderById.data.technicianUserId}</Text></KeyValueRow>
                <KeyValueRow label={t("page.Detail.keyValue.03pd73", "Status")} data-testid="work_orders-detail-status"><Badge tt="none">{ workOrderById.data.status }</Badge></KeyValueRow>
                <KeyValueRow label={t("page.Detail.keyValue.ryxjjd", "Priority")} data-testid="work_orders-detail-priority"><Badge tt="none">{ workOrderById.data.priority }</Badge></KeyValueRow>
                <KeyValueRow label={t("page.Detail.keyValue.5o3zh2", "Currency")} data-testid="work_orders-detail-currency"><Text>{workOrderById.data.currency}</Text></KeyValueRow>
                <KeyValueRow label={t("page.Detail.keyValue.qg7sx9", "Scheduled At")} data-testid="work_orders-detail-scheduledAt"><DateTimeValue iso={ workOrderById.data.scheduledAt } /></KeyValueRow>
                <KeyValueRow label={t("page.Detail.keyValue.r4aslr", "Started At")} data-testid="work_orders-detail-startedAt"><DateTimeValue iso={ workOrderById.data.startedAt } /></KeyValueRow>
                <KeyValueRow label={t("page.Detail.keyValue.b280cz", "Completed At")} data-testid="work_orders-detail-completedAt"><DateTimeValue iso={ workOrderById.data.completedAt } /></KeyValueRow>
                <KeyValueRow label={t("page.Detail.keyValue.q0z6ut", "Resolution Note")} data-testid="work_orders-detail-resolutionNote"><Text>{workOrderById.data.resolutionNote}</Text></KeyValueRow>
                <KeyValueRow label={t("page.Detail.keyValue.n2dhtv", "Photo")} data-testid="work_orders-detail-photo">{workOrderById.data.photo ? (
                      <a href={workOrderById.data.photo?.url} download>{workOrderById.data.photo?.key}</a>
                    ) : (
                      <span>—</span>
                    )}</KeyValueRow>
                <KeyValueRow label={t("page.Detail.keyValue.1byjss", "Created At")} data-testid="work_orders-detail-createdAt"><DateTimeValue iso={ workOrderById.data.createdAt } /></KeyValueRow>
                <KeyValueRow label={t("page.Detail.keyValue.wy0gb9", "Updated At")} data-testid="work_orders-detail-updatedAt"><DateTimeValue iso={ workOrderById.data.updatedAt } /></KeyValueRow>
                <KeyValueRow label={t("page.Detail.keyValue.2q60rk", "Created By")} data-testid="work_orders-detail-createdBy"><RouterLink to={`/users/${ workOrderById.data.createdBy }`}><IdValue id={ workOrderById.data.createdBy } /></RouterLink></KeyValueRow>
                <KeyValueRow label={t("page.Detail.keyValue.0yv6gt", "Updated By")} data-testid="work_orders-detail-updatedBy"><RouterLink to={`/users/${ workOrderById.data.updatedBy }`}><IdValue id={ workOrderById.data.updatedBy } /></RouterLink></KeyValueRow>
                <KeyValueRow label={t("page.Detail.keyValue.q0zd4n", "Version")} data-testid="work_orders-detail-version"><Text>{workOrderById.data.version}</Text></KeyValueRow>
              </Stack>
            </Card>
            <Card withBorder padding="md" data-testid="work_orders-detail-lines">
              <Stack gap="md">
                <Title order={4}>{t("page.Detail.heading.2bghr0", "Lines")}</Title>
                <div className="loom-table-scroll" style={{ width: "100%", overflowX: "auto" }}><Table striped highlightOnHover>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>{t("page.Detail.columnHeader.sjj37t", "Description")}</Table.Th>
                      <Table.Th>{t("page.Detail.columnHeader.c75rso", "Quantity")}</Table.Th>
                      <Table.Th>{t("page.Detail.columnHeader.ha4he2", "Unit Price")}</Table.Th>
                      <Table.Th>{t("page.Detail.columnHeader.5o3zh2", "Currency")}</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    { workOrderById.data.lines.map((row, idx) => (
                      <Table.Tr key={ idx }>
                        <Table.Td><Text>{row.description}</Text></Table.Td>
                        <Table.Td><Text>{row.quantity}</Text></Table.Td>
                        <Table.Td><MoneyValue value={ row.unitPrice } /></Table.Td>
                        <Table.Td><Text>{row.currency}</Text></Table.Td>
                      </Table.Tr>
                    )) }
                  </Table.Tbody>
                </Table></div>
              </Stack>
            </Card>
            <Group gap="xs">
              <Button variant="filled" onClick={() => openAddLabourModal(addLabour)} data-testid="work_orders-op-addLabour">{t("page.Detail.button.idy0ib", "Add Labour")}</Button>
    
              <Button variant="light" onClick={() => openScheduleModal(schedule)} data-testid="work_orders-op-schedule">{t("page.Detail.button.9hwlpo", "Schedule")}</Button>
    
              <Button variant="light" onClick={() => openStartModal(start)} data-testid="work_orders-op-start">{t("page.Detail.button.30xvgf", "Start")}</Button>
    
              <Button variant="light" onClick={() => openCompleteModal(complete)} data-testid="work_orders-op-complete">{t("page.Detail.button.rcgk2q", "Complete")}</Button>
    
              <Button variant="light" onClick={() => openCancelModal(cancel)} data-testid="work_orders-op-cancel">{t("page.Detail.button.ew9em3", "Cancel")}</Button>
    
            </Group>
          </Stack>
        ) }
      </>
    </Stack>
  );
}
//# sourceMappingURL=detail.tsx.map
