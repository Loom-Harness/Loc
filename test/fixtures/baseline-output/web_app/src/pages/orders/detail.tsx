// Auto-generated.  Do not edit by hand.
import { useParams, Link as RouterLink } from "react-router";
import { AddLineOrderRequest, ConfirmOrderRequest, UpdateOrderRequest, useAddLineOrder, useConfirmOrder, useUpdateOrder } from "../../api/order";
import { useAllProducts } from "../../api/product";
import { t } from "../../i18n";
import { applyServerErrors } from "../../lib/apply-server-errors";
import { DateTimeValue, IdValue, KeyValueRow } from "../../lib/format";
import { LoomRefLabel } from "../../lib/ref-label";
import { zodResolver } from "@hookform/resolvers/zod";
import { Alert, Anchor, Badge, Breadcrumbs, Button, Card, Group, NumberInput, Select, Skeleton, Stack, Table, Text, TextInput, Title } from "@mantine/core";
import { modals } from "@mantine/modals";
import { notifications } from "@mantine/notifications";
import { Controller, useForm } from "react-hook-form";
import { useOrderById } from "../../api/order";
function openAddLineModal(mut: ReturnType<typeof useAddLineOrder>): void {
  modals.open({
    title: t("Orders.Order.op.addLine", "Add Line"),
    closeButtonProps: { "aria-label": t("chrome.close", "Close") },
    children: <AddLineForm mut={mut} onClose={() => modals.closeAll()} />,
  });
}

