// Auto-generated.  Do not edit by hand.
import { useParams, Link as RouterLink } from "react-router";
import { useAllAssets } from "../../api/asset";
import { api } from "../../api/client";
import { useAllCustomers } from "../../api/customer";
import { useAllParts } from "../../api/part";
import { useAllSites } from "../../api/site";
import { useAllTechnicians } from "../../api/technician";
import { AddLineWorkOrderRequest, AssignTechnicianWorkOrderRequest, AttachPhotoWorkOrderRequest, CancelWorkOrderRequest, CompleteWorkOrderRequest, NotifyCustomerWorkOrderRequest, StartWorkOrderRequest, UpdateWorkOrderRequest, useAddLineWorkOrder, useAssignTechnicianWorkOrder, useAttachPhotoWorkOrder, useCancelWorkOrder, useCompleteWorkOrder, useNotifyCustomerWorkOrder, useStartWorkOrder, useUpdateWorkOrder } from "../../api/workOrder";
import { t } from "../../i18n";
import { applyServerErrors } from "../../lib/apply-server-errors";
import { DateTimeValue, IdValue, KeyValueRow } from "../../lib/format";
import { zodResolver } from "@hookform/resolvers/zod";
import { Alert, Anchor, Badge, Breadcrumbs, Button, Card, Fieldset, FileInput, Group, NumberInput, Select, Skeleton, Stack, Table, Text, TextInput, Title } from "@mantine/core";
import { modals } from "@mantine/modals";
import { notifications } from "@mantine/notifications";
import { Controller, useForm } from "react-hook-form";
import { useWorkOrderById } from "../../api/workOrder";
function openAssignTechnicianModal(mut: ReturnType<typeof useAssignTechnicianWorkOrder>): void {
  modals.open({
    title: t("page.Detail.modalTitle.16jndm", "Assign Technician"),
    children: <AssignTechnicianForm mut={mut} onClose={() => modals.closeAll()} />,
  });
}

