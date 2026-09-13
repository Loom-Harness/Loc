// Auto-generated.  Do not edit by hand.
import { useParams, Link as RouterLink } from "react-router";
import { UpdateTechnicianRequest, useUpdateTechnician } from "../../api/technician";
import { t } from "../../i18n";
import { applyServerErrors } from "../../lib/apply-server-errors";
import { KeyValueRow } from "../../lib/format";
import { zodResolver } from "@hookform/resolvers/zod";
import { Alert, Anchor, Breadcrumbs, Button, Card, Group, NumberInput, Skeleton, Stack, Text, TextInput, Title } from "@mantine/core";
import { modals } from "@mantine/modals";
import { notifications } from "@mantine/notifications";
import { Controller, useForm } from "react-hook-form";
import { useTechnicianById } from "../../api/technician";
function openUpdateModal(mut: ReturnType<typeof useUpdateTechnician>): void {
  modals.open({
    title: t("page.Detail.modalTitle.uk4kus", "Update"),
    children: <UpdateForm mut={mut} onClose={() => modals.closeAll()} />,
  });
}

function UpdateForm({ mut, onClose }: { mut: ReturnType<typeof useUpdateTechnician>; onClose: () => void }) {
  const { register, handleSubmit, setError, control, formState: { errors } } = useForm<UpdateTechnicianRequest>({
    resolver: zodResolver(UpdateTechnicianRequest),
    defaultValues: { userId: "", name: "", skills: [], costRatePerHour: 0 },
  });
  return (
    <form
      data-testid="technicians-op-update-form"
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
        <TextInput label="User Id" {...register("userId")} data-testid="technicians-op-update-input-userId" error={errors.userId?.message} />

        <TextInput label="Name" {...register("name")} data-testid="technicians-op-update-input-name" error={errors.name?.message} />

        <TextInput label="Skills" {...register("skills")} data-testid="technicians-op-update-input-skills" placeholder={t("pack.mantine.arrayUnsupported.m0hiqj", "(arrays not yet supported in forms)")} disabled error={errors.skills?.message} />

        <Controller
          control={control}
          name="costRatePerHour"
          render={({ field, fieldState }) => (
            <NumberInput label="Cost Rate Per Hour" data-testid="technicians-op-update-input-costRatePerHour" decimalScale={2} fixedDecimalScale value={field.value as number | "" | undefined} onChange={(v) => field.onChange(typeof v === "number" ? v : Number(v) || 0)} error={fieldState.error?.message} />
          )}
        />

        <Group justify="flex-end" gap="xs" mt="md">
          <Button variant="default" onClick={onClose}>{t("chrome.cancel", "Cancel")}</Button>
          <Button type="submit" loading={mut.isPending} data-testid="technicians-op-update-submit">Update</Button>
        </Group>
      </Stack>
    </form>
  );
}

export default function TechnicianDetail() {
  const { id } = useParams<{ id: string }>();
  const technicianById = useTechnicianById(id);
  const update = useUpdateTechnician(id ?? "");
  return (
    <Stack gap="md" data-testid="technicians-detail">
      <Breadcrumbs>
        <Anchor component={RouterLink} to="/">{t("page.Detail.anchor.n0mxf2", "Home")}</Anchor>
        <Anchor component={RouterLink} to="/technicians">{t("page.Detail.anchor.26rebs", "Technicians")}</Anchor>
        <Text>{t("page.Detail.text.ei31dg", "Detail")}</Text>
      </Breadcrumbs>
      <Title order={2}>{t("page.Detail.heading.konreo", "Technician detail")}</Title>
      <>
        { technicianById.isLoading && (
          <Stack gap="xs" aria-hidden="true">
    { Array.from({ length: 3 }).map((_, i) => (
    <Skeleton key={i} height={ 28 } radius="sm" />
    )) }
    </Stack>
        ) }
        { technicianById.isError && (
          <Alert color="red" variant="light">{t("page.Detail.alert.h8mlql", "Couldn't load technician")}</Alert>
        ) }
        { !technicianById.isLoading && !technicianById.isError && !technicianById.data && (
          <Alert color="yellow" variant="light">{t("page.Detail.alert.natqzr", "No technician matches that id.")}</Alert>
        ) }
        { technicianById.data && (
          <Stack gap="md">
            <Card withBorder padding="md">
              <Stack gap="md">
                <KeyValueRow label={t("page.Detail.keyValue.ywrhgr", "User Id")} data-testid="technicians-detail-userId"><Text>{technicianById.data.userId}</Text></KeyValueRow>
                <KeyValueRow label={t("page.Detail.keyValue.4el6o6", "Name")} data-testid="technicians-detail-name"><Text>{technicianById.data.name}</Text></KeyValueRow>
                <KeyValueRow label={t("page.Detail.keyValue.vawwep", "Cost Rate Per Hour")} data-testid="technicians-detail-costRatePerHour"><Text>{technicianById.data.costRatePerHour}</Text></KeyValueRow>
                <KeyValueRow label={t("page.Detail.keyValue.q0zd4n", "Version")} data-testid="technicians-detail-version"><Text>{technicianById.data.version}</Text></KeyValueRow>
              </Stack>
            </Card>
            <Group gap="xs">
              <Button variant="filled" onClick={() => openUpdateModal(update)} data-testid="technicians-op-update">{t("page.Detail.button.uk4kus", "Update")}</Button>
    
            </Group>
          </Stack>
        ) }
      </>
    </Stack>
  );
}