function AddLineForm({ mut, onClose }: { mut: ReturnType<typeof useAddLineOrder>; onClose: () => void }) {
  const __products = useAllProducts();
  const { handleSubmit, setError, control } = useForm<AddLineOrderRequest>({
    resolver: zodResolver(AddLineOrderRequest),
    defaultValues: { productId: "", qty: 0 },
  });
  return (
    <form
      data-testid="orders-op-addLine-form"
      onSubmit={handleSubmit(async (vals) => {
        try {
          await mut.mutateAsync(vals);
          notifications.show({ color: "green", message: t("chrome.operationSucceeded.addLine", "Add Line succeeded") });
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
          name="productId"
          render={({ field, fieldState }) => (
            <Select label="Product Id" data-testid="orders-op-addLine-input-productId" placeholder={t("chrome.selectPlaceholder", "Select…")} searchable data={(__products.data?.items ?? []).map((__o) => ({ value: __o.id, label: __o.display }))} renderOption={({ option }) => <div data-testid={`orders-op-addLine-input-productId-option-${option.value}`}>{option.label}</div>} allowDeselect={false} value={field.value as string} onChange={(v) => field.onChange(v ?? "")} error={fieldState.error?.message} />
          )}
        />

        <Controller
          control={control}
          name="qty"
          render={({ field, fieldState }) => (
            <NumberInput label="Qty" data-testid="orders-op-addLine-input-qty" allowDecimal={false} value={field.value as number | "" | undefined} onChange={(v) => field.onChange(typeof v === "number" ? v : Number(v) || 0)} error={fieldState.error?.message} />
          )}
        />

        <Group justify="flex-end" gap="xs" mt="md">
          <Button variant="default" onClick={onClose}>{t("chrome.cancel", "Cancel")}</Button>
          <Button type="submit" loading={mut.isPending} data-testid="orders-op-addLine-submit">{t("Orders.Order.op.addLine", "Add Line")}</Button>
        </Group>
      </Stack>
    </form>
  );
}
function openConfirmModal(mut: ReturnType<typeof useConfirmOrder>): void {
  modals.open({
    title: t("Orders.Order.op.confirm", "Confirm"),
    closeButtonProps: { "aria-label": t("chrome.close", "Close") },
    children: <ConfirmForm mut={mut} onClose={() => modals.closeAll()} />,
  });
}

function ConfirmForm({ mut, onClose }: { mut: ReturnType<typeof useConfirmOrder>; onClose: () => void }) {
  const { handleSubmit, setError } = useForm<ConfirmOrderRequest>({
    resolver: zodResolver(ConfirmOrderRequest),
    defaultValues: {  },
  });
  return (
    <form
      data-testid="orders-op-confirm-form"
      onSubmit={handleSubmit(async (vals) => {
        try {
          await mut.mutateAsync(vals);
          notifications.show({ color: "green", message: t("chrome.operationSucceeded.confirm", "Confirm succeeded") });
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
          <Button type="submit" loading={mut.isPending} data-testid="orders-op-confirm-submit">{t("Orders.Order.op.confirm", "Confirm")}</Button>
        </Group>
      </Stack>
    </form>
  );
}
function openUpdateModal(mut: ReturnType<typeof useUpdateOrder>): void {
  modals.open({
    title: t("Orders.Order.op.update", "Update"),
    closeButtonProps: { "aria-label": t("chrome.close", "Close") },
    children: <UpdateForm mut={mut} onClose={() => modals.closeAll()} />,
  });
}

function UpdateForm({ mut, onClose }: { mut: ReturnType<typeof useUpdateOrder>; onClose: () => void }) {
  const { register, handleSubmit, setError, control, formState: { errors } } = useForm<UpdateOrderRequest>({
    resolver: zodResolver(UpdateOrderRequest),
    defaultValues: { customerId: "", status: "Draft", placedAt: "" },
  });
  return (
    <form
      data-testid="orders-op-update-form"
      onSubmit={handleSubmit(async (vals) => {
        try {
          await mut.mutateAsync(vals);
          notifications.show({ color: "green", message: t("chrome.operationSucceeded.update", "Update succeeded") });
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
        <TextInput label={ t("Orders.Order.field.customerId", "Customer Id") } {...register("customerId")} data-testid="orders-op-update-input-customerId" error={errors.customerId?.message} />

        <Controller
          control={control}
          name="status"
          render={({ field, fieldState }) => (
            <Select label={ t("Orders.Order.field.status", "Status") } data-testid="orders-op-update-input-status" data={ (["Draft","Confirmed","Shipped","Cancelled"]).map((v) => ({ value: v, label: (((v: string | null | undefined): string => v == null ? "" : ({ "Draft": t("Orders.OrderStatus.value.Draft", "Draft"), "Confirmed": t("Orders.OrderStatus.value.Confirmed", "Confirmed"), "Shipped": t("Orders.OrderStatus.value.Shipped", "Shipped"), "Cancelled": t("Orders.OrderStatus.value.Cancelled", "Cancelled") } as Record<string, string>)[v] ?? v))(v) })) } allowDeselect={false} value={field.value as string} onChange={(v) => field.onChange(v)} error={fieldState.error?.message} />
          )}
        />

        <TextInput label={ t("Orders.Order.field.placedAt", "Placed At") } {...register("placedAt")} data-testid="orders-op-update-input-placedAt" type="datetime-local" error={errors.placedAt?.message} />

        <Group justify="flex-end" gap="xs" mt="md">
          <Button variant="default" onClick={onClose}>{t("chrome.cancel", "Cancel")}</Button>
          <Button type="submit" loading={mut.isPending} data-testid="orders-op-update-submit">{t("Orders.Order.op.update", "Update")}</Button>
        </Group>
      </Stack>
    </form>
  );
}

export default function OrderDetail() {
  const { id } = useParams<{ id: string }>();
  const orderById = useOrderById(id);
  const addLine = useAddLineOrder(id ?? "");
  const confirm = useConfirmOrder(id ?? "");
  const update = useUpdateOrder(id ?? "");
  return (
    <Stack gap="md" data-testid="orders-detail">
      <Breadcrumbs>
        <Anchor component={RouterLink} to="/">{t("WebApp.page.Detail.anchor.n0mxf2", "Home")}</Anchor>
        <Anchor component={RouterLink} to="/orders">{t("Orders.Order.name.other", "Orders")}</Anchor>
        <Text>{t("WebApp.page.Detail.text.ei31dg", "Detail")}</Text>
      </Breadcrumbs>
      <Title order={2}>{t("WebApp.page.Detail.heading.90lkpw", "Order detail")}</Title>
      <>
        { orderById.isLoading && (
          <Stack gap="xs" aria-hidden="true">
    { Array.from({ length: 3 }).map((_, i) => (
    <Skeleton key={i} height={ 28 } radius="sm" />
    )) }
    </Stack>
        ) }
        { orderById.isError && (
          <Alert color="red" variant="light">{t("WebApp.page.Detail.alert.4exfgx", "Couldn't load order")}</Alert>
        ) }
        { !orderById.isLoading && !orderById.isError && !orderById.data && (
          <Alert color="yellow" variant="light">{t("WebApp.page.Detail.alert.fobqop", "No order matches that id.")}</Alert>
        ) }
        { orderById.data && (
          <Stack gap="md">
            <Card withBorder padding="md">
              <Stack gap="md">
                <KeyValueRow label={t("Orders.Order.field.customerId", "Customer Id")} data-testid="orders-detail-customerId"><Text>{orderById.data.customerId}</Text></KeyValueRow>
                <KeyValueRow label={t("Orders.Order.field.status", "Status")} data-testid="orders-detail-status"><Badge tt="none">{ ((v: string | null | undefined): string => v == null ? "" : ({ "Draft": t("Orders.OrderStatus.value.Draft", "Draft"), "Confirmed": t("Orders.OrderStatus.value.Confirmed", "Confirmed"), "Shipped": t("Orders.OrderStatus.value.Shipped", "Shipped"), "Cancelled": t("Orders.OrderStatus.value.Cancelled", "Cancelled") } as Record<string, string>)[v] ?? v)(orderById.data.status) }</Badge></KeyValueRow>
                <KeyValueRow label={t("Orders.Order.field.placedAt", "Placed At")} data-testid="orders-detail-placedAt"><DateTimeValue iso={ orderById.data.placedAt } /></KeyValueRow>
              </Stack>
            </Card>
            <Card withBorder padding="md" data-testid="orders-detail-lines">
              <Stack gap="md">
                <Title order={4}>{t("Orders.Order.field.lines", "Lines")}</Title>
                <div className="loom-table-scroll" style={{ width: "100%", overflowX: "auto" }}><Table striped highlightOnHover>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>{t("Orders.OrderLine.field.productId", "Product Id")}</Table.Th>
                      <Table.Th>{t("Orders.OrderLine.field.quantity", "Quantity")}</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    { orderById.data.lines.map((row, idx) => (
                      <Table.Tr key={ idx }>
                        <Table.Td><RouterLink to={`/products/${ row.productId }`}><LoomRefLabel path="/products/" id={ row.productId }><IdValue id={ row.productId } /></LoomRefLabel></RouterLink></Table.Td>
                        <Table.Td><Text>{row.quantity}</Text></Table.Td>
                      </Table.Tr>
                    )) }
                  </Table.Tbody>
                </Table></div>
              </Stack>
            </Card>
            <Group gap="xs">
              <Button variant="filled" onClick={() => openAddLineModal(addLine)} data-testid="orders-op-addLine">{t("Orders.Order.op.addLine", "Add Line")}</Button>
    
              <Button variant="light" onClick={() => openConfirmModal(confirm)} data-testid="orders-op-confirm">{t("Orders.Order.op.confirm", "Confirm")}</Button>
    
              <Button variant="light" onClick={() => openUpdateModal(update)} data-testid="orders-op-update">{t("Orders.Order.op.update", "Update")}</Button>
    
            </Group>
          </Stack>
        ) }
      </>
    </Stack>
  );
}
