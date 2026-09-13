// Auto-generated.  Do not edit by hand.
import { useParams, Link as RouterLink } from "react-router";
import { DecrementPartRequest, UpdatePartRequest, useDecrementPart, useUpdatePart } from "../../api/part";
import { t } from "../../i18n";
import { applyServerErrors } from "../../lib/apply-server-errors";
import { KeyValueRow } from "../../lib/format";
import { zodResolver } from "@hookform/resolvers/zod";
import { Alert, Anchor, Breadcrumbs, Button, Card, Group, NumberInput, Skeleton, Stack, Text, TextInput, Title } from "@mantine/core";
import { modals } from "@mantine/modals";
import { notifications } from "@mantine/notifications";
import { Controller, useForm } from "react-hook-form";
import { usePartById } from "../../api/part";
function openDecrementModal(mut: ReturnType<typeof useDecrementPart>): void {
  modals.open({
    title: t("page.Detail.modalTitle.jp6dsi", "Decrement"),
    children: <DecrementForm mut={mut} onClose={() => modals.closeAll()} />,
  });
}

function DecrementForm({ mut, onClose }: { mut: ReturnType<typeof useDecrementPart>; onClose: () => void }) {
  const { handleSubmit, setError, control } = useForm<DecrementPartRequest>({
    resolver: zodResolver(DecrementPartRequest),
    defaultValues: { qty: 0 },
  });
  return (
    <form
      data-testid="parts-op-decrement-form"
      onSubmit={handleSubmit(async (vals) => {
        try {
          await mut.mutateAsync(vals);
          notifications.show({ color: "green", message: t("pack.mantine.operationSucceeded.tpnozz", "{operation} succeeded", { operation: "Decrement" }) });
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
          name="qty"
          render={({ field, fieldState }) => (
            <NumberInput label="Qty" data-testid="parts-op-decrement-input-qty" allowDecimal={false} value={field.value as number | "" | undefined} onChange={(v) => field.onChange(typeof v === "number" ? v : Number(v) || 0)} error={fieldState.error?.message} />
          )}
        />

        <Group justify="flex-end" gap="xs" mt="md">
          <Button variant="default" onClick={onClose}>{t("chrome.cancel", "Cancel")}</Button>
          <Button type="submit" loading={mut.isPending} data-testid="parts-op-decrement-submit">Decrement</Button>
        </Group>
      </Stack>
    </form>
  );
}
function openUpdateModal(mut: ReturnType<typeof useUpdatePart>): void {
  modals.open({
    title: t("page.Detail.modalTitle.uk4kus", "Update"),
    children: <UpdateForm mut={mut} onClose={() => modals.closeAll()} />,
  });
}

function UpdateForm({ mut, onClose }: { mut: ReturnType<typeof useUpdatePart>; onClose: () => void }) {
  const { register, handleSubmit, setError, control, formState: { errors } } = useForm<UpdatePartRequest>({
    resolver: zodResolver(UpdatePartRequest),
    defaultValues: { sku: "", name: "", stockLevel: 0 },
  });
  return (
    <form
      data-testid="parts-op-update-form"
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
        <TextInput label="Sku" {...register("sku")} data-testid="parts-op-update-input-sku" error={errors.sku?.message} />

        <TextInput label="Name" {...register("name")} data-testid="parts-op-update-input-name" error={errors.name?.message} />

        <Controller
          control={control}
          name="stockLevel"
          render={({ field, fieldState }) => (
            <NumberInput label="Stock Level" data-testid="parts-op-update-input-stockLevel" allowDecimal={false} value={field.value as number | "" | undefined} onChange={(v) => field.onChange(typeof v === "number" ? v : Number(v) || 0)} error={fieldState.error?.message} />
          )}
        />

        <Group justify="flex-end" gap="xs" mt="md">
          <Button variant="default" onClick={onClose}>{t("chrome.cancel", "Cancel")}</Button>
          <Button type="submit" loading={mut.isPending} data-testid="parts-op-update-submit">Update</Button>
        </Group>
      </Stack>
    </form>
  );
}

export default function PartDetail() {
  const { id } = useParams<{ id: string }>();
  const partById = usePartById(id);
  const decrement = useDecrementPart(id ?? "");
  const update = useUpdatePart(id ?? "");
  return (
    <Stack gap="md" data-testid="parts-detail">
      <Breadcrumbs>
        <Anchor component={RouterLink} to="/">{t("page.Detail.anchor.n0mxf2", "Home")}</Anchor>
        <Anchor component={RouterLink} to="/parts">{t("page.Detail.anchor.cegybp", "Parts")}</Anchor>
        <Text>{t("page.Detail.text.ei31dg", "Detail")}</Text>
      </Breadcrumbs>
      <Title order={2}>{t("page.Detail.heading.b5kxkd", "Part detail")}</Title>
      <>
        { partById.isLoading && (
          <Stack gap="xs" aria-hidden="true">
    { Array.from({ length: 3 }).map((_, i) => (
    <Skeleton key={i} height={ 28 } radius="sm" />
    )) }
    </Stack>
        ) }
        { partById.isError && (
          <Alert color="red" variant="light">{t("page.Detail.alert.bcmf02", "Couldn't load part")}</Alert>
        ) }
        { !partById.isLoading && !partById.isError && !partById.data && (
          <Alert color="yellow" variant="light">{t("page.Detail.alert.f830o6", "No part matches that id.")}</Alert>
        ) }
        { partById.data && (
          <Stack gap="md">
            <Card withBorder padding="md">
              <Stack gap="md">
                <KeyValueRow label={t("page.Detail.keyValue.gkg0ca", "Sku")} data-testid="parts-detail-sku"><Text>{partById.data.sku}</Text></KeyValueRow>
                <KeyValueRow label={t("page.Detail.keyValue.4el6o6", "Name")} data-testid="parts-detail-name"><Text>{partById.data.name}</Text></KeyValueRow>
                <KeyValueRow label={t("page.Detail.keyValue.xiiotr", "Stock Level")} data-testid="parts-detail-stockLevel"><Text>{partById.data.stockLevel}</Text></KeyValueRow>
                <KeyValueRow label={t("page.Detail.keyValue.q0zd4n", "Version")} data-testid="parts-detail-version"><Text>{partById.data.version}</Text></KeyValueRow>
              </Stack>
            </Card>
            <Group gap="xs">
              <Button variant="filled" onClick={() => openDecrementModal(decrement)} data-testid="parts-op-decrement">{t("page.Detail.button.jp6dsi", "Decrement")}</Button>
    
              <Button variant="light" onClick={() => openUpdateModal(update)} data-testid="parts-op-update">{t("page.Detail.button.uk4kus", "Update")}</Button>
    
            </Group>
          </Stack>
        ) }
      </>
    </Stack>
  );
}