function AssignTechnicianForm({ mut, onClose }: { mut: ReturnType<typeof useAssignTechnicianWorkOrder>; onClose: () => void }) {
  const __technicians = useAllTechnicians();
  const { register, handleSubmit, setError, control, formState: { errors } } = useForm<AssignTechnicianWorkOrderRequest>({
    resolver: zodResolver(AssignTechnicianWorkOrderRequest),
    defaultValues: { assignTo: "", assignedUserId: "", at: "" },
  });
  return (
    <form
      data-testid="work_orders-op-assignTechnician-form"
      onSubmit={handleSubmit(async (vals) => {
        try {
          await mut.mutateAsync(vals);
          notifications.show({ color: "green", message: t("pack.mantine.operationSucceeded.tpnozz", "{operation} succeeded", { operation: "Assign Technician" }) });
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
          name="assignTo"
          render={({ field, fieldState }) => (
            <Select label="Assign To" data-testid="work_orders-op-assignTechnician-input-assignTo" placeholder={t("chrome.selectPlaceholder", "Select…")} searchable data={(__technicians.data?.items ?? []).map((__o) => ({ value: __o.id, label: __o.display }))} renderOption={({ option }) => <div data-testid={`work_orders-op-assignTechnician-input-assignTo-option-${option.value}`}>{option.label}</div>} allowDeselect={false} value={field.value as string} onChange={(v) => field.onChange(v ?? "")} error={fieldState.error?.message} />
          )}
        />

        <TextInput label="Assigned User Id" {...register("assignedUserId")} data-testid="work_orders-op-assignTechnician-input-assignedUserId" error={errors.assignedUserId?.message} />

        <TextInput label="At" {...register("at")} data-testid="work_orders-op-assignTechnician-input-at" type="datetime-local" error={errors.at?.message} />

        <Group justify="flex-end" gap="xs" mt="md">
          <Button variant="default" onClick={onClose}>{t("chrome.cancel", "Cancel")}</Button>
          <Button type="submit" loading={mut.isPending} data-testid="work_orders-op-assignTechnician-submit">Assign Technician</Button>
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
function openAddLineModal(mut: ReturnType<typeof useAddLineWorkOrder>): void {
  modals.open({
    title: t("page.Detail.modalTitle.uhabr2", "Add Line"),
    children: <AddLineForm mut={mut} onClose={() => modals.closeAll()} />,
  });
}

function AddLineForm({ mut, onClose }: { mut: ReturnType<typeof useAddLineWorkOrder>; onClose: () => void }) {
  const __parts = useAllParts();
  const { register, handleSubmit, setError, control, formState: { errors } } = useForm<AddLineWorkOrderRequest>({
    resolver: zodResolver(AddLineWorkOrderRequest),
    defaultValues: { kind: "Labour", description: "", partId: "", quantity: 0, unitPrice: { amount: 0, currency: "" } },
  });
  return (
    <form
      data-testid="work_orders-op-addLine-form"
      onSubmit={handleSubmit(async (vals) => {
        try {
          await mut.mutateAsync(vals);
          notifications.show({ color: "green", message: t("pack.mantine.operationSucceeded.tpnozz", "{operation} succeeded", { operation: "Add Line" }) });
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
          name="kind"
          render={({ field, fieldState }) => (
            <Select label="Kind" data-testid="work_orders-op-addLine-input-kind" data={ ["Labour","Parts"] } allowDeselect={false} value={field.value as string} onChange={(v) => field.onChange(v)} error={fieldState.error?.message} />
          )}
        />

        <TextInput label="Description" {...register("description")} data-testid="work_orders-op-addLine-input-description" error={errors.description?.message} />

        <Controller
          control={control}
          name="partId"
          render={({ field, fieldState }) => (
            <Select label="Part Id" data-testid="work_orders-op-addLine-input-partId" placeholder={t("chrome.selectPlaceholder", "Select…")} searchable data={(__parts.data?.items ?? []).map((__o) => ({ value: __o.id, label: __o.display }))} renderOption={({ option }) => <div data-testid={`work_orders-op-addLine-input-partId-option-${option.value}`}>{option.label}</div>} allowDeselect={false} value={field.value as string} onChange={(v) => field.onChange(v ?? "")} error={fieldState.error?.message} />
          )}
        />

        <Controller
          control={control}
          name="quantity"
          render={({ field, fieldState }) => (
            <NumberInput label="Quantity" data-testid="work_orders-op-addLine-input-quantity" allowDecimal={false} value={field.value as number | "" | undefined} onChange={(v) => field.onChange(typeof v === "number" ? v : Number(v) || 0)} error={fieldState.error?.message} />
          )}
        />

        <Fieldset legend="Unit Price" variant="filled" radius="md" data-testid="work_orders-op-addLine-input-unitPrice">
          <Stack gap="sm">
            <Controller
          control={control}
          name="unitPrice.amount"
          render={({ field, fieldState }) => (
            <NumberInput label="Amount" data-testid="work_orders-op-addLine-input-unitPrice-amount" decimalScale={2} fixedDecimalScale value={field.value as number | "" | undefined} onChange={(v) => field.onChange(typeof v === "number" ? v : Number(v) || 0)} error={fieldState.error?.message} />
          )}
        />

<TextInput label="Currency" {...register("unitPrice.currency")} data-testid="work_orders-op-addLine-input-unitPrice-currency" error={errors.unitPrice?.currency?.message} />

          </Stack>
        </Fieldset>

        <Group justify="flex-end" gap="xs" mt="md">
          <Button variant="default" onClick={onClose}>{t("chrome.cancel", "Cancel")}</Button>
          <Button type="submit" loading={mut.isPending} data-testid="work_orders-op-addLine-submit">Add Line</Button>
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
  const { handleSubmit, setError } = useForm<CancelWorkOrderRequest>({
    resolver: zodResolver(CancelWorkOrderRequest),
    defaultValues: {  },
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
        <Text c="dimmed">{t("pack.mantine.noParameters.usdpad", "This operation has no parameters.")}</Text>
        <Group justify="flex-end" gap="xs" mt="md">
          <Button variant="default" onClick={onClose}>{t("chrome.cancel", "Cancel")}</Button>
          <Button type="submit" loading={mut.isPending} data-testid="work_orders-op-cancel-submit">Cancel</Button>
        </Group>
      </Stack>
    </form>
  );
}
function openNotifyCustomerModal(mut: ReturnType<typeof useNotifyCustomerWorkOrder>): void {
  modals.open({
    title: t("page.Detail.modalTitle.07hxk4", "Notify Customer"),
    children: <NotifyCustomerForm mut={mut} onClose={() => modals.closeAll()} />,
  });
}

function NotifyCustomerForm({ mut, onClose }: { mut: ReturnType<typeof useNotifyCustomerWorkOrder>; onClose: () => void }) {
  const { handleSubmit, setError } = useForm<NotifyCustomerWorkOrderRequest>({
    resolver: zodResolver(NotifyCustomerWorkOrderRequest),
    defaultValues: {  },
  });
  return (
    <form
      data-testid="work_orders-op-notifyCustomer-form"
      onSubmit={handleSubmit(async (vals) => {
        try {
          await mut.mutateAsync(vals);
          notifications.show({ color: "green", message: t("pack.mantine.operationSucceeded.tpnozz", "{operation} succeeded", { operation: "Notify Customer" }) });
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
          <Button type="submit" loading={mut.isPending} data-testid="work_orders-op-notifyCustomer-submit">Notify Customer</Button>
        </Group>
      </Stack>
    </form>
  );
}
function openAttachPhotoModal(mut: ReturnType<typeof useAttachPhotoWorkOrder>): void {
  modals.open({
    title: t("page.Detail.modalTitle.vawlvk", "Attach Photo"),
    children: <AttachPhotoForm mut={mut} onClose={() => modals.closeAll()} />,
  });
}

function AttachPhotoForm({ mut, onClose }: { mut: ReturnType<typeof useAttachPhotoWorkOrder>; onClose: () => void }) {
  const { register, handleSubmit, setError, control, formState: { errors } } = useForm<AttachPhotoWorkOrderRequest>({
    resolver: zodResolver(AttachPhotoWorkOrderRequest),
    defaultValues: { file: null, caption: "" },
  });
  return (
    <form
      data-testid="work_orders-op-attachPhoto-form"
      onSubmit={handleSubmit(async (vals) => {
        try {
          await mut.mutateAsync(vals);
          notifications.show({ color: "green", message: t("pack.mantine.operationSucceeded.tpnozz", "{operation} succeeded", { operation: "Attach Photo" }) });
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
          name="file"
          render={({ field, fieldState }) => (
            <FileInput label="File" data-testid="work_orders-op-attachPhoto-input-file" clearable placeholder={field.value?.key ?? t("pack.mantine.chooseFile.ymjjdi", "Choose file")} onChange={async (f) => { if (!f) { field.onChange(null); return; } const fd = new FormData(); fd.append("file", f); field.onChange(await api.upload("/files", fd)); }} error={fieldState.error?.message} />
          )}
        />

        <TextInput label="Caption" {...register("caption")} data-testid="work_orders-op-attachPhoto-input-caption" error={errors.caption?.message} />

        <Group justify="flex-end" gap="xs" mt="md">
          <Button variant="default" onClick={onClose}>{t("chrome.cancel", "Cancel")}</Button>
          <Button type="submit" loading={mut.isPending} data-testid="work_orders-op-attachPhoto-submit">Attach Photo</Button>
        </Group>
      </Stack>
    </form>
  );
}
function openUpdateModal(mut: ReturnType<typeof useUpdateWorkOrder>): void {
  modals.open({
    title: t("page.Detail.modalTitle.uk4kus", "Update"),
    children: <UpdateForm mut={mut} onClose={() => modals.closeAll()} />,
  });
}

function UpdateForm({ mut, onClose }: { mut: ReturnType<typeof useUpdateWorkOrder>; onClose: () => void }) {
  const __customers = useAllCustomers();
  const __sites = useAllSites();
  const __assets = useAllAssets();
  const __technicians = useAllTechnicians();
  const { register, handleSubmit, setError, control, formState: { errors } } = useForm<UpdateWorkOrderRequest>({
    resolver: zodResolver(UpdateWorkOrderRequest),
    defaultValues: { customerId: "", siteId: "", assetId: "", technicianId: "", technicianUserId: "", status: "Draft", priority: "Low", currency: "", scheduledAt: "", startedAt: "", completedAt: "", resolutionNote: "" },
  });
  return (
    <form
      data-testid="work_orders-op-update-form"
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
          name="customerId"
          render={({ field, fieldState }) => (
            <Select label="Customer Id" data-testid="work_orders-op-update-input-customerId" placeholder={t("chrome.selectPlaceholder", "Select…")} searchable data={(__customers.data?.items ?? []).map((__o) => ({ value: __o.id, label: __o.display }))} renderOption={({ option }) => <div data-testid={`work_orders-op-update-input-customerId-option-${option.value}`}>{option.label}</div>} allowDeselect={false} value={field.value as string} onChange={(v) => field.onChange(v ?? "")} error={fieldState.error?.message} />
          )}
        />

        <Controller
          control={control}
          name="siteId"
          render={({ field, fieldState }) => (
            <Select label="Site Id" data-testid="work_orders-op-update-input-siteId" placeholder={t("chrome.selectPlaceholder", "Select…")} searchable data={(__sites.data?.items ?? []).map((__o) => ({ value: __o.id, label: __o.display }))} renderOption={({ option }) => <div data-testid={`work_orders-op-update-input-siteId-option-${option.value}`}>{option.label}</div>} allowDeselect={false} value={field.value as string} onChange={(v) => field.onChange(v ?? "")} error={fieldState.error?.message} />
          )}
        />

        <Controller
          control={control}
          name="assetId"
          render={({ field, fieldState }) => (
            <Select label="Asset Id" data-testid="work_orders-op-update-input-assetId" placeholder={t("chrome.selectPlaceholder", "Select…")} searchable data={(__assets.data?.items ?? []).map((__o) => ({ value: __o.id, label: __o.display }))} renderOption={({ option }) => <div data-testid={`work_orders-op-update-input-assetId-option-${option.value}`}>{option.label}</div>} allowDeselect={false} value={field.value as string} onChange={(v) => field.onChange(v ?? "")} error={fieldState.error?.message} />
          )}
        />

        <Controller
          control={control}
          name="technicianId"
          render={({ field, fieldState }) => (
            <Select label="Technician Id" data-testid="work_orders-op-update-input-technicianId" placeholder={t("chrome.selectPlaceholder", "Select…")} searchable data={(__technicians.data?.items ?? []).map((__o) => ({ value: __o.id, label: __o.display }))} renderOption={({ option }) => <div data-testid={`work_orders-op-update-input-technicianId-option-${option.value}`}>{option.label}</div>} allowDeselect={false} value={field.value as string} onChange={(v) => field.onChange(v ?? "")} error={fieldState.error?.message} />
          )}
        />

        <TextInput label="Technician User Id" {...register("technicianUserId")} data-testid="work_orders-op-update-input-technicianUserId" error={errors.technicianUserId?.message} />

        <Controller
          control={control}
          name="status"
          render={({ field, fieldState }) => (
            <Select label="Status" data-testid="work_orders-op-update-input-status" data={ ["Draft","Scheduled","InProgress","Completed","Cancelled"] } allowDeselect={false} value={field.value as string} onChange={(v) => field.onChange(v)} error={fieldState.error?.message} />
          )}
        />

        <Controller
          control={control}
          name="priority"
          render={({ field, fieldState }) => (
            <Select label="Priority" data-testid="work_orders-op-update-input-priority" data={ ["Low","Normal","High","Urgent"] } allowDeselect={false} value={field.value as string} onChange={(v) => field.onChange(v)} error={fieldState.error?.message} />
          )}
        />

        <TextInput label="Currency" {...register("currency")} data-testid="work_orders-op-update-input-currency" error={errors.currency?.message} />

        <TextInput label="Scheduled At" {...register("scheduledAt")} data-testid="work_orders-op-update-input-scheduledAt" type="datetime-local" error={errors.scheduledAt?.message} />

        <TextInput label="Started At" {...register("startedAt")} data-testid="work_orders-op-update-input-startedAt" type="datetime-local" error={errors.startedAt?.message} />

        <TextInput label="Completed At" {...register("completedAt")} data-testid="work_orders-op-update-input-completedAt" type="datetime-local" error={errors.completedAt?.message} />

        <TextInput label="Resolution Note" {...register("resolutionNote")} data-testid="work_orders-op-update-input-resolutionNote" error={errors.resolutionNote?.message} />

        <Group justify="flex-end" gap="xs" mt="md">
          <Button variant="default" onClick={onClose}>{t("chrome.cancel", "Cancel")}</Button>
          <Button type="submit" loading={mut.isPending} data-testid="work_orders-op-update-submit">Update</Button>
        </Group>
      </Stack>
    </form>
  );
}

export default function WorkOrderDetail() {
  const { id } = useParams<{ id: string }>();
  const workOrderById = useWorkOrderById(id);
  const assignTechnician = useAssignTechnicianWorkOrder(id ?? "");
  const start = useStartWorkOrder(id ?? "");
  const addLine = useAddLineWorkOrder(id ?? "");
  const complete = useCompleteWorkOrder(id ?? "");
  const cancel = useCancelWorkOrder(id ?? "");
  const notifyCustomer = useNotifyCustomerWorkOrder(id ?? "");
  const attachPhoto = useAttachPhotoWorkOrder(id ?? "");
  const update = useUpdateWorkOrder(id ?? "");
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
                <KeyValueRow label={t("page.Detail.keyValue.fxygok", "Asset Id")} data-testid="work_orders-detail-assetId"><RouterLink to={`/assets/${ workOrderById.data.assetId }`}><IdValue id={ workOrderById.data.assetId } /></RouterLink></KeyValueRow>
                <KeyValueRow label={t("page.Detail.keyValue.ppl8uc", "Technician Id")} data-testid="work_orders-detail-technicianId"><RouterLink to={`/technicians/${ workOrderById.data.technicianId }`}><IdValue id={ workOrderById.data.technicianId } /></RouterLink></KeyValueRow>
                <KeyValueRow label={t("page.Detail.keyValue.ctm2gn", "Technician User Id")} data-testid="work_orders-detail-technicianUserId"><Text>{workOrderById.data.technicianUserId}</Text></KeyValueRow>
                <KeyValueRow label={t("page.Detail.keyValue.03pd73", "Status")} data-testid="work_orders-detail-status"><Badge tt="none">{ workOrderById.data.status }</Badge></KeyValueRow>
                <KeyValueRow label={t("page.Detail.keyValue.ryxjjd", "Priority")} data-testid="work_orders-detail-priority"><Badge tt="none">{ workOrderById.data.priority }</Badge></KeyValueRow>
                <KeyValueRow label={t("page.Detail.keyValue.5o3zh2", "Currency")} data-testid="work_orders-detail-currency"><Text>{workOrderById.data.currency}</Text></KeyValueRow>
                <KeyValueRow label={t("page.Detail.keyValue.qg7sx9", "Scheduled At")} data-testid="work_orders-detail-scheduledAt"><DateTimeValue iso={ workOrderById.data.scheduledAt } /></KeyValueRow>
                <KeyValueRow label={t("page.Detail.keyValue.r4aslr", "Started At")} data-testid="work_orders-detail-startedAt"><DateTimeValue iso={ workOrderById.data.startedAt } /></KeyValueRow>
                <KeyValueRow label={t("page.Detail.keyValue.b280cz", "Completed At")} data-testid="work_orders-detail-completedAt"><DateTimeValue iso={ workOrderById.data.completedAt } /></KeyValueRow>
                <KeyValueRow label={t("page.Detail.keyValue.q0z6ut", "Resolution Note")} data-testid="work_orders-detail-resolutionNote"><Text>{workOrderById.data.resolutionNote}</Text></KeyValueRow>
                <KeyValueRow label={t("page.Detail.keyValue.q0zd4n", "Version")} data-testid="work_orders-detail-version"><Text>{workOrderById.data.version}</Text></KeyValueRow>
              </Stack>
            </Card>
            <Card withBorder padding="md" data-testid="work_orders-detail-lines">
              <Stack gap="md">
                <Title order={4}>{t("page.Detail.heading.2bghr0", "Lines")}</Title>
                <div className="loom-table-scroll" style={{ width: "100%", overflowX: "auto" }}><Table striped highlightOnHover>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>{t("page.Detail.columnHeader.hqumoz", "Kind")}</Table.Th>
                      <Table.Th>{t("page.Detail.columnHeader.sjj37t", "Description")}</Table.Th>
                      <Table.Th>{t("page.Detail.columnHeader.nhh1zl", "Part Id")}</Table.Th>
                      <Table.Th>{t("page.Detail.columnHeader.c75rso", "Quantity")}</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    { workOrderById.data.lines.map((row, idx) => (
                      <Table.Tr key={ idx }>
                        <Table.Td><Badge tt="none">{ row.kind }</Badge></Table.Td>
                        <Table.Td><Text>{row.description}</Text></Table.Td>
                        <Table.Td><RouterLink to={`/parts/${ row.partId }`}><IdValue id={ row.partId } /></RouterLink></Table.Td>
                        <Table.Td><Text>{row.quantity}</Text></Table.Td>
                      </Table.Tr>
                    )) }
                  </Table.Tbody>
                </Table></div>
              </Stack>
            </Card>
            <Card withBorder padding="md" data-testid="work_orders-detail-photos">
              <Stack gap="md">
                <Title order={4}>{t("page.Detail.heading.l4mw9c", "Photos")}</Title>
                <div className="loom-table-scroll" style={{ width: "100%", overflowX: "auto" }}><Table striped highlightOnHover>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>{t("page.Detail.columnHeader.bygjtv", "File")}</Table.Th>
                      <Table.Th>{t("page.Detail.columnHeader.8szg1x", "Caption")}</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    { workOrderById.data.photos.map((row, idx) => (
                      <Table.Tr key={ idx }>
                        <Table.Td>{row.file ? (
                        <a href={row.file?.url} download>{row.file?.key}</a>
                      ) : (
                        <span>—</span>
                      )}</Table.Td>
                        <Table.Td><Text>{row.caption}</Text></Table.Td>
                      </Table.Tr>
                    )) }
                  </Table.Tbody>
                </Table></div>
              </Stack>
            </Card>
            <Group gap="xs">
              <Button variant="filled" onClick={() => openAssignTechnicianModal(assignTechnician)} data-testid="work_orders-op-assignTechnician">{t("page.Detail.button.16jndm", "Assign Technician")}</Button>
    
              <Button variant="light" onClick={() => openStartModal(start)} data-testid="work_orders-op-start">{t("page.Detail.button.30xvgf", "Start")}</Button>
    
              <Button variant="light" onClick={() => openAddLineModal(addLine)} data-testid="work_orders-op-addLine">{t("page.Detail.button.uhabr2", "Add Line")}</Button>
    
              <Button variant="light" onClick={() => openCompleteModal(complete)} data-testid="work_orders-op-complete">{t("page.Detail.button.rcgk2q", "Complete")}</Button>
    
              <Button variant="light" onClick={() => openCancelModal(cancel)} data-testid="work_orders-op-cancel">{t("page.Detail.button.ew9em3", "Cancel")}</Button>
    
              <Button variant="light" onClick={() => openNotifyCustomerModal(notifyCustomer)} data-testid="work_orders-op-notifyCustomer">{t("page.Detail.button.07hxk4", "Notify Customer")}</Button>
    
              <Button variant="light" onClick={() => openAttachPhotoModal(attachPhoto)} data-testid="work_orders-op-attachPhoto">{t("page.Detail.button.vawlvk", "Attach Photo")}</Button>
    
              <Button variant="light" onClick={() => openUpdateModal(update)} data-testid="work_orders-op-update">{t("page.Detail.button.uk4kus", "Update")}</Button>
    
            </Group>
          </Stack>
        ) }
      </>
    </Stack>
  );
}
