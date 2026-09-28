// Auto-generated.  Do not edit by hand.
import { useParams, Link as RouterLink } from "react-router";
import { UpdateAssetRequest, useUpdateAsset } from "../../api/asset";
import { useAllSites } from "../../api/site";
import { t } from "../../i18n";
import { applyServerErrors } from "../../lib/apply-server-errors";
import { DateTimeValue, IdValue, KeyValueRow } from "../../lib/format";
import { zodResolver } from "@hookform/resolvers/zod";
import { Alert, Anchor, Badge, Breadcrumbs, Button, Card, Group, Select, Skeleton, Stack, Text, TextInput, Title } from "@mantine/core";
import { modals } from "@mantine/modals";
import { notifications } from "@mantine/notifications";
import { Controller, useForm } from "react-hook-form";
import { useAssetById } from "../../api/asset";
function openUpdateModal(mut: ReturnType<typeof useUpdateAsset>): void {
  modals.open({
    title: t("page.Detail.modalTitle.uk4kus", "Update"),
    children: <UpdateForm mut={mut} onClose={() => modals.closeAll()} />,
  });
}

function UpdateForm({ mut, onClose }: { mut: ReturnType<typeof useUpdateAsset>; onClose: () => void }) {
  const __sites = useAllSites();
  const { register, handleSubmit, setError, control, formState: { errors } } = useForm<UpdateAssetRequest>({
    resolver: zodResolver(UpdateAssetRequest),
    defaultValues: { siteId: "", serialNumber: "", model: "", warrantyExpiry: "", requiredSkill: "Electrical" },
  });
  return (
    <form
      data-testid="assets-op-update-form"
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
          name="siteId"
          render={({ field, fieldState }) => (
            <Select label="Site Id" data-testid="assets-op-update-input-siteId" placeholder={t("chrome.selectPlaceholder", "Select…")} searchable data={(__sites.data?.items ?? []).map((__o) => ({ value: __o.id, label: __o.display }))} renderOption={({ option }) => <div data-testid={`assets-op-update-input-siteId-option-${option.value}`}>{option.label}</div>} allowDeselect={false} value={field.value as string} onChange={(v) => field.onChange(v ?? "")} error={fieldState.error?.message} />
          )}
        />

        <TextInput label="Serial Number" {...register("serialNumber")} data-testid="assets-op-update-input-serialNumber" error={errors.serialNumber?.message} />

        <TextInput label="Model" {...register("model")} data-testid="assets-op-update-input-model" error={errors.model?.message} />

        <TextInput label="Warranty Expiry" {...register("warrantyExpiry")} data-testid="assets-op-update-input-warrantyExpiry" type="datetime-local" error={errors.warrantyExpiry?.message} />

        <Controller
          control={control}
          name="requiredSkill"
          render={({ field, fieldState }) => (
            <Select label="Required Skill" data-testid="assets-op-update-input-requiredSkill" data={ ["Electrical","Plumbing","HVAC","Refrigeration"] } allowDeselect={false} value={field.value as string} onChange={(v) => field.onChange(v)} error={fieldState.error?.message} />
          )}
        />

        <Group justify="flex-end" gap="xs" mt="md">
          <Button variant="default" onClick={onClose}>{t("chrome.cancel", "Cancel")}</Button>
          <Button type="submit" loading={mut.isPending} data-testid="assets-op-update-submit">Update</Button>
        </Group>
      </Stack>
    </form>
  );
}

export default function AssetDetail() {
  const { id } = useParams<{ id: string }>();
  const assetById = useAssetById(id);
  const update = useUpdateAsset(id ?? "");
  return (
    <Stack gap="md" data-testid="assets-detail">
      <Breadcrumbs>
        <Anchor component={RouterLink} to="/">{t("page.Detail.anchor.n0mxf2", "Home")}</Anchor>
        <Anchor component={RouterLink} to="/assets">{t("page.Detail.anchor.shidso", "Assets")}</Anchor>
        <Text>{t("page.Detail.text.ei31dg", "Detail")}</Text>
      </Breadcrumbs>
      <Title order={2}>{t("page.Detail.heading.1l9weo", "Asset detail")}</Title>
      <>
        { assetById.isLoading && (
          <Stack gap="xs" aria-hidden="true">
    { Array.from({ length: 3 }).map((_, i) => (
    <Skeleton key={i} height={ 28 } radius="sm" />
    )) }
    </Stack>
        ) }
        { assetById.isError && (
          <Alert color="red" variant="light">{t("page.Detail.alert.61qdeh", "Couldn't load asset")}</Alert>
        ) }
        { !assetById.isLoading && !assetById.isError && !assetById.data && (
          <Alert color="yellow" variant="light">{t("page.Detail.alert.8hplod", "No asset matches that id.")}</Alert>
        ) }
        { assetById.data && (
          <Stack gap="md">
            <Card withBorder padding="md">
              <Stack gap="md">
                <KeyValueRow label={t("page.Detail.keyValue.q4n5gn", "Site Id")} data-testid="assets-detail-siteId"><RouterLink to={`/sites/${ assetById.data.siteId }`}><IdValue id={ assetById.data.siteId } /></RouterLink></KeyValueRow>
                <KeyValueRow label={t("page.Detail.keyValue.0wq722", "Serial Number")} data-testid="assets-detail-serialNumber"><Text>{assetById.data.serialNumber}</Text></KeyValueRow>
                <KeyValueRow label={t("page.Detail.keyValue.07rbay", "Model")} data-testid="assets-detail-model"><Text>{assetById.data.model}</Text></KeyValueRow>
                <KeyValueRow label={t("page.Detail.keyValue.doifvo", "Warranty Expiry")} data-testid="assets-detail-warrantyExpiry"><DateTimeValue iso={ assetById.data.warrantyExpiry } /></KeyValueRow>
                <KeyValueRow label={t("page.Detail.keyValue.3oiuwt", "Required Skill")} data-testid="assets-detail-requiredSkill"><Badge tt="none">{ assetById.data.requiredSkill }</Badge></KeyValueRow>
                <KeyValueRow label={t("page.Detail.keyValue.q0zd4n", "Version")} data-testid="assets-detail-version"><Text>{assetById.data.version}</Text></KeyValueRow>
              </Stack>
            </Card>
            <Group gap="xs">
              <Button variant="filled" onClick={() => openUpdateModal(update)} data-testid="assets-op-update">{t("page.Detail.button.uk4kus", "Update")}</Button>
    
            </Group>
          </Stack>
        ) }
      </>
    </Stack>
  );
}
//# sourceMappingURL=detail.tsx.map
