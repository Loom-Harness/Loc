// Auto-generated.  Do not edit by hand.
import Decimal from "decimal.js";
import { useParams, Link as RouterLink } from "react-router";
import { ConsumePartRequest, UpdatePartRequest, type UpdatePartFormState, useConsumePart, useUpdatePart } from "../../api/part";
import { t } from "../../i18n";
import { applyServerErrors } from "../../lib/apply-server-errors";
import { KeyValueRow, MoneyValue } from "../../lib/format";
import { zodResolver } from "@hookform/resolvers/zod";
import { Alert, Anchor, Breadcrumbs, Button, Card, Group, NumberInput, Skeleton, Stack, Text, TextInput, Title } from "@mantine/core";
import { modals } from "@mantine/modals";
import { notifications } from "@mantine/notifications";
import { Controller, useForm } from "react-hook-form";
import { usePartById } from "../../api/part";
function openConsumeModal(mut: ReturnType<typeof useConsumePart>): void {
  modals.open({
    title: t("page.Detail.modalTitle.p6tdup", "Consume"),
    children: <ConsumeForm mut={mut} onClose={() => modals.closeAll()} />,
  });
}

function ConsumeForm({ mut, onClose }: { mut: ReturnType<typeof useConsumePart>; onClose: () => void }) {
  const { handleSubmit, setError, control } = useForm<ConsumePartRequest>({
    resolver: zodResolver(ConsumePartRequest),
    defaultValues: { qty: 0 },
  });
  return (
    <form
      data-testid="parts-op-consume-form"
      onSubmit={handleSubmit(async (vals) => {
        try {
          await mut.mutateAsync(vals);
          notifications.show({ color: "green", message: t("pack.mantine.operationSucceeded.tpnozz", "{operation} succeeded", { operation: "Consume" }) });
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
            <NumberInput label="Qty" data-testid="parts-op-consume-input-qty" allowDecimal={false} value={field.value as number | "" | undefined} onChange={(v) => field.onChange(typeof v === "number" ? v : Number(v) || 0)} error={fieldState.error?.message} />
          )}
        />

        <Group justify="flex-end" gap="xs" mt="md">
          <Button variant="default" onClick={onClose}>{t("chrome.cancel", "Cancel")}</Button>
          <Button type="submit" loading={mut.isPending} data-testid="parts-op-consume-submit">Consume</Button>
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
  const { register, handleSubmit, setError, control, formState: { errors } } = useForm<UpdatePartFormState, unknown, UpdatePartRequest>({
    resolver: zodResolver(UpdatePartRequest),
    defaultValues: { sku: "", binCode: "", onHand: 0, unitPrice: new Decimal("0"), currency: "" },
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

        <TextInput label="Bin Code" {...register("binCode")} data-testid="parts-op-update-input-binCode" error={errors.binCode?.message} />

        <Controller
          control={control}
          name="onHand"
          render={({ field, fieldState }) => (
            <NumberInput label="On Hand" data-testid="parts-op-update-input-onHand" allowDecimal={false} value={field.value as number | "" | undefined} onChange={(v) => field.onChange(typeof v === "number" ? v : Number(v) || 0)} error={fieldState.error?.message} />
          )}
        />

        <Controller
          control={control}
          name="unitPrice"
          render={({ field, fieldState }) => (
            <TextInput label="Unit Price" data-testid="parts-op-update-input-unitPrice" value={field.value instanceof Decimal ? field.value.toString() : String(field.value ?? "0")} onChange={(e) => { try { field.onChange(new Decimal(e.currentTarget.value || "0")); } catch { field.onChange(new Decimal("0")); } }} inputMode="decimal" error={fieldState.error?.message} />
          )}
        />

        <TextInput label="Currency" {...register("currency")} data-testid="parts-op-update-input-currency" error={errors.currency?.message} />

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
  const consume = useConsumePart(id ?? "");
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
                <KeyValueRow label={t("page.Detail.keyValue.jzz8on", "Bin Code")} data-testid="parts-detail-binCode"><Text>{partById.data.binCode}</Text></KeyValueRow>
                <KeyValueRow label={t("page.Detail.keyValue.t1szj5", "On Hand")} data-testid="parts-detail-onHand"><Text>{partById.data.onHand}</Text></KeyValueRow>
                <KeyValueRow label={t("page.Detail.keyValue.ha4he2", "Unit Price")} data-testid="parts-detail-unitPrice"><MoneyValue value={ partById.data.unitPrice } /></KeyValueRow>
                <KeyValueRow label={t("page.Detail.keyValue.5o3zh2", "Currency")} data-testid="parts-detail-currency"><Text>{partById.data.currency}</Text></KeyValueRow>
                <KeyValueRow label={t("page.Detail.keyValue.q0zd4n", "Version")} data-testid="parts-detail-version"><Text>{partById.data.version}</Text></KeyValueRow>
              </Stack>
            </Card>
            <Group gap="xs">
              <Button variant="filled" onClick={() => openConsumeModal(consume)} data-testid="parts-op-consume">{t("page.Detail.button.p6tdup", "Consume")}</Button>
    
              <Button variant="light" onClick={() => openUpdateModal(update)} data-testid="parts-op-update">{t("page.Detail.button.uk4kus", "Update")}</Button>
    
            </Group>
          </Stack>
        ) }
      </>
    </Stack>
  );
}
//# sourceMappingURL=detail.tsx.map
